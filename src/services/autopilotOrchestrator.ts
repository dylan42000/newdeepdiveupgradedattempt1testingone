/**
 * autopilotOrchestrator.ts — Sole public cycle / state-transition entry point.
 * Composes caseRepository, fact ledger, gates, inbox, packets, approvals,
 * response intake, and AutoPilotEngineV2 without replacing the V2 engine.
 */

import type { NegativeItem, PersonalInfo } from '../types';
import type {
  AutopilotCase,
  AutopilotJob,
  AutopilotMode,
  CasePlan,
  DispatchPacket,
  GateResult,
  MissionControlStatus,
  ResponseMatch,
} from '../types/autopilotCase';
import type { AutoPilotCycleResult, AutoPilotSettingsV2, AutoPilotSettingsV3, GeneratedLetterV2, PassNumber } from '../types/creditRepair';
import { AutoPilotEngineV2 } from './autoPilotEngineV2';
import { CaseRepository } from './caseRepository';
import { FactLedgerService } from './factLedgerService';
import { CasePlanService } from './casePlanService';
import { PacketAssembler } from './packetAssembler';
import { ApprovalService } from './approvalService';
import { ResponseIntakeService } from './responseIntakeService';
import { AutopilotInboxService } from './autopilotInboxService';
import type { EvidenceDoc } from './evidenceGateService';
import type { PriorLetterRef } from './priorLetterReader';
import { idbGetAll, idbSet } from './indexedDB';
import { v4 as uuidv4 } from 'uuid';

// ─── World-Class §5.2: Dispute Letter Grouping Decision Matrix ────────────────
// Decides whether a campaign generation pass produces GROUPED BUREAU LETTERS
// (multiple items in one envelope to Experian/Equifax/TransUnion) or
// INDIVIDUAL ITEM LETTERS (one tradeline per letter/envelope).

export type DisputeGroupingMode = 'grouped_bureau' | 'individual_item' | 'individual_furnisher';

export interface GroupingStrategyDecision {
  mode: DisputeGroupingMode;
  maxItemsPerLetter: number;
  rationale: string;
  formattingRules: string[];
}

export const GROUPING_DECISION_MATRIX: Readonly<Record<'pass1' | 'pass2' | 'pass3' | 'pass4to6', GroupingStrategyDecision>> = {
  pass1: {
    mode: 'grouped_bureau',
    maxItemsPerLetter: 5,
    rationale:
      'Combines initial file-disclosure demands (§ 1681g) and accuracy challenges into a single clean ' +
      'envelope per bureau, reducing certified-mail postage while starting the 30-day statutory clock ' +
      'on every grouped tradeline simultaneously.',
    formattingRules: [
      'Use a clear numbered list or tabular item layout in Part 1.',
      'Include the full fact block (Creditor, Account Token, Disputed Field) for every grouped item.',
    ],
  },
  pass2: {
    mode: 'individual_item',
    maxItemsPerLetter: 1,
    rationale:
      'Prevents the bureau from issuing a blanket "Verified" response across multiple accounts. ' +
      'Forces an individualized Method-of-Verification request (§ 611(a)(7)) specific to each ' +
      "creditor's verification channel.",
    formattingRules: [
      'Single-item focus; embed specific prior-round investigation dates.',
      'Reference the exact bureau control number when available.',
    ],
  },
  pass3: {
    mode: 'individual_furnisher',
    maxItemsPerLetter: 1,
    rationale:
      'Statutory requirement: direct furnisher disputes under 15 U.S.C. § 1681s-2(a)(8) must be ' +
      'addressed directly to the creditor/collector furnishing the account, not to the CRA.',
    formattingRules: [
      'Demand the original signed contract and complete payment ledger.',
      'Demand Metro 2 Compliance Condition Code XB (Account in Dispute) placement.',
    ],
  },
  pass4to6: {
    mode: 'individual_item',
    maxItemsPerLetter: 1,
    rationale:
      'Creates an unambiguous, highly specific evidentiary exhibit for attachment to a CFPB ' +
      'complaint, State AG complaint, or FCRA civil lawsuit.',
    formattingRules: [
      'Reference the full chain of custody and Metro 2 compliance scores.',
      'Include explicit damage notice (FCRA § 616/617).',
    ],
  },
} as const;

