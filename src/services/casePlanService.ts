/**
 * casePlanService.ts — Ranked next action, alternatives, and stop rules.
 * Priority weights per FINAL-WORLD-CLASS overhaul §5.4.
 */

import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem } from '../types';
import type {
  AutopilotCase,
  CasePlan,
  CasePriorityBreakdown,
  CasePriorityLabel,
  GateName,
  GateResult,
} from '../types/autopilotCase';
import type { PassNumber } from '../types/creditRepair';
import { evaluateEvidenceReadiness, type EvidenceDoc, type EvidenceTier } from './evidenceGateService';
import { planItemStrategy } from './itemStrategyPlanner';
import { HoldQueue } from './holdQueue';
import { FactLedgerService } from './factLedgerService';
import { CaseRepository } from './caseRepository';
import { idbGetAll, idbSet } from './indexedDB';

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function labelFromBreakdown(total: number, evidenceTier: EvidenceTier): CasePriorityLabel {
  if (evidenceTier === 'BLOCKED' || total < 25) return 'Not currently actionable';
  if (evidenceTier === 'BASIC' || total < 45) return 'Needs evidence';
  if (total >= 70) return 'Strong case';
  return 'Promising';
}

function inferDisputeType(item: NegativeItem): Parameters<typeof evaluateEvidenceReadiness>[1] {
  const t = `${item.typeOfNegative || ''} ${item.status || ''}`.toLowerCase();
  if (t.includes('identity')) return 'identity_theft';
  if (t.includes('bankrupt')) return 'bankruptcy';
  if (t.includes('collection')) return 'collection';
  if (t.includes('charge')) return 'charge_off';
  if (t.includes('late')) return 'late_payment';
  if (t.includes('balance')) return 'balance_incorrect';
  return 'general';
}

export function computePriority(params: {
  item: NegativeItem;
  evidenceTier: EvidenceTier;
  evidenceScore: number;
  onHold: boolean;
  missingFacts: number;
  strategyFit?: number;
}): CasePriorityBreakdown {
  const { item, evidenceTier, evidenceScore, onHold, missingFacts } = params;
  const actionabilityConfidence = clamp(
    (item.priorityScore ?? 50) - missingFacts * 12 - (evidenceTier === 'BLOCKED' ? 30 : 0),
  );
  const evidenceReadiness = clamp(evidenceScore);
  const reportingInconsistency = /differ|inconsist|mismatch|conflict/i.test(item.additionalInfo || '')
    ? 80
    : 40;
  const impactNum = Number.parseInt(String(item.estimatedScoreImpact ?? ''), 10);
  const creditProfileRelevance = clamp(
    (Number.isFinite(impactNum) ? impactNum : undefined) || item.priorityScore || 45,
  );
  const timingUrgency = item.disputeDeadline
    ? clamp(100 - Math.max(0, Math.floor((new Date(item.disputeDeadline).getTime() - Date.now()) / 86400000)))
    : 35;
  const strategyFit = clamp(params.strategyFit ?? 50);
  const responseOpportunity = item.disputeStatus?.includes('Pending') ? 70 : 30;
  let riskPenalty = 0;
  if (onHold) riskPenalty += 40;
  if (missingFacts > 0) riskPenalty += missingFacts * 8;
  if (!item.accountNumber && !item.fullAccountNumber) riskPenalty += 10;
  if (evidenceTier === 'BLOCKED') riskPenalty += 25;

  const total = clamp(
    actionabilityConfidence * 0.25 +
      evidenceReadiness * 0.2 +
      reportingInconsistency * 0.15 +
      creditProfileRelevance * 0.15 +
      timingUrgency * 0.1 +
      strategyFit * 0.1 +
      responseOpportunity * 0.05 -
      riskPenalty,
  );

  return {
    actionabilityConfidence,
    evidenceReadiness,
    reportingInconsistency,
    creditProfileRelevance,
    timingUrgency,
    strategyFit,
    responseOpportunity,
    riskPenalty,
    total: Math.round(total * 10) / 10,
  };
}

