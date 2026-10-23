/**
 * Science of Gifts - Editorial Dashboard (Requirement #1, #16 & Phase 10)
 * Grouped project launcher with metadata, statuses, model visibility, and safe duplication/deletion.
 */

import React, { useState } from 'react';
import { WritingProject, ProjectType, ProjectStatus } from '../types/project';
import {
  FileText,
  Gift,
  Tag,
  Plus,
  Search,
  BookOpen,
  Trash2,
  Copy,
  ArrowRight,
  Compass,
  Edit2,
  Check,
  X,
  Cpu,
  Sparkles,
  Lightbulb,
} from 'lucide-react';
import { extractPlainTextFromHtml } from '../utils/richText';
import { ConfirmationModal } from './ConfirmationModal';
import { getModelDefinition } from '../services/modelRegistry';
import { storage } from '../services/storage';

interface DashboardProps {
  projects: WritingProject[];
  onOpenProject: (id: string) => void;
  onCreateProject: (type: ProjectType) => void;
  onDeleteProject: (id: string) => void;
  onDuplicateProject: (project: WritingProject) => void;
  onUpdateStatus: (id: string, status: ProjectStatus) => void;
  onRenameProject?: (id: string, newTitle: string) => void;
  onOpenIdeaGenerator?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  projects,
  onOpenProject,
  onCreateProject,
  onDeleteProject,
  onDuplicateProject,
  onUpdateStatus,
  onRenameProject,
  onOpenIdeaGenerator,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<ProjectType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | 'all'>('all');
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<WritingProject | null>(null);

  const globalModel = storage.getGlobalModel();

