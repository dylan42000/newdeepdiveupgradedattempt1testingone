/**
 * scoreImpactProjector.ts — Score Impact Projector + Smart Prioritization (v5.1.0)
 *
 * Calculates the estimated negative score impact of each item and projects the
 * potential score recovery if the item were deleted or corrected.
 *
 * Used by BatchSelector to ensure each AutoPilot cycle maximizes score recovery.
 * Higher expectedValueScore = dispute this item first.
 *
 * Formula: expectedValueScore = projectedGainIfDeleted × deletionProbability / 100
 */

import type { NegativeItem } from '../types';
import { runExpirationRadar } from './expirationRadarService';
import { auditMetro2, Metro2AuditInput } from './metro2AuditService';
import { analyzeChainOfCustody } from './furnisherChainOfCustodyService';

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface ScoreImpactProjection {
  itemId: string;
  creditorName: string;
  currentImpact: number;                // Estimated negative score impact RIGHT NOW
  projectedGainIfDeleted: number;       // Estimated score gain if deleted
  projectedGainIfCorrected: number;     // Score gain if just corrected/updated
  deletionProbability: number;          // 0-100 calculated from all factors
  expectedValueScore: number;           // projectedGain × deletionProbability / 100
  disputePriority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string[];
}

// ─── MAIN PROJECTOR ───────────────────────────────────────────────────────────

/**
 * Project score impact for a list of negative items.
 * Returns results sorted by expectedValueScore (highest first) — ideal for batch selection.
 */
export function projectScoreImpact(items: NegativeItem[]): ScoreImpactProjection[] {
  return items.map(item => _projectSingle(item))
    .sort((a, b) => b.expectedValueScore - a.expectedValueScore);
}

/**
 * Get the score impact projection for a single item.
 */
export function projectSingleItemImpact(item: NegativeItem): ScoreImpactProjection {
  return _projectSingle(item);
}

// ─── PRIVATE CALCULATION ENGINE ───────────────────────────────────────────────

function _projectSingle(item: NegativeItem): ScoreImpactProjection {
  const typeFactor = _calculateTypeFactor(item);
  const ageFactor = _calculateAgeFactor(item);
  const balanceFactor = _calculateBalanceFactor(item);
  const bureauCountFactor = (item.creditBureau ?? []).length;
  const expirationFactor = _calculateExpirationFactor(item);

  // Estimate current negative score impact
  const currentImpact = Math.round(
    (typeFactor * 0.40) +
    (balanceFactor * 0.20) +
    (ageFactor * 0.20) +
    (bureauCountFactor * 8) +
    10  // base impact floor
  );

  // Score gain estimate on deletion (slightly exceeds current impact due to ripple effects)
  const projectedGainIfDeleted = Math.min(100, Math.round(
    currentImpact * 1.1 +
    (bureauCountFactor * 5) +
    expirationFactor
  ));

  // Deletion probability from all available signals
  const deletionProbability = _calculateDeletionProbability(item);

  // Expected value = projected gain × probability of getting it
  const expectedValueScore = Math.round(
    (projectedGainIfDeleted * deletionProbability) / 100
  );

  // Build reasoning list
  const reasoning: string[] = [];
  if (typeFactor > 25) reasoning.push(`High-impact account type: ${item.typeOfNegative}`);
  if (bureauCountFactor === 3) reasoning.push('Reporting on all 3 bureaus — triple negative impact');
  if (bureauCountFactor === 2) reasoning.push('Reporting on 2 bureaus — double negative impact');
  if (expirationFactor > 20) reasoning.push('Near 7-year expiration — high deletion probability');
  if (expirationFactor === 40) reasoning.push('⚠️ EXPIRED: Past 7-year FCRA limit — demand deletion immediately');
  if (item.balance === 0 || item.balance === null) reasoning.push('Paid account — goodwill + dispute both viable');
  if (balanceFactor > 15) reasoning.push(`High balance ($${item.balance}) adds score impact`);

  return {
    itemId: item.id,
    creditorName: item.creditorName,
    currentImpact,
    projectedGainIfDeleted,
    projectedGainIfCorrected: Math.round(projectedGainIfDeleted * 0.4),
    deletionProbability,
    expectedValueScore,
    disputePriority:
      expectedValueScore >= 30 ? 'URGENT' :
        expectedValueScore >= 20 ? 'HIGH' :
          expectedValueScore >= 10 ? 'MEDIUM' : 'LOW',
    reasoning,
  };
}