export function evaluateGates(params: {
  profileId: string;
  item: NegativeItem;
  caseRecord: AutopilotCase;
  vaultDocs: EvidenceDoc[];
  missingFacts: string[];
  identityInfoConfirmed?: boolean;
}): GateResult[] {
  const { profileId, item, caseRecord, vaultDocs, missingFacts, identityInfoConfirmed } = params;
  const results: GateResult[] = [];

  const identityOk = Boolean(item.creditorName);
  results.push({
    gate: 'identity',
    passed: identityOk,
    reason: identityOk ? undefined : 'Item missing creditor identity',
    remediation: identityOk
      ? undefined
      : {
          taskType: 'review',
          title: 'Confirm account identity',
          whyItMatters: 'AutoPilot cannot plan a dispute without a stable account identity.',
        },
  });

  results.push({
    gate: 'merge',
    passed: true,
  });

  // Actionability requires known issue signals AND no outstanding accuracy facts.
  // Previously `passed: actionable || missingFacts.length > 0` inverted the gate so
  // missing facts always "passed" and Answer inbox tasks never fired.
  const hasIssueSignal =
    Boolean(item.additionalInfo) ||
    Boolean(item.typeOfNegative);
  const factsComplete = missingFacts.length === 0;
  const actionable = hasIssueSignal && factsComplete;
  results.push({
    gate: 'actionability',
    passed: actionable,
    reason: actionable
      ? undefined
      : !factsComplete
        ? 'Accuracy facts still needed before drafting'
        : 'No supportable issue identified yet',
    remediation:
      missingFacts.length > 0
        ? {
            taskType: 'answer',
            title: 'Answer accuracy questions',
            whyItMatters: 'A confirmed inaccuracy is required before drafting.',
            field: missingFacts[0],
          }
        : !hasIssueSignal
          ? {
              taskType: 'review',
              title: 'Identify disputable issue',
              whyItMatters: 'AutoPilot needs a concrete inaccuracy or negative type before drafting.',
            }
          : undefined,
  });

  results.push({
    gate: 'accuracy',
    passed: true,
  });

  const evidence = evaluateEvidenceReadiness(vaultDocs, inferDisputeType(item), { identityInfoConfirmed });
  results.push({
    gate: 'evidence',
    passed: evidence.canProceed,
    reason: evidence.canProceed ? undefined : evidence.rationale,
    remediation: evidence.canProceed
      ? undefined
      : {
          taskType: 'add',
          title: 'Add required evidence',
          whyItMatters: evidence.missingCritical[0] || 'Missing documents block a strong packet.',
        },
  });

  const onHold = HoldQueue.isOnHold(profileId, item.id);
  results.push({
    gate: 'timing',
    passed: !onHold,
    reason: onHold ? 'Case is on hold awaiting a response window' : undefined,
  });

  results.push({ gate: 'recipient', passed: true });
  results.push({ gate: 'strategy', passed: true });
  results.push({ gate: 'uniqueness', passed: true });
  results.push({ gate: 'legal', passed: true });
  results.push({ gate: 'packet', passed: caseRecord.state !== 'CLOSED' });
  results.push({
    gate: 'approval',
    passed: caseRecord.state !== 'READY_TO_DISPATCH' || Boolean(caseRecord.currentPacketId),
  });

  return results;
}

function firstFailed(gates: GateResult[]): GateResult | undefined {
  return gates.find((g) => !g.passed);
}

export const CasePlanService = {
  async listPlans(profileId: string): Promise<CasePlan[]> {
    const all = await idbGetAll<CasePlan>('casePlans');
    return all.filter((p) => p.profileId === profileId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getPlansForCase(caseId: string): Promise<CasePlan[]> {
    const all = await idbGetAll<CasePlan>('casePlans');
    return all.filter((p) => p.caseId === caseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async buildPlan(params: {
    profileId: string;
    caseRecord: AutopilotCase;
    item: NegativeItem;
    vaultDocs?: EvidenceDoc[];
    passNumbers?: Record<string, PassNumber>;
    identityInfoConfirmed?: boolean;
  }): Promise<{ plan: CasePlan; gates: GateResult[]; breakdown: CasePriorityBreakdown }> {
    const { profileId, caseRecord, item, vaultDocs = [], passNumbers = {}, identityInfoConfirmed } = params;
    const activeFacts = await FactLedgerService.getActiveFacts(caseRecord.id);
    const missingFacts = FactLedgerService.findMissingHighValueFields(activeFacts);
    const evidence = evaluateEvidenceReadiness(vaultDocs, inferDisputeType(item), { identityInfoConfirmed });
    const onHold = HoldQueue.isOnHold(profileId, item.id);
    const card = planItemStrategy(item, { passNumbers });
    const breakdown = computePriority({
      item,
      evidenceTier: evidence.tier,
      evidenceScore: evidence.score,
      onHold,
      missingFacts: missingFacts.length,
      strategyFit: card.explainWhy.length * 12,
    });
    const gates = evaluateGates({
      profileId,
      item,
      caseRecord,
      vaultDocs,
      missingFacts,
      identityInfoConfirmed,
    });
    const failed = firstFailed(gates);
    const factVersion = await FactLedgerService.getFactVersion(caseRecord.id);
    const snapshotVersion = caseRecord.snapshotVersion || 'none';

    const plan: CasePlan = {
      id: uuidv4(),
      profileId,
      caseId: caseRecord.id,
      snapshotVersion,
      factVersion,
      createdAt: new Date().toISOString(),
      recipientType: 'bureau',
      recipientName: caseRecord.bureau,
      strategy: card.primaryAngle || 'accuracy_challenge',
      passNumber: caseRecord.passNumber,
      explainWhy: card.explainWhy?.length
        ? card.explainWhy
        : [
            `Priority ${breakdown.total} (${labelFromBreakdown(breakdown.total, evidence.tier)})`,
            `Evidence tier: ${evidence.tier}`,
            `Pass ${caseRecord.passNumber} strategy selected from item facts`,
          ],
      evidenceUsed: evidence.availableDocs.map((d) => d.name || d.id),
      missingEvidence: evidence.missingCritical,
      earliestSafeActionAt: onHold ? null : new Date().toISOString(),
      deadlineAt: item.disputeDeadline,
      confidenceLabel: labelFromBreakdown(breakdown.total, evidence.tier),
      alternatives: (card.enrichmentActions || []).slice(0, 3).map((a: string) => ({
        strategy: a,
        recipient: caseRecord.bureau,
        reasonRejected: 'Enrichment alternative — primary angle preferred for current facts',
      })),
      failedGate: failed?.gate as GateName | undefined,
      remediationTaskType: failed?.remediation?.taskType,
    };

    await idbSet('casePlans', plan);
    await CaseRepository.saveCase({
      ...caseRecord,
      currentPlanId: plan.id,
      priorityScore: breakdown.total,
      priorityLabel: plan.confidenceLabel,
      priorityBreakdown: breakdown,
      evidenceTier: evidence.tier,
      factVersion,
      riskFlags: gates.filter((g) => !g.passed).map((g) => g.gate),
      updatedAt: new Date().toISOString(),
    });

    return { plan, gates, breakdown };
  },
};
