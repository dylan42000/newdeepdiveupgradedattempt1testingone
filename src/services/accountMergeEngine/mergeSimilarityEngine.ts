import type { NegativeItem } from '../../types';
import {
  decideMergeTier,
  stitchAccountNumbers,
  type MergeDecisionTier,
  type MergeSignals,
} from '../tradelineMerger';

export type MergeDecision = 'AUTO_MERGE' | 'SUGGEST_MERGE' | 'MANUAL_REVIEW' | 'NO_MERGE';
export interface MergeFactor { name: string; weight: number; score: number; contribution: number }
export interface MergeCandidate {
  itemA: NegativeItem;
  itemB: NegativeItem;
  score: number;
  factors: MergeFactor[];
  decision: MergeDecision;
  mergedAccountNumber: string | null;
}

function mapDecisionTier(tier: MergeDecisionTier): MergeDecision {
  switch (tier) {
    case 'AUTO_MERGE':
      return 'AUTO_MERGE';
    case 'SUGGEST':
      return 'SUGGEST_MERGE';
    case 'MANUAL_REVIEW':
      return 'MANUAL_REVIEW';
    case 'LINK_ONLY':
      return 'SUGGEST_MERGE';
    case 'HARD_REFUSE':
    case 'NO_MERGE':
      return 'NO_MERGE';
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

function signalsToFactors(signals: MergeSignals): MergeFactor[] {
  const factors: MergeFactor[] = [];
  const add = (name: string, weight: number, score: number | null) => {
    if (score == null) return;
    const scaled = Math.round(score * 100);
    factors.push({ name, weight, score: scaled, contribution: (weight * scaled) / 100 });
  };
  add('creditorName', 34, signals.creditorName);
  add('accountNumber', 30, signals.accountNumber);
  add('balance', 16, signals.balance);
  add('dateOpenedOrDofd', 14, signals.dateOpenedOrDofd);
  add('accountType', 6, signals.accountType);
  return factors;
}

export function reconstructBestAccountNumber(a = '', b = ''): string | null {
  const stitched = stitchAccountNumbers([
    { accountNumber: a, fullAccountNumber: a } as NegativeItem,
    { accountNumber: b, fullAccountNumber: b } as NegativeItem,
  ]);
  return stitched.accountNumber || null;
}

export function scoreMergeCandidates(itemA: NegativeItem, itemB: NegativeItem): MergeCandidate {
  const candidate = decideMergeTier(itemA, itemB);
  const stitched = stitchAccountNumbers([itemA, itemB]);
  return {
    itemA,
    itemB,
    score: Math.round(candidate.confidence * 100),
    factors: signalsToFactors(candidate.signals),
    decision: mapDecisionTier(candidate.decision),
    mergedAccountNumber: stitched.accountNumber || null,
  };
}
