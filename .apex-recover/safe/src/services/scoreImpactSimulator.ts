/**
 * Score Impact Simulator (Apex AD-11) — local heuristic range estimate (not FICO).
 */

import type { NegativeItem } from '../types';

export interface ScoreImpactRange {
  low: number;
  mid: number;
  high: number;
  factor: string;
  disclaimer: string;
}

export const SCORE_SIM_DISCLAIMER =
  'Estimate only — not a FICO® or VantageScore® calculation. Actual lender scores vary.';

const IMPACTS: Record<string, { low: number; mid: number; high: number }> = {
  collection: { low: 15, mid: 28, high: 45 },
  charge_off: { low: 18, mid: 32, high: 50 },
  bankruptcy: { low: 40, mid: 70, high: 110 },
  foreclosure: { low: 30, mid: 55, high: 85 },
  repossession: { low: 25, mid: 45, high: 75 },
  late: { low: 8, mid: 18, high: 35 },
  judgment: { low: 20, mid: 40, high: 65 },
  inquiry: { low: 2, mid: 5, high: 12 },
  default: { low: 10, mid: 22, high: 40 },
};

function ageFactor(item: NegativeItem): number {
  const raw = item.originalDateOfDelinquency || item.dateOfFirstDelinquency || item.dateOpened;
  if (!raw) return 1;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return 1;
  const years = (Date.now() - t) / (1000 * 60 * 60 * 24 * 365);
  if (years > 5) return 0.45;
  if (years > 3) return 0.65;
  if (years > 2) return 0.8;
  return 1;
}

function pickBucket(item: NegativeItem): keyof typeof IMPACTS {
  const type = `${item.typeOfNegative} ${item.accountType}`.toLowerCase();
  if (type.includes('bankruptcy')) return 'bankruptcy';
  if (type.includes('foreclosure')) return 'foreclosure';
  if (type.includes('repossession') || type.includes('repo')) return 'repossession';
  if (type.includes('judgment') || type.includes('lien')) return 'judgment';
  if (type.includes('inquir')) return 'inquiry';
  if (type.includes('charge')) return 'charge_off';
  if (type.includes('collection')) return 'collection';
  if (type.includes('late')) return 'late';
  return 'default';
}

export function estimateScoreImpactRange(item: NegativeItem): ScoreImpactRange {
  const bucket = pickBucket(item);
  const base = IMPACTS[bucket];
  const af = ageFactor(item);
  return {
    low: Math.max(1, Math.round(base.low * af)),
    mid: Math.max(2, Math.round(base.mid * af)),
    high: Math.max(3, Math.round(base.high * af)),
    factor: bucket,
    disclaimer: SCORE_SIM_DISCLAIMER,
  };
}

export function simulateRemovals(items: NegativeItem[]): ScoreImpactRange {
  if (items.length === 0) {
    return { low: 0, mid: 0, high: 0, factor: 'none', disclaimer: SCORE_SIM_DISCLAIMER };
  }
  const ranges = items.map(estimateScoreImpactRange);
  // Diminishing returns for stacks
  const damp = (n: number, idx: number) => n * Math.pow(0.85, idx);
  const sorted = [...ranges].sort((a, b) => b.mid - a.mid);
  const low = Math.round(sorted.reduce((s, r, i) => s + damp(r.low, i), 0));
  const mid = Math.round(sorted.reduce((s, r, i) => s + damp(r.mid, i), 0));
  const high = Math.round(sorted.reduce((s, r, i) => s + damp(r.high, i), 0));
  return { low, mid, high, factor: 'portfolio', disclaimer: SCORE_SIM_DISCLAIMER };
}
