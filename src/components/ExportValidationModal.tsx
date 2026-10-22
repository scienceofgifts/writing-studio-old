/**
 * Science of Gifts - Article Export Validation Modal
 * Validates article before exporting, displays missing fields and editorial warnings,
 * and allows opening Article Details to address issues or exporting anyway.
 */

import React, { useEffect } from 'react';
import { ExportValidationResult } from '../services/articleExport';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Sliders,
  Download,
  FileCheck2,
} from 'lucide-react';

interface ExportValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  validation: ExportValidationResult;
  formatType: 'cms_json' | 'markdown' | 'copy_json';
  onProceedWithExport: () => void;
  onOpenArticleDetails: () => void;
}

export const ExportValidationModal: React.FC<ExportValidationModalProps> = ({
  isOpen,
  onClose,
  validation,
  formatType,
  onProceedWithExport,
  onOpenArticleDetails,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const formatTitle =
    formatType === 'cms_json'
      ? 'CMS JSON'
      : formatType === 'markdown'
      ? 'Markdown'
      : 'Copy CMS JSON';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-2xs animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#faf9f6] border border-[#dcd6ca] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#e5dfd3] bg-[#f5f2ea] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                !validation.isValid
                  ? 'bg-rose-100 border border-rose-200 text-rose-800'
                  : 'bg-amber-100 border border-amber-200 text-amber-800'
              }`}
            >
              {!validation.isValid ? (
                <AlertCircle className="w-4 h-4 text-rose-700" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-700" />
              )}
            </div>
            <div>
              <h3 className="font-editorial text-lg font-semibold text-[#1e232a]">
                Article Export Validation ({formatTitle})
              </h3>
              <p className="text-xs text-[#736c61]">
                {!validation.isValid
                  ? 'Missing required fields must be resolved before export.'
                  : 'The article is exportable, but contains recommended fields to review.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#736c61] hover:text-[#2d333b] rounded-md hover:bg-[#e8e2d5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Issue List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {validation.issues.map((issue) => {
            const isCrit = issue.severity === 'critical';
            const isWarn = issue.severity === 'warning';

            return (
              <div
                key={issue.id}
                className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                  isCrit
                    ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                    : isWarn
                    ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                    : 'bg-blue-50/70 border-blue-200 text-blue-950'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-xs">
                    {isCrit ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                    ) : isWarn ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    ) : (
                      <Info className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                    )}
                    <span>{issue.title}</span>
                  </div>
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-xs shrink-0 ${
                      isCrit
                        ? 'bg-rose-200/80 text-rose-950'
                        : isWarn
                        ? 'bg-amber-200/80 text-amber-950'
                        : 'bg-blue-200/80 text-blue-950'
                    }`}
                  >
                    {issue.field}
                  </span>
                </div>

                <p className="text-[11px] text-[#4a443b] leading-relaxed">
                  {issue.message}
                </p>

                <div className="text-[11px] font-medium text-[#736c61] pt-1 border-t border-black/5 flex items-center gap-1">
                  <span className="font-semibold text-[#1e232a]">Action:</span>
                  <span>{issue.suggestedAction}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-[#e5dfd3] bg-[#f5f2ea] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenArticleDetails();
            }}
            className="w-full sm:w-auto px-3.5 py-2 rounded-lg bg-white border border-[#dcd6ca] text-[#2b251d] font-semibold text-xs hover:bg-[#faf9f6] transition-colors inline-flex items-center justify-center gap-1.5 shadow-2xs"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-800" />
            <span>Open Article Details</span>
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-semibold text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5] transition-colors"
            >
              Cancel
            </button>

            {validation.canExport && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onProceedWithExport();
                }}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-[#1e232a] hover:bg-[#2d3744] text-white font-semibold text-xs transition-colors inline-flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Download className="w-3.5 h-3.5 text-amber-300" />
                <span>Export Anyway</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
