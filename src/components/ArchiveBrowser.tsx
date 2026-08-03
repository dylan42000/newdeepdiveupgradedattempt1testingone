/**
 * ArchiveBrowser.tsx — Encrypted Vault File Browser
 * Browse reports, letters, and responses stored in the encrypted vault.
 */

import React, { useState } from 'react';
import {
  Archive, FileText, Mail, MessageSquare, Shield,
  Download, Trash2, AlertTriangle, CheckCircle, FolderOpen
} from 'lucide-react';
import type { ArchiveDirectory } from '../types/creditRepair';

interface ArchiveBrowserProps {
  archive: ArchiveDirectory | null;
  isLoading?: boolean;
  onExport?: (profileId: string) => void;
  onVerifyIntegrity?: () => void;
  onDeleteResponse?: (responseId: string) => void;
}

type Tab = 'reports' | 'letters' | 'responses';

export const ArchiveBrowser: React.FC<ArchiveBrowserProps> = ({
  archive,
  isLoading = false,
  onExport,
  onVerifyIntegrity,
  onDeleteResponse,
}) => {
  const [tab, setTab] = useState<Tab>('letters');

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
        <Archive className="w-8 h-8 text-cyan-400 mx-auto mb-2 animate-pulse" />
        <p className="text-gray-400 text-sm">Loading vault...</p>
      </div>
    );
  }

  if (!archive) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
        <FolderOpen className="w-8 h-8 text-gray-600 mx-auto mb-2" />
        <p className="text-gray-500 text-sm">No vault archive found</p>
        <p className="text-gray-600 text-xs mt-1">Archive is created automatically when you first send a dispute letter</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Vault summary */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-center">
          <FileText className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-gray-200 font-medium text-lg">{archive.reports.length}</p>
          <p className="text-gray-500 text-xs">Reports</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-center">
          <Mail className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
          <p className="text-gray-200 font-medium text-lg">{archive.letters.length}</p>
          <p className="text-gray-500 text-xs">Letters</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-center">
          <MessageSquare className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
          <p className="text-gray-200 font-medium text-lg">{archive.responses.length}</p>
          <p className="text-gray-500 text-xs">Responses</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => onVerifyIntegrity?.()}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-cyan-400 hover:border-cyan-700 transition-colors"
        >
          <Shield className="w-3.5 h-3.5" />
          Verify Integrity
        </button>
        <button
          onClick={() => onExport?.(archive.profileId)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export Vault
        </button>
        <span className="ml-auto text-xs text-gray-500 self-center">
          {formatBytes(archive.totalSizeBytes)} total
        </span>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-gray-800 overflow-hidden text-xs">
        {(['reports', 'letters', 'responses'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 capitalize transition-colors ${
              tab === t ? 'bg-cyan-900/50 text-cyan-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'reports' && (
        <div className="space-y-1.5">
          {archive.reports.length === 0 ? (
            <EmptyState message="No reports archived yet" />
          ) : (
            archive.reports.map(r => (
              <div key={r.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">{r.fileName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.bureau} · {new Date(r.uploadDate).toLocaleDateString()} · {formatBytes(r.sizeBytes)}
                    </p>
                  </div>
                  <HashBadge hash={r.sha256Hash} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'letters' && (
        <div className="space-y-1.5">
          {archive.letters.length === 0 ? (
            <EmptyState message="No letters archived yet" />
          ) : (
            archive.letters.map(l => (
              <div key={l.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">
                      Pass {l.letterData.passNumber} — {l.letterData.itemName}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {l.letterData.targetName} · {new Date(l.archivedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <HashBadge hash={l.sha256Hash} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'responses' && (
        <div className="space-y-1.5">
          {archive.responses.length === 0 ? (
            <EmptyState message="No bureau responses archived yet" />
          ) : (
            archive.responses.map(r => (
              <div key={r.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                <div className="flex items-start gap-2">
                  <MessageSquare className={`w-4 h-4 flex-shrink-0 ${
                    r.outcome === 'deleted' ? 'text-green-400' :
                    r.outcome === 'verified' ? 'text-orange-400' :
                    r.outcome === 'no_response' ? 'text-red-400' : 'text-yellow-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-200 truncate">{r.bureau} Response</p>
                      <OutcomeBadge outcome={r.outcome} />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(r.receivedDate).toLocaleDateString()}
                      {r.metadata.notesFromUser && ` · ${r.metadata.notesFromUser}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <HashBadge hash={r.sha256Hash} />
                    {onDeleteResponse && (
                      <button
                        onClick={() => onDeleteResponse(r.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                        title="Delete response record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <p className="text-xs text-gray-600 text-center">
        Last updated: {new Date(archive.lastUpdated).toLocaleString()}
      </p>
    </div>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────────

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-lg border border-dashed border-gray-800 p-6 text-center">
    <p className="text-gray-500 text-sm">{message}</p>
  </div>
);

const HashBadge: React.FC<{ hash: string }> = ({ hash }) => (
  <div className="flex items-center gap-1 text-xs text-gray-600" title={`SHA-256: ${hash}`}>
    <CheckCircle className="w-3 h-3 text-green-700" />
    <span className="hidden sm:inline">{hash.slice(0, 8)}</span>
  </div>
);

const OUTCOME_CONFIG = {
  deleted: { label: 'Deleted', cls: 'text-green-400 bg-green-900/30 border-green-800' },
  verified: { label: 'Verified', cls: 'text-orange-400 bg-orange-900/30 border-orange-800' },
  updated: { label: 'Updated', cls: 'text-blue-400 bg-blue-900/30 border-blue-800' },
  no_response: { label: 'No Response', cls: 'text-red-400 bg-red-900/30 border-red-800' },
};

const OutcomeBadge: React.FC<{ outcome: string }> = ({ outcome }) => {
  const cfg = OUTCOME_CONFIG[outcome as keyof typeof OUTCOME_CONFIG] ?? { label: outcome, cls: 'text-gray-400 bg-gray-900/30 border-gray-700' };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${cfg.cls}`}>{cfg.label}</span>
  );
};
