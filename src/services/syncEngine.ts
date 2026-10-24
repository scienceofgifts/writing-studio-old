/**
 * Science of Gifts - Cloud-Authoritative Synchronization Engine
 * Manages synchronization between local IndexedDB/LocalStorage and Cloud Firestore.
 *
 * Core guarantees:
 * 1. Projects are NEVER auto-pushed on a timer or background storage listener.
 * 2. Initial login completes an authenticated remote read before any write and never
 *    uploads stale local projects or local-only drafts automatically.
 * 3. Every cloud project save uses an atomic transaction verifying `cloudRevision`
 *    against the client's `baseCloudRevision`, writing both the project document
 *    and `users/{userId}/projects/{projectId}/history/{snapshotId}` atomically.
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
  getDoc,
  runTransaction,
} from 'firebase/firestore';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, signInWithGoogle, signOutUser } from './firebase';
import { storage } from './storage';
import { WritingProject, ProjectConflictInfo } from '../types/project';
import { ProjectVersionSnapshot } from '../types/versionHistory';
import {
  createVersionSnapshot,
  mergeVersionHistories,
  trimInlineVersionHistory,
} from './versionHistoryService';
import { StyleProfile } from '../types/styleReference';
import { InternalLink } from '../types/internalLink';
import { ResearchStudy, ResearchClaim } from '../types/research';
import { SavedEditorialIdea } from '../types/ideaGenerator';
import { GlobalInstruction } from '../types/project';
import { ensureSemanticHtml } from '../utils/richText';

export type SyncStatus = 'signed_out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatusInfo {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  isOnline: boolean;
}

export type CloudSaveResult =
  | {
      status: 'saved_cloud';
      savedProject: WritingProject;
      cloudRevision: number;
      syncedAt: string;
    }
  | {
      status: 'saved_local';
      savedProject: WritingProject;
    }
  | {
      status: 'conflict';
      conflict: ProjectConflictInfo;
    }
  | {
      status: 'cloud_error';
      errorMessage: string;
    };

export interface TestCloudTransport {
  currentUser?: { uid: string; email?: string | null; displayName?: string | null } | null;
  simulateOffline?: boolean;
  simulateSaveError?: string | null;
  simulateReadError?: string | null;
  projects?: Record<string, Record<string, WritingProject>>;
  history?: Record<string, Record<string, Record<string, ProjectVersionSnapshot>>>;
}

declare global {
  interface Window {
    __SOG_TEST_CLOUD__?: TestCloudTransport;
    __SOG_SYNC_ENGINE__?: SyncEngine;
  }
}

function cleanUndefinedForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_key, value) => (value === undefined ? null : value)));
}

class SyncEngine {
  private currentUser: User | null = null;
  private status: SyncStatus = 'signed_out';
  private lastSyncedAt: string | null = null;
  private errorMessage: string | null = null;
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;

  private isApplyingRemote: boolean = false;
  private isReconcilingLogin: boolean = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private activeUnsubscribers: Unsubscribe[] = [];
  private listeners: Set<(info: SyncStatusInfo) => void> = new Set();
  private conflictListeners: Set<(conflict: ProjectConflictInfo) => void> = new Set();
  private remoteProjectListeners: Set<(remoteProjects: WritingProject[]) => void> = new Set();
  private storageUnsubscribe: (() => void) | null = null;
  private activeConflicts: Map<string, ProjectConflictInfo> = new Map();

  constructor() {
    if (typeof window !== 'undefined') {
      window.__SOG_SYNC_ENGINE__ = this;
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }

    // Monitor Firebase Authentication
    onAuthStateChanged(auth, (user) => {
      if (typeof window !== 'undefined' && window.__SOG_TEST_CLOUD__?.currentUser !== undefined) {
        return;
      }
      this.handleAuthChange(user);
    });

    // Subscribe ONLY to non-project local storage changes (settings, style profiles, links, research)
    setTimeout(() => {
      try {
        if (typeof storage !== 'undefined' && typeof storage.subscribeNonProjectChanges === 'function') {
          this.storageUnsubscribe = storage.subscribeNonProjectChanges(() => {
            this.handleNonProjectLocalEdit();
          });
        }
      } catch (e) {
        console.warn('Storage subscription notice:', e);
      }
    }, 100);
  }

  private getTestTransport(): TestCloudTransport | undefined {
    if (typeof window !== 'undefined' && window.__SOG_TEST_CLOUD__) {
      return window.__SOG_TEST_CLOUD__;
    }
    return undefined;
  }

  // ==========================================
  // PUBLIC EVENT SUBSCRIBERS
  // ==========================================
  public subscribe(callback: (info: SyncStatusInfo) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatusInfo());
    return () => this.listeners.delete(callback);
  }

  public subscribeConflicts(callback: (conflict: ProjectConflictInfo) => void): () => void {
    this.conflictListeners.add(callback);
    return () => this.conflictListeners.delete(callback);
  }

  public subscribeRemoteProjects(callback: (remoteProjects: WritingProject[]) => void): () => void {
    this.remoteProjectListeners.add(callback);
    return () => this.remoteProjectListeners.delete(callback);
  }

  public getConflictForProject(projectId: string): ProjectConflictInfo | undefined {
    return this.activeConflicts.get(projectId);
  }

  public clearConflictForProject(projectId: string): void {
    this.activeConflicts.delete(projectId);
  }

  public registerConflict(conflict: ProjectConflictInfo): void {
    this.activeConflicts.set(conflict.projectId, conflict);
    this.conflictListeners.forEach((fn) => {
      try {
        fn(conflict);
      } catch (err) {
        console.error('Conflict listener error:', err);
      }
    });
  }

  public getStatusInfo(): SyncStatusInfo {
    const testTransport = this.getTestTransport();
    const effectiveOnline = testTransport?.simulateOffline ? false : this.isOnline;
    return {
      status: this.status,
      user: this.currentUser,
      lastSyncedAt: this.lastSyncedAt,
      errorMessage: this.errorMessage,
      isOnline: effectiveOnline,
    };
  }

  public isSignedIn(): boolean {
    return Boolean(this.currentUser);
  }

  private notifyStatusChange(): void {
    const info = this.getStatusInfo();
    this.listeners.forEach((fn) => {
      try {
        fn(info);
      } catch (err) {
        console.error('Sync listener error:', err);
      }
    });
  }

  // ==========================================
  // AUTHENTICATION & INITIALIZATION
  // ==========================================
  public async login(): Promise<User> {
    try {
      this.status = 'syncing';
      this.errorMessage = null;
      this.notifyStatusChange();
      const user = await signInWithGoogle();
      return user;
    } catch (err: any) {
      if (
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request'
      ) {
        this.status = 'signed_out';
        this.errorMessage = null;
        this.notifyStatusChange();
      } else if (err?.code === 'auth/popup-blocked') {
        this.status = 'signed_out';
        this.errorMessage =
          'Sign-in popup was blocked by your browser. Please allow popups and try again.';
        this.notifyStatusChange();
      } else {
        this.status = 'error';
        this.errorMessage = err?.message || 'Failed to sign in with Google.';
        this.notifyStatusChange();
      }
      throw err;
    }
  }

  public async logout(): Promise<void> {
    try {
      this.detachSnapshotListeners();
      if (!this.getTestTransport()) {
        await signOutUser();
      } else if (this.getTestTransport()) {
        this.getTestTransport()!.currentUser = null;
      }
      this.currentUser = null;
      this.status = 'signed_out';
      this.notifyStatusChange();
    } catch (err: any) {
      console.error('Logout error:', err);
    }
  }

  /**
   * Used by automated verification tests to simulate sign-in/sign-out with a test user
   * while executing the exact production reconciliation & transaction pipeline.
   */
  public async simulateTestAuthChange(
    testUser: { uid: string; email?: string | null; displayName?: string | null } | null
  ): Promise<void> {
    await this.handleAuthChange(testUser as User | null);
  }

  private async handleAuthChange(user: User | null): Promise<void> {
    this.currentUser = user;

    if (!user) {
      this.detachSnapshotListeners();
      this.status = 'signed_out';
      this.errorMessage = null;
      this.notifyStatusChange();
      return;
    }

    const testTransport = this.getTestTransport();
    if (!this.isOnline || testTransport?.simulateOffline) {
      this.status = 'offline';
      this.notifyStatusChange();
      return;
    }

    try {
      this.status = 'syncing';
      this.errorMessage = null;
      this.notifyStatusChange();

      // Step 1: Perform safe cloud-authoritative reconciliation (READ-FIRST, NO PROJECT AUTO-UPLOAD)
      await this.performInitialReconciliation(user.uid);

      // Step 2: Attach real-time snapshot listeners for remote changes
      this.attachSnapshotListeners(user.uid);

      this.status = 'synced';
      this.lastSyncedAt = new Date().toISOString();
      this.notifyStatusChange();
    } catch (err: any) {
      console.error('Initial sync error:', err);
      this.status = 'error';
      this.errorMessage = err?.message || 'Failed to initialize cloud synchronization.';
      this.notifyStatusChange();
    }
  }

  private handleNetworkChange(online: boolean): void {
    this.isOnline = online;
    if (!online) {
      this.status = 'offline';
      this.notifyStatusChange();
    } else if (this.currentUser) {
      this.retrySync();
    } else {
      this.status = 'signed_out';
      this.notifyStatusChange();
    }
  }

  public async retrySync(): Promise<void> {
    if (!this.currentUser) return;
    const testTransport = this.getTestTransport();
    if (!this.isOnline || testTransport?.simulateOffline) {
      this.status = 'offline';
      this.notifyStatusChange();
      return;
    }

    try {
      this.status = 'syncing';
      this.errorMessage = null;
      this.notifyStatusChange();

      await this.performInitialReconciliation(this.currentUser.uid);
      this.attachSnapshotListeners(this.currentUser.uid);

      this.status = 'synced';
      this.lastSyncedAt = new Date().toISOString();
      this.notifyStatusChange();
    } catch (err: any) {
      this.status = 'error';
      this.errorMessage = err?.message || 'Cloud sync retry failed.';
      this.notifyStatusChange();
    }
  }

  // ==========================================
  // CLOUD TRANSPORT PRIMITIVES (FIRESTORE + TEST HOOK)
  // ==========================================
  private async fetchRemoteProjectsList(userId: string): Promise<WritingProject[]> {
    const testTransport = this.getTestTransport();
    if (testTransport) {
      if (testTransport.simulateOffline) {
        throw new Error('Network offline: unable to read cloud projects.');
      }
      if (testTransport.simulateReadError) {
        throw new Error(testTransport.simulateReadError);
      }
      const userProjects = testTransport.projects?.[userId] || {};
      return Object.values(userProjects).map((p) => JSON.parse(JSON.stringify(p)));
    }

    const path = `users/${userId}/projects`;
    try {
      const snapshot = await getDocs(collection(db, 'users', userId, 'projects'));
      return snapshot.docs.map((docSnap) => docSnap.data() as WritingProject);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      throw err;
    }
  }

  public async fetchProjectCloudHistory(projectId: string): Promise<ProjectVersionSnapshot[]> {
    if (!this.currentUser) return [];
    const userId = this.currentUser.uid;
    const testTransport = this.getTestTransport();
    if (testTransport) {
      if (testTransport.simulateOffline) return [];
      const projHist = testTransport.history?.[userId]?.[projectId] || {};
      return Object.values(projHist).map((s) => JSON.parse(JSON.stringify(s)));
    }

    if (!this.isOnline) return [];
    try {
      const histCol = collection(db, 'users', userId, 'projects', projectId, 'history');
      const snap = await getDocs(histCol);
      return snap.docs.map((d) => d.data() as ProjectVersionSnapshot);
    } catch (err) {
      console.warn(`Could not read cloud history for project ${projectId}:`, err);
      return [];
    }
  }

  // ==========================================
  // REQUIREMENT 4: SAFE INITIAL LOGIN RECONCILIATION
  // ==========================================
  private async performInitialReconciliation(userId: string): Promise<void> {
    this.isReconcilingLogin = true;
    try {
      // 1. Reconcile Writing Projects using strict Cloud-Authoritative, Zero-Auto-Upload rules
      await this.reconcileProjectsOnLogin(userId);

      // 2. Non-project reference collections (skip in test transport mode if only testing projects)
      if (!this.getTestTransport()) {
        await this.mergeCollection<StyleProfile>(
          userId,
          'style_profiles',
          storage.getRawStyleProfilesIncludingDeleted(),
          (merged) => storage.saveStyleProfilesFromRemote(merged)
        );
        await this.mergeCollection<InternalLink>(
          userId,
          'internal_links',
          storage.getRawInternalLinksIncludingDeleted(),
          (merged) => storage.saveInternalLinksFromRemote(merged)
        );
        await this.mergeCollection<ResearchStudy>(
          userId,
          'research_studies',
          storage.getRawResearchStudiesIncludingDeleted(),
          (merged) => storage.saveResearchStudiesFromRemote(merged)
        );
        await this.mergeCollection<ResearchClaim>(
          userId,
          'research_claims',
          storage.getRawResearchClaimsIncludingDeleted(),
          (merged) => storage.saveResearchClaimsFromRemote(merged)
        );
        await this.mergeCollection<SavedEditorialIdea>(
          userId,
          'saved_ideas',
          storage.getRawSavedIdeasIncludingDeleted(),
          (merged) => storage.saveSavedIdeasFromRemote(merged)
        );
        await this.mergeCollection<GlobalInstruction>(
          userId,
          'global_instructions',
          storage.getRawGlobalInstructionsIncludingDeleted(),
          (merged) => storage.saveGlobalInstructionsFromRemote(merged)
        );
        await this.mergeSettings(userId);
      }
    } finally {
      this.isReconcilingLogin = false;
    }
  }

  /**
   * Requirement 4:
   * - Completes an authenticated remote read before any project upload is allowed.
   * - If the remote read fails or is offline, throws immediately (never treats failure as empty DB).
   * - Existing cloud versions ALWAYS take precedence over stale local versions.
   * - Never uploads local versions or local-only records during initial login.
   * - Preserves local-only drafts locally as unsynced (`_hasLocalUnsyncedSave: true`).
   * - Archives any differing local saved copy into version history so no work is ever lost.
   */
  public async reconcileProjectsOnLogin(userId: string): Promise<void> {
    // Step 1: Authenticated remote read (throws on error/offline)
    const remoteProjects = await this.fetchRemoteProjectsList(userId);
    const remoteMap = new Map<string, WritingProject>();
    remoteProjects.forEach((p) => remoteMap.set(p.id, p));

    const localItems = storage.getRawProjectsIncludingDeleted();
    const localMap = new Map<string, WritingProject>();
    localItems.forEach((p) => localMap.set(p.id, p));

    const reconciledList: WritingProject[] = [];
    const allIds = new Set<string>([...remoteMap.keys(), ...localMap.keys()]);

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);

      if (remote && !local) {
        // Exists only in cloud -> adopt cloud version
        const remoteRev = typeof remote.cloudRevision === 'number' ? remote.cloudRevision : 1;
        reconciledList.push({
          ...remote,
          content: ensureSemanticHtml(remote.content),
          cloudRevision: remoteRev,
          baseCloudRevision: remoteRev,
          lastSyncedUserId: userId,
          _hasLocalUnsyncedSave: false,
          _isSeedProject: false,
        });
      } else if (local && !remote) {
        // Exists only locally -> DO NOT upload on login!
        // If it is an unmodified default seed project, keep it clean; otherwise mark as local unsynced draft.
        const isSeed = storage.isDefaultSeedProject(local);
        reconciledList.push({
          ...local,
          cloudRevision: 0,
          baseCloudRevision: 0,
          _hasLocalUnsyncedSave: !isSeed,
          _isSeedProject: isSeed,
        });
      } else if (local && remote) {
        // Both exist locally and in cloud -> Cloud version is authoritative!
        const remoteRev = typeof remote.cloudRevision === 'number' ? remote.cloudRevision : 1;
        const localContentNorm = ensureSemanticHtml(local.content);
        const remoteContentNorm = ensureSemanticHtml(remote.content);
        const isLocalSeed = storage.isDefaultSeedProject(local);

        let mergedHistory = mergeVersionHistories(local.versionHistory, remote.versionHistory);

        // If local had non-seed content that differs from the cloud version, preserve a backup snapshot in history
        if (
          !isLocalSeed &&
          !local._isDeleted &&
          (localContentNorm !== remoteContentNorm || local.title !== remote.title)
        ) {
          const backupHistory = createVersionSnapshot(
            { ...local, versionHistory: mergedHistory },
            'conflict_backup',
            {
              label: 'Local device copy preserved on sign-in',
              actionDescription: 'Automatic backup of local copy prior to cloud sign-in reconciliation',
              force: true,
            }
          );
          mergedHistory = mergeVersionHistories(backupHistory, mergedHistory);
          storage.saveProjectHistorySnapshots(id, mergedHistory);
        }

        const authoritativeProject: WritingProject = {
          ...local,
          ...remote,
          content: remoteContentNorm,
          versionHistory: trimInlineVersionHistory(mergedHistory),
          cloudRevision: remoteRev,
          baseCloudRevision: remoteRev,
          lastSyncedUserId: userId,
          _hasLocalUnsyncedSave: false,
          _isSeedProject: false,
        };

        reconciledList.push(authoritativeProject);
      }
    }

    this.isApplyingRemote = true;
    try {
      storage.saveProjectsFromRemote(reconciledList, { replaceAllReconciled: true });
    } finally {
      this.isApplyingRemote = false;
    }

    // Notify App.tsx of authoritative remote projects so it can reconcile active editor state
    this.remoteProjectListeners.forEach((fn) => {
      try {
        fn(reconciledList.filter((p) => !p._isDeleted));
      } catch (err) {
        console.error('Remote project listener error:', err);
      }
    });
  }

  // ==========================================
  // REQUIREMENT 5 & 7: CONCURRENCY-SAFE ATOMIC CLOUD SAVE
  // ==========================================
  /**
   * Saves a single project and its new version snapshot(s) to Firestore atomically.
   * Verifies `remote.cloudRevision === expectedBaseRevision` inside a transaction.
   * Never silently overwrites a newer cloud revision unless `options.forceOverwrite` is explicitly true.
   */
  public async saveProjectToCloud(
    project: WritingProject,
    newSnapshots: ProjectVersionSnapshot[] = [],
    options?: {
      forceOverwrite?: boolean;
    }
  ): Promise<CloudSaveResult> {
    if (!this.currentUser) {
      return {
        status: 'saved_local',
        savedProject: project,
      };
    }

    const testTransport = this.getTestTransport();
    if (!this.isOnline || testTransport?.simulateOffline) {
      return {
        status: 'cloud_error',
        errorMessage: 'You are currently offline. Saved locally — cloud sync will require retry when online.',
      };
    }

    if (testTransport?.simulateSaveError) {
      return {
        status: 'cloud_error',
        errorMessage: testTransport.simulateSaveError,
      };
    }

    const userId = this.currentUser.uid;
    const expectedBaseRevision =
      typeof project.baseCloudRevision === 'number'
        ? project.baseCloudRevision
        : typeof project.cloudRevision === 'number'
          ? project.cloudRevision
          : 0;
    const nowIso = new Date().toISOString();

    try {
      this.status = 'syncing';
      this.errorMessage = null;
      this.notifyStatusChange();

      if (testTransport) {
        // Execute the exact transactional check against the test cloud transport
        if (!testTransport.projects) testTransport.projects = {};
        if (!testTransport.projects[userId]) testTransport.projects[userId] = {};
        if (!testTransport.history) testTransport.history = {};
        if (!testTransport.history[userId]) testTransport.history[userId] = {};
        if (!testTransport.history[userId][project.id]) {
          testTransport.history[userId][project.id] = {};
        }

        const remoteData = testTransport.projects[userId][project.id];
        if (remoteData && !remoteData._isDeleted) {
          const remoteRevision =
            typeof remoteData.cloudRevision === 'number' ? remoteData.cloudRevision : 1;

          if (!options?.forceOverwrite && remoteRevision !== expectedBaseRevision) {
            const conflict: ProjectConflictInfo = {
              projectId: project.id,
              localWorkingProject: project,
              remoteProject: JSON.parse(JSON.stringify(remoteData)),
              baseRevision: expectedBaseRevision,
              remoteRevision,
              detectedAt: nowIso,
            };
            this.registerConflict(conflict);
            this.status = 'synced';
            this.notifyStatusChange();
            return {
              status: 'conflict',
              conflict,
            };
          }

          const nextRevision = remoteRevision + 1;
          let combinedHistory = mergeVersionHistories(
            remoteData.versionHistory,
            project.versionHistory,
            newSnapshots
          );
          const extraSnapshotsToPersist: ProjectVersionSnapshot[] = [...newSnapshots];

          // If force-overwriting a different cloud version, preserve the replaced cloud version in history first
          if (
            options?.forceOverwrite &&
            ensureSemanticHtml(remoteData.content) !== ensureSemanticHtml(project.content)
          ) {
            const cloudBackupList = createVersionSnapshot(
              { ...remoteData, versionHistory: combinedHistory },
              'conflict_backup',
              {
                label: `Cloud Revision ${remoteRevision} (preserved before overwrite)`,
                actionDescription: `Backup of cloud revision ${remoteRevision} prior to force save`,
                cloudRevision: remoteRevision,
                force: true,
              }
            );
            if (cloudBackupList[0]) {
              extraSnapshotsToPersist.push(cloudBackupList[0]);
            }
            combinedHistory = mergeVersionHistories(cloudBackupList, combinedHistory);
          }

          // Tag the top snapshot with nextRevision
          if (combinedHistory.length > 0) {
            combinedHistory[0] = {
              ...combinedHistory[0],
              cloudRevision: nextRevision,
            };
          }

          const committedProject: WritingProject = {
            ...project,
            content: ensureSemanticHtml(project.content),
            versionHistory: trimInlineVersionHistory(combinedHistory),
            cloudRevision: nextRevision,
            baseCloudRevision: nextRevision,
            lastSyncedAt: nowIso,
            lastSyncedUserId: userId,
            _hasLocalUnsyncedSave: false,
            _isSeedProject: false,
            updatedAt: nowIso,
          };

          testTransport.projects[userId][project.id] = JSON.parse(JSON.stringify(committedProject));
          for (const snap of extraSnapshotsToPersist) {
            const tagged =
              snap.id === combinedHistory[0]?.id ? { ...snap, cloudRevision: nextRevision } : snap;
            testTransport.history[userId][project.id][snap.id] = JSON.parse(JSON.stringify(tagged));
          }
          if (combinedHistory[0]) {
            testTransport.history[userId][project.id][combinedHistory[0].id] = JSON.parse(
              JSON.stringify(combinedHistory[0])
            );
          }

          storage.saveProjectHistorySnapshots(project.id, combinedHistory);
          const syncedLocal =
            storage.markProjectSyncedWithCloud(project.id, nextRevision, userId, nowIso) ||
            committedProject;
          this.clearConflictForProject(project.id);
          this.status = 'synced';
          this.lastSyncedAt = nowIso;
          this.notifyStatusChange();

          return {
            status: 'saved_cloud',
            savedProject: {
              ...committedProject,
              ...syncedLocal,
              versionHistory: committedProject.versionHistory,
            },
            cloudRevision: nextRevision,
            syncedAt: nowIso,
          };
        } else {
          // First time creating this project in cloud
          const nextRevision = 1;
          const combinedHistory = mergeVersionHistories(project.versionHistory, newSnapshots);
          if (combinedHistory.length > 0) {
            combinedHistory[0] = {
              ...combinedHistory[0],
              cloudRevision: nextRevision,
            };
          }

          const committedProject: WritingProject = {
            ...project,
            content: ensureSemanticHtml(project.content),
            versionHistory: trimInlineVersionHistory(combinedHistory),
            cloudRevision: nextRevision,
            baseCloudRevision: nextRevision,
            lastSyncedAt: nowIso,
            lastSyncedUserId: userId,
            _hasLocalUnsyncedSave: false,
            _isSeedProject: false,
            updatedAt: nowIso,
          };

          testTransport.projects[userId][project.id] = JSON.parse(JSON.stringify(committedProject));
          for (const snap of combinedHistory) {
            testTransport.history[userId][project.id][snap.id] = JSON.parse(JSON.stringify(snap));
          }

          storage.saveProjectHistorySnapshots(project.id, combinedHistory);
          const syncedLocal =
            storage.markProjectSyncedWithCloud(project.id, nextRevision, userId, nowIso) ||
            committedProject;
          this.clearConflictForProject(project.id);
          this.status = 'synced';
          this.lastSyncedAt = nowIso;
          this.notifyStatusChange();

          return {
            status: 'saved_cloud',
            savedProject: {
              ...committedProject,
              ...syncedLocal,
              versionHistory: committedProject.versionHistory,
            },
            cloudRevision: nextRevision,
            syncedAt: nowIso,
          };
        }
      }

      // Real Firestore Transaction Path
      const projectRef = doc(db, 'users', userId, 'projects', project.id);

      const txResult = await runTransaction(db, async (transaction) => {
        const remoteDoc = await transaction.get(projectRef);

        if (remoteDoc.exists()) {
          const remoteData = remoteDoc.data() as WritingProject;
          if (!remoteData._isDeleted) {
            const remoteRevision =
              typeof remoteData.cloudRevision === 'number' ? remoteData.cloudRevision : 1;

            if (!options?.forceOverwrite && remoteRevision !== expectedBaseRevision) {
              return {
                conflict: {
                  projectId: project.id,
                  localWorkingProject: project,
                  remoteProject: remoteData,
                  baseRevision: expectedBaseRevision,
                  remoteRevision,
                  detectedAt: nowIso,
                } as ProjectConflictInfo,
              };
            }

            const nextRevision = remoteRevision + 1;
            let combinedHistory = mergeVersionHistories(
              remoteData.versionHistory,
              project.versionHistory,
              newSnapshots
            );
            const snapshotsToWrite: ProjectVersionSnapshot[] = [...newSnapshots];

            if (
              options?.forceOverwrite &&
              ensureSemanticHtml(remoteData.content) !== ensureSemanticHtml(project.content)
            ) {
              const cloudBackupList = createVersionSnapshot(
                { ...remoteData, versionHistory: combinedHistory },
                'conflict_backup',
                {
                  label: `Cloud Revision ${remoteRevision} (preserved before overwrite)`,
                  actionDescription: `Backup of cloud revision ${remoteRevision} prior to force save`,
                  cloudRevision: remoteRevision,
                  force: true,
                }
              );
              if (cloudBackupList[0]) {
                snapshotsToWrite.push(cloudBackupList[0]);
              }
              combinedHistory = mergeVersionHistories(cloudBackupList, combinedHistory);
            }

            if (combinedHistory.length > 0) {
              combinedHistory[0] = {
                ...combinedHistory[0],
                cloudRevision: nextRevision,
              };
              if (!snapshotsToWrite.some((s) => s.id === combinedHistory[0].id)) {
                snapshotsToWrite.push(combinedHistory[0]);
              }
            }

            const committedProject: WritingProject = {
              ...project,
              content: ensureSemanticHtml(project.content),
              versionHistory: trimInlineVersionHistory(combinedHistory),
              cloudRevision: nextRevision,
              baseCloudRevision: nextRevision,
              lastSyncedAt: nowIso,
              lastSyncedUserId: userId,
              _hasLocalUnsyncedSave: false,
              _isSeedProject: false,
              updatedAt: nowIso,
            };

            const cleanedProject = cleanUndefinedForFirestore(committedProject) as any;
            cleanedProject.syncedAt = serverTimestamp();
            transaction.set(projectRef, cleanedProject);

            for (const snap of snapshotsToWrite) {
              const tagged =
                snap.id === combinedHistory[0]?.id
                  ? { ...snap, cloudRevision: nextRevision }
                  : snap;
              const histRef = doc(db, 'users', userId, 'projects', project.id, 'history', snap.id);
              const cleanedSnap = cleanUndefinedForFirestore(tagged) as any;
              cleanedSnap.syncedAt = serverTimestamp();
              transaction.set(histRef, cleanedSnap);
            }

            return {
              committedProject,
              combinedHistory,
              nextRevision,
            };
          }
        }

        // Document does not exist on remote (or was deleted tombstone)
        const nextRevision = 1;
        const combinedHistory = mergeVersionHistories(project.versionHistory, newSnapshots);
        if (combinedHistory.length > 0) {
          combinedHistory[0] = {
            ...combinedHistory[0],
            cloudRevision: nextRevision,
          };
        }

        const committedProject: WritingProject = {
          ...project,
          content: ensureSemanticHtml(project.content),
          versionHistory: trimInlineVersionHistory(combinedHistory),
          cloudRevision: nextRevision,
          baseCloudRevision: nextRevision,
          lastSyncedAt: nowIso,
          lastSyncedUserId: userId,
          _hasLocalUnsyncedSave: false,
          _isSeedProject: false,
          updatedAt: nowIso,
        };

        const cleanedProject = cleanUndefinedForFirestore(committedProject) as any;
        cleanedProject.syncedAt = serverTimestamp();
        transaction.set(projectRef, cleanedProject);

        const snapshotsToWrite =
          newSnapshots.length > 0 ? newSnapshots : combinedHistory.slice(0, 5);
        for (const snap of snapshotsToWrite) {
          const tagged =
            snap.id === combinedHistory[0]?.id ? { ...snap, cloudRevision: nextRevision } : snap;
          const histRef = doc(db, 'users', userId, 'projects', project.id, 'history', snap.id);
          const cleanedSnap = cleanUndefinedForFirestore(tagged) as any;
          cleanedSnap.syncedAt = serverTimestamp();
          transaction.set(histRef, cleanedSnap);
        }

        return {
          committedProject,
          combinedHistory,
          nextRevision,
        };
      });

      if (txResult.conflict) {
        this.registerConflict(txResult.conflict);
        this.status = 'synced';
        this.notifyStatusChange();
        return {
          status: 'conflict',
          conflict: txResult.conflict,
        };
      }

      const { committedProject, combinedHistory, nextRevision } = txResult;
      storage.saveProjectHistorySnapshots(project.id, combinedHistory);
      const syncedLocal =
        storage.markProjectSyncedWithCloud(project.id, nextRevision, userId, nowIso) ||
        committedProject;
      this.clearConflictForProject(project.id);

      this.status = 'synced';
      this.lastSyncedAt = nowIso;
      this.errorMessage = null;
      this.notifyStatusChange();

      return {
        status: 'saved_cloud',
        savedProject: {
          ...committedProject,
          ...syncedLocal,
          versionHistory: committedProject.versionHistory,
        },
        cloudRevision: nextRevision,
        syncedAt: nowIso,
      };
    } catch (err: any) {
      console.error('saveProjectToCloud error:', err);
      const msg = err?.message || 'Cloud save failed.';
      this.status = 'error';
      this.errorMessage = msg;
      this.notifyStatusChange();
      return {
        status: 'cloud_error',
        errorMessage: msg,
      };
    }
  }

  // ==========================================
  // NON-PROJECT LOCAL EDIT HANDLING
  // ==========================================
  private handleNonProjectLocalEdit(): void {
    if (
      this.isApplyingRemote ||
      this.isReconcilingLogin ||
      !this.currentUser ||
      !this.isOnline ||
      this.getTestTransport()
    ) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.pushNonProjectChangesToFirestore();
    }, 1200);
  }

  private async mergeCollection<T extends { id: string; updatedAt?: string; _isDeleted?: boolean }>(
    userId: string,
    collectionName: string,
    localItems: T[],
    saveLocalCallback: (items: T[]) => void
  ): Promise<void> {
    const path = `users/${userId}/${collectionName}`;
    let snapshot;
    try {
      snapshot = await getDocs(collection(db, 'users', userId, collectionName));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return;
    }

    const remoteMap = new Map<string, T>();
    snapshot.docs.forEach((docSnap) => {
      remoteMap.set(docSnap.id, docSnap.data() as T);
    });

    const localMap = new Map<string, T>();
    localItems.forEach((item) => localMap.set(item.id, item));

    const finalLocalList: T[] = [];
    const uploadTasks: Promise<void>[] = [];

    const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);

      if (local && !remote) {
        finalLocalList.push(local);
        uploadTasks.push(this.writeDocToFirestore(userId, collectionName, id, local));
      } else if (!local && remote) {
        finalLocalList.push(remote);
      } else if (local && remote) {
        const localTime = new Date(local.updatedAt || (local as any).deletedAt || 0).getTime();
        const remoteTime = new Date(remote.updatedAt || (remote as any).deletedAt || 0).getTime();

        if (remoteTime > localTime) {
          finalLocalList.push(remote);
        } else if (localTime > remoteTime) {
          finalLocalList.push(local);
          uploadTasks.push(this.writeDocToFirestore(userId, collectionName, id, local));
        } else {
          if (local._isDeleted || remote._isDeleted) {
            const merged = { ...remote, ...local, _isDeleted: true };
            finalLocalList.push(merged);
            if (!remote._isDeleted) {
              uploadTasks.push(this.writeDocToFirestore(userId, collectionName, id, merged));
            }
          } else {
            finalLocalList.push(local);
          }
        }
      }
    }

    this.isApplyingRemote = true;
    try {
      saveLocalCallback(finalLocalList);
    } finally {
      this.isApplyingRemote = false;
    }

    if (uploadTasks.length > 0) {
      await Promise.all(uploadTasks);
    }
  }

  private async mergeSettings(userId: string): Promise<void> {
    const path = `users/${userId}/settings/user_settings`;
    try {
      const docSnap = await getDoc(doc(db, 'users', userId, 'settings', 'user_settings'));
      const localSettings = {
        activeProjectId: storage.getActiveProjectId(),
        activeTheme: storage.getTheme(),
        globalAiModel: storage.getGlobalModel(),
        updatedAt: new Date().toISOString(),
      };

      if (!docSnap.exists()) {
        await setDoc(doc(db, 'users', userId, 'settings', 'user_settings'), localSettings);
      } else {
        const remote = docSnap.data() as any;
        const localTime = new Date(localSettings.updatedAt).getTime();
        const remoteTime = new Date(remote.updatedAt || 0).getTime();

        if (remoteTime > localTime) {
          this.isApplyingRemote = true;
          try {
            storage.saveSettingsFromRemote({
              activeProjectId: remote.activeProjectId,
              activeTheme: remote.activeTheme,
              globalAiModel: remote.globalAiModel,
            });
          } finally {
            this.isApplyingRemote = false;
          }
        } else {
          await setDoc(doc(db, 'users', userId, 'settings', 'user_settings'), localSettings);
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  }

  // ==========================================
  // REAL-TIME INBOUND SNAPSHOT LISTENERS
  // ==========================================
  private attachSnapshotListeners(userId: string): void {
    this.detachSnapshotListeners();
    if (this.getTestTransport()) {
      return;
    }

    const projectsRef = collection(db, 'users', userId, 'projects');
    const unsubProjects = onSnapshot(
      projectsRef,
      (snapshot) => {
        this.isApplyingRemote = true;
        try {
          const remoteDocs: WritingProject[] = snapshot.docs.map((d) => d.data() as WritingProject);
          storage.saveProjectsFromRemote(remoteDocs);
          this.remoteProjectListeners.forEach((fn) => {
            try {
              fn(remoteDocs.filter((p) => !p._isDeleted));
            } catch (e) {
              console.error('Remote project listener error:', e);
            }
          });
          this.lastSyncedAt = new Date().toISOString();
          this.status = 'synced';
          this.notifyStatusChange();
        } finally {
          this.isApplyingRemote = false;
        }
      },
      (err) => {
        console.error('Snapshot error on projects:', err);
        handleFirestoreError(err, OperationType.LIST, `users/${userId}/projects`);
      }
    );
    this.activeUnsubscribers.push(unsubProjects);

    const collectionsToListen = [
      { name: 'style_profiles', apply: (items: StyleProfile[]) => storage.saveStyleProfilesFromRemote(items) },
      { name: 'internal_links', apply: (items: InternalLink[]) => storage.saveInternalLinksFromRemote(items) },
      { name: 'research_studies', apply: (items: ResearchStudy[]) => storage.saveResearchStudiesFromRemote(items) },
      { name: 'research_claims', apply: (items: ResearchClaim[]) => storage.saveResearchClaimsFromRemote(items) },
      { name: 'saved_ideas', apply: (items: SavedEditorialIdea[]) => storage.saveSavedIdeasFromRemote(items) },
      { name: 'global_instructions', apply: (items: GlobalInstruction[]) => storage.saveGlobalInstructionsFromRemote(items) },
    ];

    collectionsToListen.forEach((colDef) => {
      const colRef = collection(db, 'users', userId, colDef.name);
      const unsub = onSnapshot(
        colRef,
        (snapshot) => {
          this.isApplyingRemote = true;
          try {
            const remoteDocs: any[] = snapshot.docs.map((d) => d.data());
            colDef.apply(remoteDocs);
            this.lastSyncedAt = new Date().toISOString();
            this.status = 'synced';
            this.notifyStatusChange();
          } finally {
            this.isApplyingRemote = false;
          }
        },
        (err) => {
          console.error(`Snapshot error on ${colDef.name}:`, err);
          handleFirestoreError(err, OperationType.LIST, `users/${userId}/${colDef.name}`);
        }
      );
      this.activeUnsubscribers.push(unsub);
    });

    const settingsRef = doc(db, 'users', userId, 'settings', 'user_settings');
    const unsubSettings = onSnapshot(
      settingsRef,
      (docSnap) => {
        if (docSnap.exists()) {
          this.isApplyingRemote = true;
          try {
            const data = docSnap.data();
            storage.saveSettingsFromRemote({
              activeProjectId: data.activeProjectId,
              activeTheme: data.activeTheme,
              globalAiModel: data.globalAiModel,
            });
            this.lastSyncedAt = new Date().toISOString();
            this.status = 'synced';
            this.notifyStatusChange();
          } finally {
            this.isApplyingRemote = false;
          }
        }
      },
      (err) => {
        console.error('Snapshot error on settings:', err);
        handleFirestoreError(err, OperationType.GET, `users/${userId}/settings/user_settings`);
      }
    );
    this.activeUnsubscribers.push(unsubSettings);
  }

  private detachSnapshotListeners(): void {
    this.activeUnsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch (err) {
        console.warn('Unsubscribe error:', err);
      }
    });
    this.activeUnsubscribers = [];
  }

  // ==========================================
  // OUTBOUND WRITE ENGINE (NON-PROJECT COLLECTIONS ONLY)
  // ==========================================
  private async pushNonProjectChangesToFirestore(): Promise<void> {
    if (!this.currentUser || !this.isOnline || this.isApplyingRemote || this.getTestTransport()) {
      return;
    }

    try {
      this.status = 'syncing';
      this.notifyStatusChange();

      const userId = this.currentUser.uid;

      // IMPORTANT: Projects are NEVER pushed here. Projects are saved exclusively via saveProjectToCloud().
      await Promise.all([
        this.pushCollection(userId, 'style_profiles', storage.getRawStyleProfilesIncludingDeleted()),
        this.pushCollection(userId, 'internal_links', storage.getRawInternalLinksIncludingDeleted()),
        this.pushCollection(userId, 'research_studies', storage.getRawResearchStudiesIncludingDeleted()),
        this.pushCollection(userId, 'research_claims', storage.getRawResearchClaimsIncludingDeleted()),
        this.pushCollection(userId, 'saved_ideas', storage.getRawSavedIdeasIncludingDeleted()),
        this.pushCollection(userId, 'global_instructions', storage.getRawGlobalInstructionsIncludingDeleted()),
        this.writeDocToFirestore(userId, 'settings', 'user_settings', {
          activeProjectId: storage.getActiveProjectId(),
          activeTheme: storage.getTheme(),
          globalAiModel: storage.getGlobalModel(),
          updatedAt: new Date().toISOString(),
        }),
      ]);

      this.status = 'synced';
      this.lastSyncedAt = new Date().toISOString();
      this.errorMessage = null;
      this.notifyStatusChange();
    } catch (err: any) {
      console.error('Push non-project changes error:', err);
      this.status = 'error';
      this.errorMessage = err?.message || 'Failed to upload settings changes.';
      this.notifyStatusChange();
    }
  }

  private async pushCollection<T extends { id: string }>(
    userId: string,
    collectionName: string,
    items: T[]
  ): Promise<void> {
    const tasks = items.map((item) =>
      this.writeDocToFirestore(userId, collectionName, item.id, item)
    );
    await Promise.all(tasks);
  }

  private async writeDocToFirestore(
    userId: string,
    collectionName: string,
    docId: string,
    data: any
  ): Promise<void> {
    const docPath =
      collectionName === 'settings'
        ? `users/${userId}/settings/${docId}`
        : `users/${userId}/${collectionName}/${docId}`;
    try {
      const cleaned = cleanUndefinedForFirestore(data) as any;
      cleaned.syncedAt = serverTimestamp();

      const docRef =
        collectionName === 'settings'
          ? doc(db, 'users', userId, 'settings', docId)
          : doc(db, 'users', userId, collectionName, docId);

      await setDoc(docRef, cleaned, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  }

  // ==========================================
  // SOFT DELETION TOMBSTONES
  // ==========================================
  public async deleteRecord(collectionName: string, docId: string): Promise<void> {
    if (!this.currentUser || !this.isOnline) return;

    const userId = this.currentUser.uid;
    const testTransport = this.getTestTransport();
    if (testTransport) {
      if (collectionName === 'projects' && testTransport.projects?.[userId]?.[docId]) {
        testTransport.projects[userId][docId] = {
          ...testTransport.projects[userId][docId],
          _isDeleted: true,
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return;
    }

    const path = `users/${userId}/${collectionName}/${docId}`;
    try {
      const tombstone = {
        id: docId,
        _isDeleted: true,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', userId, collectionName, docId), tombstone, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }
}

export const syncEngine = new SyncEngine();

