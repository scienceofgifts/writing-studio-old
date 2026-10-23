/**
 * Science of Gifts - Content Outline Studio
 *
 * Connects the downstream Editorial Brief to a structured, research-aware Outline.
 * Consumes:
 * - Idea, 5 Angles, Editorial Direction & Synthesized Editorial Brief
 * - Attached Research Library studies & specific empirical claims
 * - Internal Links opportunities
 * - Style Profile & Project Instructions
 *
 * Supports 4 Structure Types:
 * 1. Essay (Intellectual Progression - describes argument evolution, headings optional)
 * 2. Standard Article (Content-rich conventional headings, driven by brief)
 * 3. Guide (Practical hierarchical sections & inspection criteria)
 * 4. Custom (Editor-specified custom structure guidance)
 */

import React, { useState, useEffect } from 'react';
import {
  OutlineItem,
  WritingProject,
  OutlineProposal,
  OutlineStructureType,
  OutlineItemInternalLink,
  EditorialDevelopment,
} from '../../types/project';
import {
  ListOrdered,
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Sparkles,
  Check,
  CheckCircle2,
  AlertCircle,
  Edit2,
  BookOpen,
  Link2,
  Compass,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Layers,
  Info,
  Sliders,
  ExternalLink,
  ShieldCheck,
  Tag,
} from 'lucide-react';
import { geminiService } from '../../services/geminiClient';
import { researchService } from '../../services/researchService';
import { storage } from '../../services/storage';
import { toast } from '../../services/toastService';
import { createVersionSnapshot } from '../../services/versionHistoryService';

interface ContentOutlineDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  project: WritingProject;
  outline: OutlineItem[];
  onChange: (updatedOutline: OutlineItem[]) => void;
  onUpdateProject?: (updatedProject: WritingProject) => void;
  onDraftSection?: (section: OutlineItem) => void;
  onOpenDevelop?: () => void;
  onOpenDraftPackage?: () => void;
}

