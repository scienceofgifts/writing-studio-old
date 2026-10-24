/**
 * Science of Gifts - Firebase Unauthorized Domain Guidance Modal
 * Displayed when Google Sign-In fails with `auth/unauthorized-domain`.
 * Provides 1-click domain copying, direct links to the Firebase Console,
 * clear 4-step instructions, and local-first drafting reassurance.
 */

import React, { useState } from 'react';
import {
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  X,
  CheckCircle2,
  Sparkles,
  Info,
} from 'lucide-react';

interface UnauthorizedDomainModalProps {
  isOpen: boolean;
  domain: string;
  projectId: string;
  consoleUrl: string;
  onClose: () => void;
  onRetry: () => void;
  isRetrying?: boolean;
}

export const UnauthorizedDomainModal: React.FC<UnauthorizedDomainModalProps> = ({
  isOpen,
  domain,
  projectId,
  consoleUrl,
  onClose,
  onRetry,
  isRetrying = false,
}) => {
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentHost = domain || (typeof window !== 'undefined' ? window.location.hostname : '');

  // Extract regional domain if available (e.g., "asia-southeast1.run.app")
  let regionalDomain: string | null = null;
  if (currentHost.includes('.run.app')) {
    const parts = currentHost.split('.');
    if (parts.length >= 3) {
      // e.g. ["ais-dev-uevqdqmlhnbvbusioxutlm-151789588029", "asia-southeast1", "run", "app"]
      regionalDomain = parts.slice(1).join('.');
    }
  }

  const handleCopy = (text: string, key: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedDomain(key);
      setTimeout(() => setCopiedDomain(null), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-xl bg-white border border-[#dcd6ca] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 bg-gradient-to-r from-amber-50 to-[#faf9f6] border-b border-[#e5dfd3]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 text-amber-900 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-amber-800" />
            </div>
            <div>
              <h3 className="font-editorial text-lg font-bold text-[#1e232a]">
                Firebase Domain Authorization Needed
              </h3>
              <p className="text-xs text-[#736c61]">
                Google Sign-In requires your preview domain to be registered in Firebase Console
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#8a8275] hover:text-[#1e232a] hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs text-[#3a3f47]">
          {/* Explanation Banner */}
          <div className="p-3 bg-[#faf9f6] border border-[#e5dfd3] rounded-xl flex items-start gap-2.5">
            <Info className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            <div className="space-y-1 text-[11px] leading-relaxed text-[#5c5447]">
              <span>
                Firebase Authentication blocks OAuth sign-ins from unrecognized web origins to prevent domain spoofing.
                To enable cloud synchronization on this preview URL, add this domain to your project's{' '}
                <strong className="text-[#1e232a]">Authorized domains</strong> list.
              </span>
            </div>
          </div>

          {/* Domain Copy Box */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#736c61]">
              Domain to Add
            </label>
            <div className="p-3 bg-[#f5f2eb] border border-[#dcd6ca] rounded-xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase font-bold text-[#8a8275]">
                    Current Container Hostname:
                  </div>
                  <div className="font-mono text-xs text-[#1e232a] font-semibold truncate select-all">
                    {currentHost}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(currentHost, 'current')}
                  className="px-3 py-1.5 bg-white hover:bg-stone-50 border border-[#dcd6ca] text-[#1e232a] font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer shadow-2xs text-xs"
                >
                  {copiedDomain === 'current' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#5c5447]" />
                      <span>Copy Domain</span>
                    </>
                  )}
                </button>
              </div>

              {regionalDomain && (
                <div className="pt-2 border-t border-[#e2dcce] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase font-bold text-amber-800 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      <span>Recommended (Authorizes All Regional Previews):</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#5c5447] truncate select-all">
                      {regionalDomain}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(regionalDomain!, 'regional')}
                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 font-medium rounded-lg transition-colors inline-flex items-center gap-1 shrink-0 cursor-pointer text-[11px]"
                    title="Add this so future container rebuilds are automatically authorized"
                  >
                    {copiedDomain === 'regional' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-700">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-amber-800" />
                        <span>Copy Regional</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 4-Step Instructions */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#736c61]">
              Quick Setup Steps (Under 1 minute)
            </div>
            <ol className="p-3.5 bg-white border border-[#e5dfd3] rounded-xl space-y-2.5 text-xs text-[#4b453a] list-decimal list-inside leading-relaxed">
              <li>
                Click{' '}
                <a
                  href={consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                >
                  Open Firebase Console Settings
                  <ExternalLink className="w-3 h-3 inline" />
                </a>{' '}
                for project <code className="px-1 py-0.5 bg-stone-100 rounded text-[11px] font-mono text-stone-800">{projectId}</code>.
              </li>
              <li>
                Scroll down to the <strong className="text-[#1e232a]">Authorized domains</strong> section and click{' '}
                <strong className="text-[#1e232a]">Add domain</strong>.
              </li>
              <li>
                Paste <code className="px-1 py-0.5 bg-stone-100 rounded text-[11px] font-mono text-stone-800">{regionalDomain || currentHost}</code> and click <strong className="text-[#1e232a]">Save</strong>.
              </li>
              <li>
                Return to this tab and click <strong className="text-[#1e232a]">Retry Google Sign-In</strong> below.
              </li>
            </ol>
          </div>

          {/* Local-First Peace of Mind Reassurance */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed text-emerald-950">
              <span className="font-semibold">Local-First Draft Protection is Active:</span>
              <p className="text-emerald-900 mt-0.5">
                All writing, manual saves, version history snapshots, and editorial tools continue working 100% locally in your browser storage. You can continue writing without signing in.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 bg-[#f8f6f0] border-t border-[#e5dfd3]">
          <a
            href={consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-stone-50 border border-[#dcd6ca] text-[#1e232a] font-semibold rounded-xl text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <span>Open Firebase Console</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#5c5447]" />
          </a>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-[#5c5447] hover:text-[#1e232a] hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
            >
              Continue in Local Mode
            </button>

            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="px-4 py-2 bg-[#1e232a] hover:bg-[#2d343f] text-[#f7f5ef] font-semibold rounded-xl text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
            >
              {isRetrying ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Google Sign-In</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
