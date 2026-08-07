/**
 * itemStrategyPlanner.ts — Per-item Autopilot Strategy Cards (deterministic)
 * Fuses bureau, pass, Metro2, SOL, evidence, frivolous, inertia, and prior outcomes
 * into a durable explainable plan before letter generation.
 */

import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem } from '../types';
import type { PassNumber } from '../types/creditRepair';
import { selectNextAngle, type DisputeAngle } from './disputeAngleRotator';
import { getPriorOutcomesForItem, getCreditorSuccessRate } from './disputeOutcomeTracker';
import type { InertiaAction } from './inertiaEscalationService';
import type { EvidenceDoc } from './evidenceGateService';
import { evaluateEvidenceReadiness } from './evidenceGateService';
import { planApexItemStrategy } from './apexItemStrategyPlanner';

export interface ItemStrategyCard {
  id: string;
  itemId: string;
  pass: number;
  bureauTargets: string[];
  furnisherTarget?: string;
  primaryAngle: string;
  metro2Hooks: string[];
  legalAnchors: string[];
  evidenceTier: string;
  frivolousRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  solDaysRemaining: number | null;
  crossBureauConflicts: string[];
  priorOutcomes: string[];
  batchDiversityTags: string[];
  explainWhy: string[];
  blockReasons: string[];
  enrichmentActions: string[];
  inertiaTier?: InertiaAction;
  holdReason?: string;
  slaDueDate?: string | null;
  uniquenessFloor?: number;
  campaignGroupId?: string | null;
}

export interface StrategyPlanContext {
  passNumbers: Record<string, PassNumber>;
  dualTargetMode?: boolean;
  vaultDocs?: EvidenceDoc[];
  inertiaByItem?: Record<string, InertiaAction>;
  holdReasons?: Record<string, string>;
  crossBureauConflictsByItem?: Record<string, string[]>;
  metro2ByItem?: Record<string, string[]>;
  priorAnglesByItem?: Record<string, string[]>;
}

const PASS_LEGAL_ANCHORS: Record<number, string[]> = {
  1: ['15 U.S.C. §1681i(a)(1)'],
  2: ['15 U.S.C. §1681i(a)(1)', '15 U.S.C. §1681i(a)(6)'],
  3: ['15 U.S.C. §1681s-2(a)(8)', '12 C.F.R. §1022.43'],
  4: ['15 U.S.C. §1681i(a)(6)', '15 U.S.C. §1681i(a)(7)'],
  5: ['CFPB Complaint Authority'],
  6: ['FCRA §616', 'FCRA §617', 'FCRA §611', 'FCRA §623'],
};