export const ContentOutlineDrawer: React.FC<ContentOutlineDrawerProps> = ({
  isOpen,
  onClose,
  project,
  outline = [],
  onChange,
  onUpdateProject,
  onDraftSection,
  onOpenDevelop,
  onOpenDraftPackage,
}) => {
  // Current structure type (default to essay for editorial articles)
  const [structureType, setStructureType] = useState<OutlineStructureType>(
    project.outlineStructure || 'essay'
  );
  const [customStructureNotes, setCustomStructureNotes] = useState(
    project.outlineMetadata?.customStructureNotes || ''
  );

  // Proposal state
  const [isGenerating, setIsGenerating] = useState(false);
  const [proposedOutline, setProposedOutline] = useState<OutlineProposal | null>(null);

  // Expanded cards / editing state
  const [isBriefContextExpanded, setIsBriefContextExpanded] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  // In-line edit fields
  const [editTitle, setEditTitle] = useState('');
  const [editHeading, setEditHeading] = useState('');
  const [editPurpose, setEditPurpose] = useState('');
  const [editMainIdea, setEditMainIdea] = useState('');
  const [editDevelops, setEditDevelops] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStudyIds, setEditStudyIds] = useState<string[]>([]);
  const [editLinks, setEditLinks] = useState<OutlineItemInternalLink[]>([]);

  // Add new item fields
  const [newTitle, setNewTitle] = useState('');
  const [newHeading, setNewHeading] = useState('');
  const [newPurpose, setNewPurpose] = useState('');
  const [newMainIdea, setNewMainIdea] = useState('');
  const [newDevelops, setNewDevelops] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isAddingSection, setIsAddingSection] = useState(false);

  // Available upstream data
  const structuredBrief = project.editorialDevelopment?.brief;
  const legacyBrief = project.brief;
  const originalIdea = project.editorialDevelopment?.originalIdea;
  const angles = project.editorialDevelopment?.angles || [];
  const primaryAngle = angles.find((a) => a.role === 'primary');
  const secondaryAngle = angles.find((a) => a.role === 'secondary');
  const attachedStudies = storage
    .getResearchStudies()
    .filter((s) => project.attachedStudyIds?.includes(s.id));
  const availableInternalLinks = storage.getInternalLinks();

  const briefWorkingTitle = structuredBrief?.workingTitle || project.title;
  const briefCentralThesis = structuredBrief?.centralArgument || legacyBrief?.purpose || '';
  const briefPrimaryAngle = structuredBrief?.primaryAngle || (primaryAngle ? `${primaryAngle.title}: ${primaryAngle.coreArgument}` : '');
  const briefSecondaryFocus = structuredBrief?.secondaryFocus || (secondaryAngle ? `${secondaryAngle.title}: ${secondaryAngle.coreArgument}` : '');

  // Keep structure in sync with project if changed outside
  useEffect(() => {
    if (project.outlineStructure && project.outlineStructure !== structureType) {
      setStructureType(project.outlineStructure);
    }
  }, [project.outlineStructure]);

  if (!isOpen) return null;

  // Toggle item card expansion
  const toggleItemExpanded = (id: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Expand / collapse all
  const handleToggleExpandAll = () => {
    const currentList = proposedOutline ? proposedOutline.items : outline;
    if (expandedItemIds.size === currentList.length) {
      setExpandedItemIds(new Set());
    } else {
      setExpandedItemIds(new Set(currentList.map((i) => i.id)));
    }
  };

  // -------------------------------------------------------------------------
  // GENERATE OUTLINE ACTION
  // -------------------------------------------------------------------------
  const handleGenerateOutline = async () => {
    setIsGenerating(true);
    try {
      const proposal = await geminiService.generateOutline(project, {
        structureType,
        customStructureNotes: structureType === 'custom' ? customStructureNotes : undefined,
        modelOverride: project.modelOverride,
      });

      if (proposal && proposal.items && proposal.items.length > 0) {
        setProposedOutline(proposal);
        // Expand all items in proposed outline for easy review
        setExpandedItemIds(new Set(proposal.items.map((i) => i.id)));
        toast.info(
          'Outline Proposal Ready',
          `Generated ${proposal.items.length} steps in ${structureType.toUpperCase()} mode. Inspect and accept below.`
        );
      }
    } catch (e: any) {
      console.error('Failed to generate outline:', e);
      toast.error('Outline Generation Failed', e?.message || 'Could not construct outline.');
    } finally {
      setIsGenerating(false);
    }
  };

  // -------------------------------------------------------------------------
  // ACCEPT / REJECT PROPOSAL
  // -------------------------------------------------------------------------
  const handleAcceptProposal = () => {
    if (!proposedOutline || !proposedOutline.items) return;

    const acceptedItems = proposedOutline.items;
    const rationale = proposedOutline.rationale || '';

    // Snapshot version history
    const historySnapshot = createVersionSnapshot(project, 'before_ai_edit', {
      label: `Accepted ${structureType.toUpperCase()} Outline`,
    });

    const updatedDev: EditorialDevelopment | undefined = project.editorialDevelopment
      ? {
          ...project.editorialDevelopment,
          status: 'outline_ready',
        }
      : undefined;

    if (onUpdateProject) {
      onUpdateProject({
        ...project,
        outline: acceptedItems,
        outlineStructure: structureType,
        outlineRationale: rationale,
        outlineMetadata: {
          structureType,
          customStructureNotes: structureType === 'custom' ? customStructureNotes : undefined,
          editorialRationale: rationale,
          generatedAt: new Date().toISOString(),
        },
        editorialDevelopment: updatedDev,
        versionHistory: historySnapshot,
        updatedAt: new Date().toISOString(),
      });
    } else {
      onChange(acceptedItems);
    }

    setProposedOutline(null);
    toast.success(
      'Outline Accepted',
      `Applied ${acceptedItems.length} progression steps to project.`
    );
  };

  const handleRejectProposal = () => {
    setProposedOutline(null);
    toast.info('Proposal Discarded', 'Preserved your existing outline.');
  };

  // -------------------------------------------------------------------------
  // START INLINE EDITING
  // -------------------------------------------------------------------------
  const handleStartEdit = (item: OutlineItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditHeading(item.heading || '');
    setEditPurpose(item.purpose || item.description || '');
    setEditMainIdea(item.mainIdea || '');
    setEditDevelops(item.develops || '');
    setEditNotes(item.notes || '');
    setEditStudyIds(item.assignedStudyIds || []);
    setEditLinks(item.assignedInternalLinks || []);
    // Ensure item is expanded
    setExpandedItemIds((prev) => new Set(prev).add(item.id));
  };

  const handleSaveEdit = (id: string, isProposal = false) => {
    const updates: Partial<OutlineItem> = {
      title: editTitle.trim(),
      heading: editHeading.trim() || undefined,
      purpose: editPurpose.trim() || undefined,
      description: editPurpose.trim() || undefined,
      mainIdea: editMainIdea.trim() || undefined,
      develops: editDevelops.trim() || undefined,
      notes: editNotes.trim() || undefined,
      assignedStudyIds: editStudyIds,
      assignedInternalLinks: editLinks,
    };

    if (isProposal && proposedOutline) {
      setProposedOutline({
        ...proposedOutline,
        items: proposedOutline.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
      });
    } else {
      const updated = outline.map((i) => (i.id === id ? { ...i, ...updates } : i));
      if (onUpdateProject) {
        onUpdateProject({
          ...project,
          outline: updated,
          updatedAt: new Date().toISOString(),
        });
      } else {
        onChange(updated);
      }
    }
    setEditingId(null);
  };

  // -------------------------------------------------------------------------
  // MANUAL ADD SECTION
  // -------------------------------------------------------------------------
  const handleAddSection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newItem: OutlineItem = {
      id: `outline-${Date.now()}`,
      title: newTitle.trim(),
      heading: newHeading.trim() || undefined,
      purpose: newPurpose.trim() || undefined,
      description: newPurpose.trim() || undefined,
      mainIdea: newMainIdea.trim() || undefined,
      develops: newDevelops.trim() || undefined,
      notes: newNotes.trim() || undefined,
      completed: false,
    };

    if (proposedOutline) {
      setProposedOutline({
        ...proposedOutline,
        items: [...proposedOutline.items, newItem],
      });
    } else {
      const updated = [...outline, newItem];
      if (onUpdateProject) {
        onUpdateProject({
          ...project,
          outline: updated,
          updatedAt: new Date().toISOString(),
        });
      } else {
        onChange(updated);
      }
    }

    setNewTitle('');
    setNewHeading('');
    setNewPurpose('');
    setNewMainIdea('');
    setNewDevelops('');
    setNewNotes('');
    setIsAddingSection(false);
    toast.success('Section Added', 'New step added to outline sequence.');
  };

  // -------------------------------------------------------------------------
  // REORDER & REMOVE
  // -------------------------------------------------------------------------
  const handleRemoveSection = (id: string, isProposal = false) => {
    if (isProposal && proposedOutline) {
      setProposedOutline({
        ...proposedOutline,
        items: proposedOutline.items.filter((item) => item.id !== id),
      });
    } else {
      const updated = outline.filter((item) => item.id !== id);
      if (onUpdateProject) {
        onUpdateProject({ ...project, outline: updated, updatedAt: new Date().toISOString() });
      } else {
        onChange(updated);
      }
    }
  };

  const handleMove = (index: number, direction: 'up' | 'down', isProposal = false) => {
    const list = isProposal && proposedOutline ? [...proposedOutline.items] : [...outline];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;

    if (isProposal && proposedOutline) {
      setProposedOutline({ ...proposedOutline, items: list });
    } else {
      if (onUpdateProject) {
        onUpdateProject({ ...project, outline: list, updatedAt: new Date().toISOString() });
      } else {
        onChange(list);
      }
    }
  };

  const currentList = proposedOutline ? proposedOutline.items : outline;

  return (
    <div className="max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-full w-full md:w-[520px] lg:w-[580px] xl:w-[660px] md:max-w-[50vw] min-w-0 flex-shrink h-full bg-[#faf9f6] md:border-l border-[#dcd6ca] flex flex-col overflow-hidden animate-in slide-in-from-right-1 duration-150 z-30 select-none shadow-xl">
      {/* 1. Header */}
      <div className="p-4 sm:p-5 border-b border-[#e5dfd3] bg-[#f5f2ea] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-100/80 border border-blue-300 flex items-center justify-center text-blue-900 shrink-0">
            <ListOrdered className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-editorial text-lg font-bold text-[#1e232a] tracking-tight truncate">
                Outline Studio
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white text-[#5c5447] border border-[#dcd6ca]">
                {structureType === 'essay' ? 'Essay Progression' : structureType.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs text-[#736c61] truncate">
              Downstream intellectual progression & section blueprint
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onOpenDraftPackage && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDraftPackage();
              }}
              className="px-3 py-1.5 text-xs font-bold text-white bg-[#1e232a] hover:bg-[#2d3744] rounded-lg transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Proceed to Draft Package (Handoff to ChatGPT)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline">Draft Package</span>
              <ArrowRight className="w-3 h-3 text-amber-300" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-[#736c61] hover:text-[#2d333b] rounded-lg hover:bg-[#e8e2d5] transition-colors shrink-0 cursor-pointer"
            title="Close Outline Studio"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 2. Upstream Brief & Research Summary Card */}
      <div className="border-b border-[#e5dfd3] bg-[#faf7f0]">
        <button
          type="button"
          onClick={() => setIsBriefContextExpanded(!isBriefContextExpanded)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-[#f3eee3] transition-colors cursor-pointer text-xs"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Compass className="w-3.5 h-3.5 text-amber-800 shrink-0" />
            <span className="font-bold text-[#1e232a]">Upstream Context:</span>
            <span className="text-[#5c5447] truncate">
              {briefWorkingTitle ? (
                <>
                  <strong className="text-[#2d2720]">{briefWorkingTitle}:</strong>{' '}
                  {briefCentralThesis || 'Synthesized editorial brief'}
                </>
              ) : (
                'Using project baseline'
              )}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 text-[11px] text-[#736c61]">
            {attachedStudies.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-medium">
                {attachedStudies.length} {attachedStudies.length === 1 ? 'Study' : 'Studies'}
              </span>
            )}
            {isBriefContextExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </div>
        </button>

        {isBriefContextExpanded && (
          <div className="px-4 pb-3.5 pt-1 space-y-2.5 text-xs border-t border-[#eee9dc] bg-[#fbf9f4] animate-in fade-in duration-100">
            {briefCentralThesis && (
              <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200">
                <span className="font-bold text-[10px] uppercase tracking-wider text-amber-900 block mb-0.5">
                  Central Thesis / Argument
                </span>
                <p className="text-xs text-[#2c2720] leading-relaxed">
                  {briefCentralThesis}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {briefPrimaryAngle && (
                <div className="p-2 rounded bg-white border border-[#e5dfd3]">
                  <span className="font-bold text-[10px] uppercase text-[#736c61] block mb-0.5">
                    Primary Angle
                  </span>
                  <p className="text-[#2d2720] line-clamp-2">{briefPrimaryAngle}</p>
                </div>
              )}
              {briefSecondaryFocus && (
                <div className="p-2 rounded bg-white border border-[#e5dfd3]">
                  <span className="font-bold text-[10px] uppercase text-[#736c61] block mb-0.5">
                    Secondary Focus
                  </span>
                  <p className="text-[#2d2720] line-clamp-2">{briefSecondaryFocus}</p>
                </div>
              )}
            </div>

            {attachedStudies.length > 0 && (
              <div className="p-2 rounded-lg bg-white border border-[#e5dfd3]">
                <span className="font-bold text-[10px] uppercase tracking-wider text-[#736c61] block mb-1">
                  Attached Research Studies Available for Evidence Mapping
                </span>
                <div className="space-y-1">
                  {attachedStudies.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 text-[11px] text-[#4a443b]">
                      <BookOpen className="w-3 h-3 text-amber-800 shrink-0" />
                      <span className="font-medium truncate">{s.title}</span>
                      <span className="text-[#8c8477]">
                        ({Array.isArray(s.authors) ? s.authors.join(', ') : s.authors || 'Research'}, {s.publicationYear || 'n.d.'})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {onOpenDevelop && (
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={onOpenDevelop}
                  className="text-[11px] font-semibold text-amber-900 hover:text-amber-950 underline flex items-center gap-1 cursor-pointer"
                >
                  <Compass className="w-3 h-3" />
                  <span>Open Editorial Development to adjust brief</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Structure Selector (Requirement #2) */}
      <div className="px-4 sm:px-5 py-3 border-b border-[#e5dfd3] bg-[#f9f7f2]">
        <div className="flex items-center justify-between gap-2 mb-2">
          <label className="text-xs font-bold uppercase tracking-wider text-[#5c5447]">
            Article Structure Type
          </label>
          <span className="text-[11px] text-[#736c61]">
            {structureType === 'essay' && 'Intellectual progression (Headings optional)'}
            {structureType === 'standard_article' && 'Conventional headings (Brief-driven)'}
            {structureType === 'guide' && 'Authoritative curation & inspection'}
            {structureType === 'custom' && 'Custom editorial flow'}
          </span>
        </div>

        {/* 4 Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-[#ede8dc] rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setStructureType('essay')}
            className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              structureType === 'essay'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#6e685f] hover:text-[#1e232a]'
            }`}
          >
            Essay (Default)
          </button>
          <button
            type="button"
            onClick={() => setStructureType('standard_article')}
            className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              structureType === 'standard_article'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#6e685f] hover:text-[#1e232a]'
            }`}
          >
            Standard Article
          </button>
          <button
            type="button"
            onClick={() => setStructureType('guide')}
            className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              structureType === 'guide'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#6e685f] hover:text-[#1e232a]'
            }`}
          >
            Guide
          </button>
          <button
            type="button"
            onClick={() => setStructureType('custom')}
            className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              structureType === 'custom'
                ? 'bg-white text-[#1e232a] shadow-xs'
                : 'text-[#6e685f] hover:text-[#1e232a]'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Custom Structure Guidance input if Custom selected */}
        {structureType === 'custom' && (
          <div className="mt-2.5">
            <textarea
              rows={2}
              value={customStructureNotes}
              onChange={(e) => setCustomStructureNotes(e.target.value)}
              placeholder="Specify custom progression guidance (e.g. 'Section 1 explores metallurgy; Section 2 unpacks recipient friction; Section 3 interviews maker...')"
              className="w-full text-xs p-2 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>
        )}
      </div>

      {/* 4. Proposal Review Banner (if AI generated) */}
      {proposedOutline ? (
        <div className="p-4 bg-amber-50/90 border-b border-amber-300 animate-in fade-in shrink-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
              <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Proposed {structureType.toUpperCase()} Progression ({proposedOutline.items.length} steps)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRejectProposal}
                className="px-2.5 py-1 text-xs font-semibold text-[#6e685f] hover:text-rose-700 bg-white border border-[#dcd6ca] rounded-lg transition-colors cursor-pointer"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={handleAcceptProposal}
                className="px-3.5 py-1 text-xs font-bold text-white bg-[#1e232a] hover:bg-[#2d3744] rounded-lg transition-all inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Accept Outline</span>
              </button>
            </div>
          </div>

          {proposedOutline.rationale && (
            <div className="text-xs text-[#5c5447] bg-white/80 p-2.5 rounded-lg border border-amber-200/80 leading-relaxed italic">
              <strong>Editorial Rationale:</strong> {proposedOutline.rationale}
            </div>
          )}
          <p className="text-[11px] text-amber-900 mt-2 font-medium">
            Review the intellectual progression steps below. You can edit, reorder, or map research before accepting.
          </p>
        </div>
      ) : (
        /* Action Strip */
        <div className="px-4 sm:px-5 py-2.5 border-b border-[#e5dfd3] bg-[#f9f7f2] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-[#443d34]">
              {outline.length} {structureType === 'essay' ? 'Progression Steps' : 'Sections'}
            </span>
            {outline.length > 0 && (
              <button
                type="button"
                onClick={handleToggleExpandAll}
                className="text-[11px] text-blue-900 hover:text-blue-950 underline cursor-pointer ml-1"
              >
                {expandedItemIds.size === outline.length ? 'Collapse All' : 'Expand All'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateOutline}
              disabled={isGenerating}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#1e232a] hover:bg-[#2d3744] rounded-lg transition-all inline-flex items-center gap-1.5 disabled:opacity-50 shadow-xs cursor-pointer"
              title={`Generate structured ${structureType} outline with Gemini`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {isGenerating
                  ? 'Constructing Progression...'
                  : outline.length > 0
                  ? `Regenerate (${structureType})`
                  : `Generate Outline (${structureType})`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 5. Main Step / Section List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
        {currentList.length === 0 ? (
          <div className="text-center py-12 px-5 border border-dashed border-[#dcd6ca] rounded-2xl bg-white/60">
            <ListOrdered className="w-10 h-10 text-[#a8a194] mx-auto mb-3" />
            <h4 className="text-sm font-bold text-[#1e232a]">Outline is Empty</h4>
            <p className="text-xs text-[#736c61] mt-1.5 max-w-sm mx-auto leading-relaxed">
              Generate an intellectual progression downstream from your Editorial Brief, or add steps manually below.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleGenerateOutline}
                disabled={isGenerating}
                className="px-4 py-2 text-xs font-bold text-white bg-[#1e232a] hover:bg-[#2d3744] rounded-xl transition-all inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Generate Outline ({structureType})</span>
              </button>
            </div>
          </div>
        ) : (
          currentList.map((item, index) => {
            const isEditing = editingId === item.id;
            const isExpanded = expandedItemIds.has(item.id) || isEditing;

            return (
              <div
                key={item.id}
                className={`rounded-xl border transition-all ${
                  proposedOutline
                    ? 'bg-amber-50/50 border-amber-300 shadow-xs'
                    : item.completed
                    ? 'bg-stone-50/70 border-stone-200 opacity-80'
                    : 'bg-white border-[#e5dfd3] shadow-xs hover:border-[#dcd6ca]'
                }`}
              >
                {/* Header Row */}
                <div className="p-3 sm:p-3.5 flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    {/* Step Number Badge */}
                    <span className="w-6 h-6 rounded-lg bg-[#f0ebd9] text-[#4a443b] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 border border-[#ded8c5]">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-2.5 pt-0.5">
                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#736c61] block mb-0.5">
                              Step Title / Label
                            </label>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          {structureType !== 'essay' && (
                            <div>
                              <label className="text-[10px] font-bold uppercase text-[#736c61] block mb-0.5">
                                Conventional Heading (H2/H3)
                              </label>
                              <input
                                type="text"
                                value={editHeading}
                                onChange={(e) => setEditHeading(e.target.value)}
                                placeholder="Heading text..."
                                className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                              />
                            </div>
                          )}

                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#736c61] block mb-0.5">
                              Purpose (What this section achieves)
                            </label>
                            <textarea
                              rows={2}
                              value={editPurpose}
                              onChange={(e) => setEditPurpose(e.target.value)}
                              placeholder="What this step accomplishes in the argument..."
                              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#736c61] block mb-0.5">
                              Main Idea / Intellectual Premise
                            </label>
                            <textarea
                              rows={2}
                              value={editMainIdea}
                              onChange={(e) => setEditMainIdea(e.target.value)}
                              placeholder="Core argument or intellectual claim..."
                              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#736c61] block mb-0.5">
                              What This Part Develops (Progression)
                            </label>
                            <textarea
                              rows={2}
                              value={editDevelops}
                              onChange={(e) => setEditDevelops(e.target.value)}
                              placeholder="How it advances the thesis from the previous point..."
                              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          {/* Research Study Assignment */}
                          {attachedStudies.length > 0 && (
                            <div>
                              <label className="text-[10px] font-bold uppercase text-amber-900 block mb-1">
                                Assign Research Studies
                              </label>
                              <div className="space-y-1 bg-amber-50/50 p-2 rounded-lg border border-amber-200">
                                {attachedStudies.map((study) => {
                                  const isChecked = editStudyIds.includes(study.id);
                                  return (
                                    <label
                                      key={study.id}
                                      className="flex items-start gap-2 text-xs text-[#2c2720] cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          if (isChecked) {
                                            setEditStudyIds(editStudyIds.filter((id) => id !== study.id));
                                          } else {
                                            setEditStudyIds([...editStudyIds, study.id]);
                                          }
                                        }}
                                        className="mt-0.5 accent-amber-700"
                                      />
                                      <span className="leading-tight">
                                        <strong>{study.title}</strong>{' '}
                                        <span className="text-[#736c61]">({study.authors || 'Study'})</span>
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Internal Links Assignment */}
                          {availableInternalLinks.length > 0 && (
                            <div>
                              <label className="text-[10px] font-bold uppercase text-blue-900 block mb-1">
                                Assign Internal Link Opportunity
                              </label>
                              <div className="flex gap-2">
                                <select
                                  onChange={(e) => {
                                    const selectedUrl = e.target.value;
                                    if (!selectedUrl) return;
                                    const found = availableInternalLinks.find((l) => l.url === selectedUrl);
                                    if (found && !editLinks.some((l) => l.url === found.url)) {
                                      setEditLinks([
                                        ...editLinks,
                                        {
                                          id: found.id,
                                          title: found.title,
                                          url: found.url,
                                          targetAnchor: found.preferredAnchor || found.title,
                                        },
                                      ]);
                                    }
                                    e.target.value = '';
                                  }}
                                  className="text-xs p-1.5 rounded-lg border border-[#dcd6ca] bg-white flex-1"
                                >
                                  <option value="">+ Add an Internal Link...</option>
                                  {availableInternalLinks.map((link) => (
                                    <option key={link.id} value={link.url}>
                                      {link.title} {link.preferredAnchor ? `("${link.preferredAnchor}")` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {editLinks.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {editLinks.map((l, lIdx) => (
                                    <span
                                      key={lIdx}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-50 text-blue-900 border border-blue-200"
                                    >
                                      <span>{l.title}</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditLinks(editLinks.filter((_, idx) => idx !== lIdx))
                                        }
                                        className="text-blue-950 hover:text-rose-600"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#736c61] block mb-0.5">
                              Editorial Notes & Tone Precautions
                            </label>
                            <textarea
                              rows={2}
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="Precautions, tone notes, things to avoid..."
                              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(item.id, Boolean(proposedOutline))}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-[#1e232a] hover:bg-[#2d3744] rounded-lg transition-colors cursor-pointer"
                            >
                              Save Step
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-[#6e685f] hover:text-[#1e232a] bg-stone-100 rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Read-only view */
                        <div
                          onClick={() => toggleItemExpanded(item.id)}
                          className="cursor-pointer select-none"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-xs sm:text-sm font-bold text-[#1e232a] leading-snug">
                              {item.title}
                            </h4>
                          </div>

                          {/* Quick Purpose Preview */}
                          {(item.purpose || item.description) && (
                            <p className="text-xs text-[#5c5447] mt-1 leading-relaxed line-clamp-2">
                              {item.purpose || item.description}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {onDraftSection && !proposedOutline && (
                        <button
                          type="button"
                          onClick={() => onDraftSection(item)}
                          className="px-2 py-1 text-[10px] font-bold text-amber-950 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100 transition-colors inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                          title="Draft this section in editor"
                        >
                          <Sparkles className="w-3 h-3 text-amber-700" />
                          <span className="hidden sm:inline">Draft</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleStartEdit(item)}
                        className="p-1.5 text-[#736c61] hover:text-[#1e232a] transition-colors rounded-md hover:bg-[#f3ede1] cursor-pointer"
                        title="Edit step details"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMove(index, 'up', Boolean(proposedOutline))}
                        disabled={index === 0}
                        className="p-1.5 text-[#736c61] hover:text-[#1e232a] disabled:opacity-20 transition-colors rounded-md hover:bg-[#f3ede1] cursor-pointer"
                        title="Move step up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMove(index, 'down', Boolean(proposedOutline))}
                        disabled={index === currentList.length - 1}
                        className="p-1.5 text-[#736c61] hover:text-[#1e232a] disabled:opacity-20 transition-colors rounded-md hover:bg-[#f3ede1] cursor-pointer"
                        title="Move step down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveSection(item.id, Boolean(proposedOutline))}
                        className="p-1.5 text-[#736c61] hover:text-rose-600 transition-colors rounded-md hover:bg-rose-50 cursor-pointer"
                        title="Delete step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleItemExpanded(item.id)}
                        className="p-1.5 text-[#736c61] hover:text-[#1e232a] transition-colors rounded-md hover:bg-[#f3ede1] cursor-pointer"
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded Card Details (Essay intellectual progression) */}
                {isExpanded && !isEditing && (
                  <div className="px-3.5 pb-3.5 pt-1 border-t border-[#f0ede6] space-y-2.5 text-xs animate-in fade-in duration-100">
                    {/* Optional Explicit Heading if different from title */}
                    {item.heading && item.heading !== item.title && (
                      <div className="flex items-center gap-2 text-[11px] text-[#736c61]">
                        <span className="font-bold uppercase text-[9px] tracking-wider text-[#8c8477]">
                          Heading:
                        </span>
                        <span className="font-medium text-[#2d2720]">{item.heading}</span>
                      </div>
                    )}

                    {/* Main Idea */}
                    {item.mainIdea && (
                      <div className="p-2.5 rounded-lg bg-[#fbf9f4] border border-[#e8e2d5]">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-[#6e685f] block mb-0.5">
                          Main Intellectual Idea
                        </span>
                        <p className="text-xs text-[#2d2720] leading-relaxed">
                          {item.mainIdea}
                        </p>
                      </div>
                    )}

                    {/* What this part develops */}
                    {item.develops && (
                      <div className="p-2.5 rounded-lg bg-blue-50/40 border border-blue-200/60">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-blue-900 block mb-0.5">
                          What This Part Develops (Progression)
                        </span>
                        <p className="text-xs text-[#1e2b3a] leading-relaxed">
                          {item.develops}
                        </p>
                      </div>
                    )}

                    {/* Assigned Research Studies */}
                    {item.assignedStudyIds && item.assignedStudyIds.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 mb-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-amber-800" />
                          <span>Assigned Research Studies & Empirical Claims</span>
                        </div>
                        <div className="space-y-1.5">
                          {item.assignedStudyIds.map((sid) => {
                            const study = storage.getResearchStudy(sid);
                            return (
                              <div
                                key={sid}
                                className="bg-white/80 p-2 rounded border border-amber-200/80 text-[11px]"
                              >
                                <div className="font-semibold text-amber-950">
                                  {study?.title || sid}
                                </div>
                                {study && (
                                  <div className="text-[10px] text-[#736c61]">
                                    {Array.isArray(study.authors) ? study.authors.join(', ') : study.authors || 'Research'} ({study.publicationYear || 'n.d.'})
                                  </div>
                                )}
                                {study?.keyFindings && (
                                  <div className="text-[10px] text-[#4a443b] mt-0.5 leading-tight italic">
                                    Finding: {Array.isArray(study.keyFindings) ? study.keyFindings.join('; ') : String(study.keyFindings)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {item.assignedClaims && item.assignedClaims.length > 0 && (
                            <div className="mt-1 space-y-0.5 text-[11px] text-[#3a342c]">
                              {item.assignedClaims.map((c, cIdx) => (
                                <div key={cIdx} className="leading-tight">• {c}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Assigned Internal Links */}
                    {item.assignedInternalLinks && item.assignedInternalLinks.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-emerald-50/40 border border-emerald-200/60">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-950 mb-1">
                          <Link2 className="w-3.5 h-3.5 text-emerald-800" />
                          <span>Internal Link Opportunities</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.assignedInternalLinks.map((link, lIdx) => (
                            <div
                              key={lIdx}
                              className="bg-white/90 px-2 py-1 rounded border border-emerald-200 text-[11px] text-[#1e232a]"
                            >
                              <span className="font-semibold">{link.title}</span>
                              {link.targetAnchor && (
                                <span className="text-[10px] text-[#5c5447] ml-1">
                                  (Anchor: "{link.targetAnchor}")
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Editorial Notes */}
                    {item.notes && (
                      <div className="text-[11px] text-[#6e685f] leading-relaxed pt-1">
                        <span className="font-bold text-[10px] uppercase text-[#8c8477] mr-1">
                          Notes & Tone:
                        </span>
                        {item.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* 6. Add Section Manually Form */}
        <div className="pt-4 border-t border-[#e8e2d5]">
          {isAddingSection ? (
            <form onSubmit={handleAddSection} className="p-3.5 rounded-xl border border-[#dcd6ca] bg-white space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#443d34]">
                  Add Section Manually ({structureType.toUpperCase()})
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingSection(false)}
                  className="text-xs text-[#736c61] hover:text-[#1e232a]"
                >
                  Cancel
                </button>
              </div>

              <div>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={
                    structureType === 'essay'
                      ? "Step Title (e.g. '5. Broadening the Horizon: Stewardship Across Seasons')"
                      : "Section Heading (e.g. 'The Mechanics of Honest Materials')"
                  }
                  className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {structureType !== 'essay' && (
                <div>
                  <input
                    type="text"
                    value={newHeading}
                    onChange={(e) => setNewHeading(e.target.value)}
                    placeholder="Optional H2/H3 Heading..."
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              )}

              <div>
                <textarea
                  rows={2}
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value)}
                  placeholder="Purpose: What this part establishes or achieves..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  value={newMainIdea}
                  onChange={(e) => setNewMainIdea(e.target.value)}
                  placeholder="Main Idea: Core intellectual argument of this part..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  value={newDevelops}
                  onChange={(e) => setNewDevelops(e.target.value)}
                  placeholder="What this part develops in the progression..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Important editorial notes, tone precautions, things to avoid..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAddingSection(false)}
                  className="px-3 py-1.5 text-xs font-medium text-[#6e685f] hover:text-[#1e232a]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="px-4 py-1.5 bg-[#1e232a] text-white text-xs font-bold rounded-lg hover:bg-[#2d3744] disabled:opacity-30 transition-colors inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Step to Outline
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsAddingSection(true)}
              className="w-full py-2.5 border border-dashed border-[#c8c0b0] rounded-xl text-xs font-semibold text-[#5c5447] hover:text-[#1e232a] hover:border-[#1e232a] hover:bg-white transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Step Manually</span>
            </button>
          )}

          {outline.length > 0 && onOpenDraftPackage && (
            <div className="mt-4 p-4 rounded-xl border border-amber-300 bg-amber-50/80 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
              <div className="space-y-0.5 text-center sm:text-left">
                <div className="text-xs font-bold text-[#1e232a] flex items-center justify-center sm:justify-start gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                  <span>Next Step: Editorial Draft Package</span>
                </div>
                <div className="text-[11px] text-[#6e685f]">
                  Assemble this {outline.length}-step outline, research, links, and style profile for ChatGPT.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDraftPackage();
                }}
                className="w-full sm:w-auto px-4 py-2 bg-[#1e232a] hover:bg-[#2d3744] text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs shrink-0"
              >
                <span>Proceed to Draft Package</span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-300" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
