/**
 * AutoPilotDashboard.tsx — Simplified, Guided Dispute Command Center
 *
 * Design philosophy:
 *  - One page, no internal tabs, no jargon
 *  - Clear setup checklist before first run
 *  - Show exactly what will be disputed next
 *  - One-click response logging with celebration for deletions
 *  - Verified items clearly shown as "back of line"
 */

import React, { useState, useEffect } from 'react';
import {
  Play, Pause, CheckCircle, AlertTriangle, Clock, Target,
  ChevronDown, ChevronUp, RotateCcw, ThumbsUp,
  Zap, Timer, Settings2, Info, PartyPopper, Lock,
  ArrowRight, FileText, HelpCircle, Search, X, History, Shield, Calendar,
} from 'lucide-react';
import type { NegativeItem } from '../types';
import type {
  AutoPilotEngineState,
  AutoPilotSettingsV3,
  AutoPilotCycleResult,
  HoldQueueEntry,
  FCRADeadline,
  PassNumber,
} from '../types/creditRepair';
import type { CycleAuditRecord } from '../services/cycleAuditService';
import type { EvidenceDoc } from '../services/evidenceGateService';
import { evaluateEvidenceReadiness } from '../services/evidenceGateService';
import { calculateHealthReport } from '../services/autoPilotHealthMonitor';
import { getOpenDisputeResolutionTasks, type DisputeResolutionTask } from '../services/disputeResolutionQueue';

export type ResponseOutcome = 'Deleted' | 'Updated' | 'Verified' | 'NoResponse';

export interface AutoPilotDashboardProps {
  engineState: AutoPilotEngineState;
  settings: AutoPilotSettingsV3;
  items: NegativeItem[];
  holdEntries: HoldQueueEntry[];
  deadlines: FCRADeadline[];
  passNumbers: Record<string, PassNumber>;
  lastCycleResult: AutoPilotCycleResult | null;
  profileId: string;
  profileComplete: boolean;
  onRunCycle: () => void;
  onDryRunCycle?: (previewItems: DryRunPreviewItem[]) => void;
  onEnableToggle: (enabled: boolean) => void;
  onUpdateSettings: (updates: Partial<AutoPilotSettingsV3>) => void;
  onLogResponse: (itemId: string, outcome: ResponseOutcome, bureau: string) => void;
  onViewLetters?: () => void;
  /** Sprint 4: Cycle history from IndexedDB for persistent audit trail */
  cycleHistory?: CycleAuditRecord[];
  /** Sprint 4: Vault documents for Evidence Readiness Meter */
  vaultDocs?: EvidenceDoc[];
  /** Legacy optional props — kept for backward compatibility, no-op if not provided */
  onViewHistory?: () => void;
}

export interface DryRunPreviewItem {
  itemName: string;
  passNumber: PassNumber;
  targets: string[];
  bureaus: string[];
}

const PASS_META: Record<PassNumber, { label: string; desc: string; color: string; bg: string }> = {
  1: { label: 'Round 1 — Accuracy Challenge', desc: 'Professional first contact. We dispute accuracy and demand proof.', color: 'text-blue-400', bg: 'bg-blue-950/30 border-blue-900' },
  2: { label: 'Round 2 — Method of Verification', desc: 'Demand HOW they verified it. Almost never answered correctly.', color: 'text-yellow-400', bg: 'bg-yellow-950/30 border-yellow-900' },
  3: { label: 'Round 3 — Procedural Violation', desc: 'Their investigation was defective. CFPB complaint threat added.', color: 'text-orange-400', bg: 'bg-orange-950/30 border-orange-900' },
  4: { label: 'Round 4 — Formal CFPB Intent', desc: 'Formal notice we are filing a regulatory complaint.', color: 'text-red-400', bg: 'bg-red-950/30 border-red-900' },
  5: { label: 'Round 5 — Final Legal Demand', desc: 'Maximum legal pressure. CFPB complaint pack auto-generated.', color: 'text-purple-400', bg: 'bg-purple-950/30 border-purple-900' },
  6: { label: 'Round 6 — Pre-Litigation Demand', desc: '15-day statutory deadline. Cites §616/§617 damage exposure. Final notice before legal referral.', color: 'text-rose-400', bg: 'bg-rose-950/30 border-rose-900' },
};

function passMeta(pass: number | PassNumber | undefined) {
  const key = (pass === 1 || pass === 2 || pass === 3 || pass === 4 || pass === 5 || pass === 6)
    ? pass
    : 1;
  return PASS_META[key];
}

const BUREAU_COLORS: Record<string, string> = {
  Equifax: 'bg-red-900/50 text-red-300',
  Experian: 'bg-blue-900/50 text-blue-300',
  TransUnion: 'bg-cyan-900/50 text-cyan-300',
};

