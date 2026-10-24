/**
 * Science of Gifts - Cloud Sync Control Component
 * Displayed in the top navigation bar to manage Google Sign-In, Cloud Sync status,
 * offline indications, and retry operations.
 */

import React, { useState, useEffect, useRef } from 'react';
import { syncEngine, SyncStatusInfo, UnauthorizedDomainInfo } from '../services/syncEngine';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, LogOut, User, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { UnauthorizedDomainModal } from './UnauthorizedDomainModal';
import { toast } from '../services/toastService';

export const CloudSyncBar: React.FC = () => {
  const [syncInfo, setSyncInfo] = useState<SyncStatusInfo>(syncEngine.getStatusInfo());
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isUnauthorizedModalOpen, setIsUnauthorizedModalOpen] = useState(false);
  const [unauthorizedInfo, setUnauthorizedInfo] = useState<UnauthorizedDomainInfo | null>(
    syncEngine.getStatusInfo().unauthorizedDomainInfo || null
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = syncEngine.subscribe((info) => {
      setSyncInfo(info);
      if (info.user) {
        setIsSigningIn(false);
        setIsUnauthorizedModalOpen(false);
      }
      if (info.unauthorizedDomainInfo) {
        setUnauthorizedInfo(info.unauthorizedDomainInfo);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await syncEngine.login();
    } catch (err: any) {
      setIsSigningIn(false);
      if (
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request'
      ) {
        // User closed the popup, silently reset state without error toast
        return;
      }
      if (err?.code === 'auth/unauthorized-domain') {
        const domain = err.unauthorizedDomain || (typeof window !== 'undefined' ? window.location.hostname : '');
        const projectId = err.firebaseProjectId || 'eloquent-tracer-2vxch';
        const consoleUrl = err.consoleUrl || `https://console.firebase.google.com/project/${projectId}/authentication/settings`;
        setUnauthorizedInfo({ domain, projectId, consoleUrl });
        setIsUnauthorizedModalOpen(true);
        return;
      }
      if (err?.code === 'auth/popup-blocked') {
        toast.warning('Sign-in Popup Blocked', 'Please allow popups for this domain to sign in with Google.');
      } else {
        toast.error('Sign-In Failed', err?.message || 'Could not sign in with Google.');
      }
    }
  };

  const handleSignOut = async () => {
    setIsMenuOpen(false);
    await syncEngine.logout();
  };

  const handleRetry = async () => {
    await syncEngine.retrySync();
  };

  const formatRelativeTime = (isoString: string | null) => {
    if (!isoString) return 'Just now';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 10) return 'Just now';
      if (diffSec < 60) return `${diffSec}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHours = Math.floor(diffMin / 60);
      return `${diffHours}h ago`;
    } catch {
      return 'Recently';
    }
  };

  // 1. Signed Out
  if (!syncInfo.user) {
    const activeDomainInfo = unauthorizedInfo || syncInfo.unauthorizedDomainInfo;
    return (
      <div className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleSignIn}
          disabled={isSigningIn}
          className="px-2.5 py-1.5 text-xs font-semibold text-[#5c5447] hover:text-[#1e232a] bg-[#efebe2] hover:bg-[#eae4d7] border border-[#dcd6ca] rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
          title="Sign in with Google to synchronize articles and guides across devices"
        >
          {isSigningIn ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-800" />
              <span>Connecting...</span>
            </>
          ) : (
            <>
              <Cloud className="w-3.5 h-3.5 text-amber-900" />
              <span>Cloud Sync</span>
            </>
          )}
        </button>

        {activeDomainInfo && (
          <button
            type="button"
            onClick={() => setIsUnauthorizedModalOpen(true)}
            className="px-2 py-1 text-[11px] font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
            title="Preview domain needs authorization in Firebase Console. Click to view instructions."
          >
            <AlertTriangle className="w-3 h-3 text-amber-700" />
            <span className="hidden sm:inline">Authorize Domain</span>
          </button>
        )}

        {isUnauthorizedModalOpen && activeDomainInfo && (
          <UnauthorizedDomainModal
            isOpen={isUnauthorizedModalOpen}
            domain={activeDomainInfo.domain}
            projectId={activeDomainInfo.projectId}
            consoleUrl={activeDomainInfo.consoleUrl}
            onClose={() => setIsUnauthorizedModalOpen(false)}
            onRetry={async () => {
              try {
                await handleSignIn();
              } catch {
                // Keep modal open or let error toast handle
              }
            }}
            isRetrying={isSigningIn}
          />
        )}
      </div>
    );
  }

  // 2. Signed In State UI
  const userEmail = syncInfo.user.email || 'Signed in';
  const initial = (userEmail[0] || 'U').toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        className={`px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer shadow-2xs ${
          syncInfo.status === 'error'
            ? 'bg-rose-50 border-rose-300 text-rose-900 hover:bg-rose-100'
            : syncInfo.status === 'offline'
            ? 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100'
            : 'bg-white border-[#dcd6ca] text-[#1e232a] hover:bg-[#f8f6f0]'
        }`}
        title={`Cloud Sync Status: ${syncInfo.status.toUpperCase()} (${userEmail})`}
      >
        {/* Status Indicator Icon */}
        {syncInfo.status === 'syncing' ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700 shrink-0" />
        ) : syncInfo.status === 'error' ? (
          <AlertTriangle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
        ) : syncInfo.status === 'offline' ? (
          <CloudOff className="w-3.5 h-3.5 text-amber-800 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
        )}

        {/* User avatar circle */}
        <div className="w-4 h-4 rounded-full bg-[#1e232a] text-[#f7f5ef] font-bold text-[10px] flex items-center justify-center shrink-0">
          {initial}
        </div>

        <span className="hidden sm:inline font-semibold text-xs truncate max-w-[110px]">
          {userEmail.split('@')[0]}
        </span>
      </button>

      {/* Sync Status Dropdown */}
      {isMenuOpen && (
        <div className="absolute right-0 mt-1.5 w-64 bg-white border border-[#dcd6ca] rounded-xl shadow-xl py-2.5 px-3 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 space-y-2.5">
          <div className="border-b border-[#f0ede6] pb-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8a8275]">
              Cloud Account
            </div>
            <div className="font-semibold text-[#1e232a] truncate mt-0.5" title={userEmail}>
              {userEmail}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#736c61]">Sync Status:</span>
              <span className="font-semibold capitalize text-[#1e232a] flex items-center gap-1">
                {syncInfo.status === 'synced' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                {syncInfo.status === 'syncing' && <Loader2 className="w-3 h-3 animate-spin text-amber-600" />}
                {syncInfo.status === 'error' && <AlertTriangle className="w-3 h-3 text-rose-600" />}
                {syncInfo.status === 'offline' && <CloudOff className="w-3 h-3 text-amber-600" />}
                {syncInfo.status}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#736c61]">Last Synced:</span>
              <span className="font-mono text-[#5c5447] text-[10px]">
                {formatRelativeTime(syncInfo.lastSyncedAt)}
              </span>
            </div>

            {syncInfo.errorMessage && (
              <div className="p-2 bg-rose-50 border border-rose-200 text-rose-900 rounded-md text-[11px] leading-tight">
                {syncInfo.errorMessage}
              </div>
            )}
          </div>

          {/* Retry Button */}
          {syncInfo.status === 'error' && (
            <button
              type="button"
              onClick={handleRetry}
              className="w-full py-1.5 px-2 bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold rounded-md text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Sync Now</span>
            </button>
          )}

          {/* Sign Out Action */}
          <div className="pt-2 border-t border-[#f0ede6]">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full py-1.5 px-2 hover:bg-rose-50 text-rose-800 hover:text-rose-950 font-medium rounded-md text-xs transition-colors flex items-center justify-between cursor-pointer"
            >
              <span>Sign Out</span>
              <LogOut className="w-3.5 h-3.5" />
            </button>
            <p className="text-[10px] text-[#8a8275] mt-1 leading-tight">
              Signing out pauses cloud sync. All local records remain safe on this device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
