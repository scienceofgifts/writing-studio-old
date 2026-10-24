import React, { useEffect } from 'react';
import { AlertTriangle, Save, Trash2, ArrowLeft, Loader2 } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  projectTitle: string;
  isSaving?: boolean;
  onSaveAndLeave: () => void | Promise<void>;
  onDiscardAndLeave: () => void;
  onStay: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  projectTitle,
  isSaving = false,
  onSaveAndLeave,
  onDiscardAndLeave,
  onStay,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSaving) {
        onStay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onStay]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
    >
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-600 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3
                id="unsaved-changes-title"
                className="text-lg font-serif font-semibold text-[var(--color-text-primary)] leading-snug"
              >
                Unsaved changes
              </h3>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">
                You have unsaved changes in{' '}
                <span className="font-medium text-[var(--color-text-primary)]">
                  “{projectTitle || 'Untitled Project'}”
                </span>
                . Would you like to save your work before leaving?
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border-subtle)] flex flex-col sm:flex-row-reverse items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={onSaveAndLeave}
            data-testid="unsaved-modal-save-and-leave"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[var(--color-accent-primary)] hover:opacity-90 rounded-lg shadow-xs transition-all cursor-pointer disabled:opacity-60"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save and leave</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onDiscardAndLeave}
            data-testid="unsaved-modal-discard"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10 border border-red-500/25 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Discard changes</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onStay}
            data-testid="unsaved-modal-stay"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors cursor-pointer sm:mr-auto disabled:opacity-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Stay</span>
          </button>
        </div>
      </div>
    </div>
  );
};