export const AutoPilotDashboard: React.FC<AutoPilotDashboardProps> = ({
  engineState, settings, items, holdEntries, deadlines, passNumbers,
  lastCycleResult, profileId, profileComplete,
  onRunCycle, onDryRunCycle, onEnableToggle, onUpdateSettings, onLogResponse, onViewLetters,
  cycleHistory = [], vaultDocs = [],
}) => {
  const [confirmRun, setConfirmRun] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedResponseItem, setExpandedResponseItem] = useState<string | null>(null);
  const [celebratedItems, setCelebratedItems] = useState<Set<string>>(new Set());
  const [dryRunPreview, setDryRunPreview] = useState<DryRunPreviewItem[] | null>(null);
  const [resolutionTasks, setResolutionTasks] = useState<DisputeResolutionTask[]>(() => getOpenDisputeResolutionTasks(profileId));

  useEffect(() => {
    const refresh = () => setResolutionTasks(getOpenDisputeResolutionTasks(profileId));
    refresh();
    window.addEventListener('dispute-resolution-queue:changed', refresh);
    return () => window.removeEventListener('dispute-resolution-queue:changed', refresh);
  }, [profileId, lastCycleResult]);

  useEffect(() => {
    if (!confirmRun) return;
    const t = setTimeout(() => setConfirmRun(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRun]);

  const deletedItems = items.filter(i => i.disputeStatus === 'Deleted' || i.disputeStatus === 'Won');
  const activeItems = items.filter(i => i.disputeStatus !== 'Deleted' && i.disputeStatus !== 'Won');
  const onHoldNow = new Set(holdEntries.filter(h => new Date(h.holdExpiryDate) > new Date()).map(h => h.itemId));
  const awaitingResponse = activeItems.filter(i => onHoldNow.has(i.id));
  const coolingOff = awaitingResponse.filter(i => (i.verificationCount ?? 0) > 0);
  const readyToDispute = activeItems.filter(i => !onHoldNow.has(i.id));
  const batchSize = Math.min(Math.ceil(readyToDispute.length * settings.batchFraction), settings.maxItemsPerBatch);
  const nextBatchItems = readyToDispute.slice(0, batchSize);
  const overdueDeadlines = deadlines.filter(d => d.status === 'overdue');
  const totalItems = items.length;
  const deletedCount = deletedItems.length;
  const progressPct = totalItems > 0 ? Math.round((deletedCount / totalItems) * 100) : 0;
  const hasItems = items.length > 0;
  const setupComplete = profileComplete && hasItems && settings.enabled;
  const nextCycleFmt = engineState.nextCycleDate
    ? new Date(engineState.nextCycleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const health = calculateHealthReport({ lastCycle:engineState.lastCycleDate, staleDays:settings.staleCycleAlertDays, activeItems:activeItems.length, holds:holdEntries, deadlines, evidenceReady:vaultDocs.some(d => ['photo-id','government-id','government_id'].includes(d.category)), providerHealthy:true });

  const handleRunClick = () => {
    if (!confirmRun) { setConfirmRun(true); return; }
    setConfirmRun(false);
    onRunCycle();
  };

  const handleDryRunClick = () => {
    const preview: DryRunPreviewItem[] = nextBatchItems.map((item) => {
      const pass = (passNumbers[item.id] ?? Math.min(6, Math.max(1, item.disputeRound ?? 1))) as PassNumber;
      const bureaus = item.creditBureau ?? [];
      const targets = [
        ...bureaus,
        ...(settings.dualTargetMode && item.creditorName ? [item.creditorName] : []),
      ];
      return { itemName: item.creditorName, passNumber: pass, targets, bureaus };
    });
    if (onDryRunCycle) {
      onDryRunCycle(preview);
    } else {
      setDryRunPreview(preview);
    }
  };

  const handleLogResponse = (itemId: string, outcome: ResponseOutcome) => {
    const item = items.find(i => i.id === itemId);
    const bureau = item?.creditBureau?.[0] ?? 'Bureau';
    if (outcome === 'Deleted') setCelebratedItems(prev => new Set(prev).add(itemId));
    onLogResponse(itemId, outcome, bureau);
    setExpandedResponseItem(null);
  };

  return (
    <div className="space-y-5 pb-10">

      <div className={`rounded-2xl border p-4 ${health.grade==='A'?'border-emerald-800 bg-emerald-950/20':health.grade==='B'?'border-blue-800 bg-blue-950/20':health.grade==='C'?'border-yellow-800 bg-yellow-950/20':'border-red-800 bg-red-950/20'}`}>
        <div className="flex items-center justify-between"><div><p className="text-sm font-bold text-gray-100">AutoPilot Health</p><p className="text-xs text-gray-500">Quality, evidence, cadence, and FCRA deadline readiness</p></div><div className="text-3xl font-black text-white">{health.grade}</div></div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center"><div className="rounded-lg bg-black/20 p-2"><p className="text-lg font-bold">{health.fcraDeadlinesOverdue}</p><p className="text-[10px] text-gray-500">FCRA overdue</p></div><div className="rounded-lg bg-black/20 p-2"><p className="text-lg font-bold">{health.itemsOnHold}</p><p className="text-[10px] text-gray-500">On hold</p></div><div className="rounded-lg bg-black/20 p-2"><p className="text-lg font-bold">{health.daysSinceLastCycle ?? '—'}</p><p className="text-[10px] text-gray-500">Days since cycle</p></div></div>
        {health.recommendations.slice(0,3).map(r=><p key={r.code} className="mt-2 rounded-lg bg-black/20 px-3 py-2 text-xs text-gray-300">{r.message}</p>)}
      </div>

      {/* Proposed Actions — Strategy Why strip (Apex explainability + WCAG) */}
      {lastCycleResult?.proposedActions && lastCycleResult.proposedActions.length > 0 && (
        <section
          className="rounded-2xl border border-indigo-800/50 bg-indigo-950/20 p-4"
          aria-labelledby="strategy-why-heading"
        >
          <p id="strategy-why-heading" className="text-sm font-bold text-indigo-200 mb-1">Why Autopilot chose these actions</p>
          <p className="text-xs text-gray-500 mb-3">Per-item strategy cards from the last cycle — legal, debt-type, and risk rationale</p>
          <div className="space-y-2 max-h-64 overflow-y-auto" role="list">
            {lastCycleResult.proposedActions.map((action) => (
              <article
                key={action.itemId}
                role="listitem"
                tabIndex={0}
                className="rounded-lg border border-indigo-900/40 bg-black/20 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                aria-label={`Strategy for ${action.creditorName}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-100">{action.creditorName}</span>
                  {action.primaryAngle && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-300">{action.primaryAngle}</span>
                  )}
                  {action.frivolousRisk && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      action.frivolousRisk === 'HIGH' ? 'bg-red-900/40 text-red-300' :
                      action.frivolousRisk === 'MEDIUM' ? 'bg-yellow-900/40 text-yellow-300' :
                      'bg-emerald-900/40 text-emerald-300'
                    }`}>{action.frivolousRisk} risk</span>
                  )}
                </div>
                <ul className="list-disc list-inside space-y-0.5">
                  {action.explainWhy.slice(0, 4).map((why, idx) => (
                    <li key={idx} className="text-[11px] text-gray-400">{why}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Action Required — preflight enrichment */}
      {lastCycleResult?.itemsRequiringAction && lastCycleResult.itemsRequiringAction.length > 0 && (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-4">
          <p className="text-sm font-bold text-amber-200 mb-1">Action required before next letters</p>
          <p className="text-xs text-gray-500 mb-2">
            {lastCycleResult.itemsRequiringAction.length} item(s) blocked by pre-flight. Attach vault docs or fix DOFD/address, then re-run.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {lastCycleResult.itemsRequiringAction.map((id) => {
              const item = items.find((i) => i.id === id);
              return (
                <span key={id} className="text-[10px] px-2 py-1 rounded bg-amber-900/40 text-amber-200 border border-amber-800">
                  {item?.creditorName ?? id.slice(0, 8)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {resolutionTasks.length > 0 && (
        <section className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div><p className="text-sm font-bold text-amber-200">Dispute coverage queue</p><p className="text-xs text-gray-500">No negative item is silently dropped. Resolve the listed issue, then rerun the cycle.</p></div>
            <span className="text-xs font-mono text-amber-200">{resolutionTasks.length} OPEN</span>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {resolutionTasks.map(task => (
              <div key={task.id} className="rounded border border-amber-900/70 bg-black/20 px-3 py-2 text-xs">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-bold text-zinc-100">{task.creditorName}{task.targetName ? ` → ${task.targetName}` : ''}</span><span className="font-mono text-amber-300">{task.reason.replace('_', ' ')}</span></div>
                <p className="mt-1 text-zinc-400">{task.message}</p>
                <p className="mt-1 text-[10px] text-zinc-500">{task.retryable ? task.retryAfter ? `Auto-retry eligible after ${new Date(task.retryAfter).toLocaleTimeString()}` : 'Fix the issue, then rerun AutoPilot.' : 'Update the account facts before regenerating.'}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Dry Run Preview Modal */}
      {dryRunPreview && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-black/60 pointer-events-auto" onClick={() => setDryRunPreview(null)} />
          <div className="relative bg-gray-950 border border-cyan-800 rounded-2xl w-full max-w-lg mx-4 p-5 pointer-events-auto shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-cyan-300">DRY RUN PREVIEW — {dryRunPreview.length} item(s)</h3>
              </div>
              <button
                onClick={() => setDryRunPreview(null)}
                title="Close preview"
                aria-label="Close preview"
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              This shows what letters would be generated — nothing is created or mailed. Review the plan then hit <strong className="text-white">Run For Real</strong> when ready.
            </p>
            <div className="space-y-2">
              {dryRunPreview.map((item, i) => {
                const meta = passMeta(item.passNumber);
                return (
                  <div key={i} className={`rounded-xl border px-4 py-3 ${meta.bg}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-100 truncate">{item.itemName}</span>
                      <span className={`text-xs font-medium whitespace-nowrap ${meta.color}`}>{meta.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.targets.map((t) => (
                        <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded ${BUREAU_COLORS[t] ?? 'bg-gray-800 text-gray-300'}`}>
                          → {t}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 italic">{meta.desc}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setDryRunPreview(null); setConfirmRun(false); onRunCycle(); }}
                className="flex-1 flex items-center justify-center gap-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-all"
              >
                <Play className="w-4 h-4" /> Run For Real
              </button>
              <button
                onClick={() => setDryRunPreview(null)}
                className="px-4 py-2.5 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Setup Checklist */}
      {!setupComplete && (
        <div className="rounded-2xl border border-cyan-800/60 bg-cyan-950/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <HelpCircle className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-semibold text-cyan-300">Get AutoPilot Ready — 3 Steps</h3>
          </div>
          <div className="space-y-3">
            <SetupItem done={profileComplete} label="Personal info complete"
              detail="Your name and mailing address are needed so letters have your correct return address"
              action={profileComplete ? undefined : { label: 'Go to Profile →' }} />
            <SetupItem done={hasItems} label="Negative items loaded"
              detail="Upload a credit report or add negative items manually"
              action={hasItems ? undefined : { label: 'Upload Report →' }} />
            <SetupItem done={settings.enabled} label="AutoPilot enabled"
              detail="Toggle AutoPilot on to activate the dispute engine"
              action={settings.enabled ? undefined : { label: 'Enable Now', onClick: () => onEnableToggle(true) }} />
          </div>
        </div>
      )}

      {/* Status Header */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => onEnableToggle(!settings.enabled)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
              settings.enabled
                ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300 hover:bg-emerald-900/60'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            {settings.enabled ? <><Zap className="w-4 h-4" /> AutoPilot Active</> : <><Pause className="w-4 h-4" /> AutoPilot Paused</>}
          </button>
          {engineState.isRunning && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 animate-pulse">
              <RotateCcw className="w-4 h-4 animate-spin" /> Generating letters...
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-gray-400 ml-auto">
            <span><span className="text-emerald-400 font-bold">{deletedCount}</span> removed</span>
            <span><span className="text-cyan-400 font-bold">{readyToDispute.length}</span> ready</span>
            <span><span className="text-purple-400 font-bold">{awaitingResponse.length}</span> on hold</span>
            {overdueDeadlines.length > 0 && <span className="text-red-400 font-bold">{overdueDeadlines.length} overdue!</span>}
          </div>
        </div>
        {totalItems > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>Overall Progress</span>
              <span>{deletedCount} of {totalItems} items removed ({progressPct}%)</span>
            </div>
            <progress
              value={progressPct}
              max={100}
              aria-label="AutoPilot progress"
              title="AutoPilot progress"
              className="autopilot-progress h-2.5"
            />
          </div>
        )}
      </div>

      {/* Overdue Alert */}
      {overdueDeadlines.length > 0 && (
        <div className="rounded-xl border border-red-800 bg-red-950/30 p-4">
          <div className="flex items-center gap-2 text-red-400 font-semibold text-sm mb-1">
            <AlertTriangle className="w-4 h-4" />
            {overdueDeadlines.length} bureau response{overdueDeadlines.length > 1 ? 's are' : ' is'} overdue — the bureau broke federal law!
          </div>
          <p className="text-xs text-red-300/70">Bureaus must respond within 30 days per FCRA. Log "No Response" on the items below to auto-escalate to a harder letter.</p>
        </div>
      )}

      {/* Next Dispute Batch */}
      {readyToDispute.length > 0 && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" />
                Next Dispute Round — {nextBatchItems.length} Items
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {Math.round(settings.batchFraction * 100)}% of {readyToDispute.length} ready items · Letters will be generated for you to print and mail
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDryRunClick}
                disabled={engineState.isRunning || !settings.enabled || readyToDispute.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-700 text-gray-400 hover:border-cyan-700 hover:text-cyan-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title="Preview what letters would be generated without running"
              >
                <Search className="w-3.5 h-3.5" /> Dry Run
              </button>
              <button
                onClick={handleRunClick}
                disabled={engineState.isRunning || !settings.enabled || readyToDispute.length === 0}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  confirmRun ? 'bg-orange-600 hover:bg-orange-500 text-white animate-pulse' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                }`}
              >
                {engineState.isRunning ? <><RotateCcw className="w-4 h-4 animate-spin" /> Working...</>
                  : confirmRun ? <><AlertTriangle className="w-4 h-4" /> Confirm — Run Now?</>
                  : <><Play className="w-4 h-4" /> Run Dispute Round</>}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {nextBatchItems.map(item => {
              const pass = passNumbers[item.id] ?? Math.min(6, Math.max(1, item.disputeRound ?? 1));
              const meta = passMeta(pass);
              return (
                <div key={item.id} className={`rounded-xl border px-4 py-3 ${meta.bg}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-100 truncate">{item.creditorName}</span>
                        {(item.verificationCount ?? 0) > 0 && (
                          <span className="text-[10px] bg-yellow-900/50 border border-yellow-800 text-yellow-400 px-1.5 py-0.5 rounded">Re-dispute (more aggressive)</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{item.typeOfNegative}{item.balance != null ? ` · $${item.balance.toLocaleString()}` : ''}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {(item.creditBureau ?? []).map(b => (
                          <span key={b} className={`text-[10px] px-1.5 py-0.5 rounded ${BUREAU_COLORS[b] ?? 'bg-gray-800 text-gray-400'}`}>{b}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1.5 italic">{meta.desc}</p>
                </div>
              );
            })}
            {readyToDispute.length > nextBatchItems.length && (
              <p className="text-xs text-gray-600 text-center pt-1">
                +{readyToDispute.length - nextBatchItems.length} more items in queue for future rounds
              </p>
            )}
          </div>
          {nextCycleFmt && (
            <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Scheduled next cycle</span>
              <span className="text-gray-400">{nextCycleFmt}</span>
            </div>
          )}
        </div>
      )}

      {/* No items ready */}
      {readyToDispute.length === 0 && activeItems.length > 0 && (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-center">
          <Lock className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm font-medium">All items are waiting on bureau responses</p>
          <p className="text-gray-600 text-xs mt-1">When you receive letters back from the bureaus, log responses below. Each response triggers the next step automatically.</p>
        </div>
      )}

      {/* How It Works */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40">
        <button onClick={() => setShowHowItWorks(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <span className="flex items-center gap-2"><Info className="w-3.5 h-3.5" /> How AutoPilot works</span>
          {showHowItWorks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showHowItWorks && (
          <div className="px-4 pb-5 space-y-4 border-t border-gray-800 pt-4">
            <HowItWorksStep number="1" title="AutoPilot picks 1/3 of your items each round"
              desc="We never dispute everything at once. Spreading disputes across 3 rounds prevents bureaus from flagging them as frivolous. We pick the highest-impact items first — most likely to be deleted." />
            <HowItWorksStep number="2" title="Letters are generated with all your info filled in"
              desc="Each letter is professionally written with your full name, address, the creditor's legal name, bureau's official mailing address, account details, and the exact federal law citations. Print and mail with a regular stamp by default (or switch to certified mail when needed)." />
            <HowItWorksStep number="3" title="Mail the letters, then wait for bureau response (up to 30 days)"
              desc="Bureaus must respond within 30 days per federal law (FCRA §611). When you receive their letter back, log the outcome here. If they don't respond in 30 days, that's a federal violation — we escalate." />
            <HowItWorksStep number="4" title="Verified? Goes to the back of the line — by design"
              desc='If the bureau says "verified," that item is put on hold for 60 days while other items get disputed first. Then we come back with a harder letter demanding HOW they verified it, then threatening a CFPB complaint. Each round gets more aggressive.' />
            <HowItWorksStep number="5" title="5 escalating rounds — each harder than the last"
              desc="Round 1: accuracy challenge → Round 2: response-specific reinvestigation → Round 3: direct furnisher/data integrity → Round 4: procedure failure → Round 5: CFPB/State AG package → Round 6: final pre-litigation review." />
          </div>
        )}
      </div>

      {/* Awaiting Bureau Response */}
      {awaitingResponse.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Timer className="w-4 h-4 text-yellow-400" />
            Awaiting Bureau Response
            <span className="text-xs text-gray-500 font-normal">— log it when their letter arrives</span>
          </h3>
          {awaitingResponse.filter(item => !celebratedItems.has(item.id)).map(item => {
            const holdEntry = holdEntries.find(h => h.itemId === item.id);
            const expiryDate = holdEntry ? new Date(holdEntry.holdExpiryDate) : null;
            const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
            const isOverdue = daysLeft !== null && daysLeft < 0;
            const pass = passNumbers[item.id] ?? Math.min(6, Math.max(1, item.disputeRound ?? 1));
            const meta = passMeta(pass);
            const isExpanded = expandedResponseItem === item.id;
            return (
              <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-100 truncate">{item.creditorName}</span>
                      <span className={`text-[10px] font-medium ${meta.color}`}>{meta.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs">
                      <span className="text-gray-500">{item.typeOfNegative}</span>
                      {holdEntry?.notes && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-300 border border-yellow-800" title={holdEntry.notes}>
                          Hold: {holdEntry.notes.slice(0, 48)}{holdEntry.notes.length > 48 ? '…' : ''}
                        </span>
                      )}
                      {holdEntry?.verificationBureau && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                          via {holdEntry.verificationBureau}
                        </span>
                      )}
                      {daysLeft !== null && (
                        <span className={`flex items-center gap-1 font-medium ${isOverdue ? 'text-red-400' : daysLeft <= 7 ? 'text-orange-400' : 'text-gray-500'}`}>
                          <Clock className="w-3 h-3" />
                          {isOverdue ? `${Math.abs(daysLeft)}d OVERDUE — escalate!` : `Response due in ${daysLeft} days`}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedResponseItem(isExpanded ? null : item.id)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0 ${
                      isOverdue ? 'border-red-700 bg-red-950/30 text-red-400 hover:bg-red-950/50' : 'border-cyan-800 bg-cyan-950/30 text-cyan-400 hover:bg-cyan-950/50'
                    }`}
                  >
                    Log Response
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-800 bg-gray-950/60 px-4 py-4">
                    <p className="text-xs text-gray-500 mb-3">What did the bureau's letter say?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <ResponseButton
                        icon="🎉" label="Deleted!" sublabel="They removed it — you won!"
                        onClick={() => handleLogResponse(item.id, 'Deleted')}
                        color="bg-emerald-900/40 border-emerald-700 text-emerald-300 hover:bg-emerald-900/70" />
                      <ResponseButton
                        icon="✅" label="Updated" sublabel="Corrected in your favor"
                        onClick={() => handleLogResponse(item.id, 'Updated')}
                        color="bg-blue-900/30 border-blue-800 text-blue-300 hover:bg-blue-900/60" />
                      <ResponseButton
                        icon="⚡" label="Verified (again)" sublabel="Back of line — Round 2+ incoming"
                        onClick={() => handleLogResponse(item.id, 'Verified')}
                        color="bg-yellow-900/30 border-yellow-800 text-yellow-300 hover:bg-yellow-900/60" />
                      <ResponseButton
                        icon="⏰" label="No Response" sublabel="Deadline passed — escalate now"
                        onClick={() => handleLogResponse(item.id, 'NoResponse')}
                        color="bg-red-900/30 border-red-800 text-red-300 hover:bg-red-900/60" />
                    </div>
                    <p className="text-[10px] text-gray-700 mt-2">
                      "Verified" = we put this item to the back of the line and send a harder letter after other items get their round.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cooling Off */}
      {coolingOff.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 flex items-center gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-yellow-600" />
            Back of Line — Cooling Off (got "Verified," waiting for harder letter)
          </h3>
          <div className="rounded-xl border border-yellow-900/40 bg-yellow-950/10 p-3">
            <p className="text-xs text-yellow-700 mb-3">These items were verified. While they wait, other items get disputed. Then these come back with a more aggressive letter that's harder for bureaus to brush off.</p>
            <div className="space-y-1.5">
              {coolingOff.map(item => {
                const holdEntry = holdEntries.find(h => h.itemId === item.id);
                const expiryDate = holdEntry ? new Date(holdEntry.holdExpiryDate) : null;
                const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                const currentPass = passNumbers[item.id] ?? Math.min(6, Math.max(1, item.disputeRound ?? 1));
                const nextPass = Math.min(6, currentPass + 1) as PassNumber;
                const nextMeta = passMeta(nextPass);
                return (
                  <div key={item.id} className="flex items-center justify-between text-xs text-gray-500">
                    <span className="truncate">{item.creditorName}</span>
                    <div className="flex items-center gap-3 ml-2 flex-shrink-0">
                      <span className={nextMeta.color}>→ {nextMeta.label.split('—')[0].trim()}</span>
                      {daysLeft !== null && daysLeft > 0 && <span className="text-gray-700">{daysLeft}d left</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Victory Zone */}
      {deletedItems.length > 0 && (
        <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <PartyPopper className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-emerald-300">Removed from Your Credit Report 🎉</h3>
          </div>
          <div className="space-y-1.5">
            {deletedItems.map(item => (
              <div key={item.id} className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-medium">{item.creditorName}</span>
                <span className="text-emerald-700">— {item.typeOfNegative}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-emerald-800 mt-3">Each removal boosts your credit score. Every item removed is a win!</p>
        </div>
      )}

      {/* Last Cycle Result */}
      {lastCycleResult && lastCycleResult.lettersGenerated > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-semibold text-gray-300">Last Cycle</span>
            <span className="text-xs text-gray-600 ml-auto">{new Date(lastCycleResult.completedAt).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xl font-bold text-cyan-400">{lastCycleResult.lettersGenerated}</p><p className="text-xs text-gray-500">Letters Ready</p></div>
            <div><p className="text-xl font-bold text-purple-400">{lastCycleResult.itemsProcessed}</p><p className="text-xs text-gray-500">Items Disputed</p></div>
            <div>
              <p className={`text-xl font-bold ${lastCycleResult.errors.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {lastCycleResult.errors.length > 0 ? lastCycleResult.errors.length : '✓'}
              </p>
              <p className="text-xs text-gray-500">{lastCycleResult.errors.length > 0 ? 'Errors' : 'Clean'}</p>
            </div>
          </div>
          {onViewLetters && (
            <button onClick={onViewLetters} className="mt-3 w-full text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-900/50 hover:border-cyan-700 rounded-lg py-2 transition-colors">
              View / Print Letters →
            </button>
          )}
        </div>
      )}

      {/* ─── Sprint 4: SLA Countdown Chips ────────────────────────────────── */}
      {deadlines.filter(d => d.status !== 'resolved').length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-gray-300">FCRA Response Deadlines</span>
            <span className="text-[10px] text-gray-600">(30-day bureau / 45-day furnisher)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {deadlines
              .filter(d => d.status !== 'resolved')
              .sort((a, b) => new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime())
              .slice(0, 12)
              .map(d => {
                const daysLeft = Math.ceil((new Date(d.deadlineDate).getTime() - Date.now()) / 86_400_000);
                const isOverdue = daysLeft < 0;
                const isUrgent = daysLeft >= 0 && daysLeft <= 5;
                const chipColor = isOverdue
                  ? 'bg-red-950/60 border-red-800 text-red-300'
                  : isUrgent
                  ? 'bg-orange-950/50 border-orange-800 text-orange-300'
                  : 'bg-gray-900 border-gray-700 text-gray-400';
                return (
                  <div key={d.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-medium ${chipColor}`}>
                    <Clock className="w-3 h-3" />
                    <span className="truncate max-w-[80px]" title={d.itemName}>{d.itemName?.split(' ')[0] ?? 'Item'}</span>
                    <span className="text-[9px] opacity-80">{d.bureau ?? ''}</span>
                    <span className="font-bold">
                      {isOverdue ? `${Math.abs(daysLeft)}d OVER` : `${daysLeft}d`}
                    </span>
                  </div>
                );
              })}
            {deadlines.filter(d => d.status !== 'resolved').length > 12 && (
              <div className="flex items-center px-2.5 py-1.5 text-[10px] text-gray-600">
                +{deadlines.filter(d => d.status !== 'resolved').length - 12} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Sprint 4: Evidence Readiness Meter ──────────────────────────── */}
      {vaultDocs.length >= 0 && items.length > 0 && (
        <EvidenceReadinessMeter vaultDocs={vaultDocs} items={items} />
      )}

      {/* ─── Sprint 4: Cycle History Panel ───────────────────────────────── */}
      {cycleHistory.length > 0 && (
        <CycleHistoryPanel history={cycleHistory} />
      )}

      {/* Settings */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40">
        <button onClick={() => setShowSettings(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <span className="flex items-center gap-2"><Settings2 className="w-3.5 h-3.5" /> Dispute Settings</span>
          {showSettings ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showSettings && (
          <div className="px-4 pb-5 space-y-4 border-t border-gray-800 pt-4">
            <SettingRow label="Items per round" hint="1/4 = conservative, 1/3 = recommended (prevents frivolous designation)">
              <div className="flex gap-2">
                {([0.25, 0.33] as const).map(f => (
                  <button key={f} onClick={() => onUpdateSettings({ batchFraction: f })}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${settings.batchFraction === f ? 'bg-cyan-900/50 border-cyan-700 text-cyan-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                    {f === 0.25 ? '1/4 of items' : '1/3 of items'}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="Max items per cycle" hint="Hard cap regardless of percentage">
              <input type="number" min={2} max={20} value={settings.maxItemsPerBatch}
                title="Maximum items per cycle"
                aria-label="Max items per batch"
                onChange={e => onUpdateSettings({ maxItemsPerBatch: Math.max(2, parseInt(e.target.value) || 8) })}
                className="w-16 text-center text-xs bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-200 focus:outline-none focus:border-cyan-700" />
            </SettingRow>
            <SettingRow label="Also dispute directly with creditor" hint="Sends letters to bureau AND the creditor simultaneously for faster results">
              <Toggle value={settings.dualTargetMode} onChange={v => onUpdateSettings({ dualTargetMode: v })} />
            </SettingRow>
            <SettingRow label="Auto-generate CFPB complaint at Round 5" hint="Automatically prepares a CFPB complaint when an item reaches final round">
              <Toggle value={settings.autoGenerateCFPBOnPass5} onChange={v => onUpdateSettings({ autoGenerateCFPBOnPass5: v })} />
            </SettingRow>
            <SettingRow label="Auto-approve qualified letters" hint="Only passes 1–4 that clear uniqueness, factual-anchor, placeholder, and frivolous-risk gates">
              <Toggle value={settings.letterAutoApproveEnabled} onChange={v => onUpdateSettings({ letterAutoApproveEnabled: v })} />
            </SettingRow>
            <SettingRow label="Minimum uniqueness score" hint="Higher values are stricter; 70 is the recommended quality floor">
              <input type="number" min={50} max={100} value={settings.letterAutoApprovePassThreshold} aria-label="Auto-approve uniqueness threshold" onChange={e=>onUpdateSettings({letterAutoApprovePassThreshold:Math.max(50,Math.min(100,Number(e.target.value)||70))})} className="w-16 text-center text-xs bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-200" />
            </SettingRow>
            <SettingRow label="Adaptive safety timing" hint="Uses bureau-specific duplicate windows and frivolous cooldowns">
              <Toggle value={settings.adaptiveDuplicateWindow && settings.adaptiveFrivolousHold} onChange={v => onUpdateSettings({ adaptiveDuplicateWindow:v, adaptiveFrivolousHold:v })} />
            </SettingRow>
            <div className="pt-2 border-t border-gray-800">
              <p className="text-[11px] text-gray-600 leading-relaxed">
                <span className="text-gray-500 font-medium">Wait times between rounds: </span>
                Rounds 1 & 2: 60-day hold · Round 3: 45 days · Round 4: 30 days · Round 5: 14 days · Round 6: 15 days.
                These gaps are intentional — they give bureaus time to respond and prevent your disputes from being labeled as frivolous.
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const SetupItem: React.FC<{
  done: boolean; label: string; detail: string;
  action?: { label: string; href?: string; onClick?: () => void };
}> = ({ done, label, detail, action }) => (
  <div className="flex items-start gap-3">
    <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center ${done ? 'bg-emerald-900 border-emerald-600' : 'border-gray-600 bg-gray-800'}`}>
      {done && <CheckCircle className="w-3 h-3 text-emerald-400" />}
    </div>
    <div className="flex-1">
      <p className={`text-sm font-medium ${done ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{label}</p>
      <p className="text-xs text-gray-600 mt-0.5">{detail}</p>
    </div>
    {!done && action && (
      action.href
        ? <a href={action.href} className="flex-shrink-0 text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-900/50 rounded-lg px-3 py-1">{action.label}</a>
        : <button onClick={action.onClick} className="flex-shrink-0 text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-900/50 rounded-lg px-3 py-1">{action.label}</button>
    )}
  </div>
);

const HowItWorksStep: React.FC<{ number: string; title: string; desc: string }> = ({ number, title, desc }) => (
  <div className="flex gap-3">
    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-900/40 border border-cyan-900 flex items-center justify-center text-[10px] font-bold text-cyan-500">{number}</div>
    <div>
      <p className="text-xs font-semibold text-gray-300">{title}</p>
      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
    </div>
  </div>
);

const ResponseButton: React.FC<{ icon: string; label: string; sublabel: string; onClick: () => void; color: string }> = ({ icon, label, sublabel, onClick, color }) => (
  <button onClick={onClick} className={`flex flex-col items-start gap-0.5 p-3 rounded-xl border text-left transition-all ${color}`}>
    <div className="flex items-center gap-1.5 font-semibold text-xs">{icon} {label}</div>
    <span className="text-[10px] opacity-70">{sublabel}</span>
  </button>
);

const SettingRow: React.FC<{ label: string; hint: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex items-start justify-between gap-4">
    <div><p className="text-xs text-gray-300">{label}</p><p className="text-[11px] text-gray-600 mt-0.5">{hint}</p></div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button onClick={() => onChange(!value)} title={value ? 'Toggle off' : 'Toggle on'} aria-label="Toggle setting" className={`relative w-9 h-5 rounded-full border transition-colors ${value ? 'bg-cyan-600 border-cyan-500' : 'bg-gray-800 border-gray-700'}`}>
    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
  </button>
);

// ─── Sprint 4: Evidence Readiness Meter sub-component ─────────────────────────

const TIER_STYLES = {
  BLOCKED: { color: 'text-red-400', bar: 'bg-red-600', label: 'BLOCKED — Upload ID to proceed' },
  BASIC: { color: 'text-yellow-400', bar: 'bg-yellow-500', label: 'BASIC — Limited legal hooks' },
  STRONG: { color: 'text-emerald-400', bar: 'bg-emerald-500', label: 'STRONG — Full legal argument' },
  AUDIT_PROOF: { color: 'text-cyan-400', bar: 'bg-cyan-500', label: 'AUDIT-PROOF — Maximum pressure' },
} as const;

const EvidenceReadinessMeter: React.FC<{ vaultDocs: EvidenceDoc[]; items: NegativeItem[] }> = ({ vaultDocs, items }) => {
  const [showDetails, setShowDetails] = useState(false);

  // Evaluate for the first dispute-type in the batch (most common type)
  const disputeType = (items[0]?.typeOfNegative?.toLowerCase() ?? 'general').includes('collect') ? 'collection' :
    (items[0]?.typeOfNegative?.toLowerCase() ?? '').includes('charge') ? 'charge_off' : 'general';

  const result = evaluateEvidenceReadiness(vaultDocs, disputeType as Parameters<typeof evaluateEvidenceReadiness>[1]);
  const tierStyle = TIER_STYLES[result.tier];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-semibold text-gray-300">Evidence Readiness</span>
        </div>
        <button
          onClick={() => setShowDetails(v => !v)}
          className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1"
        >
          {showDetails ? 'hide' : 'details'}
          {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${tierStyle.bar}`}
            style={{ width: `${result.score}%` }}
          />
        </div>
        <span className={`text-xs font-bold w-8 text-right ${tierStyle.color}`}>{result.score}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold ${tierStyle.color}`}>{tierStyle.label}</span>
        <span className="text-[9px] text-gray-600">{result.availableDocs.length} doc(s) in vault</span>
      </div>
      {showDetails && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
          <p className="text-[10px] text-gray-500 leading-relaxed">{result.rationale}</p>
          {result.missingCritical.length > 0 && (
            <div>
              <p className="text-[10px] text-yellow-500 font-semibold mb-1">Missing documents:</p>
              {result.missingCritical.map((doc, i) => (
                <p key={i} className="text-[9px] text-yellow-700 flex items-start gap-1">
                  <span>•</span> {doc}
                </p>
              ))}
            </div>
          )}
          {!result.canProceed && (
            <p className="text-[10px] text-red-400 font-semibold">
              Upload a government-issued photo ID to the Vault to unlock letter generation.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Sprint 4: Cycle History Panel sub-component ──────────────────────────────

const CycleHistoryPanel: React.FC<{ history: CycleAuditRecord[] }> = ({ history }) => {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? history : history.slice(0, 3);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <span className="flex items-center gap-2">
          <History className="w-3.5 h-3.5" />
          Cycle History
          <span className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-[9px]">{history.length}</span>
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      <div className="border-t border-gray-800">
        {shown.map((record, i) => {
          const date = new Date(record.runAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const hasErrors = record.errors.length > 0;
          return (
            <div key={record.cycleId} className={`flex items-center justify-between px-4 py-2.5 ${i < shown.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasErrors ? 'bg-red-500' : 'bg-emerald-500'}`} />
                <div>
                  <p className="text-xs text-gray-300">{date}</p>
                  <p className="text-[10px] text-gray-600">{record.lettersGenerated} letters · {record.itemsProcessed} items</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-600">
                {record.inertiaEscalations > 0 && (
                  <span className="text-orange-500">{record.inertiaEscalations} auto-adv.</span>
                )}
                {hasErrors && <span className="text-red-500">{record.errors.length} err</span>}
                <span className="text-gray-700">{Math.round((record.durationMs ?? 0) / 1000)}s</span>
              </div>
            </div>
          );
        })}
        {!expanded && history.length > 3 && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full text-[10px] text-gray-600 hover:text-gray-400 py-2 transition-colors"
          >
            Show all {history.length} cycles
          </button>
        )}
      </div>
    </div>
  );
};
