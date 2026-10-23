/**
 * Science of Gifts - Core Editorial Writing Workspace (Phase 2 & Article Export)
 * Primary workspace for Article drafts.
 * The writing surface remains the visual center of the application.
 * Lightweight, non-dominant Export menu for:
 * 1. CMS JSON (.json)
 * 2. Markdown (.md with YAML front matter)
 * 3. Copy CMS JSON
 * Pre-export validation warns about missing required fields and guidelines.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  WritingProject,
  ProjectStatus,
  OutlineItem,
  DiffProposal,
  ActivePanel,
  ArticleMetadata,
} from '../../types/project';
import { Editor } from '../Editor';
import { geminiService } from '../../services/geminiClient';
import { toastService } from '../../services/toastService';
import {
  buildCmsArticleExport,
  buildMarkdownExport,
  validateArticleForExport,
  downloadFile,
  copyToClipboard,
  slugify,
  ExportValidationResult,
} from '../../services/articleExport';
import { ArticleInfoDrawer } from '../drawers/ArticleInfoDrawer';
import { ExportValidationModal } from '../ExportValidationModal';
import {
  Sparkles,
  BookOpen,
  ShieldCheck,
  ChevronDown,
  Download,
  FileCode,
  FileText,
  Copy,
  Sliders,
  Compass,
  ListOrdered,
  Link2,
  Scale,
  ClipboardCheck,
  History,
} from 'lucide-react';

interface ArticleWorkspaceProps {
  project: WritingProject;
  onChange: (updatedProject: WritingProject) => void;
  onRequestProposal: (proposal: DiffProposal) => void;
  activePanel?: ActivePanel;
  onTogglePanel?: (panel: Exclude<ActivePanel, null>) => void;
  onOpenBrief?: () => void;
  onOpenOutline?: () => void;
  onOpenDraftPackage?: () => void;
  onOpenControls?: () => void;
  onOpenRules?: () => void;
  onOpenInstructions?: () => void;
  editorRef?: React.MutableRefObject<any>;
}

export const ArticleWorkspace: React.FC<ArticleWorkspaceProps> = ({
  project,
  onChange,
  onRequestProposal,
  activePanel = null,
  onTogglePanel,
  onOpenBrief,
  onOpenOutline,
  onOpenDraftPackage,
  onOpenControls,
  onOpenRules,
  onOpenInstructions,
  editorRef,
}) => {
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileAiOpen, setIsMobileAiOpen] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isInfoDrawerOpen, setIsInfoDrawerOpen] = useState(false);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState<
    'cms_json' | 'markdown' | 'copy_json'
  >('cms_json');
  const [validationResult, setValidationResult] = useState<ExportValidationResult | null>(null);

  const mobileAiRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [actionsMenuPosition, setActionsMenuPosition] = useState<'left' | 'right'>('left');

  // Close menus when tapping outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (mobileAiRef.current && !mobileAiRef.current.contains(e.target as Node)) {
        setIsMobileAiOpen(false);
      }
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setIsActionsMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Viewport-aware positioning for Actions menu
  useEffect(() => {
    if (!isActionsMenuOpen || !actionsMenuRef.current) return;

    const updatePosition = () => {
      if (!actionsMenuRef.current) return;
      const rect = actionsMenuRef.current.getBoundingClientRect();
      const menuWidth = 240; // w-60 = 240px
      const padding = 16;

      if (rect.left + menuWidth > window.innerWidth - padding) {
        if (rect.right - menuWidth >= padding) {
          setActionsMenuPosition('right');
        } else {
          setActionsMenuPosition('left');
        }
      } else {
        setActionsMenuPosition('left');
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isActionsMenuOpen]);

  // Status update
  const handleStatusChange = (newStatus: ProjectStatus) => {
    onChange({
      ...project,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    });
  };

  // Title update
  const handleTitleChange = (newTitle: string) => {
    onChange({
      ...project,
      title: newTitle,
      updatedAt: new Date().toISOString(),
    });
  };

  // Metadata update
  const handleMetadataChange = (updatedMeta: ArticleMetadata) => {
    onChange({
      ...project,
      articleMeta: updatedMeta,
      updatedAt: new Date().toISOString(),
    });
  };

  // Trigger export flow with validation check
  const handleTriggerExport = (format: 'cms_json' | 'markdown' | 'copy_json') => {
    setIsExportMenuOpen(false);
    const validation = validateArticleForExport(project);

    // If there are critical missing fields or warnings, show validation modal
    if (!validation.isValid || validation.hasWarnings) {
      setPendingExportFormat(format);
      setValidationResult(validation);
      setIsValidationModalOpen(true);
      return;
    }

    // Clean pass - execute export immediately
    executeExport(format);
  };

  // Execute download or clipboard copy
  const executeExport = (format: 'cms_json' | 'markdown' | 'copy_json') => {
    const slug =
      project.articleMeta?.slug?.trim() || slugify(project.title) || 'untitled-article';

    if (format === 'cms_json') {
      const payload = buildCmsArticleExport(project);
      const jsonStr = JSON.stringify(payload, null, 2);
      downloadFile(`${slug}.json`, jsonStr, 'application/json');
      toastService.success(`Downloaded CMS JSON: ${slug}.json`);
    } else if (format === 'markdown') {
      const mdStr = buildMarkdownExport(project);
      downloadFile(`${slug}.md`, mdStr, 'text/markdown');
      toastService.success(`Downloaded Markdown: ${slug}.md`);
    } else if (format === 'copy_json') {
      const payload = buildCmsArticleExport(project);
      const jsonStr = JSON.stringify(payload, null, 2);
      copyToClipboard(jsonStr).then((success) => {
        if (success) {
          toastService.success('Copied CMS JSON to clipboard');
        } else {
          toastService.error('Failed to copy to clipboard');
        }
      });
    }
  };

  // Explicit AI Action Execution
  const handleExecuteAiAction = async (
    action: string,
    customCommand?: string,
    scope: any = 'selection',
    targetOutlineItem?: OutlineItem,
    explicitSelectedText?: string,
    explicitRange?: { start: number; end: number }
  ) => {
    setIsLoading(true);
    try {
      const effectiveText = explicitSelectedText !== undefined ? explicitSelectedText : selectedText;
      const effectiveRange = explicitRange !== undefined ? explicitRange : selectionRange;
      const isSelectionScope = scope === 'selection' && Boolean(effectiveText);
      const res = await geminiService.executeAction(project, action, {
        selectedText: isSelectionScope ? effectiveText : undefined,
        scope,
        customCommand,
        targetOutlineItem,
      });

      if (res.ok && res.proposedText) {
        onRequestProposal({
          id: `prop-${Date.now()}`,
          scopeDescription:
            isSelectionScope
              ? `Selected text (${effectiveText.split(/\s+/).filter(Boolean).length} words)`
              : formatActionScopeDescription(action, targetOutlineItem),
          targetText: isSelectionScope ? effectiveText : '',
          proposedText: res.proposedText,
          explanation: res.explanation,
          modelUsed: res.modelUsed,
          range: isSelectionScope ? effectiveRange : undefined,
          mode: isSelectionScope ? 'replace_selection' : 'insert',
        });
      }
    } catch (err) {
      console.error('Error executing AI action', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper description
  const formatActionScopeDescription = (action: string, item?: OutlineItem) => {
    if (item) return `Section: "${item.title}"`;
    switch (action) {
      case 'generate_intro':
        return 'Generated Introduction';
      case 'continue_writing':
        return 'Continued Draft Reasoning';
      case 'review_writing':
        return 'Editorial Review & Rewrite';
      case 'improve_flow':
        return 'Document Flow Improvement';
      default:
        return action.replace(/_/g, ' ');
    }
  };

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'draft':
        return 'bg-stone-100 text-stone-700 border-stone-200';
      case 'in_progress':
        return 'bg-amber-50 text-amber-900 border-amber-200';
      case 'review':
        return 'bg-blue-50 text-blue-900 border-blue-200';
      case 'complete':
        return 'bg-emerald-50 text-emerald-900 border-emerald-200';
    }
  };

  const currentMeta = project.articleMeta || {
    slug: slugify(project.title) || 'untitled-article',
    seoTitle: project.title ? `${project.title} | Science of Gifts` : '',
    metaDescription: '',
    standfirst: '',
    category: 'Product & Craft Advice',
    targetKeyword: '',
    secondaryKeywords: [],
    audience: 'Thoughtful gifters & readers',
    searchIntent: 'Editorial insight & advice',
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[#faf9f6] overflow-hidden">
      {/* Top Workspace Strip */}
      <div className="px-3 sm:px-6 py-2 sm:py-3 bg-[#f6f3eb] border-b border-[#e5dfd3] shrink-0 select-none">
        {/* Title, Type & Status Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            {/* Editable Title */}
            <input
              type="text"
              value={project.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Draft Title..."
              className="w-full min-w-0 font-editorial text-lg sm:text-2xl md:text-3xl font-bold text-[#1e232a] bg-transparent focus:outline-hidden border-b border-transparent focus:border-amber-500 py-0.5 tracking-tight truncate"
            />
            {currentMeta.standfirst ? (
              <p
                onClick={() => setIsInfoDrawerOpen(true)}
                className="text-xs text-[#5c5447] italic mt-0.5 truncate cursor-pointer hover:text-[#1e232a]"
                title="Click to edit standfirst in Article Details"
              >
                {currentMeta.standfirst}
              </p>
            ) : (
              <p
                onClick={() => setIsInfoDrawerOpen(true)}
                className="text-[11px] text-[#8c8477] cursor-pointer hover:text-[#5c5447] mt-0.5 truncate hidden sm:block"
              >
                + Add standfirst / deck and article metadata...
              </p>
            )}
          </div>

          {/* Right Status Selector, Article Info, Export & Quick Generators */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
            {/* Studio Actions Dropdown for narrow viewports */}
            <div className="relative xl:hidden" ref={actionsMenuRef}>
              <button
                type="button"
                onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#1e232a] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#ede8dc] transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer min-h-[32px]"
                title="Studio Actions & Tools"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-800" />
                <span>Actions</span>
                <ChevronDown className="w-3 h-3 text-[#736c61]" />
                {((project.attachedStudyIds?.length || 0) > 0 || (project.outline?.length || 0) > 0) && (
                  <span className="w-2 h-2 rounded-full bg-amber-600"></span>
                )}
              </button>

              {isActionsMenuOpen && (
                <div
                  className={`absolute ${
                    actionsMenuPosition === 'right' ? 'right-0' : 'left-0'
                  } mt-1.5 w-64 max-w-[calc(100vw-2rem)] bg-white border border-[#dcd6ca] rounded-xl shadow-xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[80vh] overflow-y-auto`}
                >
                  {/* Section 1: Writing & Workflow */}
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8a8275] bg-[#f7f5ef] border-y border-[#ede7db] my-1">
                    Writing & Workflow
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('develop');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Compass className="w-4 h-4 text-amber-800 shrink-0" />
                      <span className="font-semibold">Develop Article</span>
                    </div>
                    {project.editorialDevelopment?.status && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-900">
                        {project.editorialDevelopment.status}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      if (onOpenOutline) onOpenOutline();
                      else onTogglePanel?.('outline');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <ListOrdered className="w-4 h-4 text-blue-700 shrink-0" />
                      <span className="font-semibold">Outline Studio</span>
                    </div>
                    {project.outline && project.outline.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-blue-100 text-blue-900">
                        {project.outline.length} steps
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      if (onOpenDraftPackage) onOpenDraftPackage();
                      else onTogglePanel?.('draft_package');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="font-semibold">Draft Package</span>
                    </div>
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-emerald-100 text-emerald-900">
                      ChatGPT
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('links');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-blue-800 shrink-0" />
                      <span className="font-semibold">Internal Linking Studio</span>
                    </div>
                    {project.linkOpportunities && project.linkOpportunities.filter((o) => o.status === 'pending').length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-blue-100 text-blue-900">
                        {project.linkOpportunities.filter((o) => o.status === 'pending').length} new
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('citations');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-amber-900 shrink-0" />
                      <span className="font-semibold">Citation Studio</span>
                    </div>
                    {project.citationRecommendations && project.citationRecommendations.filter((r) => r.status === 'pending').length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-950">
                        {project.citationRecommendations.filter((r) => r.status === 'pending').length} new
                      </span>
                    )}
                  </button>

                  {/* Section 2: Controls & Research */}
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8a8275] bg-[#f7f5ef] border-y border-[#ede7db] my-1">
                    Controls & Research
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setIsInfoDrawerOpen(true);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2 text-[#1e232a] cursor-pointer"
                  >
                    <Sliders className="w-4 h-4 text-amber-800 shrink-0" />
                    <div>
                      <div className="font-semibold">Article Info & Brief</div>
                      <div className="text-[10px] text-[#736c61]">SEO, metadata & author</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('controls');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                      <span className="font-semibold">Writing Controls</span>
                    </div>
                    <span className="text-[10px] text-[#736c61]">Tone & style</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('rules');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Scale className="w-4 h-4 text-purple-700 shrink-0" />
                      <span className="font-semibold">Content Rules</span>
                    </div>
                    <span className="text-[10px] text-[#736c61]">Hard constraints</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('instructions');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-800 shrink-0" />
                      <span className="font-semibold">Instructions</span>
                    </div>
                    <span className="text-[10px] text-[#736c61]">Draft notes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('research');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-amber-800 shrink-0" />
                      <span className="font-semibold">Research Library</span>
                    </div>
                    {project.attachedStudyIds && project.attachedStudyIds.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-900">
                        {project.attachedStudyIds.length} attached
                      </span>
                    )}
                  </button>

                  {/* Section 3: Quality & History */}
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8a8275] bg-[#f7f5ef] border-y border-[#ede7db] my-1">
                    Quality & History
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('review');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                      <span className="font-semibold">AI Editorial Review</span>
                    </div>
                    {project.editorialReview &&
                      project.editorialReview.findings.filter((f) => f.status === 'pending').length > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-amber-100 text-amber-950">
                          {project.editorialReview.findings.filter((f) => f.status === 'pending').length} issues
                        </span>
                      )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('qc');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="font-semibold">Quality Control</span>
                    </div>
                    {project.qualityControl && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-emerald-100 text-emerald-900">
                        {project.qualityControl.status}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      onTogglePanel?.('history');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center justify-between text-[#1e232a] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-indigo-700 shrink-0" />
                      <span className="font-semibold">Version History</span>
                    </div>
                    {project.versionHistory && project.versionHistory.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase bg-indigo-100 text-indigo-900">
                        {project.versionHistory.length}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Desktop Studio Buttons (Visible >= xl) */}
            <div className="hidden xl:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onTogglePanel?.('develop')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                  activePanel === 'develop'
                    ? 'bg-[#1e232a] text-white border-[#1e232a]'
                    : 'text-[#1e232a] bg-amber-50/80 border-amber-300 hover:bg-amber-100'
                }`}
                title="Develop Article: Idea → 5 Angles → Editorial Direction → Brief"
              >
                <Compass className={`w-3.5 h-3.5 ${activePanel === 'develop' ? 'text-amber-300' : 'text-amber-800'}`} />
                <span>Develop Article</span>
                {project.editorialDevelopment?.status && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                      activePanel === 'develop'
                        ? 'bg-amber-800 text-amber-100'
                        : 'bg-white text-amber-950 border border-amber-300'
                    }`}
                  >
                    {project.editorialDevelopment.status === 'draft_package_ready'
                      ? 'Package Ready'
                      : project.editorialDevelopment.status === 'outline_ready'
                      ? 'Outline Ready'
                      : project.editorialDevelopment.status === 'brief_ready'
                      ? 'Brief Ready'
                      : project.editorialDevelopment.status === 'direction_set'
                      ? 'Direction'
                      : project.editorialDevelopment.status === 'angles_generated'
                      ? 'Angles'
                      : 'Idea'}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => (onOpenOutline ? onOpenOutline() : onTogglePanel?.('outline'))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                  activePanel === 'outline'
                    ? 'bg-[#1e232a] text-white border-[#1e232a]'
                    : 'text-[#1e232a] bg-blue-50/80 border-blue-200 hover:bg-blue-100'
                }`}
                title="Content Outline Studio"
              >
                <ListOrdered className={`w-3.5 h-3.5 ${activePanel === 'outline' ? 'text-blue-300' : 'text-blue-700'}`} />
                <span>Outline</span>
                {project.outline && project.outline.length > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                      activePanel === 'outline'
                        ? 'bg-blue-800 text-blue-100'
                        : 'bg-white text-blue-900 border border-blue-200'
                    }`}
                  >
                    {project.outline.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => (onOpenDraftPackage ? onOpenDraftPackage() : onTogglePanel?.('draft_package'))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                  activePanel === 'draft_package'
                    ? 'bg-[#1e232a] text-white border-[#1e232a]'
                    : 'text-[#1e232a] bg-emerald-50/80 border-emerald-300 hover:bg-emerald-100'
                }`}
                title="Editorial Draft Package"
              >
                <Sparkles className={`w-3.5 h-3.5 ${activePanel === 'draft_package' ? 'text-amber-300' : 'text-emerald-700'}`} />
                <span>Draft Package</span>
              </button>

              <button
                type="button"
                onClick={() => setIsInfoDrawerOpen(true)}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#4a443b] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#ede8dc] transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Article Details & Metadata"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-800" />
                <span>Info</span>
              </button>

              <button
                type="button"
                onClick={() => onTogglePanel?.('research')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                  activePanel === 'research'
                    ? 'bg-[#1e232a] text-white border-[#1e232a]'
                    : 'text-[#4a443b] bg-white border-[#dcd6ca] hover:bg-[#ede8dc]'
                }`}
                title="Research Studies & Claims"
              >
                <BookOpen className={`w-3.5 h-3.5 ${activePanel === 'research' ? 'text-amber-300' : 'text-amber-800'}`} />
                <span>Research</span>
                {project.attachedStudyIds && project.attachedStudyIds.length > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      activePanel === 'research' ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-900 border border-amber-300'
                    }`}
                  >
                    {project.attachedStudyIds.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => onTogglePanel?.('citations')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                  activePanel === 'citations'
                    ? 'bg-[#1e232a] text-white border-[#1e232a]'
                    : 'text-[#4a443b] bg-amber-50/70 border-amber-300 hover:bg-amber-100'
                }`}
                title="Research Citation Studio: Numbered In-Text Citations & References"
              >
                <BookOpen className={`w-3.5 h-3.5 ${activePanel === 'citations' ? 'text-amber-300' : 'text-amber-900'}`} />
                <span>Citations</span>
                {project.citationRecommendations && project.citationRecommendations.filter((r) => r.status === 'pending').length > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      activePanel === 'citations'
                        ? 'bg-amber-800 text-amber-100'
                        : 'bg-amber-900 text-white'
                    }`}
                  >
                    {project.citationRecommendations.filter((r) => r.status === 'pending').length}
                  </span>
                )}
              </button>
            </div>

            {/* Export Dropdown Menu (Lightweight, non-dominant) */}
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#1e232a] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#ede8dc] transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Export Article for Science of Gifts CMS"
              >
                <Download className="w-3.5 h-3.5 text-amber-800" />
                <span>Export</span>
                <ChevronDown className="w-3 h-3 text-[#736c61]" />
              </button>

              {isExportMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-56 max-w-[calc(100vw-2rem)] bg-white border border-[#dcd6ca] rounded-xl shadow-xl py-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[80vh] overflow-y-auto">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8a8275] border-b border-[#f0ede6] mb-1">
                    Science of Gifts Export
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTriggerExport('cms_json')}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2.5 text-[#1e232a] cursor-pointer"
                  >
                    <FileCode className="w-4 h-4 text-amber-800 shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">CMS JSON</div>
                      <div className="text-[10px] text-[#736c61]">
                        Primary format for CMS importer
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTriggerExport('markdown')}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2.5 text-[#1e232a] cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#5c5447] shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">Markdown</div>
                      <div className="text-[10px] text-[#736c61]">
                        .md with YAML front matter
                      </div>
                    </div>
                  </button>

                  <div className="border-t border-[#f0ece3] my-1"></div>

                  <button
                    type="button"
                    onClick={() => handleTriggerExport('copy_json')}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2.5 text-[#1e232a] cursor-pointer"
                  >
                    <Copy className="w-4 h-4 text-blue-700 shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">Copy CMS JSON</div>
                      <div className="text-[10px] text-[#736c61]">
                        Copy full payload to clipboard
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Status Dropdown */}
            <div className="relative">
              <select
                value={project.status}
                onChange={(e) => handleStatusChange(e.target.value as ProjectStatus)}
                className={`text-xs font-semibold py-1.5 pl-2.5 sm:pl-3 pr-6 sm:pr-7 rounded-lg border appearance-none cursor-pointer focus:outline-hidden transition-colors shadow-2xs ${getStatusColor(
                  project.status
                )}`}
              >
                <option value="draft">Draft</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Ready for Review</option>
                <option value="complete">Complete</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#736c61] absolute right-2 top-2.5 pointer-events-none" />
            </div>

            {/* Mobile AI Actions Menu (< 640px) */}
            <div className="relative sm:hidden" ref={mobileAiRef}>
              <button
                type="button"
                onClick={() => setIsMobileAiOpen(!isMobileAiOpen)}
                disabled={isLoading}
                className="px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors inline-flex items-center gap-1 shadow-2xs disabled:opacity-50 min-h-[32px]"
                title="AI Writing Actions"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                <span>AI</span>
                <ChevronDown className="w-3 h-3 text-[#736c61]" />
              </button>

              {isMobileAiOpen && (
                <div
                  className="absolute right-0 mt-1.5 w-52 max-w-[calc(100vw-2rem)] bg-white border border-[#dcd6ca] rounded-xl shadow-xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 max-h-[80vh] overflow-y-auto"
                  onClick={() => setIsMobileAiOpen(false)}
                >
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8a8275] border-b border-[#f0ede6] mb-1">
                    AI Writing Actions
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleExecuteAiAction(
                        'generate_intro',
                        'Draft an evocative, unhurried opening paragraph grounded in the brief.',
                        'all'
                      )
                    }
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2 text-[#1e232a]"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                    <div>
                      <div className="font-semibold">Draft Intro</div>
                      <div className="text-[10px] text-[#736c61]">Opening paragraph from brief</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleExecuteAiAction(
                        'continue_writing',
                        'Continue draft line of reasoning naturally',
                        'all'
                      )
                    }
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2 text-[#1e232a]"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#5c5447]" />
                    <div>
                      <div className="font-semibold">Continue Writing</div>
                      <div className="text-[10px] text-[#736c61]">Flow forward seamlessly</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => (onTogglePanel ? onTogglePanel('review') : undefined)}
                    className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex items-center gap-2 text-[#1e232a]"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                    <div>
                      <div className="font-semibold">Editorial Review</div>
                      <div className="text-[10px] text-[#736c61]">Open review & audit panel</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Desktop Fast Generator Actions (>= 640px) */}
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  handleExecuteAiAction(
                    'generate_intro',
                    'Draft an evocative, unhurried opening paragraph grounded in the brief.',
                    'all'
                  )
                }
                disabled={isLoading}
                className="px-2.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors inline-flex items-center gap-1 shadow-2xs disabled:opacity-50"
                title="Draft an unhurried editorial introduction"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                <span>Intro</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleExecuteAiAction(
                    'continue_writing',
                    'Continue draft line of reasoning naturally',
                    'all'
                  )
                }
                disabled={isLoading}
                className="px-2.5 py-1.5 text-xs font-medium text-[#2d333b] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#ede8dc] transition-colors inline-flex items-center gap-1 shadow-2xs disabled:opacity-50"
                title="Continue writing seamlessly"
              >
                <BookOpen className="w-3.5 h-3.5 text-[#5c5447]" />
                <span>Continue</span>
              </button>
              <button
                type="button"
                onClick={() => (onTogglePanel ? onTogglePanel('review') : undefined)}
                className="px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors inline-flex items-center gap-1 shadow-2xs"
                title="Open AI Editorial Review Panel"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                <span>Editorial Review</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dominant Writing Canvas */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-4 md:p-8 flex flex-col">
        {project.editorialDevelopment?.originalIdea && !project.editorialDevelopment?.brief && (
          <div className="mb-4 mx-auto max-w-3xl w-full bg-[#f6f3eb] border border-[#ded7ca] rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in duration-100 shadow-2xs">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
              <Compass className="w-4 h-4 text-amber-900 shrink-0 mt-0.5 sm:mt-0" />
              <div className="min-w-0 flex-1">
                <span className="font-bold text-[#1e232a] mr-1.5">Editorial Development:</span>
                <span className="text-[#5c5447] block sm:inline truncate">
                  Originated from idea &ldquo;{project.editorialDevelopment.originalIdea.title}&rdquo;. Ready to shape 5 editorial angles and synthesize a structured brief.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onTogglePanel?.('develop')}
              className="w-full sm:w-auto px-3.5 py-2 sm:py-1.5 rounded-lg text-xs font-semibold bg-[#1e232a] text-white hover:bg-[#2d3744] transition-colors shrink-0 cursor-pointer shadow-2xs text-center flex items-center justify-center"
            >
              Develop Article
            </button>
          </div>
        )}

        <Editor
          projectId={project.id}
          content={project.content}
          editorRef={editorRef}
          onChange={(newContent) =>
            onChange({
              ...project,
              content: newContent,
              updatedAt: new Date().toISOString(),
            })
          }
          onSelectionChange={(text, range) => {
            setSelectedText(text);
            if (range) setSelectionRange(range);
          }}
          onExplicitAiAction={(action, text, range) => {
            setSelectedText(text);
            if (range) setSelectionRange(range);
            handleExecuteAiAction(action, undefined, text ? 'selection' : 'all', undefined, text, range);
          }}
        />
      </div>

      {/* Article Details & Metadata Drawer */}
      <ArticleInfoDrawer
        isOpen={isInfoDrawerOpen}
        onClose={() => setIsInfoDrawerOpen(false)}
        metadata={currentMeta}
        projectTitle={project.title}
        onUpdateTitle={handleTitleChange}
        onChange={handleMetadataChange}
      />

      {/* Pre-Export Validation Modal */}
      {validationResult && (
        <ExportValidationModal
          isOpen={isValidationModalOpen}
          onClose={() => setIsValidationModalOpen(false)}
          validation={validationResult}
          formatType={pendingExportFormat}
          onProceedWithExport={() => executeExport(pendingExportFormat)}
          onOpenArticleDetails={() => setIsInfoDrawerOpen(true)}
        />
      )}
    </div>
  );
};
