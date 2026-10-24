import React, { useState } from 'react';
import {
  AlertOctagon,
  CloudDownload,
  Copy,
  UploadCloud,
  X,
  Columns,
  GitCompare,
  Clock,
  Check,
} from 'lucide-react';
import { ProjectConflictInfo } from '../types/project';
import { computeVersionDiff } from '../services/versionHistoryService';
import { countWords, extractPlainTextFromHtml } from '../utils/richText';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  conflict: ProjectConflictInfo | null;
  isProcessing?: boolean;
  onReloadCloudVersion: (conflict: ProjectConflictInfo) => void | Promise<void>;
  onSaveLocalAsCopy: (conflict: ProjectConflictInfo) => void | Promise<void>;
  onForceOverwriteCloud: (conflict: ProjectConflictInfo) => void | Promise<void>;
  onClose: () => void;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  isOpen,
  conflict,
  isProcessing = false,
  onReloadCloudVersion,
  onSaveLocalAsCopy,
  onForceOverwriteCloud,
  onClose,
}) => {
  const [viewMode, setViewMode] = useState<'side_by_side' | 'diff'>('side_by_side');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  if (!isOpen || !conflict) return null;

  const { localWorkingProject, remoteProject, baseRevision, remoteRevision } = conflict;
  const localPlain = extractPlainTextFromHtml(localWorkingProject.content || '');
  const remotePlain = extractPlainTextFromHtml(remoteProject.content || '');
  const localWords = countWords(localWorkingProject.content || '');
  const remoteWords = countWords(remoteProject.content || '');

  const diffResult = computeVersionDiff(
    localWorkingProject.content || '',
    remoteProject.content || '',
    `cloud-rev-${remoteRevision}`
  );

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
      data-testid="conflict-resolution-modal"
    >
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)] rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border-subtle)] flex items-start justify-between gap-4 bg-red-500/5">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-red-500/15 text-red-600 shrink-0 mt-0.5">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="conflict-modal-title"
                className="text-base font-serif font-semibold text-[var(--color-text-primary)]"
              >
                Cloud Revision Conflict Detected
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                This article was updated in the cloud (Revision {remoteRevision}) while your local edits were based on{' '}
                {baseRevision > 0 ? `Revision ${baseRevision}` : 'an older local state'}. Your cloud write was blocked so no work is silently overwritten.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
            title="Close and review later"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* View switcher */}
        <div className="px-6 py-2.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span className="font-medium text-[var(--color-text-primary)]">
              Compare Versions:
            </span>
            <span>
              +{diffResult.additionsCount} additions / -{diffResult.deletionsCount} removals
            </span>
          </div>
          <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-0.5 rounded-lg border border-[var(--color-border-primary)]">
            <button
              type="button"
              onClick={() => setViewMode('side_by_side')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                viewMode === 'side_by_side'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Side-by-Side</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('diff')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                viewMode === 'diff'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Paragraph Diff</span>
            </button>
          </div>
        </div>

        {/* Comparison Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'side_by_side' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Local working copy */}
              <div className="border border-amber-500/30 rounded-xl bg-amber-500/5 p-4 flex flex-col">
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-amber-500/20">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                      Your Local Working Version
                    </span>
                    <h4 className="text-sm font-serif font-semibold text-[var(--color-text-primary)] mt-0.5">
                      {localWorkingProject.title}
                    </h4>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {localWords} words
                  </span>
                </div>
                <div
                  data-testid="conflict-local-preview"
                  className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto font-serif"
                >
                  {localPlain || '(Empty document)'}
                </div>
              </div>

              {/* Remote authoritative copy */}
              <div className="border border-emerald-500/30 rounded-xl bg-emerald-500/5 p-4 flex flex-col">
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-emerald-500/20">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                      Newer Cloud Version (Rev {remoteRevision})
                    </span>
                    <h4 className="text-sm font-serif font-semibold text-[var(--color-text-primary)] mt-0.5">
                      {remoteProject.title}
                    </h4>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-[var(--color-text-muted)] block">
                      {remoteWords} words
                    </span>
                    {remoteProject.updatedAt && (
                      <span className="text-[10px] text-[var(--color-text-muted)] inline-flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(remoteProject.updatedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div
                  data-testid="conflict-remote-preview"
                  className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto font-serif"
                >
                  {remotePlain || '(Empty document)'}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto border border-[var(--color-border-primary)] rounded-xl p-4 bg-[var(--color-bg-app)]">
              {diffResult.diffParagraphs.map((para, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg text-xs font-serif leading-relaxed ${
                    para.type === 'added'
                      ? 'bg-emerald-500/10 text-emerald-900 border-l-2 border-emerald-500'
                      : para.type === 'removed'
                        ? 'bg-red-500/10 text-red-900 line-through border-l-2 border-red-500'
                        : para.type === 'modified'
                          ? 'bg-amber-500/10 border-l-2 border-amber-500'
                          : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  {para.diffSegments
                    ? para.diffSegments.map((seg, sIdx) => (
                        <span
                          key={sIdx}
                          className={
                            seg.type === 'added'
                              ? 'bg-emerald-500/20 text-emerald-900 font-medium px-0.5 rounded'
                              : seg.type === 'removed'
                                ? 'bg-red-500/20 text-red-800 line-through px-0.5 rounded'
                                : ''
                          }
                        >
                          {seg.value}
                        </span>
                      ))
                    : para.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resolution Actions Footer */}
        <div className="px-6 py-4 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border-subtle)] flex flex-col gap-3">
          {!confirmOverwrite ? (
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => onReloadCloudVersion(conflict)}
                  data-testid="conflict-reload-cloud"
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <CloudDownload className="w-3.5 h-3.5" />
                  <span>Load Cloud Version (Save Local in History)</span>
                </button>

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => onSaveLocalAsCopy(conflict)}
                  data-testid="conflict-save-copy"
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border-primary)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Save Local as Separate Copy</span>
                </button>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setConfirmOverwrite(true)}
                data-testid="conflict-request-overwrite"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10 border border-red-500/25 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Overwrite Cloud Version...</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-800 font-medium">
                Confirm overwrite: Cloud Revision {remoteRevision} will be archived in Version History before your local version is saved as Revision {remoteRevision + 1}.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setConfirmOverwrite(false)}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border-primary)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    setConfirmOverwrite(false);
                    onForceOverwriteCloud(conflict);
                  }}
                  data-testid="conflict-confirm-overwrite"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Overwrite</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
