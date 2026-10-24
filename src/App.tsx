/**
 * Science of Gifts - Editorial Writing Studio
 * Main Application Shell (Phase 2 & Phase 10 Production Polish)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  WritingProject,
  ProjectType,
  ProjectStatus,
  DiffProposal,
  OutlineItem,
  ActivePanel,
  SaveStatus,
  ProjectConflictInfo,
} from './types/project';
import { ProjectVersionSnapshot } from './types/versionHistory';
import { storage } from './services/storage';
import { syncEngine } from './services/syncEngine';
import { geminiService } from './services/geminiClient';
import { toast } from './services/toastService';
import { ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FindInDocumentBar } from './components/FindInDocumentBar';
import { Navigation } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { ArticleWorkspace } from './components/workspaces/ArticleWorkspace';
import { GiftGuideWorkspace } from './components/workspaces/GiftGuideWorkspace';
import { ProductCopyWorkspace } from './components/workspaces/ProductCopyWorkspace';
import { SettingsView } from './components/SettingsView';
import { DiffReviewModal } from './components/DiffReviewModal';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { ProjectBriefDrawer } from './components/drawers/ProjectBriefDrawer';
import { EditorialDevelopmentDrawer } from './components/drawers/EditorialDevelopmentDrawer';
import { ContentOutlineDrawer } from './components/drawers/ContentOutlineDrawer';
import { DraftPackageDrawer } from './components/drawers/DraftPackageDrawer';
import { ContentRulesDrawer } from './components/drawers/ContentRulesDrawer';
import { StyleSettingsDrawer } from './components/drawers/StyleSettingsDrawer';
import { ProjectInstructionsDrawer } from './components/drawers/ProjectInstructionsDrawer';
import { StyleReferenceView } from './components/styleReference/StyleReferenceView';
import { InternalLinksView } from './components/internalLinks/InternalLinksView';
import { LinkOpportunitiesDrawer } from './components/drawers/LinkOpportunitiesDrawer';
import { EditorialIntelligenceDrawer } from './components/drawers/EditorialIntelligenceDrawer';
import { VersionHistoryDrawer } from './components/drawers/VersionHistoryDrawer';
import { LinkOpportunity } from './types/internalLink';
import { ReviewFinding, EditorialReviewResult, QCResult, QCFinding } from './types/project';
import {
  createVersionSnapshot,
  mergeVersionHistories,
  trimInlineVersionHistory,
} from './services/versionHistoryService';
import { ensureSemanticHtml, isEquivalentEditorHtml } from './utils/richText';
import { applyHyperlinkToHtml, isValidUrl, isUrlAlreadyInDocument } from './utils/urlUtils';
import { applyTheme } from './theme/tokens';
import { useDocumentSearch } from './utils/useDocumentSearch';
import { IdeaGeneratorView } from './components/IdeaGeneratorView';
import { EditorialIdea } from './types/ideaGenerator';
import { DataBackupView } from './components/DataBackupView';
import { ResearchLibraryView } from './components/research/ResearchLibraryView';
import { ResearchStudyWorkspace } from './components/research/ResearchStudyWorkspace';
import { ResearchDrawer } from './components/drawers/ResearchDrawer';
import { CitationStudioDrawer } from './components/drawers/CitationStudioDrawer';

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isProjectDirtyAgainstBaseline(
  current: WritingProject,
  baseline: WritingProject | undefined
): boolean {
  if (!baseline) return true;
  if (current === baseline) return false;
  if (!isEquivalentEditorHtml(current.content || '', baseline.content || '')) return true;
  if ((current.title || '') !== (baseline.title || '')) return true;
  if (current.status !== baseline.status) return true;
  if ((current.projectInstructions || '') !== (baseline.projectInstructions || '')) return true;
  if ((current.styleProfileId || '') !== (baseline.styleProfileId || '')) return true;
  if ((current.modelOverride || '') !== (baseline.modelOverride || '')) return true;
  if (stableStringify(current.brief || {}) !== stableStringify(baseline.brief || {})) return true;
  if (stableStringify(current.outline || []) !== stableStringify(baseline.outline || [])) {
    return true;
  }
  if (
    stableStringify(current.contentRules || []) !== stableStringify(baseline.contentRules || [])
  ) {
    return true;
  }
  if (
    stableStringify(current.writingControls || {}) !==
    stableStringify(baseline.writingControls || {})
  ) {
    return true;
  }
  if (stableStringify(current.articleMeta || {}) !== stableStringify(baseline.articleMeta || {})) {
    return true;
  }
  if (
    stableStringify(current.giftGuideMeta || {}) !==
    stableStringify(baseline.giftGuideMeta || {})
  ) {
    return true;
  }
  if (
    stableStringify(current.productCopyMeta || {}) !==
    stableStringify(baseline.productCopyMeta || {})
  ) {
    return true;
  }
  return false;
}

function getCleanBaselineSaveStatus(project: WritingProject | null | undefined): SaveStatus {
  if (!project) return 'saved_local';
  if (
    syncEngine.isSignedIn() &&
    !project._hasLocalUnsyncedSave &&
    (project.cloudRevision ?? 0) > 0
  ) {
    return 'saved_cloud';
  }
  return 'saved_local';
}

export default function App() {
  const [projects, setProjects] = useState<WritingProject[]>(() => storage.getProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => storage.getActiveProjectId());
  const [currentView, setCurrentView] = useState<'dashboard' | 'workspace' | 'settings' | 'style_reference' | 'internal_links' | 'idea_generator' | 'backup' | 'research'>('dashboard');
  const [activeResearchStudyId, setActiveResearchStudyId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved_local');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isFindOpen, setIsFindOpen] = useState(false);

  // Unsaved Navigation Guard & Conflict Resolution Modal states
  const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState(false);
  const [isSavingForNavigation, setIsSavingForNavigation] = useState(false);
  const pendingNavigationActionRef = useRef<(() => void) | null>(null);

  const [activeConflict, setActiveConflict] = useState<ProjectConflictInfo | null>(null);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  // Authoritative saved baselines per project ID
  const savedBaselinesRef = useRef<Map<string, WritingProject>>(new Map());
  const hasUnsavedChangesRef = useRef<boolean>(false);
  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  const projectsRef = useRef<WritingProject[]>(projects);
  const isSavingInFlightRef = useRef<boolean>(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Populate initial saved baselines, initialize IndexedDB, and subscribe to storage/remote updates
  useEffect(() => {
    applyTheme(storage.getTheme());

    projectsRef.current.forEach((p) => {
      if (!savedBaselinesRef.current.has(p.id)) {
        savedBaselinesRef.current.set(p.id, p);
      }
    });

    const syncProjectsFromStorage = () => {
      const nextFromStorage = storage.getProjects();
      setProjects((prev) => {
        let changed = prev.length !== nextFromStorage.length;
        const merged = nextFromStorage.map((np, idx) => {
          const existing = prev.find((ep) => ep.id === np.id);
          // If this is the currently active project and the user has unsaved in-memory edits,
          // preserve the active in-memory working state!
          if (
            existing &&
            np.id === activeProjectIdRef.current &&
            hasUnsavedChangesRef.current
          ) {
            return existing;
          }
          if (!existing) {
            savedBaselinesRef.current.set(np.id, np);
            changed = true;
            return np;
          }
          if (
            existing.updatedAt === np.updatedAt &&
            existing.title === np.title &&
            existing.status === np.status &&
            existing.cloudRevision === np.cloudRevision &&
            existing._hasLocalUnsyncedSave === np._hasLocalUnsyncedSave &&
            isEquivalentEditorHtml(existing.content, np.content)
          ) {
            savedBaselinesRef.current.set(existing.id, existing);
            if (prev[idx]?.id !== np.id) changed = true;
            return existing;
          }
          savedBaselinesRef.current.set(np.id, np);
          changed = true;
          return np;
        });
        return changed ? merged : prev;
      });
    };

    storage.init().then(() => {
      syncProjectsFromStorage();
      const activeId = storage.getActiveProjectId();
      if (activeId) setActiveProjectId(activeId);
    });

    const unsubscribeStorage = storage.subscribe(syncProjectsFromStorage);

    // Subscribe to remote project updates (sign-in reconciliation and real-time snapshot updates)
    const unsubscribeRemote = syncEngine.subscribeRemoteProjects((remoteProjects) => {
      const currentActiveId = activeProjectIdRef.current;
      const isDirtyInMemory = hasUnsavedChangesRef.current;

      if (currentActiveId && isDirtyInMemory) {
        const remoteActive = remoteProjects.find((p) => p.id === currentActiveId);
        const localWorking = projectsRef.current.find((p) => p.id === currentActiveId);
        const baseline = savedBaselinesRef.current.get(currentActiveId);

        if (remoteActive && localWorking) {
          const remoteChangedFromBaseline =
            !baseline ||
            !isEquivalentEditorHtml(remoteActive.content, baseline.content) ||
            (remoteActive.cloudRevision ?? 0) > (localWorking.baseCloudRevision ?? 0);
          const remoteDiffersFromWorking = !isEquivalentEditorHtml(
            remoteActive.content,
            localWorking.content
          );

          if (remoteChangedFromBaseline && remoteDiffersFromWorking) {
            const conflict: ProjectConflictInfo = {
              projectId: currentActiveId,
              localWorkingProject: localWorking,
              remoteProject: remoteActive,
              baseRevision: localWorking.baseCloudRevision ?? localWorking.cloudRevision ?? 0,
              remoteRevision: remoteActive.cloudRevision ?? 1,
              detectedAt: new Date().toISOString(),
            };
            syncEngine.registerConflict(conflict);
            setActiveConflict(conflict);
            setIsConflictModalOpen(true);
            setSaveStatus('conflict');
          }
        }
      } else if (currentActiveId && !isDirtyInMemory) {
        const updatedProj = storage.getProjectById(currentActiveId);
        if (updatedProj) {
          savedBaselinesRef.current.set(currentActiveId, updatedProj);
          setSaveStatus(getCleanBaselineSaveStatus(updatedProj));
        }
      }
    });

    const unsubscribeSyncStatus = syncEngine.subscribe(() => {
      const currentActiveId = activeProjectIdRef.current;
      if (!currentActiveId || hasUnsavedChangesRef.current) return;
      const existingConflict = syncEngine.getConflictForProject(currentActiveId);
      if (existingConflict) {
        setActiveConflict(existingConflict);
        setSaveStatus('conflict');
        return;
      }
      const proj = storage.getProjectById(currentActiveId);
      if (proj) {
        setSaveStatus(getCleanBaselineSaveStatus(proj));
      }
    });

    return () => {
      unsubscribeStorage();
      unsubscribeRemote();
      unsubscribeSyncStatus();
    };
  }, []);

  // Single source of truth for mutually exclusive writing panels
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [diffProposal, setDiffProposal] = useState<DiffProposal | null>(null);
  const [savedSelectedText, setSavedSelectedText] = useState<string>('');

  const handleTogglePanel = useCallback((panel: Exclude<ActivePanel, null>) => {
    if (panel === 'review') {
      if (editorRef.current) {
        try {
          const { from, to } = editorRef.current.state.selection;
          const text = editorRef.current.state.doc.textBetween(from, to, ' ').trim();
          if (text) {
            setSavedSelectedText(text);
          }
        } catch (e) {
          console.warn('Could not capture selection on panel toggle:', e);
        }
      }
    }
    setActivePanel((current) => (current === panel ? null : panel));
  }, []);

  const handleClosePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  // Editor instance reference & Workspace container reference for in-document search
  const editorRef = useRef<any>(null);
  const workspaceContainerRef = useRef<HTMLDivElement>(null);

  const {
    query: searchQuery,
    matchCount: searchMatchCount,
    currentIndex: searchMatchIndex,
    performSearch,
    nextMatch,
    prevMatch,
    clearHighlights,
  } = useDocumentSearch(workspaceContainerRef);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  // Persist active project ID and sync saveStatus when switching projects
  useEffect(() => {
    storage.setActiveProjectId(activeProjectId);
    if (!activeProjectId) return;
    const storedProj = storage.getProjectById(activeProjectId);
    if (storedProj && !savedBaselinesRef.current.has(activeProjectId)) {
      savedBaselinesRef.current.set(activeProjectId, storedProj);
    }
    const currentInMem = projectsRef.current.find((p) => p.id === activeProjectId);
    const baseline = savedBaselinesRef.current.get(activeProjectId) || storedProj;
    const existingConflict = syncEngine.getConflictForProject(activeProjectId);

    if (existingConflict) {
      setActiveConflict(existingConflict);
      setHasUnsavedChanges(true);
      setSaveStatus('conflict');
    } else if (currentInMem && baseline && isProjectDirtyAgainstBaseline(currentInMem, baseline)) {
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
    } else {
      setActiveConflict(null);
      setHasUnsavedChanges(false);
      setSaveStatus(getCleanBaselineSaveStatus(baseline || currentInMem));
    }
  }, [activeProjectId]);

  /**
   * Requirement 1: In-memory editing without timer-driven autosave.
   * Updates active project in React memory and tracks dirty state against the last saved baseline.
   */
  const handleUpdateActiveProject = useCallback((updatedProject: WritingProject) => {
    const prevTime = new Date(updatedProject.updatedAt || 0).getTime();
    const nowTime = Math.max(Date.now(), prevTime + 1);
    const stampedProject: WritingProject = {
      ...updatedProject,
      updatedAt: new Date(nowTime).toISOString(),
    };

    setProjects((prev) => prev.map((p) => (p.id === stampedProject.id ? stampedProject : p)));

    const baseline =
      savedBaselinesRef.current.get(stampedProject.id) ||
      storage.getProjectById(stampedProject.id);
    const isDirty = isProjectDirtyAgainstBaseline(stampedProject, baseline);
    const existingConflict = syncEngine.getConflictForProject(stampedProject.id);

    setHasUnsavedChanges(isDirty);
    hasUnsavedChangesRef.current = isDirty;

    if (existingConflict) {
      setSaveStatus('conflict');
    } else if (isDirty) {
      setSaveStatus('unsaved');
    } else {
      setSaveStatus(getCleanBaselineSaveStatus(baseline));
    }
  }, []);

  /**
   * Requirement 2, 5, 6, 7: Explicit Manual Save with automatic version history and atomic cloud transaction.
   * Returns true if save succeeded (local when signed out, or local + cloud when signed in).
   */
  const performProjectSave = useCallback(
    async (options?: {
      projectOverride?: WritingProject;
      newSnapshotsOverride?: ProjectVersionSnapshot[];
      forceOverwrite?: boolean;
      label?: string;
      silentToast?: boolean;
    }): Promise<boolean> => {
      const targetBase =
        options?.projectOverride ||
        projectsRef.current.find((p) => p.id === activeProjectIdRef.current) ||
        activeProject;
      if (!targetBase) return false;
      if (isSavingInFlightRef.current) return false;

      isSavingInFlightRef.current = true;

      try {
        // Capture current live HTML from editor if saving the active workspace project
        let liveContent = targetBase.content;
        if (
          !options?.projectOverride &&
          editorRef.current &&
          typeof editorRef.current.getHTML === 'function'
        ) {
          try {
            liveContent = editorRef.current.getHTML();
          } catch (e) {
            console.warn('Could not read live HTML from editorRef:', e);
          }
        }

        const nowIso = new Date().toISOString();
        const candidateProject: WritingProject = {
          ...targetBase,
          content: ensureSemanticHtml(liveContent),
          updatedAt: nowIso,
        };

        // Create version-history snapshot (deduplicated automatically if identical to latest snapshot)
        const prevTopSnapshotId = candidateProject.versionHistory?.[0]?.id;
        const updatedHistory = options?.newSnapshotsOverride
          ? candidateProject.versionHistory || []
          : createVersionSnapshot(candidateProject, 'manual_save', {
              label: options?.label,
              force: false,
            });

        const newSnapshots: ProjectVersionSnapshot[] = options?.newSnapshotsOverride
          ? options.newSnapshotsOverride
          : updatedHistory.length > 0 && updatedHistory[0].id !== prevTopSnapshotId
            ? [updatedHistory[0]]
            : [];

        const projectWithHistory: WritingProject = {
          ...candidateProject,
          versionHistory: updatedHistory,
        };

        // Step 1: Local persistence
        setSaveStatus('saving_local');
        const savedLocal = storage.saveProject(projectWithHistory, {
          markUnsynced: true,
          newSnapshots,
        });

        // If signed out, local save is the final step
        if (!syncEngine.isSignedIn()) {
          savedBaselinesRef.current.set(savedLocal.id, savedLocal);
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== savedLocal.id) return p;
              // If user continued typing during save, keep their newer live content
              if (!isProjectDirtyAgainstBaseline(p, candidateProject)) {
                return savedLocal;
              }
              return {
                ...p,
                versionHistory: savedLocal.versionHistory,
              };
            })
          );

          const latestInMem =
            projectsRef.current.find((p) => p.id === savedLocal.id) || savedLocal;
          const stillDirty = isProjectDirtyAgainstBaseline(latestInMem, savedLocal);
          setHasUnsavedChanges(stillDirty);
          hasUnsavedChangesRef.current = stillDirty;
          setSaveStatus(stillDirty ? 'unsaved' : 'saved_local');

          if (!options?.silentToast) {
            toast.success(
              'Saved locally',
              `"${savedLocal.title || 'Untitled'}" saved locally (not synced to cloud).`
            );
          }
          return true;
        }

        // Step 2: Signed-in Concurrency-Safe Cloud Save
        setSaveStatus('saving_cloud');
        const cloudResult = await syncEngine.saveProjectToCloud(savedLocal, newSnapshots, {
          forceOverwrite: options?.forceOverwrite,
        });

        if (cloudResult.status === 'saved_cloud') {
          const syncedProject = cloudResult.savedProject;
          savedBaselinesRef.current.set(syncedProject.id, syncedProject);

          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== syncedProject.id) return p;
              if (!isProjectDirtyAgainstBaseline(p, candidateProject)) {
                return syncedProject;
              }
              return {
                ...p,
                cloudRevision: syncedProject.cloudRevision,
                baseCloudRevision: syncedProject.baseCloudRevision,
                versionHistory: syncedProject.versionHistory,
                _hasLocalUnsyncedSave: false,
              };
            })
          );

          const latestInMem =
            projectsRef.current.find((p) => p.id === syncedProject.id) || syncedProject;
          const stillDirty = isProjectDirtyAgainstBaseline(latestInMem, syncedProject);
          setActiveConflict(null);
          setHasUnsavedChanges(stillDirty);
          hasUnsavedChangesRef.current = stillDirty;
          setSaveStatus(stillDirty ? 'unsaved' : 'saved_cloud');

          if (!options?.silentToast) {
            toast.success(
              'Saved to cloud',
              `"${syncedProject.title || 'Untitled'}" synced (Revision ${cloudResult.cloudRevision}).`
            );
          }
          return true;
        }

        if (cloudResult.status === 'conflict') {
          setActiveConflict(cloudResult.conflict);
          setIsConflictModalOpen(true);
          setHasUnsavedChanges(true);
          hasUnsavedChangesRef.current = true;
          setSaveStatus('conflict');
          toast.warning(
            'Conflict — changes need review',
            'A newer cloud version was detected. Review the differences before saving.'
          );
          return false;
        }

        // Cloud error: saved locally, but cloud write failed -> keep dirty/error state
        setHasUnsavedChanges(true);
        hasUnsavedChangesRef.current = true;
        setSaveStatus('cloud_error');
        toast.error(
          'Cloud save failed',
          cloudResult.status === 'cloud_error'
            ? cloudResult.errorMessage
            : 'Saved locally, but cloud sync failed.'
        );
        return false;
      } catch (err) {
        console.error('Manual save error:', err);
        setSaveStatus('cloud_error');
        toast.error('Save failed', 'Could not complete save operation.');
        return false;
      } finally {
        isSavingInFlightRef.current = false;
      }
    },
    [activeProject]
  );

  const handleManualSave = useCallback(() => {
    void performProjectSave();
  }, [performProjectSave]);

  const handleRetrySave = useCallback(() => {
    void performProjectSave();
  }, [performProjectSave]);

  // Requirement 3: Browser tab close / refresh warning only when unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current) {
        e.preventDefault();
        e.returnValue =
          'You have unsaved changes in your document. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Global Keyboard Shortcuts (Phase 10, Part D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl + S -> Save
      if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleManualSave();
      }

      // Cmd/Ctrl + F -> Find in Document (only in workspace)
      if (isCmdOrCtrl && e.key.toLowerCase() === 'f' && currentView === 'workspace') {
        e.preventDefault();
        setIsFindOpen((prev) => !prev);
      }

      // Escape -> Close search or active drawer or diff modal
      if (e.key === 'Escape') {
        if (isFindOpen) {
          setIsFindOpen(false);
          clearHighlights();
        } else if (diffProposal) {
          setDiffProposal(null);
        } else if (activePanel) {
          setActivePanel(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleManualSave, currentView, isFindOpen, clearHighlights, diffProposal, activePanel]);

  // Requirement 3: Guard internal navigation / project switching when unsaved changes exist
  const executeWithUnsavedGuard = useCallback(
    (action: () => void) => {
      if (currentView === 'workspace' && activeProject && hasUnsavedChangesRef.current) {
        pendingNavigationActionRef.current = action;
        setIsUnsavedModalOpen(true);
        return;
      }
      action();
    },
    [currentView, activeProject]
  );

  const handleSaveAndLeave = useCallback(async () => {
    setIsSavingForNavigation(true);
    try {
      const ok = await performProjectSave();
      if (ok) {
        setIsUnsavedModalOpen(false);
        const pending = pendingNavigationActionRef.current;
        pendingNavigationActionRef.current = null;
        pending?.();
      } else {
        // Save failed or hit conflict -> close unsaved modal so user sees error/conflict modal without losing edits
        setIsUnsavedModalOpen(false);
      }
    } finally {
      setIsSavingForNavigation(false);
    }
  }, [performProjectSave]);

  const handleDiscardAndLeave = useCallback(() => {
    if (activeProject) {
      const baseline =
        savedBaselinesRef.current.get(activeProject.id) ||
        storage.getProjectById(activeProject.id);
      if (baseline) {
        setProjects((prev) => prev.map((p) => (p.id === baseline.id ? baseline : p)));
      }
    }
    setHasUnsavedChanges(false);
    hasUnsavedChangesRef.current = false;
    setIsUnsavedModalOpen(false);
    const pending = pendingNavigationActionRef.current;
    pendingNavigationActionRef.current = null;
    pending?.();
  }, [activeProject]);

  const handleStayOnArticle = useCallback(() => {
    pendingNavigationActionRef.current = null;
    setIsUnsavedModalOpen(false);
  }, []);

  // Conflict Resolution Handlers (Requirement 5)
  const handleReloadCloudVersion = useCallback(async (conflict: ProjectConflictInfo) => {
    setIsResolvingConflict(true);
    try {
      const { localWorkingProject, remoteProject, remoteRevision } = conflict;
      const mergedHistory = mergeVersionHistories(
        localWorkingProject.versionHistory,
        remoteProject.versionHistory
      );
      const backupHistory = createVersionSnapshot(
        { ...localWorkingProject, versionHistory: mergedHistory },
        'conflict_backup',
        {
          label: 'Local working version (saved before loading cloud version)',
          actionDescription: 'Preserved local edits when resolving conflict in favor of cloud revision',
          force: true,
        }
      );
      const finalHistory = mergeVersionHistories(backupHistory, mergedHistory);
      storage.saveProjectHistorySnapshots(conflict.projectId, finalHistory);

      const adoptedProject: WritingProject = {
        ...localWorkingProject,
        ...remoteProject,
        content: ensureSemanticHtml(remoteProject.content),
        versionHistory: trimInlineVersionHistory(finalHistory),
        cloudRevision: remoteRevision,
        baseCloudRevision: remoteRevision,
        _hasLocalUnsyncedSave: false,
        _isSeedProject: false,
      };

      storage.saveProjectsFromRemote([adoptedProject], { replaceAllReconciled: false });
      savedBaselinesRef.current.set(adoptedProject.id, adoptedProject);
      setProjects((prev) => prev.map((p) => (p.id === adoptedProject.id ? adoptedProject : p)));

      syncEngine.clearConflictForProject(conflict.projectId);
      setActiveConflict(null);
      setIsConflictModalOpen(false);
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      setSaveStatus('saved_cloud');
      toast.success(
        'Cloud Version Loaded',
        `Loaded Cloud Revision ${remoteRevision}. Your previous local edits are preserved in Version History.`
      );
    } finally {
      setIsResolvingConflict(false);
    }
  }, []);

  const handleSaveLocalAsCopy = useCallback(async (conflict: ProjectConflictInfo) => {
    setIsResolvingConflict(true);
    try {
      const { localWorkingProject, remoteProject, remoteRevision } = conflict;
      // 1. Restore the original project to the authoritative cloud version
      const adoptedRemote: WritingProject = {
        ...remoteProject,
        content: ensureSemanticHtml(remoteProject.content),
        cloudRevision: remoteRevision,
        baseCloudRevision: remoteRevision,
        _hasLocalUnsyncedSave: false,
        _isSeedProject: false,
      };
      storage.saveProjectsFromRemote([adoptedRemote]);
      savedBaselinesRef.current.set(adoptedRemote.id, adoptedRemote);

      // 2. Create a separate new project with the local working content
      const copyTitle = `${localWorkingProject.title || 'Untitled'} (Conflict Copy)`;
      const createdCopy = storage.createProject(localWorkingProject.type, copyTitle, {
        ...localWorkingProject,
        title: copyTitle,
        cloudRevision: 0,
        baseCloudRevision: 0,
      });

      let finalCopy = createdCopy;
      if (syncEngine.isSignedIn()) {
        const res = await syncEngine.saveProjectToCloud(
          createdCopy,
          createdCopy.versionHistory || []
        );
        if (res.status === 'saved_cloud') {
          finalCopy = res.savedProject;
        }
      }

      savedBaselinesRef.current.set(finalCopy.id, finalCopy);
      syncEngine.clearConflictForProject(conflict.projectId);
      setActiveConflict(null);
      setIsConflictModalOpen(false);
      setProjects(storage.getProjects());
      setActiveProjectId(finalCopy.id);
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      setSaveStatus(getCleanBaselineSaveStatus(finalCopy));
      toast.success('Saved as Separate Copy', `Created "${copyTitle}".`);
    } finally {
      setIsResolvingConflict(false);
    }
  }, []);

  const handleForceOverwriteCloud = useCallback(
    async (conflict: ProjectConflictInfo) => {
      setIsResolvingConflict(true);
      try {
        const ok = await performProjectSave({
          projectOverride: conflict.localWorkingProject,
          forceOverwrite: true,
          label: `Overwrote Cloud Revision ${conflict.remoteRevision}`,
        });
        if (ok) {
          setIsConflictModalOpen(false);
          setActiveConflict(null);
        }
      } finally {
        setIsResolvingConflict(false);
      }
    },
    [performProjectSave]
  );

  // Project Creation
  const handleCreateProject = (type: ProjectType) => {
    executeWithUnsavedGuard(() => {
      const created = storage.createProject(type);
      savedBaselinesRef.current.set(created.id, created);
      setProjects(storage.getProjects());
      setActiveProjectId(created.id);
      setActivePanel(null);
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      setSaveStatus('saved_local');
      setCurrentView('workspace');
      toast.success('Project Created', `Started new ${type.replace('_', ' ')}.`);
    });
  };

  // Phase 10.5: Use Generated Editorial Idea -> Creates new Article project
  const handleUseIdea = (idea: EditorialIdea, targetAudience?: string) => {
    executeWithUnsavedGuard(() => {
      const created = storage.createProject('article', idea.title, {
        brief: {
          purpose: idea.whyInteresting,
          audience: targetAudience || 'Discerning gifters & readers',
          readerLearns: idea.angle,
          readerFeels: 'Engaged, thoughtful, and relieved to find recommendations written by an authentic human connoisseur.',
          readerAction: 'Gain an authentic understanding beyond commercial clichés.',
          keyPoints: [
            `Editorial Premise: ${idea.angle}`,
            `Why It's Engaging: ${idea.whyInteresting}`,
            idea.searchIntent ? `Search Intent: ${idea.searchIntent}` : 'Focus on recipient psychology and craft nuance',
          ],
          thingsToAvoid: [
            'Generic product listicles',
            'Superficial keyword repetition',
            'Vague praise without material detail',
          ],
        },
        articleMeta: {
          slug: idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          seoTitle: `${idea.title} | Science of Gifts`,
          metaDescription: idea.angle.length > 155 ? `${idea.angle.slice(0, 152)}...` : idea.angle,
          standfirst: idea.angle,
          targetKeyword: '',
          secondaryKeywords: [],
          audience: targetAudience || 'Discerning gifters & readers',
          searchIntent: idea.searchIntent || 'Editorial insight & advice',
        },
        editorialDevelopment: {
          originalIdea: idea,
          angles: [],
          direction: {
            briefMentionAngleIds: [],
            doNotUseAngleIds: [],
            editorsDirection: '',
          },
          status: 'idea',
        },
        lastAIRequest: {
          id: `ai-req-${Date.now()}`,
          modelUsed: 'gemini-3.6-flash',
          modelDisplayName: 'Gemini 3.6 Flash',
          action: 'idea_generation',
          actionType: 'idea_generation',
          timestamp: new Date().toISOString(),
          status: 'completed',
        },
      });

      savedBaselinesRef.current.set(created.id, created);
      setProjects(storage.getProjects());
      setActiveProjectId(created.id);
      setActivePanel('develop');
      setHasUnsavedChanges(false);
      hasUnsavedChangesRef.current = false;
      setSaveStatus('saved_local');
      setCurrentView('workspace');
      toast.success('Article Draft Created', `Loaded "${idea.title}" into Article Studio.`);
    });
  };

  // Open existing project
  const handleOpenProject = (id: string) => {
    if (id === activeProjectId && currentView === 'workspace') return;
    executeWithUnsavedGuard(() => {
      setActiveProjectId(id);
      setActivePanel(null);
      setCurrentView('workspace');
    });
  };

  // Delete project
  const handleDeleteProject = (id: string) => {
    const found = projects.find((p) => p.id === id);
    storage.deleteProject(id);
    setProjects(storage.getProjects());
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setActivePanel(null);
      setCurrentView('dashboard');
    }
    toast.info('Project Deleted', `"${found?.title || 'Project'}" has been removed.`);
  };

  // Rename project
  const handleRenameProject = (id: string, newTitle: string) => {
    storage.renameProject(id, newTitle);
    setProjects(storage.getProjects());
    toast.info('Title Updated', `Renamed to "${newTitle}".`);
  };

  // Duplicate project (Phase 10, Part G)
  const handleDuplicateProject = (project: WritingProject) => {
    const copyTitle = `Copy of ${project.title || 'Untitled Draft'}`;
    const duplicated: WritingProject = {
      ...project,
      id: `proj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: copyTitle,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft',
      // Reset version history with fresh initial snapshot
      versionHistory: createVersionSnapshot(
        { ...project, title: copyTitle },
        'manual_save',
        { label: `Initial duplicate from "${project.title}"` }
      ),
    };
    storage.saveProject(duplicated);
    setProjects(storage.getProjects());
    toast.success('Project Duplicated', `Created "${copyTitle}".`);
  };

  // Update Status directly
  const handleUpdateStatus = (id: string, status: ProjectStatus) => {
    const updated = storage.updateProjectStatus(id, status);
    if (updated) {
      setProjects(storage.getProjects());
      toast.info('Status Changed', `Project is now marked as ${status.replace('_', ' ')}.`);
    }
  };

  // Draft a specific section from Outline with AI
  const handleDraftSectionFromOutline = async (section: OutlineItem) => {
    if (!activeProject) return;
    try {
      const res = await geminiService.executeAction(activeProject, 'generate_section', {
        targetOutlineItem: section,
        scope: 'section',
      });
      if (res.ok && res.proposedText) {
        setDiffProposal({
          id: `prop-sec-${section.id}`,
          scopeDescription: `Outline Section: "${section.title}"`,
          targetText: '',
          proposedText: res.proposedText,
          explanation: res.explanation || `Drafted section based on "${section.title}".`,
          mode: 'insert',
        });
      }
    } catch (err) {
      console.error('Error drafting section:', err);
      toast.error('Drafting Failed', 'Could not generate outline section.');
    }
  };

  // Apply AI Diff Proposal
  const handleAcceptProposal = (proposal: DiffProposal) => {
    if (!activeProject) return;

    // Automatically create version checkpoint before applying AI rewrite
    const historyWithCheckpoint = createVersionSnapshot(activeProject, 'before_ai_edit', {
      label: proposal.actionLabel || 'Before AI Edit',
    });

    // 1. Try atomic Tiptap ProseMirror replacement if selection range is present
    if (
      editorRef.current &&
      proposal.range &&
      proposal.range.start !== undefined &&
      proposal.range.end !== undefined &&
      proposal.range.start !== proposal.range.end
    ) {
      try {
        editorRef.current
          .chain()
          .focus()
          .setTextSelection({ from: proposal.range.start, to: proposal.range.end })
          .insertContent(ensureSemanticHtml(proposal.proposedText))
          .run();

        const updatedHtml = editorRef.current.getHTML();
        handleUpdateActiveProject({
          ...activeProject,
          content: updatedHtml,
          updatedAt: new Date().toISOString(),
          versionHistory: historyWithCheckpoint,
        });
        setDiffProposal(null);
        toast.success('AI Edit Accepted', 'Prose updated and checkpoint saved.');
        return;
      } catch (e) {
        console.warn('ProseMirror selection replacement failed, falling back to string replace:', e);
      }
    }

    // 2. Fallback to clean HTML string replacement
    let newContent = activeProject.content;
    if (proposal.mode === 'insert') {
      newContent = `${activeProject.content}<p>${ensureSemanticHtml(proposal.proposedText)}</p>`;
    } else if (proposal.targetText && activeProject.content.includes(proposal.targetText)) {
      newContent = activeProject.content.replace(proposal.targetText, ensureSemanticHtml(proposal.proposedText));
    } else {
      newContent = `${activeProject.content}\n${ensureSemanticHtml(proposal.proposedText)}`;
    }

    handleUpdateActiveProject({
      ...activeProject,
      content: newContent,
      updatedAt: new Date().toISOString(),
      versionHistory: historyWithCheckpoint,
    });
    setDiffProposal(null);
    toast.success('AI Edit Accepted', 'Prose updated and checkpoint saved.');
  };

  // Internal link opportunity acceptance
  const handleAcceptLinkOpportunity = (opp: LinkOpportunity) => {
    if (!activeProject) return;

    // 1. Validate destination URL
    if (!isValidUrl(opp.linkUrl)) {
      toast.error('Invalid URL', `Destination URL "${opp.linkUrl}" is invalid.`);
      return;
    }

    // 2. Check duplicate protection before insertion
    if (isUrlAlreadyInDocument(opp.linkUrl, activeProject.content)) {
      toast.error(
        'Duplicate Link Prevented',
        `Destination "${opp.linkTitle}" (${opp.linkUrl}) is already linked in this article.`
      );
      return;
    }

    // 3. Apply hyperlink insertion
    const res = applyHyperlinkToHtml(
      activeProject.content,
      opp.suggestedAnchor,
      opp.linkUrl,
      opp.targetPassage
    );

    // 4. Confirm actual document contains the intended hyperlink and destination
    if (!res.applied || !isUrlAlreadyInDocument(opp.linkUrl, res.updatedHtml)) {
      toast.error(
        'Insertion Not Applied',
        `Could not locate the passage or anchor "${opp.suggestedAnchor}" in the current draft. Please verify the draft text.`
      );
      return;
    }

    const historyWithCheckpoint = createVersionSnapshot(activeProject, 'before_ai_edit', {
      label: `Link: ${opp.linkTitle}`,
    });

    const updatedOpportunities = (activeProject.linkOpportunities || []).map((o) =>
      o.id === opp.id ? { ...o, status: 'accepted' as const } : o
    );

    handleUpdateActiveProject({
      ...activeProject,
      content: res.updatedHtml,
      linkOpportunities: updatedOpportunities,
      versionHistory: historyWithCheckpoint,
    });
    toast.success('Internal Link Inserted', `Linked "${opp.suggestedAnchor}" to ${opp.linkTitle}.`);
  };

  const handleAcceptAllLinkOpportunities = (opps: LinkOpportunity[]) => {
    if (!activeProject || opps.length === 0) return;

    let currentHtml = activeProject.content;
    const insertedIds: string[] = [];
    const skippedItems: string[] = [];

    opps.forEach((opp) => {
      if (!isValidUrl(opp.linkUrl)) {
        skippedItems.push(`Invalid URL: ${opp.linkTitle}`);
        return;
      }
      if (isUrlAlreadyInDocument(opp.linkUrl, currentHtml)) {
        skippedItems.push(`Already linked: ${opp.linkTitle}`);
        return;
      }

      const res = applyHyperlinkToHtml(
        currentHtml,
        opp.suggestedAnchor,
        opp.linkUrl,
        opp.targetPassage
      );

      if (res.applied && isUrlAlreadyInDocument(opp.linkUrl, res.updatedHtml)) {
        currentHtml = res.updatedHtml;
        insertedIds.push(opp.id);
      } else {
        skippedItems.push(`Passage not matched: ${opp.suggestedAnchor}`);
      }
    });

    if (insertedIds.length === 0) {
      toast.error(
        'Insertion Failed',
        skippedItems.length > 0 ? skippedItems.join('; ') : 'Could not insert recommendations.'
      );
      return;
    }

    const historyWithCheckpoint = createVersionSnapshot(activeProject, 'before_ai_edit', {
      label: `Bulk Inserted ${insertedIds.length} Internal Links`,
    });

    const updatedOpportunities = (activeProject.linkOpportunities || []).map((o) =>
      insertedIds.includes(o.id) ? { ...o, status: 'accepted' as const } : o
    );

    handleUpdateActiveProject({
      ...activeProject,
      content: currentHtml,
      linkOpportunities: updatedOpportunities,
      versionHistory: historyWithCheckpoint,
    });

    if (insertedIds.length === opps.length) {
      toast.success('Internal Links Inserted', `Applied ${insertedIds.length} link opportunities.`);
    } else {
      toast.warning(
        'Partial Insertion',
        `Applied ${insertedIds.length} of ${opps.length} links. (${skippedItems.length} skipped)`
      );
    }
  };

  const handleRejectLinkOpportunity = (oppId: string) => {
    if (!activeProject) return;
    const updatedOpportunities = (activeProject.linkOpportunities || []).map((o) =>
      o.id === oppId ? { ...o, status: 'rejected' as const } : o
    );
    handleUpdateActiveProject({
      ...activeProject,
      linkOpportunities: updatedOpportunities,
    });
  };

  const handleRestoreLinkOpportunity = (oppId: string) => {
    if (!activeProject) return;
    const updatedOpportunities = (activeProject.linkOpportunities || []).map((o) =>
      o.id === oppId ? { ...o, status: 'pending' as const } : o
    );
    handleUpdateActiveProject({
      ...activeProject,
      linkOpportunities: updatedOpportunities,
    });
    toast.success('Recommendation Restored', 'Returned to active recommendations.');
  };

  const handleRejectAllLinkOpportunities = () => {
    if (!activeProject) return;
    const updatedOpportunities = (activeProject.linkOpportunities || []).map((o) => ({
      ...o,
      status: 'rejected' as const,
    }));
    handleUpdateActiveProject({
      ...activeProject,
      linkOpportunities: updatedOpportunities,
    });
  };

  // Phase 7: Accept Single Review Finding
  const handleAcceptReviewFinding = (finding: ReviewFinding) => {
    if (!activeProject || !finding.proposedText) return;
    const historyWithCheckpoint = createVersionSnapshot(activeProject, 'before_ai_edit', {
      label: `Editorial Fix: ${finding.category}`,
    });

    let newContent = activeProject.content;
    if (finding.originalText && activeProject.content.includes(finding.originalText)) {
      newContent = activeProject.content.replace(
        finding.originalText,
        ensureSemanticHtml(finding.proposedText)
      );
    } else {
      newContent = `${activeProject.content}\n${ensureSemanticHtml(finding.proposedText)}`;
    }

    const updatedReview: EditorialReviewResult = activeProject.editorialReview
      ? {
          ...activeProject.editorialReview,
          findings: activeProject.editorialReview.findings.map((f) =>
            f.id === finding.id ? { ...f, status: 'accepted' as const } : f
          ),
        }
      : {
          id: `rev-${Date.now()}`,
          reviewedAt: new Date().toISOString(),
          scope: 'all',
          qualitativeSummary: '',
          counts: { critical: 0, important: 0, minor: 0, suggestion: 1 },
          findings: [{ ...finding, status: 'accepted' }],
          mode: 'full',
        };

    handleUpdateActiveProject({
      ...activeProject,
      content: newContent,
      editorialReview: updatedReview,
      versionHistory: historyWithCheckpoint,
    });
    toast.success('Editorial Fix Accepted', 'Finding applied to document.');
  };

  // Accept All Pending Review Findings
  const handleAcceptAllReviewFindings = (pendingFindings: ReviewFinding[]) => {
    if (!activeProject || !activeProject.editorialReview) return;
    const historyWithCheckpoint = createVersionSnapshot(activeProject, 'before_ai_edit', {
      label: `Accept All (${pendingFindings.length} Review Findings)`,
    });

    let currentHtml = activeProject.content;
    pendingFindings.forEach((f) => {
      if (f.proposedText && f.originalText && currentHtml.includes(f.originalText)) {
        currentHtml = currentHtml.replace(f.originalText, ensureSemanticHtml(f.proposedText));
      }
    });

    const updatedReview: EditorialReviewResult = {
      ...activeProject.editorialReview,
      findings: activeProject.editorialReview.findings.map((f) =>
        pendingFindings.some((p) => p.id === f.id) ? { ...f, status: 'accepted' as const } : f
      ),
    };

    handleUpdateActiveProject({
      ...activeProject,
      content: currentHtml,
      editorialReview: updatedReview,
      versionHistory: historyWithCheckpoint,
    });
    toast.success('All Findings Accepted', `Applied ${pendingFindings.length} editorial suggestions.`);
  };

  const handleRejectReviewFinding = (findingId: string) => {
    if (!activeProject || !activeProject.editorialReview) return;
    const updatedReview: EditorialReviewResult = {
      ...activeProject.editorialReview,
      findings: activeProject.editorialReview.findings.map((f) =>
        f.id === findingId ? { ...f, status: 'rejected' as const } : f
      ),
    };
    handleUpdateActiveProject({
      ...activeProject,
      editorialReview: updatedReview,
    });
  };

  const handleRejectAllReviewFindings = () => {
    if (!activeProject || !activeProject.editorialReview) return;
    const updatedReview: EditorialReviewResult = {
      ...activeProject.editorialReview,
      findings: activeProject.editorialReview.findings.map((f) => ({
        ...f,
        status: 'rejected' as const,
      })),
    };
    handleUpdateActiveProject({
      ...activeProject,
      editorialReview: updatedReview,
    });
  };

  const handleUpdateReview = (reviewResult: EditorialReviewResult) => {
    if (!activeProject) return;
    handleUpdateActiveProject({
      ...activeProject,
      editorialReview: reviewResult,
    });
  };

  // Phase 8: Quality Control handlers
  const handleUpdateQC = (qcResult: QCResult) => {
    if (!activeProject) return;
    handleUpdateActiveProject({
      ...activeProject,
      qualityControl: qcResult,
    });
  };

  const handleApplyQCFix = (finding: QCFinding) => {
    if (!activeProject || !finding.proposedText) return;
    const historyWithCheckpoint = createVersionSnapshot(activeProject, 'before_qc', {
      label: `QC Fix: ${finding.title}`,
    });

    let newContent = activeProject.content;
    if (finding.targetText && activeProject.content.includes(finding.targetText)) {
      newContent = activeProject.content.replace(
        finding.targetText,
        ensureSemanticHtml(finding.proposedText)
      );
    } else {
      newContent = `${activeProject.content}\n${ensureSemanticHtml(finding.proposedText)}`;
    }

    const updatedQC: QCResult = activeProject.qualityControl
      ? {
          ...activeProject.qualityControl,
          findings: activeProject.qualityControl.findings.map((f) =>
            f.id === finding.id ? { ...f, targetText: undefined } : f
          ),
        }
      : {
          id: `qc-${Date.now()}`,
          runAt: new Date().toISOString(),
          documentLengthAtRun: activeProject.content.length,
          status: 'ready',
          summary: '',
          counts: { critical: 0, warning: 0, suggestion: 0 },
          findings: [finding],
          categoryChecks: [],
        };

    handleUpdateActiveProject({
      ...activeProject,
      content: newContent,
      qualityControl: updatedQC,
      versionHistory: historyWithCheckpoint,
    });
    toast.success('QC Fix Applied', `Resolved: ${finding.title}.`);
  };

  const getSelectedText = () => {
    if (editorRef.current) {
      try {
        const { from, to } = editorRef.current.state.selection;
        const liveText = editorRef.current.state.doc.textBetween(from, to, ' ').trim();
        if (liveText) {
          return liveText;
        }
      } catch (e) {
        console.warn('Failed to extract selection from editorRef:', e);
      }
    }
    return savedSelectedText;
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#faf9f6] text-[#1e232a] font-ui antialiased selection:bg-amber-100 selection:text-amber-950">
      {/* Toast Notifications */}
      <ToastContainer />

      {/* Two-Level Global Navigation & Project Toolbar */}
      <Navigation
        currentView={currentView}
        activeProject={activeProject}
        saveStatus={saveStatus}
        hasUnsavedChanges={hasUnsavedChanges}
        onManualSave={handleManualSave}
        onRetrySave={handleRetrySave}
        onOpenConflictModal={() => {
          if (activeConflict) {
            setIsConflictModalOpen(true);
          } else if (activeProjectId) {
            const c = syncEngine.getConflictForProject(activeProjectId);
            if (c) {
              setActiveConflict(c);
              setIsConflictModalOpen(true);
            }
          }
        }}
        activePanel={activePanel}
        onTogglePanel={handleTogglePanel}
        onNavigate={(view, projectType) => {
          executeWithUnsavedGuard(() => {
            setActivePanel(null);
            if (view === 'dashboard') {
              if (projectType) {
                const existing = projects.find((p) => p.type === projectType);
                if (existing) {
                  setActiveProjectId(existing.id);
                  setCurrentView('workspace');
                  return;
                } else {
                  const created = storage.createProject(projectType);
                  savedBaselinesRef.current.set(created.id, created);
                  setProjects(storage.getProjects());
                  setActiveProjectId(created.id);
                  setHasUnsavedChanges(false);
                  hasUnsavedChangesRef.current = false;
                  setSaveStatus('saved_local');
                  setCurrentView('workspace');
                  return;
                }
              }
              setCurrentView('dashboard');
            } else if (view === 'idea_generator') {
              setCurrentView('idea_generator');
            } else if (view === 'research') {
              setActiveResearchStudyId(null);
              setCurrentView('research');
            } else if (view === 'style_reference') {
              setCurrentView('style_reference');
            } else if (view === 'internal_links') {
              setCurrentView('internal_links');
            } else if (view === 'backup') {
              setCurrentView('backup');
            } else {
              setCurrentView('settings');
            }
          });
        }}
        onCreateProject={handleCreateProject}
      />

      {/* In-Document Search Floating Bar (Phase 10, Part E) */}
      {currentView === 'workspace' && isFindOpen && (
        <div className="fixed top-24 sm:top-20 right-3 sm:right-6 left-3 sm:left-auto max-w-sm z-40 animate-fade-in">
          <FindInDocumentBar
            isOpen={isFindOpen}
            onClose={() => {
              setIsFindOpen(false);
              clearHighlights();
            }}
            onSearchChange={(q) => performSearch(q)}
            totalMatches={searchMatchCount}
            currentMatchIndex={searchMatchIndex}
            onNextMatch={nextMatch}
            onPrevMatch={prevMatch}
          />
        </div>
      )}

      {/* Workspace Area: Main Content + Right Side Panel */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative" ref={workspaceContainerRef}>
        <ErrorBoundary onReset={() => setProjects(storage.getProjects())}>
          {currentView === 'dashboard' && (
            <Dashboard
              projects={projects}
              onOpenProject={handleOpenProject}
              onCreateProject={handleCreateProject}
              onDeleteProject={handleDeleteProject}
              onDuplicateProject={handleDuplicateProject}
              onUpdateStatus={handleUpdateStatus}
              onRenameProject={handleRenameProject}
              onOpenIdeaGenerator={() => setCurrentView('idea_generator')}
            />
          )}

          {currentView === 'idea_generator' && (
            <IdeaGeneratorView
              onUseIdea={handleUseIdea}
              onBackToStudio={() => setCurrentView(activeProjectId ? 'workspace' : 'dashboard')}
            />
          )}

          {/* Research Library (Top-Level Area & Workspace) */}
          {currentView === 'research' && !activeResearchStudyId && (
            <ResearchLibraryView
              onOpenStudy={(studyId) => setActiveResearchStudyId(studyId)}
              onBackToStudio={() => setCurrentView(activeProjectId ? 'workspace' : 'dashboard')}
              onUseIdea={handleUseIdea}
            />
          )}

          {currentView === 'research' && activeResearchStudyId && (
            <ResearchStudyWorkspace
              study={
                storage.getResearchStudy(activeResearchStudyId) ||
                storage.getResearchStudies()[0]
              }
              onBack={() => setActiveResearchStudyId(null)}
              onUpdateStudy={() => {
                // study saved in persistent storage
              }}
              onDeleteStudy={(studyId) => {
                storage.deleteResearchStudy(studyId);
                setActiveResearchStudyId(null);
                toast.success('Study Deleted', 'Removed study from Research Library.');
              }}
              onUseIdea={handleUseIdea}
            />
          )}

          {currentView === 'backup' && (
            <DataBackupView
              onBackToStudio={() => setCurrentView(activeProjectId ? 'workspace' : 'dashboard')}
            />
          )}

          {currentView === 'settings' && (
            <SettingsView
              onBackToStudio={() => setCurrentView(activeProjectId ? 'workspace' : 'dashboard')}
              onNavigateToBackup={() => setCurrentView('backup')}
            />
          )}

          {currentView === 'style_reference' && (
            <StyleReferenceView
              onBackToStudio={() => setCurrentView(activeProjectId ? 'workspace' : 'dashboard')}
              activeProjectTitle={activeProject?.title}
              activeProjectProfileId={activeProject?.styleProfileId}
              onApplyProfileToActiveProject={(profileId) => {
                if (activeProject) {
                  handleUpdateActiveProject({
                    ...activeProject,
                    styleProfileId: profileId,
                  });
                }
              }}
            />
          )}

          {currentView === 'internal_links' && (
            <InternalLinksView
              onBackToStudio={() => setCurrentView(activeProjectId ? 'workspace' : 'dashboard')}
            />
          )}

          {/* Phase 5: Specialized Gift Guide Studio */}
          {currentView === 'workspace' && activeProject && activeProject.type === 'gift_guide' && (
            <GiftGuideWorkspace
              project={activeProject}
              editorRef={editorRef}
              activePanel={activePanel}
              onTogglePanel={handleTogglePanel}
              onChange={handleUpdateActiveProject}
              onRequestProposal={(prop) => setDiffProposal(prop)}
            />
          )}

          {/* Phase 6: Specialized Product Copy Studio */}
          {currentView === 'workspace' && activeProject && activeProject.type === 'product_copy' && (
            <ProductCopyWorkspace
              project={activeProject}
              editorRef={editorRef}
              activePanel={activePanel}
              onTogglePanel={handleTogglePanel}
              onChange={handleUpdateActiveProject}
              onRequestProposal={(prop) => setDiffProposal(prop)}
            />
          )}

          {/* Phase 2: Article Workspace */}
          {currentView === 'workspace' && activeProject && activeProject.type === 'article' && (
            <ArticleWorkspace
              project={activeProject}
              editorRef={editorRef}
              activePanel={activePanel}
              onTogglePanel={handleTogglePanel}
              onOpenOutline={() => setActivePanel('outline')}
              onOpenBrief={() => setActivePanel('brief')}
              onOpenDraftPackage={() => setActivePanel('draft_package')}
              onChange={handleUpdateActiveProject}
              onRequestProposal={(prop) => setDiffProposal(prop)}
            />
          )}
        </ErrorBoundary>
      </main>

      {/* Side Panels - Mutually Exclusive Accordion / Drawer System (Exactly 0 or 1 open) */}
      {currentView === 'workspace' && activeProject && activePanel === 'develop' && (
        <EditorialDevelopmentDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          onChange={handleUpdateActiveProject}
          onOpenOutline={() => setActivePanel('outline')}
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'brief' && (
        <ProjectBriefDrawer
          isOpen={true}
          onClose={handleClosePanel}
          brief={activeProject.brief}
          onChange={(updatedBrief) =>
            handleUpdateActiveProject({ ...activeProject, brief: updatedBrief })
          }
          onOpenDevelop={activeProject.type === 'article' ? () => setActivePanel('develop') : undefined}
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'outline' && (
        <ContentOutlineDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          outline={activeProject.outline}
          onChange={(updatedOutline) =>
            handleUpdateActiveProject({ ...activeProject, outline: updatedOutline })
          }
          onUpdateProject={handleUpdateActiveProject}
          onDraftSection={handleDraftSectionFromOutline}
          onOpenDevelop={() => setActivePanel('develop')}
          onOpenDraftPackage={() => setActivePanel('draft_package')}
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'draft_package' && (
        <DraftPackageDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          onUpdateProject={handleUpdateActiveProject}
          onOpenOutline={() => setActivePanel('outline')}
          onOpenDevelop={() => setActivePanel('develop')}
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'rules' && (
        <ContentRulesDrawer
          isOpen={true}
          onClose={handleClosePanel}
          rules={activeProject.contentRules}
          onChange={(updatedRules) =>
            handleUpdateActiveProject({ ...activeProject, contentRules: updatedRules })
          }
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'controls' && (
        <StyleSettingsDrawer
          isOpen={true}
          onClose={handleClosePanel}
          settings={activeProject.writingControls}
          styleProfileId={activeProject.styleProfileId}
          modelOverride={activeProject.modelOverride}
          onModelOverrideChange={(newModel) =>
            handleUpdateActiveProject({
              ...activeProject,
              modelOverride: newModel,
            })
          }
          onStyleProfileChange={(newProfileId) =>
            handleUpdateActiveProject({
              ...activeProject,
              styleProfileId: newProfileId,
            })
          }
          onChange={(updatedSettings) =>
            handleUpdateActiveProject({
              ...activeProject,
              writingControls: updatedSettings,
              aiSettings: updatedSettings,
            })
          }
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'instructions' && (
        <ProjectInstructionsDrawer
          isOpen={true}
          onClose={handleClosePanel}
          projectTitle={activeProject.title}
          instructions={activeProject.projectInstructions}
          onChange={(updatedInstructions) =>
            handleUpdateActiveProject({
              ...activeProject,
              projectInstructions: updatedInstructions,
            })
          }
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'links' && (
        <LinkOpportunitiesDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          editorRef={editorRef}
          onUpdateOpportunities={(opps) =>
            handleUpdateActiveProject({
              ...activeProject,
              linkOpportunities: opps,
            })
          }
          onAcceptOpportunity={handleAcceptLinkOpportunity}
          onAcceptAllOpportunities={handleAcceptAllLinkOpportunities}
          onRejectOpportunity={handleRejectLinkOpportunity}
          onRestoreOpportunity={handleRestoreLinkOpportunity}
          onRejectAllOpportunities={handleRejectAllLinkOpportunities}
        />
      )}

      {/* Editorial Intelligence Drawer (Phase 1: Unified Editorial Review & Quality Control Panel) */}
      {currentView === 'workspace' && activeProject && (activePanel === 'review' || activePanel === 'qc') && (
        <EditorialIntelligenceDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          selectedText={getSelectedText()}
          defaultTab={activePanel === 'qc' ? 'qc' : 'review'}
          onUpdateReview={handleUpdateReview}
          onAcceptFinding={handleAcceptReviewFinding}
          onAcceptAllFindings={handleAcceptAllReviewFindings}
          onRejectFinding={handleRejectReviewFinding}
          onRejectAllFindings={handleRejectAllReviewFindings}
          onUpdateQC={handleUpdateQC}
          onRequestProposal={(prop) => setDiffProposal(prop)}
          onApplyFix={handleApplyQCFix}
          onOpenCitationStudio={() => setActivePanel('citations')}
        />
      )}

      {currentView === 'workspace' && activeProject && activePanel === 'history' && (
        <VersionHistoryDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          onUpdateProject={handleUpdateActiveProject}
          onRestoreVersion={async (restoredProject, newSnapshots, restoredVersionNumber) => {
            setProjects((prev) =>
              prev.map((p) => (p.id === restoredProject.id ? restoredProject : p))
            );
            const ok = await performProjectSave({
              projectOverride: restoredProject,
              newSnapshotsOverride: newSnapshots,
              silentToast: true,
            });
            if (ok) {
              toast.success(
                'Version Restored',
                `Restored Version ${restoredVersionNumber} and saved checkpoint.`
              );
            }
          }}
        />
      )}

      {/* Research Drawer (Requirement #8) */}
      {currentView === 'workspace' && activeProject && activePanel === 'research' && (
        <ResearchDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          onUpdateProject={handleUpdateActiveProject}
          onNavigateToResearchLibrary={() => executeWithUnsavedGuard(() => setCurrentView('research'))}
          onOpenCitationStudio={() => setActivePanel('citations')}
        />
      )}

      {/* Feature: Research Citation Studio Drawer */}
      {currentView === 'workspace' && activeProject && activePanel === 'citations' && (
        <CitationStudioDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          onUpdateProject={handleUpdateActiveProject}
          editorRef={editorRef}
          onNavigateToResearchLibrary={() => executeWithUnsavedGuard(() => setCurrentView('research'))}
        />
      )}
      </div>

      {/* Unsaved Work Navigation Protection Modal (Requirement 3) */}
      <UnsavedChangesModal
        isOpen={isUnsavedModalOpen}
        projectTitle={activeProject?.title || 'Untitled Project'}
        isSaving={isSavingForNavigation}
        onSaveAndLeave={handleSaveAndLeave}
        onDiscardAndLeave={handleDiscardAndLeave}
        onStay={handleStayOnArticle}
      />

      {/* Cloud Revision Conflict Resolution Modal (Requirement 5) */}
      <ConflictResolutionModal
        isOpen={isConflictModalOpen}
        conflict={activeConflict}
        isProcessing={isResolvingConflict}
        onReloadCloudVersion={handleReloadCloudVersion}
        onSaveLocalAsCopy={handleSaveLocalAsCopy}
        onForceOverwriteCloud={handleForceOverwriteCloud}
        onClose={() => setIsConflictModalOpen(false)}
      />

      {/* AI Diff Proposal Review Modal */}
      <DiffReviewModal
        proposal={diffProposal}
        onAccept={handleAcceptProposal}
        onReject={() => setDiffProposal(null)}
      />
    </div>
  );
}
