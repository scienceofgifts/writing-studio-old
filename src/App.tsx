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
} from './types/project';
import { storage } from './services/storage';
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
import { createVersionSnapshot } from './services/versionHistoryService';
import { ensureSemanticHtml } from './utils/richText';
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

export default function App() {
  const [projects, setProjects] = useState<WritingProject[]>(() => storage.getProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => storage.getActiveProjectId());
  const [currentView, setCurrentView] = useState<'dashboard' | 'workspace' | 'settings' | 'style_reference' | 'internal_links' | 'idea_generator' | 'backup' | 'research'>('dashboard');
  const [activeResearchStudyId, setActiveResearchStudyId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [isFindOpen, setIsFindOpen] = useState(false);

  // Initialize theme tokens and IndexedDB persistence engine on mount
  useEffect(() => {
    applyTheme(storage.getTheme());
    storage.init().then(() => {
      setProjects(storage.getProjects());
      const activeId = storage.getActiveProjectId();
      if (activeId) setActiveProjectId(activeId);
    });

    const unsubscribe = storage.subscribe(() => {
      setProjects(storage.getProjects());
    });

    const handleCrossTabStorage = (e: StorageEvent) => {
      if (e.key === 'sog_writing_projects_v2' && e.newValue) {
        setProjects(storage.getProjects());
      }
    };
    window.addEventListener('storage', handleCrossTabStorage);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleCrossTabStorage);
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

  // Persist active project ID
  useEffect(() => {
    storage.setActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  // Debounced Autosave
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleUpdateActiveProject = useCallback((updatedProject: WritingProject) => {
    setSaveStatus('unsaved');
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)));

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(() => {
      setSaveStatus('saving');
      try {
        storage.saveProject(updatedProject, { isAutosave: true, silent: true });
        setTimeout(() => {
          setSaveStatus('saved');
        }, 250);
      } catch (err) {
        console.error('Failed to autosave project:', err);
        setSaveStatus('error');
        toast.error('Autosave failed', 'Could not persist to storage. Local edits are preserved.');
      }
    }, 600);
  }, []);

  // Immediate manual save
  const handleManualSave = useCallback(() => {
    if (!activeProject) return;
    setSaveStatus('saving');
    try {
      storage.saveProject(activeProject);
      setSaveStatus('saved');
      toast.success('Document saved', `"${activeProject.title || 'Untitled'}" saved successfully.`);
    } catch (err) {
      console.error('Manual save error:', err);
      setSaveStatus('error');
      toast.error('Save failed', 'Local storage save failed. Check available browser storage.');
    }
  }, [activeProject]);

  // Retry save
  const handleRetrySave = useCallback(() => {
    if (!activeProject) return;
    handleManualSave();
  }, [activeProject, handleManualSave]);

  // Warn before unload if unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'unsaved' || saveStatus === 'saving') {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes in your document. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveStatus]);

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

  // Project Creation
  const handleCreateProject = (type: ProjectType) => {
    const created = storage.createProject(type);
    setProjects(storage.getProjects());
    setActiveProjectId(created.id);
    setActivePanel(null);
    setCurrentView('workspace');
    toast.success('Project Created', `Started new ${type.replace('_', ' ')}.`);
  };

  // Phase 10.5: Use Generated Editorial Idea -> Creates new Article project
  const handleUseIdea = (idea: EditorialIdea, targetAudience?: string) => {
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

    setProjects(storage.getProjects());
    setActiveProjectId(created.id);
    setActivePanel('develop');
    setCurrentView('workspace');
    toast.success('Article Draft Created', `Loaded "${idea.title}" into Article Studio.`);
  };

  // Open existing project
  const handleOpenProject = (id: string) => {
    setActiveProjectId(id);
    setActivePanel(null);
    setCurrentView('workspace');
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

    if (editorRef.current) {
      editorRef.current.commands.setContent(newContent, { emitUpdate: false });
    }
    window.dispatchEvent(
      new CustomEvent('sog:restore-editor-content', {
        detail: { content: newContent, projectId: activeProject.id },
      })
    );

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

    if (editorRef.current) {
      editorRef.current.commands.setContent(res.updatedHtml, { emitUpdate: false });
    }
    window.dispatchEvent(
      new CustomEvent('sog:restore-editor-content', {
        detail: { content: res.updatedHtml, projectId: activeProject.id },
      })
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

    if (editorRef.current) {
      editorRef.current.commands.setContent(currentHtml, { emitUpdate: false });
    }
    window.dispatchEvent(
      new CustomEvent('sog:restore-editor-content', {
        detail: { content: currentHtml, projectId: activeProject.id },
      })
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

    if (editorRef.current) {
      editorRef.current.commands.setContent(newContent, { emitUpdate: false });
    }
    window.dispatchEvent(
      new CustomEvent('sog:restore-editor-content', {
        detail: { content: newContent, projectId: activeProject.id },
      })
    );

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

    if (editorRef.current) {
      editorRef.current.commands.setContent(currentHtml, { emitUpdate: false });
    }
    window.dispatchEvent(
      new CustomEvent('sog:restore-editor-content', {
        detail: { content: currentHtml, projectId: activeProject.id },
      })
    );

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

    if (editorRef.current) {
      editorRef.current.commands.setContent(newContent, { emitUpdate: false });
    }
    window.dispatchEvent(
      new CustomEvent('sog:restore-editor-content', {
        detail: { content: newContent, projectId: activeProject.id },
      })
    );

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
        onRetrySave={handleRetrySave}
        activePanel={activePanel}
        onTogglePanel={handleTogglePanel}
        onNavigate={(view, projectType) => {
          setActivePanel(null);
          if (view === 'dashboard') {
            if (projectType) {
              const existing = projects.find((p) => p.type === projectType);
              if (existing) {
                setActiveProjectId(existing.id);
                setCurrentView('workspace');
                return;
              } else {
                handleCreateProject(projectType);
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
        />
      )}

      {/* Research Drawer (Requirement #8) */}
      {currentView === 'workspace' && activeProject && activePanel === 'research' && (
        <ResearchDrawer
          isOpen={true}
          onClose={handleClosePanel}
          project={activeProject}
          onUpdateProject={handleUpdateActiveProject}
          onNavigateToResearchLibrary={() => setCurrentView('research')}
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
          onNavigateToResearchLibrary={() => setCurrentView('research')}
        />
      )}
      </div>

      {/* AI Diff Proposal Review Modal */}
      <DiffReviewModal
        proposal={diffProposal}
        onAccept={handleAcceptProposal}
        onReject={() => setDiffProposal(null)}
      />
    </div>
  );
}