// ─── FACTOR CALCULATORS ───────────────────────────────────────────────────────

function _calculateTypeFactor(item: NegativeItem): number {
  const type = (item.typeOfNegative ?? '').toLowerCase();
  if (type.includes('collection')) return 35;
  if (type.includes('charge-off') || type.includes('charge off')) return 32;
  if (type.includes('repossession')) return 30;
  if (type.includes('foreclosure')) return 30;
  if (type.includes('bankruptcy')) return 28;
  if (type.includes('judgment')) return 26;
  if (type.includes('late 120')) return 22;
  if (type.includes('late 90')) return 18;
  if (type.includes('late 60')) return 14;
  if (type.includes('late 30')) return 10;
  if (type.includes('inquiry')) return 5;
  return 15;
}

function _calculateAgeFactor(item: NegativeItem): number {
  const dofdStr = item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency;
  if (!dofdStr) return 10;
  const dofd = new Date(dofdStr);
  if (isNaN(dofd.getTime())) return 10;
  const yearsOld = (Date.now() - dofd.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  // Newer items hurt score more; older items are less impactful
  if (yearsOld < 1) return 30;
  if (yearsOld < 2) return 25;
  if (yearsOld < 3) return 20;
  if (yearsOld < 4) return 15;
  if (yearsOld < 5) return 10;
  if (yearsOld < 6) return 8;
  return 5;
}

function _calculateBalanceFactor(item: NegativeItem): number {
  const balance = item.balance ?? 0;
  if (balance <= 0) return 0;
  if (balance < 200) return 5;
  if (balance < 1000) return 10;
  if (balance < 5000) return 15;
  if (balance < 10000) return 20;
  return 25;
}

function _calculateExpirationFactor(item: NegativeItem): number {
  try {
    const radar = runExpirationRadar([item]);
    if (radar.length === 0) return 0;
    switch (radar[0].status) {
      case 'EXPIRED': return 40;
      case 'IMMINENT': return 25;
      case 'APPROACHING': return 10;
      default: return 0;
    }
  } catch {
    return 0;
  }
}

function _calculateDeletionProbability(item: NegativeItem): number {
  let base = 30; // Baseline deletion probability

  // Metro 2 violations boost probability
  try {
    const metro2Input: Metro2AuditInput = {
      status: item.status ?? '',
      balance: item.balance ?? 0,
      paymentHistory: (item as any).paymentHistoryProfile ? (item as any).paymentHistoryProfile.split('') : [],
      dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null,
      dateOpened: item.dateOpened ?? item.originalOpeningDate ?? null,
      creditLimit: item.creditLimit ?? (item as any).highCredit ?? null,
      accountType: item.accountType ?? '',
      currentRating: (item as any).currentRating ?? '',
      portfolioType: (item as any).portfolioType ?? '',
      specialComment: (item as any).specialComment ?? null,
      complianceConditionCode: (item as any).complianceConditionCode ?? null,
      crossBureauDofds: [item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null],
      crossBureauStatuses: [item.status ?? ''],
      crossBureauDateOpened: [item.dateOpened ?? item.originalOpeningDate ?? null]
    };
    const violations = auditMetro2(metro2Input);
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    base += criticalViolations.length * 15;
    const highViolations = violations.filter(v => v.severity === 'high');
    base += highViolations.length * 7;
  } catch {
    // Non-blocking — metro2 audit is optional signal
  }

  // Expiration proximity boosts probability
  try {
    const radar = runExpirationRadar([item]);
    if (radar.length > 0) base += radar[0].urgencyScore * 0.4;
  } catch {
    // Non-blocking
  }

  // Debt buyer boosts probability
  try {
    const custody = analyzeChainOfCustody(item);
    if (custody.isDebtBuyer) base += 15;
  } catch {
    // Non-blocking
  }

  // Paid account boosts probability (goodwill viable)
  if (item.balance === 0 || item.balance === null) base += 10;

  // Medical debt — CFPB protections 2024+
  const type = (item.typeOfNegative ?? '').toLowerCase();
  if (type.includes('medical')) base += 20;

  return Math.min(95, Math.round(base));
}