/** Resolve the grouping strategy for a dispute pass (1–6). */
export function resolveGroupingStrategy(passNumber: number): GroupingStrategyDecision {
  if (passNumber <= 1) return GROUPING_DECISION_MATRIX.pass1;
  if (passNumber === 2) return GROUPING_DECISION_MATRIX.pass2;
  if (passNumber === 3) return GROUPING_DECISION_MATRIX.pass3;
  return GROUPING_DECISION_MATRIX.pass4to6;
}

export interface GroupedLetterUnit {
  key: string;
  bureau: string;
  mode: DisputeGroupingMode;
  items: NegativeItem[];
}

/**
 * Build the §5.2 Pass-1 grouped-bureau letter units: up to
 * `maxItemsPerLetter` (default 5) items sharing one letter per bureau.
 * For passes 2–6 every unit holds exactly one item (individual mode).
 */
export function buildGroupedLetterUnits(
  items: NegativeItem[],
  passNumber: number,
  maxItemsPerLetter = 5,
): GroupedLetterUnit[] {
  const decision = resolveGroupingStrategy(passNumber);

  if (decision.mode !== 'grouped_bureau') {
    return items.map((item) => ({
      key: `${decision.mode}:${item.id}`,
      bureau: item.creditBureau?.[0] ?? 'unknown',
      mode: decision.mode,
      items: [item],
    }));
  }

  const byBureau = new Map<string, NegativeItem[]>();
  for (const item of items) {
    const bureau = (item.creditBureau?.[0] ?? 'unknown').toLowerCase();
    const bucket = byBureau.get(bureau) ?? [];
    bucket.push(item);
    byBureau.set(bureau, bucket);
  }

  const units: GroupedLetterUnit[] = [];
  for (const [bureau, bucket] of byBureau) {
    for (let i = 0; i < bucket.length; i += maxItemsPerLetter) {
      const chunk = bucket.slice(i, i + maxItemsPerLetter);
      units.push({
        key: `grouped_bureau:${bureau}:${Math.floor(i / maxItemsPerLetter) + 1}`,
        bureau,
        mode: decision.mode,
        items: chunk,
      });
    }
  }
  return units;
}

export interface OrchestratorCycleParams {
  profileId: string;
  items: NegativeItem[];
  personalInfo: PersonalInfo;
  settings: AutoPilotSettingsV2 | AutoPilotSettingsV3;
  mode?: AutopilotMode;
  vaultDocs?: EvidenceDoc[];
  priorLetters?: PriorLetterRef[];
  onProgress?: (msg: string) => void;
  hasReports?: boolean;
}

export interface OrchestratorCycleResult {
  cycle: AutoPilotCycleResult;
  cases: AutopilotCase[];
  plans: CasePlan[];
  packets: DispatchPacket[];
  gateFailures: Array<{ caseId: string; gates: GateResult[] }>;
  missionControl: MissionControlStatus;
  /** World-Class §5.2: grouping decision + planned letter units for this cycle. */
  grouping?: {
    decision: GroupingStrategyDecision;
    units: GroupedLetterUnit[];
  };
}

const LEASE_MS = 5 * 60 * 1000;

function itemMap(items: NegativeItem[]): Map<string, NegativeItem> {
  return new Map(items.map((i) => [i.id, i]));
}

