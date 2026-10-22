import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  FileText,
  Sparkles,
  BookOpen,
  Link2,
  Compass,
  ListOrdered,
  Layers,
  Code,
  Eye,
  ArrowRight,
  Sliders,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Tag,
  Palette,
  ExternalLink,
} from 'lucide-react';
import { WritingProject } from '../../types/project';
import {
  EditorialDraftPackage,
  EditorialDraftPackageSection,
  EditorialDraftPackageStudy,
  EditorialDraftPackageLink,
} from '../../types/research';
import { draftPackageService, DraftPackageExportOptions } from '../../services/draftPackageService';
import { toast } from '../../services/toastService';
import { createVersionSnapshot } from '../../services/versionHistoryService';

interface DraftPackageDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  project: WritingProject;
  onUpdateProject?: (updatedProject: WritingProject) => void;
  onOpenOutline?: () => void;
  onOpenDevelop?: () => void;
}

export const DraftPackageDrawer: React.FC<DraftPackageDrawerProps> = ({
  isOpen,
  onClose,
  project,
  onUpdateProject,
  onOpenOutline,
  onOpenDevelop,
}) => {
  // Active Tab: 'overview' | 'prompt' | 'progressive'
  const [activeTab, setActiveTab] = useState<'overview' | 'prompt' | 'progressive'>('overview');

  // Customization controls
  const [modelTarget, setModelTarget] = useState<'chatgpt' | 'claude' | 'generic'>('chatgpt');
  const [targetWordCount, setTargetWordCount] = useState<number>(
    parseInt((project.writingControls?.wordCountTarget || '').replace(/,/g, ''), 10) || (project.outlineStructure === 'essay' ? 1800 : 1500)
  );
  const [includeStyleCharacteristics, setIncludeStyleCharacteristics] = useState(true);
  const [includeResearchLimitations, setIncludeResearchLimitations] = useState(true);
  const [includeInternalLinks, setIncludeInternalLinks] = useState(true);
  const [includeHardConstraints, setIncludeHardConstraints] = useState(true);
  const [customEditorNotes, setCustomEditorNotes] = useState('');
  const [isCustomizingExpanded, setIsCustomizingExpanded] = useState(false);

  // Progressive section selector
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number>(0);

  // Copy feedback states & timeout refs
  const [copiedMasterPrompt, setCopiedMasterPrompt] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedSectionPrompt, setCopiedSectionPrompt] = useState(false);

  const copyMasterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyMarkdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copySectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (copyMasterTimeoutRef.current) clearTimeout(copyMasterTimeoutRef.current);
      if (copyMarkdownTimeoutRef.current) clearTimeout(copyMarkdownTimeoutRef.current);
      if (copySectionTimeoutRef.current) clearTimeout(copySectionTimeoutRef.current);
    };
  }, []);

  // Build draft package dynamically
  const draftPackage: EditorialDraftPackage = useMemo(() => {
    const exportOptions: DraftPackageExportOptions = {
      modelTarget,
      targetWordCount,
      includeStyleCharacteristics,
      includeResearchLimitations,
      includeInternalLinkDirectives: includeInternalLinks,
      includeHardConstraints,
      customEditorNotes,
    };
    return draftPackageService.assembleDraftPackage(project, exportOptions);
  }, [
    project,
    modelTarget,
    targetWordCount,
    includeStyleCharacteristics,
    includeResearchLimitations,
    includeInternalLinks,
    includeHardConstraints,
    customEditorNotes,
  ]);

  if (!isOpen) return null;

  // Word count & token estimation
  const promptText = draftPackage.chatGptPrompt || '';
  const promptWordCount = promptText.trim().split(/\s+/).filter(Boolean).length;
  const estimatedTokens = Math.round(promptWordCount * 1.35);

  // Handlers
  const handleCopyMasterPrompt = async () => {
    if (!draftPackage.chatGptPrompt) return;
    try {
      await navigator.clipboard.writeText(draftPackage.chatGptPrompt);
      setCopiedMasterPrompt(true);
      toast.success(
        'ChatGPT Prompt Copied',
        `Full editorial handoff package (${promptWordCount.toLocaleString()} words) ready to paste.`
      );
      if (copyMasterTimeoutRef.current) clearTimeout(copyMasterTimeoutRef.current);
      copyMasterTimeoutRef.current = setTimeout(() => setCopiedMasterPrompt(false), 2500);

      // Record snapshot in project if needed
      if (project.editorialDevelopment && project.editorialDevelopment.status !== 'draft_package_ready') {
        const historySnapshot = createVersionSnapshot(project, 'before_ai_edit', {
          label: 'Exported Draft Package',
        });
        if (onUpdateProject) {
          onUpdateProject({
            ...project,
            editorialDevelopment: {
              ...project.editorialDevelopment,
              status: 'draft_package_ready',
            },
            versionHistory: historySnapshot,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      toast.error('Copy Failed', 'Unable to access clipboard.');
    }
  };

  const handleCopyMarkdown = async () => {
    if (!draftPackage.markdownExport) return;
    try {
      await navigator.clipboard.writeText(draftPackage.markdownExport);
      setCopiedMarkdown(true);
      toast.success('Markdown Copied', 'Editorial package document copied to clipboard.');
      if (copyMarkdownTimeoutRef.current) clearTimeout(copyMarkdownTimeoutRef.current);
      copyMarkdownTimeoutRef.current = setTimeout(() => setCopiedMarkdown(false), 2500);
    } catch (e) {
      toast.error('Copy Failed', 'Unable to access clipboard.');
    }
  };

  const handleDownloadMarkdown = () => {
    if (!draftPackage.markdownExport) return;
    const blob = new Blob([draftPackage.markdownExport], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug = (project.title || 'draft-package')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    link.href = url;
    link.download = `${slug}-editorial-draft-package.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Downloaded', 'Saved editorial draft package as Markdown file.');
  };

  const handleCopySelectedSectionPrompt = async () => {
    const secPrompt = draftPackage.sectionPrompts?.[selectedSectionIdx]?.prompt;
    if (!secPrompt) return;
    try {
      await navigator.clipboard.writeText(secPrompt);
      setCopiedSectionPrompt(true);
      toast.success(
        `Step ${selectedSectionIdx + 1} Prompt Copied`,
        `Ready to paste into ChatGPT for focused drafting.`
      );
      if (copySectionTimeoutRef.current) clearTimeout(copySectionTimeoutRef.current);
      copySectionTimeoutRef.current = setTimeout(() => setCopiedSectionPrompt(false), 2500);
    } catch (e) {
      toast.error('Copy Failed', 'Unable to access clipboard.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-package-title"
      className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-4xl md:max-w-5xl bg-[#fbf9f4] shadow-2xl border-l border-[#e5dfd3] flex flex-col animate-in slide-in-from-right duration-200"
    >
      {/* ========================================================================= */}
      {/* 1. HEADER & EDITORIAL WORKFLOW PROGRESSION                                */}
      {/* ========================================================================= */}
      <div className="bg-[#f7f5ef] border-b border-[#e5dfd3] px-6 py-4 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1e232a] text-amber-300 flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="draft-package-title" className="text-base font-bold font-editorial text-[#1e232a]">
                  Editorial Draft Package & External Model Export
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Ready for ChatGPT
                </span>
              </div>
              <p className="text-xs text-[#6e685f]">
                Complete downstream editorial artifact: brief, progression outline, research citations, links, and style profile.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyMasterPrompt}
              className="px-4 py-2 bg-[#1e232a] hover:bg-[#2d3744] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer border border-[#1e232a]"
              title="Copy the master prompt ready to paste into ChatGPT or Claude"
            >
              {copiedMasterPrompt ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400 animate-in zoom-in-50" />
                  <span className="text-emerald-300">Copied Full Prompt!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-amber-300" />
                  <span>Copy ChatGPT Prompt</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="px-3 py-2 bg-white hover:bg-[#ede8dc] text-[#1e232a] text-xs font-semibold rounded-xl border border-[#dcd6ca] transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Copy clean Markdown document"
            >
              {copiedMarkdown ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-[#5c5447]" />
              )}
              <span className="hidden sm:inline">Markdown</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="p-2 bg-white hover:bg-[#ede8dc] text-[#5c5447] hover:text-[#1e232a] text-xs font-semibold rounded-xl border border-[#dcd6ca] transition-all cursor-pointer shadow-2xs"
              title="Download as .md file"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-[#736c61] hover:text-[#1e232a] hover:bg-[#eae4d7] rounded-lg transition-colors cursor-pointer"
              title="Close Draft Package"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Workflow Breadcrumb Stepper */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] font-medium pt-1 text-[#787166]">
          <span
            onClick={onOpenDevelop}
            className="cursor-pointer hover:text-[#1e232a] hover:underline flex items-center gap-1"
          >
            Idea
          </span>
          <ArrowRight className="w-3 h-3 text-[#b5ad9e] shrink-0" />
          <span
            onClick={onOpenDevelop}
            className="cursor-pointer hover:text-[#1e232a] hover:underline"
          >
            5 Angles
          </span>
          <ArrowRight className="w-3 h-3 text-[#b5ad9e] shrink-0" />
          <span
            onClick={onOpenDevelop}
            className="cursor-pointer hover:text-[#1e232a] hover:underline"
          >
            Direction
          </span>
          <ArrowRight className="w-3 h-3 text-[#b5ad9e] shrink-0" />
          <span
            onClick={onOpenDevelop}
            className="cursor-pointer hover:text-[#1e232a] hover:underline"
          >
            Brief
          </span>
          <ArrowRight className="w-3 h-3 text-[#b5ad9e] shrink-0" />
          <span
            onClick={onOpenOutline}
            className="cursor-pointer hover:text-[#1e232a] hover:underline flex items-center gap-1"
          >
            Outline ({draftPackage.outline.sections.length} steps)
          </span>
          <ArrowRight className="w-3 h-3 text-[#b5ad9e] shrink-0" />
          <span className="font-bold text-[#1e232a] bg-[#ebe5d8] px-2 py-0.5 rounded-md border border-[#dcd6ca] flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-700" />
            Draft Package
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. TABS & CUSTOMIZATION CONTROLS                                          */}
      {/* ========================================================================= */}
      <div className="bg-[#f0ebe0] border-b border-[#e5dfd3] px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-[#e4decfa0] p-1 rounded-xl border border-[#d8d2c4]">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#615a50] hover:text-[#1e232a]'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-amber-700" />
            <span>Package Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('prompt')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'prompt'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#615a50] hover:text-[#1e232a]'
            }`}
          >
            <Code className="w-3.5 h-3.5 text-blue-700" />
            <span>Full ChatGPT Prompt</span>
            <span className="px-1.5 py-0.2 bg-[#f0ebe0] text-[10px] rounded text-[#787166] font-mono">
              ~{promptWordCount}w
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('progressive')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'progressive'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#615a50] hover:text-[#1e232a]'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5 text-emerald-700" />
            <span>Section-by-Section Prompts</span>
          </button>
        </div>

        {/* Quick Customization Toggle */}
        <div className="flex items-center gap-3">
          <div className="text-xs text-[#6e685f] hidden sm:flex items-center gap-1.5">
            <span>Target:</span>
            <span className="font-semibold text-[#1e232a] capitalize">{modelTarget}</span>
            <span>•</span>
            <span className="font-semibold text-[#1e232a]">{targetWordCount} words</span>
          </div>

          <button
            type="button"
            onClick={() => setIsCustomizingExpanded(!isCustomizingExpanded)}
            className="px-2.5 py-1 text-xs font-medium text-[#5c5447] hover:text-[#1e232a] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#ede8dc] transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
          >
            <Sliders className="w-3 h-3 text-[#787166]" />
            <span>Configure Handoff</span>
            {isCustomizingExpanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Expandable Configuration Drawer */}
      {isCustomizingExpanded && (
        <div className="bg-[#ede7da] border-b border-[#ded7c8] px-6 py-4 flex flex-col gap-3 text-xs animate-in slide-in-from-top-2 duration-150 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Target Model */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#615a50] mb-1">
                Writing Model Target
              </label>
              <select
                value={modelTarget}
                onChange={(e) => setModelTarget(e.target.value as any)}
                className="w-full px-2.5 py-1.5 bg-white border border-[#d8d2c4] rounded-lg font-medium text-xs text-[#1e232a] focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
              >
                <option value="chatgpt">ChatGPT (GPT-4o / o1 / o3)</option>
                <option value="claude">Claude (Sonnet / Opus)</option>
                <option value="generic">Generic LLM / Custom</option>
              </select>
            </div>

            {/* Target Word Count */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#615a50] mb-1">
                Target Word Count
              </label>
              <select
                value={targetWordCount}
                onChange={(e) => setTargetWordCount(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-white border border-[#d8d2c4] rounded-lg font-medium text-xs text-[#1e232a] focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
              >
                <option value={1200}>~1,200 Words (Focused Feature)</option>
                <option value={1800}>~1,800 Words (Standard Essay)</option>
                <option value={2400}>~2,400 Words (In-Depth Inquiry)</option>
                <option value={3000}>~3,000 Words (Long-Form Monograph)</option>
              </select>
            </div>

            {/* Inclusions */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#615a50] mb-1">
                Include in Prompt
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#403b35]">
                <input
                  type="checkbox"
                  checked={includeStyleCharacteristics}
                  onChange={(e) => setIncludeStyleCharacteristics(e.target.checked)}
                  className="rounded text-amber-700 focus:ring-amber-500"
                />
                <span>Style Characteristics</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#403b35]">
                <input
                  type="checkbox"
                  checked={includeResearchLimitations}
                  onChange={(e) => setIncludeResearchLimitations(e.target.checked)}
                  className="rounded text-amber-700 focus:ring-amber-500"
                />
                <span>Empirical Studies & Limits</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#615a50] mb-1">
                Constraints & Linking
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#403b35]">
                <input
                  type="checkbox"
                  checked={includeInternalLinks}
                  onChange={(e) => setIncludeInternalLinks(e.target.checked)}
                  className="rounded text-amber-700 focus:ring-amber-500"
                />
                <span>Internal Link Directives</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-[#403b35]">
                <input
                  type="checkbox"
                  checked={includeHardConstraints}
                  onChange={(e) => setIncludeHardConstraints(e.target.checked)}
                  className="rounded text-amber-700 focus:ring-amber-500"
                />
                <span>Anti-AI Cliché Rules</span>
              </label>
            </div>
          </div>

          {/* Ad-hoc Editor Note */}
          <div className="pt-2 border-t border-[#ded7c8]">
            <label className="block text-[11px] font-bold text-[#615a50] mb-1">
              Add Specific Note for the Writing Model (Optional):
            </label>
            <input
              type="text"
              value={customEditorNotes}
              onChange={(e) => setCustomEditorNotes(e.target.value)}
              placeholder="e.g. Focus on tactile narrative details; write opening in first person; keep tone slightly warmer..."
              className="w-full px-3 py-1.5 text-xs bg-white border border-[#d8d2c4] rounded-lg text-[#1e232a] focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MAIN CONTENT BODY ACCORDING TO ACTIVE TAB                              */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* ======================================================================= */}
        {/* TAB 1: STRUCTURED PACKAGE OVERVIEW                                      */}
        {/* ======================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Quick Summary Hero */}
            <div className="bg-white rounded-2xl border border-[#e5dfd3] p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300">
                    {draftPackage.outline.structureType?.toUpperCase() || 'ESSAY'} MODE
                  </span>
                  <span className="text-xs text-[#787166]">
                    {draftPackage.outline.sections.length} Progression Steps
                  </span>
                  <span className="text-xs text-[#787166]">•</span>
                  <span className="text-xs text-[#787166]">
                    {draftPackage.research.length} Empirical Studies
                  </span>
                  <span className="text-xs text-[#787166]">•</span>
                  <span className="text-xs text-[#787166]">
                    {draftPackage.internalLinks.length} Internal Links
                  </span>
                </div>
                <h3 className="text-lg font-bold font-editorial text-[#1e232a]">
                  {draftPackage.article.title}
                </h3>
                <p className="text-xs text-[#5c5447] italic">
                  {draftPackage.article.centralArgument || draftPackage.article.standfirst || 'Intellectual inquiry into gifting dynamics.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyMasterPrompt}
                  className="px-4 py-2 bg-[#1e232a] hover:bg-[#2d3744] text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-amber-300" />
                  <span>Copy Prompt for ChatGPT</span>
                </button>
              </div>
            </div>

            {/* 1. Article Information & Editorial Direction */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Article Overview */}
              <div className="bg-white rounded-xl border border-[#e5dfd3] p-4 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-[#f0ece3]">
                  <Compass className="w-4 h-4 text-amber-800" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                    Article Information
                  </h4>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="font-semibold text-[#6e685f]">Working Title:</span>{' '}
                    <span className="text-[#1e232a] font-medium">{draftPackage.article.title}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#6e685f]">Topic / Premise:</span>{' '}
                    <span className="text-[#1e232a]">{draftPackage.article.topic || 'Gifting psychology'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#6e685f]">Audience:</span>{' '}
                    <span className="text-[#1e232a]">{draftPackage.article.audience}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#6e685f]">Search Intent:</span>{' '}
                    <span className="text-[#1e232a]">{draftPackage.article.searchIntent}</span>
                  </div>
                  {draftPackage.article.readerLearns && (
                    <div>
                      <span className="font-semibold text-[#6e685f]">Reader Takeaway:</span>{' '}
                      <span className="text-[#1e232a]">{draftPackage.article.readerLearns}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Editorial Direction */}
              <div className="bg-white rounded-xl border border-[#e5dfd3] p-4 shadow-xs space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-[#f0ece3]">
                  <Sparkles className="w-4 h-4 text-amber-700" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                    Editorial Direction
                  </h4>
                </div>
                <div className="space-y-2 text-xs">
                  {draftPackage.editorialDirection?.primaryAngle && (
                    <div>
                      <span className="font-semibold text-emerald-800">Primary Angle:</span>{' '}
                      <span className="text-[#1e232a] font-medium">
                        {draftPackage.editorialDirection.primaryAngle}
                      </span>
                    </div>
                  )}
                  {draftPackage.editorialDirection?.secondaryFocus && (
                    <div>
                      <span className="font-semibold text-blue-800">Secondary Focus:</span>{' '}
                      <span className="text-[#1e232a]">
                        {draftPackage.editorialDirection.secondaryFocus}
                      </span>
                    </div>
                  )}
                  {draftPackage.editorialDirection?.centralArgument && (
                    <div>
                      <span className="font-semibold text-[#6e685f]">Central Thesis:</span>{' '}
                      <span className="text-[#1e232a] italic">
                        {draftPackage.editorialDirection.centralArgument}
                      </span>
                    </div>
                  )}
                  {draftPackage.editorialDirection?.editorsDirection && (
                    <div className="p-2 bg-[#f9f7f2] rounded-lg border border-[#e5dfd3] text-[11px] text-[#5c5447]">
                      <strong>Editor's Directive:</strong> {draftPackage.editorialDirection.editorsDirection}
                    </div>
                  )}
                  {draftPackage.editorialDirection?.doNotFocusOn &&
                    draftPackage.editorialDirection.doNotFocusOn.length > 0 && (
                      <div className="text-[11px] text-rose-800 font-medium">
                        ✕ Do Not Focus On:{' '}
                        {draftPackage.editorialDirection.doNotFocusOn.join('; ')}
                      </div>
                    )}
                </div>
              </div>
            </div>

            {/* 2. Intellectual Progression Outline */}
            <div className="bg-white rounded-xl border border-[#e5dfd3] p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f0ece3]">
                <div className="flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-blue-800" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                    Intellectual Progression Outline
                  </h4>
                </div>
                <span className="text-xs text-[#787166] font-medium">
                  {draftPackage.outline.structureType?.toUpperCase()} Structure
                </span>
              </div>

              {draftPackage.outline.sections.length === 0 ? (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                  <span>No outline sections yet. Open Outline Studio to generate or build your progression steps.</span>
                  {onOpenOutline && (
                    <button
                      type="button"
                      onClick={onOpenOutline}
                      className="px-3 py-1 bg-amber-800 text-white rounded-lg font-bold"
                    >
                      Open Outline Studio
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {draftPackage.outline.sections.map((sec, idx) => (
                    <div
                      key={sec.id || idx}
                      className="p-3.5 rounded-xl border border-[#e8e2d6] bg-[#fbf9f4] hover:border-[#1e232a] transition-all space-y-2 text-xs"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="w-5 h-5 rounded-full bg-[#1e232a] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                            {idx + 1}
                          </span>
                          <span className="font-bold font-editorial text-sm text-[#1e232a]">
                            {sec.title}
                          </span>
                        </div>
                        {sec.heading && (
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-[#ede8dc] text-[#5c5447] rounded-md">
                            H2: {sec.heading}
                          </span>
                        )}
                      </div>

                      {sec.purpose && (
                        <div className="text-[#403b35] pl-7">
                          <span className="font-semibold text-[#6e685f]">Purpose:</span> {sec.purpose}
                        </div>
                      )}

                      {sec.mainIdea && (
                        <div className="text-[#403b35] pl-7">
                          <span className="font-semibold text-[#6e685f]">Main Idea:</span> {sec.mainIdea}
                        </div>
                      )}

                      {sec.develops && (
                        <div className="text-[#403b35] pl-7">
                          <span className="font-semibold text-[#6e685f]">Develops:</span> {sec.develops}
                        </div>
                      )}

                      {/* Associated Research & Links */}
                      {(sec.assignedStudies.length > 0 || (sec.assignedLinks && sec.assignedLinks.length > 0)) && (
                        <div className="pl-7 pt-1 flex flex-wrap items-center gap-2">
                          {sec.assignedStudies.map((s) => (
                            <span
                              key={s.id}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1"
                            >
                              <BookOpen className="w-3 h-3" />
                              <span>{s.title.slice(0, 30)}...</span>
                            </span>
                          ))}
                          {sec.assignedLinks?.map((l) => (
                            <span
                              key={l.id || l.url}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-900 border border-blue-300 flex items-center gap-1"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>{l.targetAnchor || l.title}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Research Studies & Evidence */}
            <div className="bg-white rounded-xl border border-[#e5dfd3] p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f0ece3]">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-amber-800" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                    Empirical Research Repository ({draftPackage.research.length} Studies)
                  </h4>
                </div>
                <span className="text-[11px] text-[#787166]">
                  Strict citation fidelity • No invented facts
                </span>
              </div>

              {draftPackage.research.length === 0 ? (
                <div className="text-xs text-[#787166] italic p-3 bg-[#fbf9f4] rounded-lg border border-[#e8e2d6]">
                  No research studies formally attached. General psychological principles will guide the draft.
                </div>
              ) : (
                <div className="space-y-3">
                  {draftPackage.research.map((study) => (
                    <div
                      key={study.studyId}
                      className="p-3.5 rounded-xl border border-[#e5dfd3] bg-[#fbf9f4] space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-[#1e232a] text-xs">
                          {study.title}
                        </div>
                        {study.url && (
                          <a
                            href={study.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#787166] hover:text-[#1e232a] inline-flex items-center gap-1 text-[11px]"
                          >
                            <span>Link</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div className="text-[11px] text-[#6e685f]">
                        <strong>Citation:</strong> {study.citation}
                      </div>

                      {study.keyFindings.length > 0 && (
                        <div className="space-y-1">
                          <span className="font-semibold text-[#5c5447] text-[11px]">Findings:</span>
                          <ul className="list-disc pl-4 space-y-0.5 text-[#3e3933] text-[11px]">
                            {study.keyFindings.slice(0, 3).map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {study.limitations.length > 0 && (
                        <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                          <strong>Empirical Limitation:</strong> {study.limitations[0]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Internal Link Opportunities */}
            <div className="bg-white rounded-xl border border-[#e5dfd3] p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#f0ece3]">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-blue-800" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                    Internal Link Opportunities ({draftPackage.internalLinks.length} Articles)
                  </h4>
                </div>
              </div>

              {draftPackage.internalLinks.length === 0 ? (
                <div className="text-xs text-[#787166] italic p-3 bg-[#fbf9f4] rounded-lg border border-[#e8e2d6]">
                  No internal link recommendations in package.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {draftPackage.internalLinks.map((link, idx) => (
                    <div
                      key={link.url || idx}
                      className="p-3 rounded-xl border border-[#e5dfd3] bg-[#fbf9f4] space-y-1 text-xs"
                    >
                      <div className="font-semibold text-[#1e232a] truncate">
                        {link.targetTitle}
                      </div>
                      <div className="text-blue-900 font-mono text-[11px]">
                        Anchor: "{link.suggestedAnchor}"
                      </div>
                      {link.suggestedContext && (
                        <div className="text-[11px] text-[#6e685f]">
                          Context: {link.suggestedContext}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 5. Style Characteristics */}
            {draftPackage.styleGuidance && (
              <div className="bg-white rounded-xl border border-[#e5dfd3] p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[#f0ece3]">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-purple-800" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                      Distilled Style Characteristics ({draftPackage.styleGuidance.profileName})
                    </h4>
                  </div>
                  <span className="text-[11px] text-purple-900 font-semibold bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                    Applied Style Profile
                  </span>
                </div>

                <p className="text-xs text-[#6e685f] italic">
                  {draftPackage.styleGuidance.description}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {draftPackage.styleGuidance.distilledCharacteristics.map((c, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-[#ded7c8] bg-[#fbf9f4] space-y-1 text-xs"
                    >
                      <div className="font-bold text-[#1e232a] text-[11px] uppercase tracking-wider text-amber-900">
                        {c.category}
                      </div>
                      <div className="text-[#3e3933]">{c.observation}</div>
                      {c.evidence && (
                        <div className="text-[10px] text-[#787166] italic pt-1 border-t border-[#eee8dc]">
                          "{c.evidence}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Hard Constraints & Prohibitions */}
            <div className="bg-white rounded-xl border border-[#e5dfd3] p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#f0ece3]">
                <AlertCircle className="w-4 h-4 text-rose-800" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#1e232a]">
                  Inviolable Constraints & Anti-AI Rules
                </h4>
              </div>
              <ul className="space-y-1.5 text-xs text-[#403b35]">
                {draftPackage.projectGuidance?.hardConstraints?.map((hc, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-rose-700 font-bold shrink-0">✕</span>
                    <span>{hc}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 2: FULL CHATGPT PROMPT                                              */}
        {/* ======================================================================= */}
        {activeTab === 'prompt' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            {/* Quick Metrics Bar */}
            <div className="bg-[#ede7da] rounded-xl p-3 border border-[#ded7c8] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 text-[#5c5447]">
                <div>
                  <span className="font-bold text-[#1e232a]">{promptWordCount.toLocaleString()}</span> words
                </div>
                <div>
                  <span className="font-bold text-[#1e232a]">~{estimatedTokens.toLocaleString()}</span> tokens
                </div>
                <div>
                  <span className="font-bold text-[#1e232a]">{draftPackage.outline.sections.length}</span> outline steps
                </div>
                <div>
                  <span className="font-bold text-[#1e232a]">{draftPackage.research.length}</span> studies
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyMasterPrompt}
                className="px-3.5 py-1.5 bg-[#1e232a] text-white hover:bg-[#2d3744] text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {copiedMasterPrompt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-amber-300" />
                    <span>Copy Full Prompt</span>
                  </>
                )}
              </button>
            </div>

            {/* Prompt Viewport */}
            <div className="relative bg-[#1e232a] text-[#fbf9f4] rounded-2xl p-6 font-mono text-xs leading-relaxed overflow-x-auto shadow-inner border border-[#333b47]">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[#eae5d8]">
                {draftPackage.chatGptPrompt}
              </pre>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 3: PROGRESSIVE SECTION-BY-SECTION PROMPTS                           */}
        {/* ======================================================================= */}
        {activeTab === 'progressive' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Explanatory callout */}
            <div className="bg-[#eef3f8] border border-[#cfdded] p-4 rounded-xl text-xs text-[#234263] flex items-start gap-3">
              <ListOrdered className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">Why Draft Step-by-Step?</strong>
                <p className="mt-0.5 text-[#3d5978]">
                  Feeding an entire 2,000-word article to ChatGPT all at once frequently causes rushed pacing and compressed arguments. Generating one step at a time keeps the model focused on full narrative richness, rigorous research depth, and natural transitions.
                </p>
              </div>
            </div>

            {/* Stepper Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Left Column: Outline Step Selector */}
              <div className="md:col-span-1 space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#615a50]">
                  Select Step ({draftPackage.outline.sections.length} Total)
                </label>
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
                  {draftPackage.outline.sections.map((sec, idx) => (
                    <button
                      key={sec.id || idx}
                      type="button"
                      onClick={() => setSelectedSectionIdx(idx)}
                      className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex items-start gap-2.5 cursor-pointer ${
                        selectedSectionIdx === idx
                          ? 'bg-[#1e232a] text-white border-[#1e232a] shadow-xs'
                          : 'bg-white text-[#403b35] border-[#e5dfd3] hover:border-[#1e232a]'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5 ${
                          selectedSectionIdx === idx
                            ? 'bg-amber-400 text-[#1e232a]'
                            : 'bg-[#ebe5d8] text-[#5c5447]'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold truncate">{sec.title}</div>
                        {sec.purpose && (
                          <div
                            className={`text-[10px] line-clamp-1 ${
                              selectedSectionIdx === idx ? 'text-[#b5ad9e]' : 'text-[#787166]'
                            }`}
                          >
                            {sec.purpose}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Column: Active Step Prompt View */}
              <div className="md:col-span-2 space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs uppercase tracking-wider text-[#1e232a]">
                      Step {selectedSectionIdx + 1} Prompt
                    </span>
                    <span className="text-xs text-[#787166]">
                      (~300-400 words target)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopySelectedSectionPrompt}
                      className="px-3.5 py-1.5 bg-[#1e232a] text-white hover:bg-[#2d3744] text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedSectionPrompt ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied Step {selectedSectionIdx + 1}!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-amber-300" />
                          <span>Copy This Step Prompt</span>
                        </>
                      )}
                    </button>

                    {selectedSectionIdx < draftPackage.outline.sections.length - 1 && (
                      <button
                        type="button"
                        onClick={() => setSelectedSectionIdx((prev) => prev + 1)}
                        className="px-2.5 py-1.5 bg-white border border-[#dcd6ca] text-[#1e232a] text-xs font-semibold rounded-lg hover:bg-[#ede8dc] transition-all flex items-center gap-1 cursor-pointer"
                        title="Next step"
                      >
                        <span>Next</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-[#1e232a] text-[#fbf9f4] rounded-2xl p-5 font-mono text-xs leading-relaxed overflow-x-auto shadow-inner border border-[#333b47]">
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[#eae5d8]">
                    {draftPackage.sectionPrompts?.[selectedSectionIdx]?.prompt ||
                      'Select an outline step on the left.'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 4. FOOTER                                                                 */}
      {/* ========================================================================= */}
      <div className="bg-[#f7f5ef] border-t border-[#e5dfd3] px-6 py-3.5 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 text-xs text-[#6e685f]">
          <span className="font-semibold text-[#1e232a] font-editorial">
            Science of Gifts Editorial Studio
          </span>
          <span>•</span>
          <span>Handoff Phase 6</span>
        </div>

        <div className="flex items-center gap-2">
          {onOpenOutline && (
            <button
              type="button"
              onClick={onOpenOutline}
              className="px-3.5 py-1.5 text-xs font-semibold text-[#5c5447] hover:text-[#1e232a] hover:bg-[#eae4d7] rounded-lg transition-colors cursor-pointer"
            >
              Back to Outline Studio
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyMasterPrompt}
            className="px-4 py-2 bg-[#1e232a] hover:bg-[#2d3744] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
          >
            {copiedMasterPrompt ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4 text-amber-300" />
            )}
            <span>Copy Master ChatGPT Prompt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
