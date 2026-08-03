import type { NegativeItem } from '../../types';
import {
  buildTradelineMergePlan,
  decideMergeTier,
  stitchAccountNumbers,
  type MergeSignals,
  type PendingReviewMerge,
} from '../tradelineMerger';
import { type MergeCandidate, type MergeFactor } from './mergeSimilarityEngine';

export interface MergedAccountGroup {
  primary: NegativeItem;
  duplicates: NegativeItem[];
  allBureaus: string[];
  bestAccountNumber: string;
  mergeConfidence: number;
  mergeFactors: MergeFactor[];
  /** Shared campaign identity for LINK_ONLY pairs — AppContext should propagate to items. */
  campaignGroupId?: string;
}

export interface AutoMergeResult {
  mergedGroups: MergedAccountGroup[];
  suggestedMerges: MergeCandidate[];
  manualReviewItems: MergeCandidate[];
  linkOnlyPairs: PendingReviewMerge[];
  stats: {
    totalItems: number;
    autoMerged: number;
    suggestedCount: number;
    manualCount: number;
    linkOnlyCount: number;
    uniqueAccountsAfterMerge: number;
  };
}

function earliest(items: NegativeItem[]): string | null {
  const vals = items.map(i => i.dateOfFirstDelinquency ?? i.originalDateOfDelinquency).filter(Boolean) as string[];
  return vals.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;
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

function pendingToMergeCandidate(pending: PendingReviewMerge): MergeCandidate {
  const stitched = stitchAccountNumbers([pending.left, pending.right]);
  return {
    itemA: pending.left,
    itemB: pending.right,
    score: Math.round(pending.confidence * 100),
    factors: signalsToFactors(pending.signals),
    decision: pending.decision === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'SUGGEST_MERGE',
    mergedAccountNumber: stitched.accountNumber || null,
  };
}

function buildPrimaryFromGroup(members: NegativeItem[], bestAccountNumber: string, allBureaus: string[]): NegativeItem {
  const base = members[0];
  const balances = members.map(x => x.balance).filter((x): x is number => x != null);
  const dofd = earliest(members);
  return {
    ...base,
    accountNumber: bestAccountNumber,
    fullAccountNumber: bestAccountNumber,
    creditBureau: allBureaus,
    balance: balances.length ? Math.max(...balances) : base.balance,
    dateOfFirstDelinquency: dofd,
    originalDateOfDelinquency: dofd,
  };
}

export function runAutoMerge(items: NegativeItem[]): AutoMergeResult {
  const plan = buildTradelineMergePlan(items);
  const used = new Set<string>();
  const mergedGroups: MergedAccountGroup[] = [];

  for (const unified of plan.autoMerged) {
    const sorted = [...unified.sourceItems].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
    const [primary, ...duplicates] = sorted;
    const stitched = stitchAccountNumbers(unified.sourceItems);
    const edgeFactors = unified.sourceItems.length >= 2
      ? signalsToFactors(decideMergeTier(unified.sourceItems[0], unified.sourceItems[1]).signals)
      : [];
    mergedGroups.push({
      primary: buildPrimaryFromGroup([primary, ...duplicates], stitched.accountNumber, unified.bureaus),
      duplicates,
      allBureaus: unified.bureaus,
      bestAccountNumber: stitched.accountNumber,
      mergeConfidence: unified.mergeConfidence,
      mergeFactors: edgeFactors,
    });
    for (const member of unified.sourceItems) used.add(member.id);
  }

  const linkCampaignByItem = new Map<string, string>();
  for (const link of plan.linkOnlyPairs) {
    if (!link.campaignGroupId) continue;
    linkCampaignByItem.set(link.leftId, link.campaignGroupId);
    linkCampaignByItem.set(link.rightId, link.campaignGroupId);
  }

  for (const item of items) {
    if (used.has(item.id)) continue;
    mergedGroups.push({
      primary: item,
      duplicates: [],
      allBureaus: [...(item.creditBureau ?? [])],
      bestAccountNumber: item.fullAccountNumber ?? item.accountNumber,
      mergeConfidence: 1,
      mergeFactors: [],
      campaignGroupId: linkCampaignByItem.get(item.id),
    });
    used.add(item.id);
  }

  const suggestedMerges = plan.pendingReviewMerges
    .filter(p => p.decision === 'SUGGEST')
    .map(pendingToMergeCandidate);
  const manualReviewItems = plan.pendingReviewMerges
    .filter(p => p.decision === 'MANUAL_REVIEW')
    .map(pendingToMergeCandidate);

  return {
    mergedGroups,
    suggestedMerges,
    manualReviewItems,
    linkOnlyPairs: plan.linkOnlyPairs,
    stats: {
      totalItems: items.length,
      autoMerged: plan.autoMerged.reduce((n, g) => n + g.sourceItems.length - 1, 0),
      suggestedCount: suggestedMerges.length,
      manualCount: manualReviewItems.length,
      linkOnlyCount: plan.linkOnlyPairs.length,
      uniqueAccountsAfterMerge: mergedGroups.length,
    },
  };
}