function solDaysRemaining(item: NegativeItem): number | null {
  if (!item.autoRemovalDate) return null;
  const days = Math.floor(
    (new Date(item.autoRemovalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  return Number.isFinite(days) ? days : null;
}

function mapFrivolous(risk: DisputeAngle['frivolousRisk'], verifiedCount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (verifiedCount >= 2) return 'HIGH';
  switch (risk) {
    case 'LOW':
      return 'LOW';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'HIGH':
      return 'HIGH';
    default: {
      const _exhaustive: never = risk;
      return _exhaustive;
    }
  }
}

function evidenceTierLabel(vaultDocs: EvidenceDoc[], identityConfirmed?: boolean, identityDocId?: string): string {
  if (!vaultDocs.length && !identityConfirmed && !identityDocId) return 'none';
  try {
    const readiness = evaluateEvidenceReadiness(vaultDocs, 'general', { identityInfoConfirmed: identityConfirmed, identityDocId });
    switch (readiness.tier) {
      case 'AUDIT_PROOF':
        return 'audit_proof';
      case 'STRONG':
        return 'strong';
      case 'BASIC':
        return 'basic';
      case 'BLOCKED':
        return 'blocked';
      default: {
        const _exhaustive: never = readiness.tier;
        return _exhaustive;
      }
    }
  } catch {
    return 'unknown';
  }
}

export function planItemStrategy(
  item: NegativeItem,
  ctx: StrategyPlanContext,
): ItemStrategyCard {
  const pass = (ctx.passNumbers[item.id] ?? 1) as number;
  const bureaus = item.creditBureau ?? [];
  const priorOutcomes = getPriorOutcomesForItem(item.id).map(
    (o) => `${o.outcome}@${o.bureau}/pass${o.passNumber}`,
  );
  const verifiedSameBasis = getPriorOutcomesForItem(item.id).filter(
    (o) => o.outcome === 'verified',
  );
  const priorAngles = ctx.priorAnglesByItem?.[item.id] ?? [];
  // Force rotation after 2× verified
  const forcedPrior =
    verifiedSameBasis.length >= 2
      ? [...priorAngles, ...(priorAngles.length ? [] : ['CANNOT_VERIFY', 'DOFD_INACCURATE'])]
      : priorAngles;

  const metro2Hooks = ctx.metro2ByItem?.[item.id] ?? [];
  const crossBureauConflicts = ctx.crossBureauConflictsByItem?.[item.id] ?? [];
  const angle = selectNextAngle(
    item,
    forcedPrior,
    Math.min(6, Math.max(1, pass)) as 1 | 2 | 3 | 4 | 5 | 6,
    metro2Hooks.map((code) => ({ code, description: code })),
    crossBureauConflicts.map((field) => ({ field, description: field })),
  );

  const frivolousRisk = mapFrivolous(angle.frivolousRisk, verifiedSameBasis.length);
  const creditorStats = getCreditorSuccessRate(item.creditorName);
  const solDays = solDaysRemaining(item);
  const evidenceTier = evidenceTierLabel(ctx.vaultDocs ?? []);
  const inertiaTier = ctx.inertiaByItem?.[item.id] ?? 'none';
  const holdReason = ctx.holdReasons?.[item.id];
  const legalAnchors = PASS_LEGAL_ANCHORS[pass] ?? PASS_LEGAL_ANCHORS[1];

  const blockReasons: string[] = [];
  const enrichmentActions: string[] = [];

  if (evidenceTier === 'blocked' || evidenceTier === 'basic') {
    blockReasons.push('Evidence packet below Autopilot quality floor — enrich vault docs before send.');
    enrichmentActions.push('Attach government ID / proof of address / account statements from vault');
  }
  if (frivolousRisk === 'HIGH' && verifiedSameBasis.length >= 2) {
    blockReasons.push('Two prior verifications on similar basis — refuse identical legal basis; rotate or hold.');
  }
  if (!item.accountNumber && !item.fullAccountNumber) {
    enrichmentActions.push('Stitch or confirm account number; Pass 1 may pivot to disclosure');
  }
  if (!item.disputeContactAddress && ctx.dualTargetMode) {
    enrichmentActions.push('Run address research for furnisher dual-target');
  }

  const explainWhy: string[] = [
    `Pass ${pass} posture with anchors ${legalAnchors.join(', ')}.`,
    `Primary angle ${angle.code}: ${angle.description} (${angle.legalBasis}).`,
    frivolousRisk === 'HIGH'
      ? `Frivolous risk HIGH — ${verifiedSameBasis.length} prior verification(s); rotation enforced.`
      : `Frivolous risk ${frivolousRisk}; creditor historical deletion rate ${Math.round(creditorStats.rate * 100)}% (${creditorStats.total} samples).`,
  ];
  if (metro2Hooks.length) {
    explainWhy.push(`Metro2 hooks: ${metro2Hooks.slice(0, 3).join(', ')}.`);
  } else {
    explainWhy.push(`Evidence tier ${evidenceTier}; SOL days remaining: ${solDays ?? 'n/a'}.`);
  }
  if (inertiaTier !== 'none') {
    explainWhy.push(`Inertia tier "${inertiaTier}" fired — strategy cites stalled-outcome escalation.`);
  }
  if (crossBureauConflicts.length) {
    explainWhy.push(`Cross-bureau conflicts: ${crossBureauConflicts.slice(0, 2).join('; ')}.`);
  }

  // Apex enrichment (read-only overlay) — never overrides V2 angle selection.
  try {
    const apex = planApexItemStrategy({
      item,
      pass: Math.min(6, Math.max(1, pass)) as 1 | 2 | 3 | 4 | 5 | 6,
    });
    for (const card of apex.explainWhy.slice(0, 2)) {
      const line = card.legalBasis
        ? `${card.headline}: ${card.detail} (${card.legalBasis})`
        : `${card.headline}: ${card.detail}`;
      if (!explainWhy.some((e) => e.startsWith(card.headline))) {
        explainWhy.push(line);
      }
    }
    if (apex.blockReasons.length) {
      blockReasons.push(...apex.blockReasons.slice(0, 2));
    }
  } catch {
    /* Apex overlay is best-effort; V2 card remains authoritative */
  }

  while (explainWhy.length < 3) {
    explainWhy.push(`Bureau targets: ${bureaus.join(', ') || 'unspecified'}.`);
  }

  const batchDiversityTags = [
    angle.code,
    `pass-${pass}`,
    `risk-${frivolousRisk.toLowerCase()}`,
    ...(bureaus[0] ? [`bureau-${bureaus[0].toLowerCase().replace(/\s+/g, '')}`] : []),
  ];

  return {
    id: uuidv4(),
    itemId: item.id,
    pass,
    bureauTargets: bureaus,
    furnisherTarget: ctx.dualTargetMode ? item.creditorName : undefined,
    primaryAngle: angle.code,
    metro2Hooks,
    legalAnchors,
    evidenceTier,
    frivolousRisk,
    solDaysRemaining: solDays,
    crossBureauConflicts,
    priorOutcomes,
    batchDiversityTags,
    explainWhy: explainWhy.slice(0, 6),
    blockReasons,
    enrichmentActions,
    inertiaTier,
    holdReason,
    slaDueDate: item.disputeDeadline ?? null,
    uniquenessFloor: 70,
    campaignGroupId: item.campaignGroupId ?? item.crossBureauGroupId ?? null,
  };
}

export function planBatchStrategies(
  items: NegativeItem[],
  ctx: StrategyPlanContext,
): ItemStrategyCard[] {
  return items.map((item) => planItemStrategy(item, ctx));
}

export function strategyHintsFromCards(
  cards: ItemStrategyCard[],
): Record<string, { primaryAngle: string; frivolousRisk: string }> {
  const hints: Record<string, { primaryAngle: string; frivolousRisk: string }> = {};
  for (const card of cards) {
    hints[card.itemId] = {
      primaryAngle: card.primaryAngle,
      frivolousRisk: card.frivolousRisk,
    };
  }
  return hints;
}
