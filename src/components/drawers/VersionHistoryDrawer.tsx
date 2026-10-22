/**
 * Science of Gifts - Version History Drawer (Phase 9)
 * Editorial revision history with snapshot preview, word-level editorial diffs,
 * manual checkpoints, and non-destructive version restoration.
 */

import React, { useState, useMemo } from 'react';
import { WritingProject } from '../../types/project';
import {
  ProjectVersionSnapshot,
  VersionType,
  VersionDiffResult,
} from '../../types/versionHistory';
import {
  createVersionSnapshot,
  restoreVersionSnapshot,
  computeVersionDiff,
} from '../../services/versionHistoryService';
import { getModelDefinition } from '../../services/modelRegistry';
import {
  History,
  X,
  RotateCcw,
  GitCompare,
  Plus,
  Eye,
  Check,
  AlertCircle,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
  Layers,
  ArrowLeft,
  ChevronRight,
  Bookmark,
  CheckCircle2,
} from 'lucide-react';

interface VersionHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  project: WritingProject;
  onUpdateProject: (updatedProject: WritingProject) => void;
  onRestoreSuccess?: (restoredVersionNumber: number) => void;
}

export const VersionHistoryDrawer: React.FC<VersionHistoryDrawerProps> = ({
  isOpen,
  onClose,
  project,
  onUpdateProject,
  onRestoreSuccess,
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'preview' | 'compare'>('list');
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualLabel, setManualLabel] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'manual_ai' | 'recent'>('all');
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);

  const history = useMemo(() => {
    return project.versionHistory || [];
  }, [project.versionHistory]);

  const selectedVersion = useMemo(() => {
    if (!selectedVersionId) return history[0] || null;
    return history.find((v) => v.id === selectedVersionId) || history[0] || null;
  }, [history, selectedVersionId]);

  const diffResult: VersionDiffResult | null = useMemo(() => {
    if (viewMode !== 'compare' || !selectedVersion) return null;
    return computeVersionDiff(project.content || '', selectedVersion.content || '', selectedVersion.id);
  }, [viewMode, selectedVersion, project.content]);

  // Filtered list
  const filteredHistory = useMemo(() => {
    if (activeFilter === 'manual_ai') {
      return history.filter(
        (v) =>
          v.type === 'manual_save' ||
          v.type === 'restored_version' ||
          v.type === 'before_ai_edit' ||
          v.type === 'after_ai_edit'
      );
    }
    if (activeFilter === 'recent') {
      return history.slice(0, 10);
    }
    return history;
  }, [history, activeFilter]);

  if (!isOpen) return null;

  // Handle manual checkpoint creation
  const handleSaveManualCheckpoint = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedHistory = createVersionSnapshot(project, 'manual_save', {
      label: manualLabel.trim() || undefined,
      force: true,
    });
    onUpdateProject({
      ...project,
      versionHistory: updatedHistory,
      updatedAt: new Date().toISOString(),
    });
    setManualLabel('');
    setIsSavingManual(false);
    if (updatedHistory.length > 0) {
      setSelectedVersionId(updatedHistory[0].id);
    }
  };

  // Handle version restoration
  const handleRestoreVersion = (targetVersionId: string) => {
    const result = restoreVersionSnapshot(project, targetVersionId);
    if (result) {
      onUpdateProject(result.updatedProject);
      window.dispatchEvent(
        new CustomEvent('sog:restore-editor-content', {
          detail: { content: result.updatedProject.content, projectId: project.id },
        })
      );
      setRestoreConfirmId(null);
      setViewMode('list');
      if (result.updatedProject.versionHistory && result.updatedProject.versionHistory.length > 0) {
        setSelectedVersionId(result.updatedProject.versionHistory[0].id);
      }
      onRestoreSuccess?.(result.restoredVersion.versionNumber);
    }
  };

  const getVersionTypeBadge = (type: VersionType) => {
    switch (type) {
      case 'manual_save':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300/60 inline-flex items-center gap-1">
            <Bookmark className="w-2.5 h-2.5" /> Manual Save
          </span>
        );
      case 'before_ai_edit':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300/60 inline-flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 text-amber-700" /> Before AI Edit
          </span>
        );
      case 'after_ai_edit':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-900 border border-blue-300/60 inline-flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 text-blue-700" /> After AI Edit
          </span>
        );
      case 'before_review':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-900 border border-purple-300/60 inline-flex items-center gap-1">
            <ShieldCheck className="w-2.5 h-2.5" /> Before Review
          </span>
        );
      case 'before_qc':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-900 border border-indigo-300/60 inline-flex items-center gap-1">
            <Layers className="w-2.5 h-2.5" /> Before QC
          </span>
        );
      case 'restored_version':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-900 border border-teal-300/60 inline-flex items-center gap-1">
            <RotateCcw className="w-2.5 h-2.5" /> Restored
          </span>
        );
      case 'autosave_snapshot':
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-300/60 inline-flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Snapshot
          </span>
        );
    }
  };

  const formatTimestamp = (isoDate: string) => {
    try {
      const d = new Date(isoDate);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today, ${timeStr}`;
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch {
      return 'Recent';
    }
  };

  return (
    <aside
      className="max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-full w-full md:w-[520px] lg:w-[600px] shrink-0 h-full bg-[#fbf9f4] md:border-l border-[#dfd7c9] flex flex-col overflow-hidden animate-in slide-in-from-right-1 duration-150 z-30"
      aria-label="Version History Panel"
    >
      {/* Top Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-[#e5dfd3] bg-[#f4efe4] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-[#1e232a] text-[#f7f5ef] shadow-xs shrink-0">
            <History className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-editorial text-lg font-bold text-[#1e232a] truncate">Version History</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#eae4d7] text-[#5c5447] shrink-0">
                {history.length} {history.length === 1 ? 'version' : 'versions'}
              </span>
            </div>
            <p className="text-xs text-[#6e675c] truncate">
              Every edit, AI generation, and milestone preserved
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!isSavingManual && viewMode === 'list' && (
            <button
              type="button"
              onClick={() => setIsSavingManual(true)}
              className="px-2.5 sm:px-3 py-1.5 rounded-md bg-[#1e232a] text-white text-xs font-semibold hover:bg-[#2e3744] transition-colors inline-flex items-center gap-1 shadow-xs min-h-[36px]"
            >
              <Plus className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline">Save Version</span>
              <span className="sm:hidden">Save</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#70685c] hover:text-[#1e232a] hover:bg-[#eae4d7] rounded-lg transition-colors"
            title="Close version history"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Manual Checkpoint Creator Dialog */}
      {isSavingManual && (
        <form
          onSubmit={handleSaveManualCheckpoint}
          className="p-4 bg-amber-50/70 border-b border-amber-200/80 shrink-0 space-y-2.5 animate-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#1e232a] inline-flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-amber-800" /> Save Named Version Checkpoint
            </span>
            <button
              type="button"
              onClick={() => setIsSavingManual(false)}
              className="text-xs text-[#70685c] hover:text-[#1e232a]"
            >
              Cancel
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualLabel}
              onChange={(e) => setManualLabel(e.target.value)}
              placeholder="Optional label (e.g. Before final rewrite, Pre-publication pass)"
              className="flex-1 px-3 py-1.5 rounded bg-white border border-[#ded7ca] text-xs text-[#1e232a] focus:outline-none focus:ring-1 focus:ring-amber-800"
              autoFocus
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 transition-colors shrink-0 shadow-2xs"
            >
              Save Now
            </button>
          </div>
        </form>
      )}

      {/* View Mode: PREVIEW */}
      {viewMode === 'preview' && selectedVersion && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Preview Navigation Bar */}
          <div className="px-6 py-2.5 bg-amber-100/60 border-b border-amber-200/80 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className="px-2 py-1 rounded bg-white border border-[#d8d0c2] text-[#4a4235] hover:text-[#1e232a] font-semibold inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to List
              </button>
              <span className="font-bold text-[#1e232a]">
                Previewing v{selectedVersion.versionNumber} ({selectedVersion.label})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode('compare')}
                className="px-2.5 py-1 rounded bg-white border border-[#d8d0c2] text-xs font-medium text-[#4a4235] hover:text-[#1e232a] inline-flex items-center gap-1"
              >
                <GitCompare className="w-3.5 h-3.5 text-blue-700" /> Compare
              </button>
              <button
                type="button"
                onClick={() => setRestoreConfirmId(selectedVersion.id)}
                className="px-3 py-1 rounded bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 transition-colors inline-flex items-center gap-1 shadow-2xs"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore This Version
              </button>
            </div>
          </div>

          {/* Version Snapshot Metadata Card */}
          <div className="px-6 py-3 bg-[#f6f2e8] border-b border-[#e2dbce] text-xs text-[#5c5447] grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#8a8172] font-semibold block">Timestamp</span>
              <span className="font-medium text-[#1e232a]">{formatTimestamp(selectedVersion.timestamp)}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#8a8172] font-semibold block">Type</span>
              {getVersionTypeBadge(selectedVersion.type)}
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#8a8172] font-semibold block">Word Count</span>
              <span className="font-medium text-[#1e232a]">{selectedVersion.wordCount} words</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#8a8172] font-semibold block">AI Model</span>
              <span className="font-medium text-[#1e232a]">
                {selectedVersion.modelUsed ? getModelDefinition(selectedVersion.modelUsed).displayName : 'Human Editor'}
              </span>
            </div>
          </div>

          {/* Read-Only Document Canvas */}
          <div className="flex-1 p-6 overflow-y-auto bg-white border-b border-[#e2dbce] select-text">
            <div
              className="prose prose-stone max-w-none font-serif text-[#1e232a] leading-relaxed text-sm"
              dangerouslySetInnerHTML={{ __html: selectedVersion.content }}
            />
          </div>
        </div>
      )}

      {/* View Mode: COMPARE */}
      {viewMode === 'compare' && selectedVersion && diffResult && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Compare Toolbar */}
          <div className="px-6 py-2.5 bg-blue-50/80 border-b border-blue-200/70 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className="px-2 py-1 rounded bg-white border border-[#d8d0c2] text-[#4a4235] hover:text-[#1e232a] font-semibold inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to List
              </button>
              <span className="text-xs font-bold text-[#1e232a]">
                Comparing Current Draft vs v{selectedVersion.versionNumber} ({selectedVersion.label})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRestoreConfirmId(selectedVersion.id)}
                className="px-3 py-1 rounded bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 transition-colors inline-flex items-center gap-1 shadow-2xs"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore v{selectedVersion.versionNumber}
              </button>
            </div>
          </div>

          {/* Diff Metric Summary */}
          <div className="px-6 py-2.5 bg-white border-b border-[#e2dbce] flex items-center gap-4 text-xs font-medium shrink-0">
            <span className="text-[#5c5447]">Editorial Delta:</span>
            <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
              +{diffResult.additionsCount} additions
            </span>
            <span className="text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 font-semibold">
              -{diffResult.deletionsCount} deletions
            </span>
            <span className="text-[#756d60]">
              {diffResult.unchangedCount} paragraphs unchanged
            </span>
          </div>

          {/* Diff Body Canvas */}
          <div className="flex-1 p-6 overflow-y-auto bg-[#faf8f3] space-y-4">
            {diffResult.diffParagraphs.map((diffP, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-lg border text-sm font-serif leading-relaxed ${
                  diffP.type === 'added'
                    ? 'bg-emerald-50/70 border-emerald-300/80 text-emerald-950'
                    : diffP.type === 'removed'
                    ? 'bg-rose-50/70 border-rose-300/80 text-rose-950 line-through'
                    : diffP.type === 'modified'
                    ? 'bg-amber-50/50 border-amber-300/70 text-[#1e232a]'
                    : 'bg-white border-[#e6e0d4] text-[#1e232a]'
                }`}
              >
                {diffP.diffSegments ? (
                  diffP.diffSegments.map((seg, sIdx) => (
                    <span
                      key={sIdx}
                      className={
                        seg.type === 'added'
                          ? 'bg-emerald-200/70 text-emerald-950 px-0.5 rounded font-medium'
                          : seg.type === 'removed'
                          ? 'bg-rose-200/70 text-rose-950 px-0.5 rounded line-through opacity-80'
                          : ''
                      }
                    >
                      {seg.value}
                    </span>
                  ))
                ) : (
                  <span>{diffP.text}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View Mode: TIMELINE LIST */}
      {viewMode === 'list' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Filter Bar */}
          <div className="px-6 py-2 bg-[#f4efe4] border-b border-[#e2dbce] flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-1 font-medium">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-[#1e232a] text-white font-semibold shadow-2xs'
                    : 'text-[#615a50] hover:text-[#1e232a] hover:bg-[#e8e2d4]'
                }`}
              >
                All Snapshots
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('manual_ai')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  activeFilter === 'manual_ai'
                    ? 'bg-[#1e232a] text-white font-semibold shadow-2xs'
                    : 'text-[#615a50] hover:text-[#1e232a] hover:bg-[#e8e2d4]'
                }`}
              >
                Key Milestones & AI
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('recent')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  activeFilter === 'recent'
                    ? 'bg-[#1e232a] text-white font-semibold shadow-2xs'
                    : 'text-[#615a50] hover:text-[#1e232a] hover:bg-[#e8e2d4]'
                }`}
              >
                Recent (10)
              </button>
            </div>

            <span className="text-[11px] text-[#787164]">
              {filteredHistory.length} of {history.length}
            </span>
          </div>

          {/* Timeline List Items */}
          <div className="flex-1 p-6 overflow-y-auto space-y-3">
            {filteredHistory.length === 0 ? (
              <div className="p-8 text-center text-[#787164] bg-white rounded-xl border border-[#ded7ca]">
                <History className="w-8 h-8 text-[#a39a8c] mx-auto mb-2 opacity-60" />
                <p className="text-sm font-semibold text-[#1e232a]">No version checkpoints found</p>
                <p className="text-xs mt-1">
                  Snapshots are automatically recorded when you make major changes or run AI actions.
                </p>
              </div>
            ) : (
              filteredHistory.map((ver, idx) => {
                const isLatest = idx === 0 && activeFilter === 'all';
                return (
                  <div
                    key={ver.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isLatest
                        ? 'bg-amber-50/40 border-amber-300 shadow-xs'
                        : 'bg-white border-[#ded7ca] hover:border-[#b8af9f]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-editorial text-sm font-bold text-[#1e232a]">
                            Version {ver.versionNumber}
                          </span>
                          {isLatest && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200/80 text-amber-950 uppercase tracking-wider">
                              CURRENT
                            </span>
                          )}
                          {getVersionTypeBadge(ver.type)}
                        </div>

                        <div className="text-xs font-medium text-[#2d2821] mt-1">
                          {ver.label || 'Checkpoint'}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[#736c61] mt-1.5">
                          <span>{formatTimestamp(ver.timestamp)}</span>
                          <span>•</span>
                          <span>{ver.wordCount} words</span>
                          {ver.modelUsed && (
                            <>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1 text-amber-900 font-medium">
                                <Sparkles className="w-2.5 h-2.5 text-amber-700" />
                                {getModelDefinition(ver.modelUsed).displayName}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedVersionId(ver.id);
                            setViewMode('preview');
                          }}
                          className="px-2.5 py-1 rounded bg-[#f3eee3] hover:bg-[#e7e1d3] text-xs font-semibold text-[#453e34] hover:text-[#1e232a] transition-colors inline-flex items-center gap-1"
                          title="Preview this version read-only"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Preview</span>
                        </button>

                        {!isLatest && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedVersionId(ver.id);
                                setViewMode('compare');
                              }}
                              className="px-2.5 py-1 rounded bg-[#f3eee3] hover:bg-[#e7e1d3] text-xs font-semibold text-[#453e34] hover:text-[#1e232a] transition-colors inline-flex items-center gap-1"
                              title="Compare with current draft"
                            >
                              <GitCompare className="w-3.5 h-3.5" />
                              <span>Compare</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setRestoreConfirmId(ver.id)}
                              className="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300 transition-colors inline-flex items-center gap-1"
                              title="Restore document to this version"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {restoreConfirmId && (
        <div
          className="fixed inset-0 z-60 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setRestoreConfirmId(null)}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-[#dcd6ca] space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 text-amber-900">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-editorial text-base font-bold text-[#1e232a]">
                  Restore Earlier Version?
                </h3>
                <p className="text-xs text-[#6e675c]">
                  Your current draft will be safely snapshotted as a new checkpoint before restoring.
                </p>
              </div>
            </div>

            <p className="text-xs text-[#4a4338] leading-relaxed bg-[#fbf9f4] p-3 rounded-lg border border-[#e8e2d4]">
              Restoring replaces the visual editor canvas and project fields with the selected version, and appends a new <strong>Restored Version</strong> checkpoint. You will not lose your current work.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRestoreConfirmId(null)}
                className="px-4 py-2 rounded-lg bg-[#f0ebe0] text-xs font-semibold text-[#5c5447] hover:bg-[#e4ded2]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRestoreVersion(restoreConfirmId)}
                className="px-4 py-2 rounded-lg bg-emerald-800 text-white text-xs font-bold hover:bg-emerald-900 shadow-sm inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" /> Yes, Restore Version
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
