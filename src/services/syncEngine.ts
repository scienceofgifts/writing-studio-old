/**
 * Science of Gifts - Local-First Cloud Synchronization Engine
 * Manages bidirectional synchronization between local IndexedDB/LocalStorage and Cloud Firestore.
 * Ensures instant local responsiveness, loop suppression, initial two-way union merge,
 * soft deletion tombstones, and offline resilience.
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
} from 'firebase/firestore';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, signInWithGoogle, signOutUser } from './firebase';
import { storage } from './storage';
import { WritingProject } from '../types/project';
import { StyleProfile } from '../types/styleReference';
import { InternalLink } from '../types/internalLink';
import { ResearchStudy, ResearchClaim } from '../types/research';
import { SavedEditorialIdea } from '../types/ideaGenerator';
import { GlobalInstruction } from '../types/project';

export type SyncStatus = 'signed_out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatusInfo {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  isOnline: boolean;
}

class SyncEngine {
  private currentUser: User | null = null;
  private status: SyncStatus = 'signed_out';
  private lastSyncedAt: string | null = null;
  private errorMessage: string | null = null;
  private isOnline: boolean = navigator.onLine;

  private isApplyingRemote: boolean = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private activeUnsubscribers: Unsubscribe[] = [];
  private listeners: Set<(info: SyncStatusInfo) => void> = new Set();
  private storageUnsubscribe: (() => void) | null = null;

  constructor() {
    // Monitor online/offline state
    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));

    // Monitor Firebase Authentication
    onAuthStateChanged(auth, (user) => {
      this.handleAuthChange(user);
    });

    // Subscribe to local storage edits after initialization tick
    setTimeout(() => {
      try {
        if (typeof storage !== 'undefined' && typeof storage.subscribe === 'function') {
          this.storageUnsubscribe = storage.subscribe(() => {
            this.handleLocalEdit();
          });
        }
      } catch (e) {
        console.warn('Storage subscription notice:', e);
      }
    }, 100);
  }

  // ==========================================
  // PUBLIC EVENT SUBSCRIBERS
  // ==========================================
  public subscribe(callback: (info: SyncStatusInfo) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatusInfo());
    return () => this.listeners.delete(callback);
  }

  public getStatusInfo(): SyncStatusInfo {
    return {
      status: this.status,
      user: this.currentUser,
      lastSyncedAt: this.lastSyncedAt,
      errorMessage: this.errorMessage,
      isOnline: this.isOnline,
    };
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
        // User intentionally closed or cancelled the Google sign-in window.
        // Revert status to signed_out gracefully without alarming error state.
        this.status = 'signed_out';
        this.errorMessage = null;
        this.notifyStatusChange();
      } else if (err?.code === 'auth/popup-blocked') {
        this.status = 'signed_out';
        this.errorMessage = 'Sign-in popup was blocked by your browser. Please allow popups and try again.';
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
      await signOutUser();
      this.currentUser = null;
      this.status = 'signed_out';
      this.notifyStatusChange();
    } catch (err: any) {
      console.error('Logout error:', err);
    }
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

    if (!this.isOnline) {
      this.status = 'offline';
      this.notifyStatusChange();
      return;
    }

    try {
      this.status = 'syncing';
      this.errorMessage = null;
      this.notifyStatusChange();

      // Step 1: Perform initial two-way union merge
      await this.performInitialTwoWayMerge(user.uid);

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
    if (!this.isOnline) {
      this.status = 'offline';
      this.notifyStatusChange();
      return;
    }

    try {
      this.status = 'syncing';
      this.errorMessage = null;
      this.notifyStatusChange();

      await this.performInitialTwoWayMerge(this.currentUser.uid);
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
  // LOOP SUPPRESSION & LOCAL EDIT HANDLING
  // ==========================================
  private handleLocalEdit(): void {
    // If the change was triggered by an incoming Firestore snapshot, ignore!
    if (this.isApplyingRemote || !this.currentUser || !this.isOnline) {
      return;
    }

    // Schedule debounced outbound push (1200ms delay to batch typing)
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.pushLocalChangesToFirestore();
    }, 1200);
  }

  // ==========================================
  // INITIAL TWO-WAY UNION MERGE
  // ==========================================
  private async performInitialTwoWayMerge(userId: string): Promise<void> {
    // 1. Writing Projects
    await this.mergeCollection<WritingProject>(
      userId,
      'projects',
      storage.getRawProjectsIncludingDeleted(),
      (merged) => storage.saveProjectsFromRemote(merged)
    );

    // 2. Style Profiles
    await this.mergeCollection<StyleProfile>(
      userId,
      'style_profiles',
      storage.getRawStyleProfilesIncludingDeleted(),
      (merged) => storage.saveStyleProfilesFromRemote(merged)
    );

    // 3. Internal Links
    await this.mergeCollection<InternalLink>(
      userId,
      'internal_links',
      storage.getRawInternalLinksIncludingDeleted(),
      (merged) => storage.saveInternalLinksFromRemote(merged)
    );

    // 4. Research Studies
    await this.mergeCollection<ResearchStudy>(
      userId,
      'research_studies',
      storage.getRawResearchStudiesIncludingDeleted(),
      (merged) => storage.saveResearchStudiesFromRemote(merged)
    );

    // 5. Research Claims
    await this.mergeCollection<ResearchClaim>(
      userId,
      'research_claims',
      storage.getRawResearchClaimsIncludingDeleted(),
      (merged) => storage.saveResearchClaimsFromRemote(merged)
    );

    // 6. Saved Editorial Ideas
    await this.mergeCollection<SavedEditorialIdea>(
      userId,
      'saved_ideas',
      storage.getRawSavedIdeasIncludingDeleted(),
      (merged) => storage.saveSavedIdeasFromRemote(merged)
    );

    // 7. Global Instructions
    await this.mergeCollection<GlobalInstruction>(
      userId,
      'global_instructions',
      storage.getRawGlobalInstructionsIncludingDeleted(),
      (merged) => storage.saveGlobalInstructionsFromRemote(merged)
    );

    // 8. User Settings
    await this.mergeSettings(userId);
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

    // Process all unique and shared IDs
    const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);

      if (local && !remote) {
        // Local only -> keep in local state and upload to Firestore (whether active or tombstone)
        finalLocalList.push(local);
        uploadTasks.push(this.writeDocToFirestore(userId, collectionName, id, local));
      } else if (!local && remote) {
        // Remote only -> keep in local state (whether active or tombstone)
        finalLocalList.push(remote);
      } else if (local && remote) {
        // If local is deleted, drop/reject remote document UNLESS remote updatedAt is strictly newer than local deletedAt
        if (local._isDeleted && !remote._isDeleted) {
          const localDeletedTime = new Date((local as any).deletedAt || local.updatedAt || 0).getTime();
          const remoteUpdatedTime = new Date(remote.updatedAt || 0).getTime();
          if (remoteUpdatedTime <= localDeletedTime) {
            finalLocalList.push(local);
            uploadTasks.push(this.writeDocToFirestore(userId, collectionName, id, local));
            continue;
          }
        }

        // If remote is deleted, drop/reject local document UNLESS local updatedAt is strictly newer than remote deletedAt
        if (remote._isDeleted && !local._isDeleted) {
          const remoteDeletedTime = new Date((remote as any).deletedAt || remote.updatedAt || 0).getTime();
          const localUpdatedTime = new Date(local.updatedAt || 0).getTime();
          if (localUpdatedTime <= remoteDeletedTime) {
            finalLocalList.push(remote);
            continue;
          }
        }

        // Both exist -> compare revision timestamps
        const localTime = new Date(local.updatedAt || (local as any).deletedAt || 0).getTime();
        const remoteTime = new Date(remote.updatedAt || (remote as any).deletedAt || 0).getTime();

        if (remoteTime > localTime) {
          // Remote is newer -> adopt remote
          finalLocalList.push(remote);
        } else if (localTime > remoteTime) {
          // Local is newer -> keep local & update remote
          finalLocalList.push(local);
          uploadTasks.push(this.writeDocToFirestore(userId, collectionName, id, local));
        } else {
          // Timestamps equal: if either is deleted, prefer tombstone
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

    // Apply merged list to local storage
    this.isApplyingRemote = true;
    try {
      saveLocalCallback(finalLocalList);
    } finally {
      this.isApplyingRemote = false;
    }

    // Flush outbound uploads in parallel
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

    const collectionsToListen = [
      { name: 'projects', apply: (items: WritingProject[]) => storage.saveProjectsFromRemote(items) },
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

    // Listen to settings doc
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
  // OUTBOUND WRITE ENGINE
  // ==========================================
  private async pushLocalChangesToFirestore(): Promise<void> {
    if (!this.currentUser || !this.isOnline || this.isApplyingRemote) return;

    try {
      this.status = 'syncing';
      this.notifyStatusChange();

      const userId = this.currentUser.uid;

      await Promise.all([
        this.pushCollection(userId, 'projects', storage.getRawProjectsIncludingDeleted()),
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
      console.error('Push changes error:', err);
      this.status = 'error';
      this.errorMessage = err?.message || 'Failed to upload local changes.';
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
    const docPath = collectionName === 'settings' ? `users/${userId}/settings/${docId}` : `users/${userId}/${collectionName}/${docId}`;
    try {
      // Clean undefined values before writing to Firestore
      const cleaned = JSON.parse(JSON.stringify(data, (key, value) => (value === undefined ? null : value)));
      cleaned.syncedAt = serverTimestamp();

      const docRef = collectionName === 'settings' 
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
