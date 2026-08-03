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
  onStatusUpdate?: (planItem: any, pass: any) => void;
}

export interface OrchestratorCycleResult {
  cycle: AutoPilotCycleResult;
  cases: AutopilotCase[];
  plans: CasePlan[];
  packets: DispatchPacket[];
  gateFailures: Array<{ caseId: string; gates: GateResult[] }>;
  missionControl: MissionControlStatus;
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

        const identityConfirmed = Boolean(
          (params.settings as Partial<AutoPilotSettingsV3>).identityInfoConfirmed ||
          params.personalInfo.identityInfoConfirmed,
        );
        const { plan, gates } = await CasePlanService.buildPlan({
          profileId: params.profileId,
          caseRecord: c,
          item,
          vaultDocs: params.vaultDocs,
          passNumbers,
          identityInfoConfirmed: identityConfirmed,
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

      return { cycle, cases: refreshed, plans, packets, gateFailures, missionControl };
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
