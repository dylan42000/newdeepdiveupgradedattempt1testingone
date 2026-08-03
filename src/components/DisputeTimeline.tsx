/**
 * Dispute Timeline Component
 * Visualizes per-item round history as a horizontal timeline.
 * Shows: round #, strategy, sent date, bureau response, outcome, deadline status.
 */

import React, { useState } from 'react';
import type { NegativeItem } from '../types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RoundHistoryEntry {
  round: number;
  strategy: string;
  sentDate: string | null;      // ISO date
  deadlineDate: string | null;  // ISO date
  responseDate: string | null;  // ISO date
  bureauResponse: string | null;
  outcome: 'pending' | 'deleted' | 'updated' | 'verified' | 'no_response' | 'escalated' | 'skipped';
  certifiedMailNumber?: string;
  notes?: string;
}

interface DisputeTimelineProps {
  item: NegativeItem;
  /** Per-round history entries (up to 6) */
  rounds: RoundHistoryEntry[];
  /** Compact mode for use inside tables */
  compact?: boolean;
  onRoundClick?: (round: RoundHistoryEntry) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const OUTCOME_CONFIG: Record<RoundHistoryEntry['outcome'], {
  bg: string; border: string; text: string; icon: string; label: string;
}> = {
  pending:     { bg: 'bg-blue-900/40',    border: 'border-blue-600',    text: 'text-blue-300',    icon: '⏳', label: 'Pending' },
  deleted:     { bg: 'bg-emerald-900/40', border: 'border-emerald-500', text: 'text-emerald-300', icon: '✅', label: 'Deleted' },
  updated:     { bg: 'bg-teal-900/40',    border: 'border-teal-500',    text: 'text-teal-300',    icon: '✏️', label: 'Updated' },
  verified:    { bg: 'bg-yellow-900/40',  border: 'border-yellow-600',  text: 'text-yellow-300',  icon: '🔄', label: 'Verified' },
  no_response: { bg: 'bg-orange-900/40',  border: 'border-orange-500',  text: 'text-orange-300',  icon: '📭', label: 'No Response' },
  escalated:   { bg: 'bg-red-900/40',     border: 'border-red-500',     text: 'text-red-300',     icon: '⚠️', label: 'Escalated' },
  skipped:     { bg: 'bg-gray-800',       border: 'border-gray-600',    text: 'text-gray-500',    icon: '⏭', label: 'Skipped' },
};

const ROUND_LABELS: Record<number, { name: string; short: string }> = {
  1: { name: 'Round 1 — Discovery Strike',     short: 'R1' },
  2: { name: 'Round 2 — Verification Demand',  short: 'R2' },
  3: { name: 'Round 3 — Furnisher Bypass',     short: 'R3' },
  4: { name: 'Round 4 — CFPB + AG Triple',     short: 'R4' },
  5: { name: 'Round 5 — Nuclear Option',       short: 'R5' },
  6: { name: 'Round 6 — Final Demand',         short: 'R6' },
};

function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function DisputeTimeline({ item, rounds, compact = false, onRoundClick }: DisputeTimelineProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (compact) {
    // Compact mode: small colored dots row
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5, 6].map(r => {
          const entry = rounds.find(rd => rd.round === r);
          if (!entry) {
            return (
              <div key={r} className="w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                <span className="text-gray-600 text-xs">{r}</span>
              </div>
            );
          }
          const cfg = OUTCOME_CONFIG[entry.outcome];
          return (
            <div
              key={r}
              className={`w-5 h-5 rounded-full ${cfg.bg} border ${cfg.border} flex items-center justify-center cursor-pointer`}
              title={`Round ${r}: ${cfg.label}${entry.sentDate ? ` — Sent ${formatShortDate(entry.sentDate)}` : ''}`}
              onClick={() => onRoundClick?.(entry)}
            >
              <span className="text-xs">{cfg.icon}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Full timeline
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">{item.creditorName ?? 'Unknown Account'}</h3>
          <p className="text-xs text-gray-400">{item.typeOfNegative} · {item.creditBureau?.join(', ')}</p>
        </div>
        <div className={`text-xs px-2 py-0.5 rounded-full ${
          item.disputeStatus === 'Deleted' || item.disputeStatus === 'Won'
            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40'
            : 'bg-blue-900/40 text-blue-300 border border-blue-700/40'
        }`}>
          {item.disputeStatus}
        </div>
      </div>

      {/* Timeline track */}
      <div className="relative">
        {/* Connector line */}
        <div className="absolute top-5 left-5 right-5 h-0.5 bg-gray-700 z-0" />

        <div className="relative z-10 flex justify-between items-start gap-1">
          {[1, 2, 3, 4, 5, 6].map(r => {
            const entry = rounds.find(rd => rd.round === r);
            const roundInfo = ROUND_LABELS[r];
            const isExpanded = expanded === r;

            if (!entry) {
              return (
                <div key={r} className="flex flex-col items-center" style={{ width: '14%' }}>
                  <div className="w-10 h-10 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center text-gray-600 text-xs font-bold">
                    R{r}
                  </div>
                  <div className="text-xs text-gray-700 mt-1 text-center">{roundInfo.short}</div>
                </div>
              );
            }

            const cfg = OUTCOME_CONFIG[entry.outcome];
            const deadline = entry.deadlineDate ? daysUntil(entry.deadlineDate) : null;
            const isOverdue = deadline !== null && deadline < 0;
            const isUrgent = deadline !== null && deadline >= 0 && deadline <= 5;

            return (
              <div
                key={r}
                className="flex flex-col items-center cursor-pointer"
                style={{ width: '14%' }}
                onClick={() => setExpanded(isExpanded ? null : r)}
              >
                {/* Node */}
                <div className={`w-10 h-10 rounded-full ${cfg.bg} border-2 ${cfg.border} flex items-center justify-center text-base transition-transform hover:scale-110`}>
                  {cfg.icon}
                </div>

                {/* Label */}
                <div className={`text-xs font-semibold mt-1 text-center ${cfg.text}`}>{roundInfo.short}</div>

                {/* Deadline badge */}
                {entry.outcome === 'pending' && deadline !== null && (
                  <div className={`text-xs mt-0.5 font-mono ${
                    isOverdue ? 'text-red-400' : isUrgent ? 'text-orange-400' : 'text-gray-500'
                  }`}>
                    {isOverdue ? `${Math.abs(deadline)}d OD` : `${deadline}d`}
                  </div>
                )}

                {/* Expanded detail card */}
                {isExpanded && (
                  <div className={`absolute mt-14 w-48 ${cfg.bg} border ${cfg.border} rounded-lg p-2 z-20 shadow-xl text-xs`}
                       style={{ left: '50%', transform: 'translateX(-50%)' }}>
                    <div className={`font-bold mb-1 ${cfg.text}`}>{roundInfo.name}</div>
                    {entry.strategy && <div className="text-gray-400">Strategy: <span className="text-white">{entry.strategy}</span></div>}
                    {entry.sentDate && <div className="text-gray-400">Sent: <span className="text-white">{formatShortDate(entry.sentDate)}</span></div>}
                    {entry.deadlineDate && <div className="text-gray-400">Deadline: <span className={isOverdue ? 'text-red-400' : 'text-white'}>{formatShortDate(entry.deadlineDate)}</span></div>}
                    {entry.responseDate && <div className="text-gray-400">Response: <span className="text-white">{formatShortDate(entry.responseDate)}</span></div>}
                    {entry.bureauResponse && <div className="text-gray-400">Bureau: <span className="text-white">{entry.bureauResponse}</span></div>}
                    {entry.certifiedMailNumber && <div className="text-gray-400">CMRRR: <span className="text-gray-300 font-mono text-xs">{entry.certifiedMailNumber}</span></div>}
                    {entry.notes && <div className="text-gray-400 mt-1 italic">{entry.notes}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary stats */}
      <div className="mt-6 flex gap-3 text-xs">
        <div className="flex-1 bg-gray-800 rounded p-2 text-center">
          <div className="text-white font-bold">{rounds.length}</div>
          <div className="text-gray-500">Rounds</div>
        </div>
        <div className="flex-1 bg-gray-800 rounded p-2 text-center">
          <div className="text-emerald-400 font-bold">{rounds.filter(r => r.outcome === 'deleted').length}</div>
          <div className="text-gray-500">Deletions</div>
        </div>
        <div className="flex-1 bg-gray-800 rounded p-2 text-center">
          <div className="text-yellow-400 font-bold">{rounds.filter(r => r.outcome === 'verified').length}</div>
          <div className="text-gray-500">Verified</div>
        </div>
        <div className="flex-1 bg-gray-800 rounded p-2 text-center">
          <div className="text-blue-400 font-bold">{rounds.filter(r => r.outcome === 'pending').length}</div>
          <div className="text-gray-500">Active</div>
        </div>
      </div>
    </div>
  );
}