export const AutopilotOrchestrator = {
  /**
   * Public cycle entry — syncs cases, plans next actions, routes remediation
   * into the inbox, then delegates letter generation to AutoPilotEngineV2.
   */
  async runCycle(params: OrchestratorCycleParams): Promise<OrchestratorCycleResult> {
    const mode = params.mode || 'guided';
    const progress = (msg: string) => params.onProgress?.(msg);

    progress('Acquiring profile lease...');
    const lease = await this.acquireLease(params.profileId, 'cycle');
    if (!lease.ok) {
      throw new Error(lease.error || 'Could not acquire AutoPilot lease');
    }

    try {
      progress('Syncing canonical cases...');
      await CaseRepository.ensureReady();
      const cases = await CaseRepository.syncFromItems(params.profileId, params.items);
      const byItem = itemMap(params.items);
      const plans: CasePlan[] = [];
      const packets: DispatchPacket[] = [];
      const gateFailures: Array<{ caseId: string; gates: GateResult[] }> = [];
      let cycleGrouping: OrchestratorCycleResult['grouping'];
      const passNumbers: Record<string, PassNumber> = {};
      for (const c of cases) passNumbers[c.negativeItemId] = c.passNumber;

      // Seed report facts + build plans / inbox tasks
      for (const c of cases) {
        const item = byItem.get(c.negativeItemId);
        if (!item) continue;

        const activeFacts = await FactLedgerService.getActiveFacts(c.id);
        if (activeFacts.length === 0) {
          await FactLedgerService.seedFromReportFields(
            params.profileId,
            c.id,
            {
              creditorName: item.creditorName,
              accountNumber: item.accountNumber,
              balance: item.balance,
              status: item.status,
              typeOfNegative: item.typeOfNegative,
              dofd: item.originalDateOfDelinquency,
            },
            `report:${item.id}`,
          );
        }

        const { plan, gates } = await CasePlanService.buildPlan({
          profileId: params.profileId,
          caseRecord: c,
          item,
          vaultDocs: params.vaultDocs,
          passNumbers,
        });
        plans.push(plan);

        const failed = gates.filter((g) => !g.passed);
        if (failed.length) {
          gateFailures.push({ caseId: c.id, gates: failed });
          for (const g of failed) {
            if (!g.remediation) continue;
            await AutopilotInboxService.upsertTask({
              profileId: params.profileId,
              caseId: c.id,
              type: g.remediation.taskType,
              title: g.remediation.title,
              whyItMatters: g.remediation.whyItMatters,
              afterComplete: 'AutoPilot will re-run gates and continue the case plan.',
              field: g.remediation.field,
              dedupeKey: `${c.id}:${g.gate}`,
            });
            if (g.gate === 'evidence') {
              await CaseRepository.transition(c.id, 'EVIDENCE_NEEDED', 'autopilot');
            } else if (g.gate === 'actionability' || g.remediation.taskType === 'answer') {
              await CaseRepository.transition(c.id, 'FACTS_NEEDED', 'autopilot');
            }
          }
        } else if (mode !== 'monitor_only') {
          await CaseRepository.transition(c.id, 'PLANNED', 'autopilot', { planId: plan.id });
        }
      }

      let cycle: AutoPilotCycleResult;
      if (mode === 'monitor_only') {
        progress('Monitor-only mode — skipping letter generation');
        cycle = {
          cycleId: uuidv4(),
          profileId: params.profileId,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          itemsProcessed: 0,
          lettersGenerated: 0,
          itemsSkippedDuplicate: 0,
          itemsOnHold: 0,
          errors: [],
          dispatchPlan: {
            profileId: params.profileId,
            cycleDate: new Date().toISOString(),
            totalItems: 0,
            items: [],
            estimatedLetterCount: 0,
            holdExpiryDates: {},
          },
          letters: [],
          nextCycleDate: new Date(Date.now() + 32 * 86400000).toISOString(),
          preFlightPassed: true,
          preFlightErrors: [],
          itemsRequiringAction: [],
          resolutionTaskIds: [],
        };
      } else {
        // World-Class §5.2: resolve the grouping strategy for this cycle's dominant
        // pass and log the decision (explainability). Pass 1 campaigns plan grouped
        // bureau units (≤5 items per envelope); passes 2–6 plan individual units.
        const dominantPass = cases.reduce<Record<number, number>>((acc, c) => {
          const p = Number(c.passNumber) || 1;
          acc[p] = (acc[p] ?? 0) + 1;
          return acc;
        }, {});
        const cyclePass = Number(
          Object.entries(dominantPass).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1,
        );
        const groupingDecision = resolveGroupingStrategy(cyclePass);
        const groupingUnits = buildGroupedLetterUnits(
          params.items,
          cyclePass,
          groupingDecision.maxItemsPerLetter,
        );
        progress(
          `§5.2 Grouping: ${groupingDecision.mode} (pass ${cyclePass}) — ` +
          `${groupingUnits.length} letter unit(s) across ${params.items.length} item(s). ` +
          groupingDecision.rationale,
        );
        cycleGrouping = { decision: groupingDecision, units: groupingUnits };

        progress('Delegating to AutoPilotEngineV2...');
        cycle = await AutoPilotEngineV2.runCycle({
          profileId: params.profileId,
          items: params.items,
          personalInfo: params.personalInfo,
          settings: params.settings,
          onProgress: params.onProgress,
          vaultDocs: params.vaultDocs,
          priorLetters: params.priorLetters,
        });

        // Assemble packets from generated letters for approval inbox
        for (const letter of cycle.letters) {
          const c = cases.find((x) => x.negativeItemId === letter.itemId);
          const item = byItem.get(letter.itemId);
          const plan = plans.find((p) => p.caseId === c?.id) || (c ? (await CasePlanService.getPlansForCase(c.id))[0] : undefined);
          if (!c || !item || !plan) continue;
          if (letter.status === 'blocked') continue;

          await CaseRepository.transition(c.id, 'DRAFTED', 'autopilot', { letterId: letter.id });
          const packet = await PacketAssembler.assemble({
            profileId: params.profileId,
            caseId: c.id,
            plan,
            letter,
            item,
            personalInfo: params.personalInfo,
            attachments: (params.vaultDocs || []).slice(0, 5).map((d) => ({
              id: d.id,
              name: d.name || d.id,
              category: d.category,
            })),
          });
          packets.push(packet);

          if (packet.status === 'validated') {
            if (mode === 'guided' || mode === 'review_each') {
              await AutopilotInboxService.upsertTask({
                profileId: params.profileId,
                caseId: c.id,
                type: 'approve',
                title: `Review and approve packet for ${c.creditorName}`,
                whyItMatters: 'Consumer approval is required before any external submission.',
                afterComplete: 'Packet becomes ready to dispatch with a bound content hash.',
                dedupeKey: `approve:${packet.id}`,
                payload: { packetId: packet.id, contentHash: packet.contentHash },
              });
            }
          }
        }

        for (const itemId of cycle.itemsRequiringAction || []) {
          const c = cases.find((x) => x.negativeItemId === itemId);
          await AutopilotInboxService.upsertTask({
            profileId: params.profileId,
            caseId: c?.id,
            type: 'review',
            title: 'Resolve pre-flight blocker',
            whyItMatters: 'This item failed pre-flight and was not drafted this cycle.',
            afterComplete: 'AutoPilot will include it in the next eligible cycle.',
            dedupeKey: `preflight:${itemId}`,
          });
        }
      }

      const refreshed = await CaseRepository.getCasesForProfile(params.profileId);
      const missionControl = await AutopilotInboxService.buildMissionControl({
        profileId: params.profileId,
        hasPersonalInfo: Boolean(params.personalInfo.firstName && params.personalInfo.address),
        hasReports: params.hasReports ?? params.items.length > 0,
        autopilotEnabled: params.settings.enabled,
      });

      await CaseRepository.appendEvent({
        profileId: params.profileId,
        type: 'orchestrator.cycle_complete',
        actor: 'autopilot',
        payload: {
          cycleId: cycle.cycleId,
          letters: cycle.lettersGenerated,
          packets: packets.length,
          gateFailures: gateFailures.length,
          mode,
        },
      });

      return { cycle, cases: refreshed, plans, packets, gateFailures, missionControl, grouping: cycleGrouping };
    } finally {
      await this.releaseLease(params.profileId, lease.jobId);
    }
  },

  async getMissionControl(params: {
    profileId: string;
    hasPersonalInfo: boolean;
    hasReports: boolean;
    autopilotEnabled: boolean;
  }): Promise<MissionControlStatus> {
    return AutopilotInboxService.buildMissionControl(params);
  },

  async answerFact(params: {
    profileId: string;
    caseId: string;
    field: string;
    value: unknown;
    taskId?: string;
  }): Promise<void> {
    await FactLedgerService.recordFact({
      profileId: params.profileId,
      caseId: params.caseId,
      field: params.field,
      value: params.value,
      sourceType: 'user',
      sourceId: params.taskId || `user:${params.field}`,
      confidence: 'confirmed',
      userConfirmedAt: new Date().toISOString(),
    });
    if (params.taskId) await AutopilotInboxService.completeTask(params.taskId);
    await CaseRepository.transition(params.caseId, 'ELIGIBLE', 'user', { field: params.field });
  },

  async approvePacket(packetId: string, mode: AutopilotMode = 'guided') {
    const packet = await PacketAssembler.getPacket(packetId);
    if (!packet) return { ok: false as const, error: 'Packet not found' };
    const result = await ApprovalService.approvePacket({ packet, mode });
    if (result.ok) {
      const tasks = await AutopilotInboxService.listTasks(packet.profileId, 'open');
      for (const t of tasks.filter((x) => x.payload?.packetId === packetId)) {
        await AutopilotInboxService.completeTask(t.id);
      }
    }
    return result;
  },

  async intakeResponse(params: {
    profileId: string;
    rawText: string;
    sourceFileName?: string;
    items: NegativeItem[];
  }): Promise<ResponseMatch> {
    const match = await ResponseIntakeService.intake(params);
    if (match.needsConfirmation) {
      await AutopilotInboxService.upsertTask({
        profileId: params.profileId,
        caseId: match.caseId,
        type: 'review',
        title: 'Confirm matched bureau response',
        whyItMatters: 'AutoPilot needs confirmation before updating strategy from this response.',
        afterComplete: 'Case outcome and next action will update automatically.',
        dedupeKey: `response:${match.id}`,
        payload: { matchId: match.id },
      });
    }
    return match;
  },

  async acquireLease(
    profileId: string,
    type: string,
  ): Promise<{ ok: boolean; jobId?: string; error?: string }> {
    const jobs = await idbGetAll<AutopilotJob>('autopilotJobs');
    const now = Date.now();
    const blocking = jobs.find(
      (j) =>
        j.profileId === profileId &&
        j.status === 'running' &&
        j.leaseExpiresAt &&
        new Date(j.leaseExpiresAt).getTime() > now,
    );
    if (blocking) {
      return { ok: false, error: `Profile lease held by job ${blocking.id}` };
    }
    const job: AutopilotJob = {
      id: uuidv4(),
      profileId,
      type,
      status: 'running',
      attemptCount: 1,
      maxAttempts: 5,
      scheduledAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      leaseOwner: 'orchestrator',
      leaseExpiresAt: new Date(now + LEASE_MS).toISOString(),
      payload: {},
    };
    await idbSet('autopilotJobs', job);
    return { ok: true, jobId: job.id };
  },

  async releaseLease(profileId: string, jobId?: string): Promise<void> {
    if (!jobId) return;
    const jobs = await idbGetAll<AutopilotJob>('autopilotJobs');
    const job = jobs.find((j) => j.id === jobId && j.profileId === profileId);
    if (!job) return;
    await idbSet('autopilotJobs', {
      ...job,
      status: 'completed',
      completedAt: new Date().toISOString(),
      leaseExpiresAt: new Date().toISOString(),
    });
  },

  /** Constrained batch selection overlay — never include blocked/waiting cases. */
  selectReadyCases(cases: AutopilotCase[], limit: number): AutopilotCase[] {
    const blocked = new Set(['WAITING', 'SENT', 'CLOSED', 'RESOLVED', 'DELETED', 'CORRECTED', 'EVIDENCE_NEEDED', 'FACTS_NEEDED']);
    return cases
      .filter((c) => !blocked.has(c.state) && c.priorityLabel !== 'Not currently actionable')
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, Math.max(1, limit));
  },
};

/** Convenience re-export so UI can treat orchestrator as the only entry. */
export async function runAutopilotCycle(params: OrchestratorCycleParams): Promise<OrchestratorCycleResult> {
  return AutopilotOrchestrator.runCycle(params);
}
