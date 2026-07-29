/**
 * MissionControlPanel — AutoPilot Mission Control (overhaul §3 / §10).
 * Status strip, one primary action, case pipeline, success panel, inbox, why drawer.
 */

import React, { useEffect, useState } from 'react';
import {
  Zap, Inbox, CheckCircle2, Clock, AlertTriangle, ChevronRight,
  FileText, HelpCircle, Shield, X, ArrowRight,
} from 'lucide-react';
import type { AutopilotCase, AutopilotTask, MissionControlStatus } from '../types/autopilotCase';
import { AutopilotOrchestrator } from '../services/autopilotOrchestrator';
import { AutopilotInboxService } from '../services/autopilotInboxService';
import { CaseRepository } from '../services/caseRepository';
import { CasePlanService } from '../services/casePlanService';

export interface MissionControlPanelProps {
  profileId: string;
  hasPersonalInfo: boolean;
  hasReports: boolean;
  autopilotEnabled: boolean;
  onNavigate?: (page: string) => void;
  onRunCycle?: () => void;
  refreshKey?: number;
}

const PIPELINE_ORDER = [
  'Discovered',
  'Needs facts',
  'Ready',
  'Approved',
  'Sent',
  'Waiting',
  'Response received',
  'Resolved',
] as const;

export function MissionControlPanel({
  profileId,
  hasPersonalInfo,
  hasReports,
  autopilotEnabled,
  onNavigate,
  onRunCycle,
  refreshKey = 0,
}: MissionControlPanelProps) {
  const [status, setStatus] = useState<MissionControlStatus | null>(null);
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [cases, setCases] = useState<AutopilotCase[]>([]);
  const [whyCaseId, setWhyCaseId] = useState<string | null>(null);
  const [whyBullets, setWhyBullets] = useState<string[]>([]);
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [taskError, setTaskError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mc, openTasks, caseList] = await Promise.all([
          AutopilotOrchestrator.getMissionControl({
            profileId,
            hasPersonalInfo,
            hasReports,
            autopilotEnabled,
          }),
          AutopilotInboxService.listTasks(profileId, 'open'),
          CaseRepository.getCasesForProfile(profileId),
        ]);
        if (cancelled) return;
        setStatus(mc);
        setTasks(openTasks);
        setCases(caseList);
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, hasPersonalInfo, hasReports, autopilotEnabled, refreshKey]);

  const openWhy = async (caseId: string) => {
    setWhyCaseId(caseId);
    try {
      const plans = await CasePlanService.getPlansForCase(caseId);
      const plan = plans[0];
      const c = cases.find((x) => x.id === caseId);
      setWhyBullets(
        plan?.explainWhy?.length
          ? [
              ...plan.explainWhy,
              `Recipient: ${plan.recipientName}`,
              `Strategy: ${plan.strategy}`,
              `Evidence missing: ${(plan.missingEvidence ?? []).join(', ') || 'none'}`,
              `Deadline: ${plan.deadlineAt || 'none'}`,
              ...(c?.riskFlags?.length ? [`Risk flags: ${c.riskFlags.join(', ')}`] : []),
            ]
          : ['No plan yet — run AutoPilot to generate an explainable next action.'],
      );
    } catch {
      setWhyBullets(['Could not load plan details for this case.']);
    }
  };

  const handlePrimary = () => {
    const kind = status?.nextBestAction.actionKind;
    switch (kind) {
      case 'import':
        onNavigate?.('upload');
        break;
      case 'setup':
        onNavigate?.('profile');
        break;
      case 'add':
        onNavigate?.('vault');
        break;
      case 'approve':
      case 'answer':
      case 'scan':
        // Stay on autopilot — inbox below
        break;
      case 'monitor':
        onRunCycle?.();
        break;
      case undefined:
        onRunCycle?.();
        break;
      default: {
        const _exhaustive: never = kind;
        void _exhaustive;
        onRunCycle?.();
        break;
      }
    }
  };

  const refreshMissionControl = async () => {
    const [openTasks, missionControl] = await Promise.all([
      AutopilotInboxService.listTasks(profileId, 'open'),
      AutopilotOrchestrator.getMissionControl({ profileId, hasPersonalInfo, hasReports, autopilotEnabled }),
    ]);
    setTasks(openTasks);
    setStatus(missionControl);
  };

  const submitAnswer = async (task: AutopilotTask, value: unknown) => {
    if (!task.caseId || !task.field) {
      setTaskError('This question is missing its case or field reference. Run AutoPilot once more to recreate it.');
      return;
    }
    setBusy(true);
    setTaskError(null);
    try {
      await AutopilotOrchestrator.answerFact({
        profileId,
        caseId: task.caseId,
        field: task.field,
        value,
        taskId: task.id,
      });
      await refreshMissionControl();
    } catch {
      setTaskError('Your answer could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const questionFor = (task: AutopilotTask): { prompt: string; options?: Array<{ label: string; value: boolean }> } => {
    if (task.field === 'userRecognizesAccount') {
      return { prompt: 'Do you recognize this account as yours?', options: [{ label: 'Yes, it is mine', value: true }, { label: 'No, I do not recognize it', value: false }] };
    }
    if (task.field === 'latePaymentAccurate') {
      return { prompt: 'Is the reported late payment accurate?', options: [{ label: 'Yes, it is accurate', value: true }, { label: 'No, it is inaccurate', value: false }] };
    }
    return { prompt: task.title };
  };

  const filteredCases = pipelineFilter
    ? cases.filter((c) => {
        switch (pipelineFilter) {
          case 'Discovered':
            return (
              c.state === 'IMPORTED' ||
              c.state === 'NORMALIZED' ||
              c.state === 'ELIGIBLE' ||
              c.state === 'IDENTITY_RESOLVED'
            );
          case 'Needs facts':
            return c.state === 'FACTS_NEEDED' || c.state === 'EVIDENCE_NEEDED';
          case 'Ready':
            return (
              c.state === 'VALIDATED' ||
              c.state === 'USER_APPROVAL' ||
              c.state === 'PLANNED' ||
              c.state === 'DRAFTED'
            );
          case 'Approved':
            return c.state === 'READY_TO_DISPATCH';
          case 'Sent':
            return c.state === 'SENT';
          case 'Waiting':
            return c.state === 'WAITING' || c.state === 'VERIFIED' || c.state === 'DEADLINE_BREACH';
          case 'Response received':
            return c.state === 'RESPONSE_RECEIVED';
          case 'Resolved':
            return c.state === 'RESOLVED' || c.state === 'DELETED' || c.state === 'CORRECTED';
          default:
            return true;
        }
      })
    : cases.slice(0, 8);

  const statusColor =
    status?.autopilotStatus === 'Needs You'
      ? 'text-amber-300'
      : status?.autopilotStatus === 'Running'
        ? 'text-emerald-300'
        : status?.autopilotStatus === 'Paused'
          ? 'text-zinc-400'
          : status?.autopilotStatus === 'Waiting'
            ? 'text-cyan-300'
            : 'text-orange-300';

  return (
    <div className="space-y-4" role="region" aria-label="AutoPilot Mission Control">
      {/* Status strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { label: 'AutoPilot', value: status?.autopilotStatus ?? '…', className: statusColor },
          { label: 'Next action', value: status?.nextBestAction.label ?? 'Loading…', className: 'text-white' },
          { label: 'Active cases', value: String(status?.activeCases ?? 0), className: 'text-cyan-300' },
          { label: 'Waiting', value: String(status?.waitingOnResponses ?? 0), className: 'text-amber-300' },
          { label: 'Confirmed', value: String(status?.confirmedResults ?? 0), className: 'text-emerald-300' },
        ].map((cell) => (
          <div key={cell.label} className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{cell.label}</div>
            <div className={`text-sm font-semibold mt-1 line-clamp-2 ${cell.className}`}>{cell.value}</div>
          </div>
        ))}
      </div>

      {/* Primary action card */}
      <div className="rounded-2xl border border-cyan-900/50 bg-gradient-to-br from-cyan-950/40 via-zinc-950 to-zinc-950 p-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-800/50">
            <Zap className="w-5 h-5 text-cyan-300" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-cyan-600 uppercase tracking-widest">Primary action</div>
            <h2 className="text-lg font-bold text-white mt-1">
              {status?.nextBestAction.label ?? 'Preparing Mission Control…'}
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              {status?.nextBestAction.detail ?? 'Syncing cases and inbox'}
            </p>
            <button
              type="button"
              onClick={handlePrimary}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-500 text-black font-semibold text-sm px-4 py-2.5 hover:bg-cyan-400 transition-colors"
            >
              {status?.nextBestAction.actionKind === 'monitor' ? 'Run status check' : 'Continue'}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 overflow-x-auto">
        <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-2">Case pipeline</div>
        <div className="flex gap-2 min-w-max">
          {PIPELINE_ORDER.map((stage) => {
            const count = status?.pipeline[stage] ?? 0;
            const active = pipelineFilter === stage;
            return (
              <button
                key={stage}
                type="button"
                onClick={() => setPipelineFilter(active ? null : stage)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active ? 'border-cyan-600 bg-cyan-950/40' : 'border-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className="text-sm font-bold text-white">{count}</div>
                <div className="text-[10px] text-zinc-500 whitespace-nowrap">{stage}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Inbox */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Inbox className="w-4 h-4 text-cyan-400" aria-hidden />
            <h3 className="text-sm font-semibold text-white">AutoPilot Inbox</h3>
            <span className="ml-auto text-[10px] font-mono text-zinc-500">{tasks.length} open</span>
          </div>
          {tasks.length === 0 ? (
            <p className="text-xs text-zinc-500">No tasks — AutoPilot will ask only when a fact or approval is required.</p>
          ) : (
            <ul className="space-y-2">
              {tasks.slice(0, 6).map((task) => (
                <li key={task.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-mono text-cyan-500">{task.type}</span>
                    <span className="text-[10px] text-zinc-600">~{task.estimatedMinutes} min</span>
                  </div>
                  <div className="text-sm text-white mt-1">{task.title}</div>
                  <p className="text-xs text-zinc-500 mt-1">{task.whyItMatters}</p>
                  {task.type === 'answer' && (
                    <div className="mt-3 rounded-md border border-cyan-900/50 bg-cyan-950/20 p-2.5">
                      <p className="text-xs text-cyan-100 mb-2">{questionFor(task).prompt}</p>
                      {questionFor(task).options ? (
                        <div className="flex flex-wrap gap-2">
                          {questionFor(task).options!.map((option) => (
                            <button key={option.label} type="button" disabled={busy} onClick={() => void submitAnswer(task, option.value)} className="text-[11px] px-2.5 py-1.5 rounded border border-cyan-800 text-cyan-200 hover:bg-cyan-950/70 disabled:opacity-50">
                              {option.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input value={answers[task.id] || ''} onChange={(event) => setAnswers((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="Enter your answer" className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
                          <button type="button" disabled={busy || !answers[task.id]?.trim()} onClick={() => void submitAnswer(task, answers[task.id].trim())} className="text-[11px] px-2.5 py-1.5 rounded border border-cyan-800 text-cyan-200 hover:bg-cyan-950/70 disabled:opacity-50">Save answer</button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          if (task.type === 'approve' && task.payload?.packetId) {
                            await AutopilotOrchestrator.approvePacket(String(task.payload.packetId), 'guided');
                          } else if (task.type === 'answer') {
                            setTaskError('Answer the question above before marking this task complete.');
                            return;
                          } else if (task.type === 'add') {
                            onNavigate?.('vault');
                            return;
                          } else {
                            await AutopilotInboxService.completeTask(task.id);
                          }
                          await refreshMissionControl();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-cyan-800 text-cyan-300 hover:bg-cyan-950/50"
                    >
                      {task.type === 'approve' ? 'Approve' : task.type === 'add' ? 'Open Vault' : task.type === 'answer' ? 'Answer above' : 'Done'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await AutopilotInboxService.holdTask(task.id);
                        setTasks(await AutopilotInboxService.listTasks(profileId, 'open'));
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-900"
                    >
                      Hold
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {taskError && <p role="alert" className="mt-3 text-xs text-red-300">{taskError}</p>}
        </div>

        {/* Success panel */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden />
            <h3 className="text-sm font-semibold text-white">Results</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-zinc-900/50 p-3">
              <div className="text-xl font-bold text-emerald-300">{status?.success.deletions ?? 0}</div>
              <div className="text-[10px] text-zinc-500">Confirmed deletions</div>
            </div>
            <div className="rounded-lg bg-zinc-900/50 p-3">
              <div className="text-xl font-bold text-cyan-300">{status?.success.corrections ?? 0}</div>
              <div className="text-[10px] text-zinc-500">Confirmed corrections</div>
            </div>
            <div className="rounded-lg bg-zinc-900/50 p-3">
              <div className="text-xl font-bold text-amber-300">{status?.success.activeOpportunities ?? 0}</div>
              <div className="text-[10px] text-zinc-500">Active opportunities</div>
            </div>
            <div className="rounded-lg bg-zinc-900/50 p-3">
              <div className="text-xl font-bold text-zinc-200">{status?.success.estimatedMinutesSaved ?? 0}</div>
              <div className="text-[10px] text-zinc-500">Est. minutes saved</div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 mt-3 flex items-start gap-1">
            <Shield className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
            Results vary. Accurate negatives cannot be removed merely because they are negative. No deletion or score gain is guaranteed.
          </p>
        </div>
      </div>

      {/* Case list + why */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-zinc-400" aria-hidden />
          <h3 className="text-sm font-semibold text-white">
            {pipelineFilter ? `Cases · ${pipelineFilter}` : 'Top cases'}
          </h3>
        </div>
        {filteredCases.length === 0 ? (
          <p className="text-xs text-zinc-500">No cases in this stage yet. Import a report to begin.</p>
        ) : (
          <ul className="space-y-2">
            {filteredCases.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{c.creditorName}</div>
                  <div className="text-[10px] font-mono text-zinc-500">
                    {c.bureau} · {c.state} · {c.priorityLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openWhy(c.id)}
                  className="text-[11px] inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden />
                  Why
                  <ChevronRight className="w-3 h-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {whyCaseId && (
        <div
          className="fixed inset-0 z-[60] flex justify-end bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="Why AutoPilot chose this"
          onClick={() => setWhyCaseId(null)}
        >
          <div
            className="h-full w-full max-w-md bg-zinc-950 border-l border-zinc-800 p-5 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Why AutoPilot chose this</h3>
              <button type="button" onClick={() => setWhyCaseId(null)} aria-label="Close" className="text-zinc-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="space-y-2">
              {whyBullets.map((b) => (
                <li key={b} className="text-sm text-zinc-300 flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-cyan-500 mt-0.5 shrink-0" aria-hidden />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-zinc-600 mt-4 flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden />
              Ranking is work-order only — never a promised deletion percentage.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
