import React, { useState } from 'react';
import { DiffProposal } from '../types/project';
import { Check, X, Copy, ArrowRight, ShieldCheck, Sparkles, Cpu } from 'lucide-react';
import { extractPlainTextFromHtml, ensureSemanticHtml } from '../utils/richText';
import { getModelDefinition } from '../services/modelRegistry';

interface DiffReviewModalProps {
  proposal: DiffProposal | null;
  onAccept: (proposal: DiffProposal) => void;
  onReject: () => void;
}

export const DiffReviewModal: React.FC<DiffReviewModalProps> = ({
  proposal,
  onAccept,
  onReject,
}) => {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'proposed'>('split');

  if (!proposal) return null;

  const currentPlain = extractPlainTextFromHtml(proposal.targetText);
  const proposedPlain = extractPlainTextFromHtml(proposal.proposedText);

  const currentWordCount = currentPlain ? currentPlain.trim().split(/\s+/).filter(Boolean).length : 0;
  const proposedWordCount = proposedPlain ? proposedPlain.trim().split(/\s+/).filter(Boolean).length : 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(proposedPlain || proposal.proposedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#faf9f6] border border-[#dcd6ca] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[#e5dfd3] bg-[#f5f2ea] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-editorial text-lg sm:text-xl font-semibold text-[#1e232a] truncate">
                Editorial Suggestion
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-[#6e685f]">
                  Scope: <span className="font-medium text-[#2d333b]">{proposal.scopeDescription}</span>
                </p>
                {proposal.modelUsed && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                    <Cpu className="w-3 h-3 text-indigo-700" />
                    <span>Model: <strong>{getModelDefinition(proposal.modelUsed).displayName}</strong></span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2">
            <div className="flex bg-[#e8e2d5] p-0.5 rounded-lg text-xs font-medium text-[#4a443b]">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`px-2.5 sm:px-3 py-1 rounded-md transition-colors ${
                  viewMode === 'split' ? 'bg-white shadow-xs text-[#1e232a]' : 'hover:text-[#1e232a]'
                }`}
              >
                Side-by-Side
              </button>
              <button
                type="button"
                onClick={() => setViewMode('proposed')}
                className={`px-2.5 sm:px-3 py-1 rounded-md transition-colors ${
                  viewMode === 'proposed' ? 'bg-white shadow-xs text-[#1e232a]' : 'hover:text-[#1e232a]'
                }`}
              >
                Proposed Only
              </button>
            </div>
            <button
              type="button"
              onClick={onReject}
              className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center text-[#736c61] hover:text-[#2d333b] rounded-md hover:bg-[#e8e2d5] transition-colors"
              title="Close without accepting"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Editorial Rationale Banner */}
        {proposal.explanation && (
          <div className="px-6 py-2.5 bg-amber-50/70 border-b border-amber-200/60 flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-950">Editorial Rationale: </span>
              {proposal.explanation}
            </div>
          </div>
        )}

        {/* Comparison Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {viewMode === 'split' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {/* CURRENT */}
              <div className="flex flex-col rounded-lg border border-[#e5dfd3] bg-white overflow-hidden shadow-xs">
                <div className="px-4 py-2 bg-[#f4f1ea] border-b border-[#e5dfd3] flex items-center justify-between text-xs">
                  <span className="font-semibold tracking-wider uppercase text-[#615a50]">
                    Current Text
                  </span>
                  <span className="text-[#7d7568]">{currentWordCount} words</span>
                </div>
                <div className="p-3.5 sm:p-4 font-editorial text-sm text-[#443d34] leading-relaxed max-h-[380px] overflow-y-auto prose-sm">
                  {proposal.targetText ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: ensureSemanticHtml(proposal.targetText),
                      }}
                    />
                  ) : (
                    <span className="italic text-[#8c8477]">
                      [New content insertion - no previous text will be removed]
                    </span>
                  )}
                </div>
              </div>

              {/* PROPOSED */}
              <div className="flex flex-col rounded-lg border border-emerald-300 bg-white overflow-hidden shadow-xs">
                <div className="px-4 py-2 bg-emerald-50/70 border-b border-emerald-200 flex items-center justify-between text-xs">
                  <span className="font-semibold tracking-wider uppercase text-emerald-900 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Proposed Rewrite
                  </span>
                  <span className="text-emerald-800 font-medium">{proposedWordCount} words</span>
                </div>
                <div className="p-3.5 sm:p-4 font-editorial text-sm text-[#1e232a] leading-relaxed bg-emerald-50/20 max-h-[380px] overflow-y-auto prose-sm">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: ensureSemanticHtml(proposal.proposedText),
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-300 bg-white overflow-hidden shadow-xs">
              <div className="px-4 py-2 bg-emerald-50/70 border-b border-emerald-200 flex items-center justify-between text-xs">
                <span className="font-semibold tracking-wider uppercase text-emerald-900">
                  Proposed Text ({proposedWordCount} words)
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 text-emerald-800 hover:text-emerald-950 font-medium"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? 'Copied' : 'Copy Text'}
                </button>
              </div>
              <div className="p-4 sm:p-6 font-editorial text-base text-[#1e232a] leading-relaxed max-h-[440px] overflow-y-auto prose-base">
                <div
                  dangerouslySetInnerHTML={{
                    __html: ensureSemanticHtml(proposal.proposedText),
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[#e5dfd3] bg-[#f5f2ea] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#736c61]">
            Original text remains safe and recoverable until you accept.
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 min-h-[36px] text-xs font-medium text-[#4a443b] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#eae4d7] transition-colors inline-flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={onReject}
              className="px-3 sm:px-4 py-2 min-h-[36px] text-xs font-medium text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors inline-flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>
            <button
              type="button"
              onClick={() => onAccept(proposal)}
              className="px-4 sm:px-5 py-2 min-h-[36px] text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2e3743] rounded-lg transition-colors shadow-xs inline-flex items-center gap-1.5"
            >
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Accept & Apply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