  // Filter projects
  const filtered = projects.filter((p) => {
    if (activeTab !== 'all' && p.type !== activeTab) return false;
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const plainBody = extractPlainTextFromHtml(p.content).toLowerCase();
      const matchTitle = p.title.toLowerCase().includes(q);
      const matchContent = plainBody.includes(q);
      const matchInstructions = (p.projectInstructions || '').toLowerCase().includes(q);
      return matchTitle || matchContent || matchInstructions;
    }
    return true;
  });

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'draft':
        return (
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200">
            Draft
          </span>
        );
      case 'in_progress':
        return (
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
            In Progress
          </span>
        );
      case 'review':
        return (
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-900 border border-blue-200">
            Ready for Review
          </span>
        );
      case 'complete':
        return (
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-900 border border-emerald-200">
            Complete
          </span>
        );
    }
  };

  const getTypeIcon = (type: ProjectType) => {
    switch (type) {
      case 'article':
        return <FileText className="w-4 h-4 text-blue-700" />;
      case 'gift_guide':
        return <Gift className="w-4 h-4 text-amber-700" />;
      case 'product_copy':
        return <Tag className="w-4 h-4 text-emerald-700" />;
    }
  };

  const getTypeName = (type: ProjectType) => {
    switch (type) {
      case 'article':
        return 'Editorial Article';
      case 'gift_guide':
        return 'Gift Guide';
      case 'product_copy':
        return 'Product Copy';
    }
  };

  const calculateWordCount = (proj: WritingProject) => {
    let plain = extractPlainTextFromHtml(proj.content);
    if (proj.type === 'gift_guide' && proj.giftGuideMeta?.products) {
      const prodText = proj.giftGuideMeta.products
        .map((p: any) => `${p.name || ''} ${p.price || ''} ${p.description || ''} ${p.whyItMakesGreatGift || ''}`)
        .join(' ');
      plain += ' ' + prodText;
    }
    return plain.trim() ? plain.trim().split(/\s+/).filter(Boolean).length : 0;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleStartRename = (proj: WritingProject, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleId(proj.id);
    setEditingTitleText(proj.title);
  };

  const handleSaveRename = (id: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    if (editingTitleText.trim() && onRenameProject) {
      onRenameProject(id, editingTitleText.trim());
    }
    setEditingTitleId(null);
  };

  const articleCount = projects.filter((p) => p.type === 'article').length;
  const guideCount = projects.filter((p) => p.type === 'gift_guide').length;
  const productCount = projects.filter((p) => p.type === 'product_copy').length;

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf9f6] p-4 sm:p-6 md:p-10 space-y-6 sm:space-y-8 max-w-6xl mx-auto w-full">
      {/* Studio Header Banner */}
      <div className="border-b border-[#e5dfd3] pb-6 sm:pb-8 pt-2">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-800 mb-2">
              <Compass className="w-4 h-4" />
              <span>Science of Gifts Editorial Studio</span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-3xl md:text-4xl font-bold text-[#1e232a] tracking-tight">
              Editorial Studio Projects
            </h1>
            <p className="text-xs sm:text-sm text-[#6e685f] mt-1.5 sm:mt-2 max-w-2xl leading-relaxed">
              Discerning workspace for human, specific, unhurried articles, curated gift guides, and factual product narratives.
            </p>
          </div>

          {/* Quick Create & Idea Generator Buttons */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {onOpenIdeaGenerator && (
              <button
                type="button"
                onClick={onOpenIdeaGenerator}
                className="px-3.5 py-2 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200/80 border border-amber-300/80 rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-2xs select-none min-h-[36px]"
                title="Discover interesting article ideas, questions, and editorial angles"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-800" />
                <span>Generate Ideas</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onCreateProject('article')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2e3743] rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-xs min-h-[36px]"
            >
              <FileText className="w-3.5 h-3.5 text-blue-300" />
              New Article
            </button>
            <button
              type="button"
              onClick={() => onCreateProject('gift_guide')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2e3743] rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-xs min-h-[36px]"
            >
              <Gift className="w-3.5 h-3.5 text-amber-300" />
              New Gift Guide
            </button>
            <button
              type="button"
              onClick={() => onCreateProject('product_copy')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2e3743] rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-xs min-h-[36px]"
            >
              <Tag className="w-3.5 h-3.5 text-emerald-300" />
              New Product Copy
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 sm:p-3.5 rounded-xl border border-[#e5dfd3] shadow-xs">
        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects by title, keyword, or text..."
            className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-[#dcd6ca] bg-[#faf8f4] focus:outline-hidden focus:bg-white text-[#1e232a]"
          />
          <Search className="w-3.5 h-3.5 text-[#8c8477] absolute left-2.5 top-2.5" />
        </div>

        {/* Group Tabs */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex bg-[#f2efe6] p-0.5 rounded-lg overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'all'
                  ? 'bg-white shadow-2xs font-semibold text-[#1e232a]'
                  : 'text-[#6e685f] hover:text-[#1e232a]'
              }`}
            >
              All ({projects.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('article')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'article'
                  ? 'bg-white shadow-2xs font-semibold text-[#1e232a]'
                  : 'text-[#6e685f] hover:text-[#1e232a]'
              }`}
            >
              Articles ({articleCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('gift_guide')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'gift_guide'
                  ? 'bg-white shadow-2xs font-semibold text-[#1e232a]'
                  : 'text-[#6e685f] hover:text-[#1e232a]'
              }`}
            >
              Gift Guides ({guideCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('product_copy')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'product_copy'
                  ? 'bg-white shadow-2xs font-semibold text-[#1e232a]'
                  : 'text-[#6e685f] hover:text-[#1e232a]'
              }`}
            >
              Product Copy ({productCount})
            </button>
          </div>

          {/* Filter Status */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="text-xs py-1.5 px-2.5 rounded-lg border border-[#dcd6ca] bg-white text-[#2d333b] focus:outline-hidden"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Ready for Review</option>
            <option value="complete">Complete</option>
          </select>
        </div>
      </div>

      {/* Projects List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-[#736c61] px-1 font-medium">
          <span>{filtered.length} {filtered.length === 1 ? 'Project' : 'Projects'}</span>
          <span className="hidden md:inline">Word Count & AI Model</span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 px-4 bg-white border border-dashed border-[#dcd6ca] rounded-xl space-y-4">
            <BookOpen className="w-10 h-10 text-[#a39a8c] mx-auto" />
            <div className="space-y-1">
              <h3 className="font-editorial text-lg font-bold text-[#1e232a]">
                {searchQuery ? 'No matching projects found' : 'No projects in this category'}
              </h3>
              <p className="text-xs text-[#736c61] max-w-sm mx-auto">
                {searchQuery
                  ? 'Try clearing your search keyword or changing your active filters.'
                  : 'Create an Article, Gift Guide, or Product Copy project to begin writing.'}
              </p>
            </div>
            {!searchQuery && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onCreateProject(activeTab === 'all' ? 'article' : activeTab)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2e3743] rounded-lg transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create {activeTab === 'all' ? 'Article' : getTypeName(activeTab)}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((proj) => {
              const wordCount = calculateWordCount(proj);
              const activeModelDef = getModelDefinition(proj.modelOverride || globalModel);

              return (
                <div
                  key={proj.id}
                  onClick={() => onOpenProject(proj.id)}
                  className="group p-4 sm:p-5 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs hover:shadow-md hover:border-[#cbcaa9] transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4"
                >
                  {/* Left: Info */}
                  <div className="flex items-start gap-3 sm:gap-3.5 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#f6f3eb] border border-[#e8e4db] flex items-center justify-center shrink-0 mt-0.5">
                      {getTypeIcon(proj.type)}
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap text-xs">
                        <span className="text-[11px] font-semibold text-[#736c61] uppercase tracking-wider">
                          {getTypeName(proj.type)}
                        </span>
                        <span className="text-[#dcd6ca]">·</span>
                        {getStatusBadge(proj.status)}
                        <span className="text-[#dcd6ca]">·</span>
                        <span className="text-[11px] text-[#8c8477] inline-flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-[#a39a8c]" />
                          {activeModelDef.displayName}
                        </span>
                      </div>

                      {/* Title or Inline Edit */}
                      {editingTitleId === proj.id ? (
                        <div
                          className="flex items-center gap-2 pt-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editingTitleText}
                            onChange={(e) => setEditingTitleText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(proj.id);
                              if (e.key === 'Escape') setEditingTitleId(null);
                            }}
                            className="font-editorial text-base sm:text-lg font-bold text-[#1e232a] px-2 py-0.5 border border-amber-400 rounded-md bg-[#faf8f4] focus:outline-hidden w-full max-w-sm"
                          />
                          <button
                            type="button"
                            onClick={(e) => handleSaveRename(proj.id, e)}
                            className="p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center bg-[#1e232a] text-white rounded-md text-xs hover:bg-[#2d3744]"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTitleId(null);
                            }}
                            className="p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#736c61] hover:text-[#1e232a]"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h3 className="font-editorial text-lg md:text-xl font-bold text-[#1e232a] group-hover:text-amber-900 transition-colors truncate">
                            {proj.title || 'Untitled Draft'}
                          </h3>
                          <button
                            type="button"
                            onClick={(e) => handleStartRename(proj, e)}
                            className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-[#8c8477] hover:text-[#1e232a] transition-opacity p-1 min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded hover:bg-[#ede7db]"
                            title="Rename project"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <p className="text-xs text-[#6e685f] line-clamp-2 sm:line-clamp-1 max-w-2xl font-editorial">
                        {extractPlainTextFromHtml(proj.content)
                          ? extractPlainTextFromHtml(proj.content).substring(0, 140) + '...'
                          : proj.brief?.purpose
                          ? `Purpose: ${proj.brief.purpose.substring(0, 140)}...`
                          : 'No draft content written yet.'}
                      </p>
                    </div>
                  </div>

                  {/* Right: Metrics & Actions */}
                  <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 sm:gap-4 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-[#f0ede6] text-xs">
                    <div className="text-left md:text-right space-y-0.5">
                      <div className="font-semibold text-[#1e232a]">{wordCount.toLocaleString()} words</div>
                      <div className="text-[10px] text-[#8c8477]">
                        Modified {formatDate(proj.updatedAt)}
                      </div>
                    </div>

                    {/* Status Select */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <select
                        value={proj.status}
                        onChange={(e) => onUpdateStatus(proj.id, e.target.value as ProjectStatus)}
                        className="text-[11px] py-1.5 px-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] text-[#443d34] focus:outline-hidden font-medium cursor-pointer min-h-[32px]"
                      >
                        <option value="draft">Draft</option>
                        <option value="in_progress">In Progress</option>
                        <option value="review">Ready for Review</option>
                        <option value="complete">Complete</option>
                      </select>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onDuplicateProject(proj)}
                        className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#8c8477] hover:text-[#1e232a] rounded-md hover:bg-[#f2efe6] transition-colors"
                        title="Duplicate project (creates fresh copy)"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setProjectToDelete(proj)}
                        className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#8c8477] hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                        title="Delete project"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="text-[#8c8477] group-hover:text-amber-900 group-hover:translate-x-1 transition-transform hidden sm:block">
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <ConfirmationModal
          isOpen={true}
          title={`Delete "${projectToDelete.title}"?`}
          message="This action permanently deletes this project and cannot be undone. Any versions in its history will also be removed."
          confirmLabel="Delete Project"
          cancelLabel="Keep Project"
          isDestructive={true}
          onConfirm={() => {
            onDeleteProject(projectToDelete.id);
            setProjectToDelete(null);
          }}
          onCancel={() => setProjectToDelete(null)}
        />
      )}
    </div>
  );
};
