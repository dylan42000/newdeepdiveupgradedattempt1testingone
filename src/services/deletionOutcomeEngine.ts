import { NegativeItem, DisputeLetter } from '../types';
import { recordOutcome, type DisputeOutcome } from './disputeOutcomeTracker';

export interface StrategyWeight {
  bureau: string;
  creditorName: string;
  successRate: number;
  recommendedStrategy: string;
  totalAttempts: number;
  historicalMetrics: {
    deletions: number;
    verifications: number;
    updates: number;
    noResponse: number;
  };
}

export type OutcomeDetectionResult =
  | 'DELETED'
  | 'BALANCE_REDUCED'
  | 'STATUS_CHANGED'
  | 'ACCOUNT_UPDATED'
  | 'VERIFIED_UNCHANGED'
  | 'NOT_DETERMINABLE';

export interface AutoDetectedOutcome {
  itemId: string;
  creditorName: string;
  bureau: string;
  outcome: OutcomeDetectionResult;
  previousState: Partial<NegativeItem>;
  newState: Partial<NegativeItem> | null;
  confidenceScore: number;
  detectedAt: string;
  scoreImpactEstimate: number;
  nextAction: string;
}

export interface HandleResponseSinkPayload {
  itemId: string;
  bureau: string;
  outcome: 'deleted' | 'verified' | 'updated' | 'no_response' | 'frivolous';
  creditorName: string;
}

export function mapDetectionToDisputeOutcome(
  detection: OutcomeDetectionResult,
): DisputeOutcome {
  switch (detection) {
    case 'DELETED':
      return 'deleted';
    case 'BALANCE_REDUCED':
    case 'STATUS_CHANGED':
    case 'ACCOUNT_UPDATED':
      return 'modified';
    case 'VERIFIED_UNCHANGED':
      return 'verified';
    case 'NOT_DETERMINABLE':
      return 'in_progress';
    default: {
      const _exhaustive: never = detection;
      return _exhaustive;
    }
  }
}

export function mapDetectionToHandleResponseOutcome(
  detection: OutcomeDetectionResult,
): HandleResponseSinkPayload['outcome'] {
  switch (detection) {
    case 'DELETED':
      return 'deleted';
    case 'BALANCE_REDUCED':
    case 'STATUS_CHANGED':
    case 'ACCOUNT_UPDATED':
      return 'updated';
    case 'VERIFIED_UNCHANGED':
      return 'verified';
    case 'NOT_DETERMINABLE':
      return 'no_response';
    default: {
      const _exhaustive: never = detection;
      return _exhaustive;
    }
  }
}

/**
 * Automatically detect dispute outcomes by comparing a newly parsed report
 * against the set of actively disputed items.
 */
export async function detectOutcomesFromNewReport(
  newReportItems: NegativeItem[],
  activeDisputeItems: NegativeItem[],
  sentLetters: DisputeLetter[]
): Promise<AutoDetectedOutcome[]> {
  const outcomes: AutoDetectedOutcome[] = [];

  for (const disputedItem of activeDisputeItems) {
    const itemLetters = sentLetters.filter(
      l => l.negativeItemIds.includes(disputedItem.id) && l.status === 'Sent'
    );
    if (itemLetters.length === 0) continue;

    const newReportMatch = _findMatchingItemInReport(disputedItem, newReportItems);

    if (!newReportMatch) {
      outcomes.push({
        itemId: disputedItem.id,
        creditorName: disputedItem.creditorName,
        bureau: disputedItem.creditBureau[0] ?? 'Unknown',
        outcome: 'DELETED',
        previousState: {
          balance: disputedItem.balance,
          typeOfNegative: disputedItem.typeOfNegative,
          status: disputedItem.status,
        },
        newState: null,
        confidenceScore: 90,
        detectedAt: new Date().toISOString(),
        scoreImpactEstimate: _estimateScoreImpact(disputedItem, 'DELETED'),
        nextAction: '🎉 DELETED! Remove from active dispute queue. Log deletion for success metrics.',
      });
    } else {
      const outcome = _compareItemStates(disputedItem, newReportMatch);
      outcomes.push({
        itemId: disputedItem.id,
        creditorName: disputedItem.creditorName,
        bureau: disputedItem.creditBureau[0] ?? 'Unknown',
        outcome,
        previousState: {
          balance: disputedItem.balance,
          typeOfNegative: disputedItem.typeOfNegative,
          status: disputedItem.status,
          dateOfFirstDelinquency: disputedItem.dateOfFirstDelinquency,
        },
        newState: {
          balance: newReportMatch.balance,
          typeOfNegative: newReportMatch.typeOfNegative,
          status: newReportMatch.status,
        },
        confidenceScore: 85,
        detectedAt: new Date().toISOString(),
        scoreImpactEstimate: _estimateScoreImpact(disputedItem, outcome, newReportMatch),
        nextAction: _getNextAction(outcome),
      });
    }
  }

  const priority: Record<OutcomeDetectionResult, number> = {
    DELETED: 0,
    BALANCE_REDUCED: 1,
    STATUS_CHANGED: 2,
    ACCOUNT_UPDATED: 3,
    VERIFIED_UNCHANGED: 4,
    NOT_DETERMINABLE: 5,
  };
  return outcomes.sort((a, b) => (priority[a.outcome] ?? 5) - (priority[b.outcome] ?? 5));
}

/** Apply detected upload outcomes through the same sink as manual handleResponse. */
export async function applyDetectedOutcomesToSink(
  outcomes: AutoDetectedOutcome[],
  sinkFn: (payload: HandleResponseSinkPayload) => Promise<void> | void,
): Promise<void> {
  for (const detected of outcomes) {
    const mapped = mapDetectionToHandleResponseOutcome(detected.outcome);
    DeletionOutcomeEngine.captureOutcome(
      detected.bureau,
      detected.creditorName,
      detected.outcome,
      {
        accountId: detected.itemId,
        passNumber: 1,
      },
    );
    await sinkFn({
      itemId: detected.itemId,
      bureau: detected.bureau,
      outcome: mapped,
      creditorName: detected.creditorName,
    });
  }
}

function _findMatchingItemInReport(
  disputedItem: NegativeItem,
  newReportItems: NegativeItem[]
): NegativeItem | null {
  const creditorNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const disputedCreditor = creditorNorm(disputedItem.creditorName);

  if (disputedItem.accountNumber) {
    const acctMatch = newReportItems.find(
      n => n.accountNumber &&
        n.accountNumber.slice(-4) === disputedItem.accountNumber.slice(-4) &&
        creditorNorm(n.creditorName).includes(disputedCreditor.slice(0, 6))
    );
    if (acctMatch) return acctMatch;
  }

  const nameMatch = newReportItems.find(n => {
    const newCreditor = creditorNorm(n.creditorName);
    return newCreditor.includes(disputedCreditor.slice(0, 6)) ||
      disputedCreditor.includes(newCreditor.slice(0, 6));
  });
  return nameMatch ?? null;
}

function _compareItemStates(
  prior: NegativeItem,
  current: NegativeItem
): OutcomeDetectionResult {
  if (
    prior.balance != null && current.balance != null &&
    prior.balance > 0 && current.balance < prior.balance * 0.9
  ) return 'BALANCE_REDUCED';

  if (prior.status !== current.status) return 'STATUS_CHANGED';
  if (prior.typeOfNegative !== current.typeOfNegative) return 'ACCOUNT_UPDATED';
  if (
    (prior.dateOfFirstDelinquency ?? prior.originalDateOfDelinquency) !==
    (current.dateOfFirstDelinquency ?? current.originalDateOfDelinquency)
  ) return 'ACCOUNT_UPDATED';

  return 'VERIFIED_UNCHANGED';
}

function _estimateScoreImpact(
  item: NegativeItem,
  outcome: OutcomeDetectionResult,
  _updated?: NegativeItem
): number {
  const base: Record<OutcomeDetectionResult, number> = {
    DELETED: 0,
    BALANCE_REDUCED: 8,
    STATUS_CHANGED: 12,
    ACCOUNT_UPDATED: 5,
    VERIFIED_UNCHANGED: 0,
    NOT_DETERMINABLE: 0,
  };

  if (outcome === 'DELETED') {
    const type = (item.typeOfNegative ?? '').toLowerCase();
    if (type.includes('collection')) return 30;
    if (type.includes('charge')) return 25;
    if (type.includes('late')) return 15;
    return 20;
  }
  return base[outcome];
}

function _getNextAction(outcome: OutcomeDetectionResult): string {
  switch (outcome) {
    case 'DELETED':
      return '🎉 SUCCESS: Remove from dispute queue and log deletion.';
    case 'BALANCE_REDUCED':
      return '✅ PARTIAL WIN: Balance reduced. Continue to next pass citing remaining balance inaccuracy.';
    case 'STATUS_CHANGED':
      return '⚡ UPDATE DETECTED: Status changed. Advance to next pass with updated status challenge.';
    case 'ACCOUNT_UPDATED':
      return '⚡ UPDATE DETECTED: Account fields changed. Advance with updated challenge.';
    case 'VERIFIED_UNCHANGED':
      return '🔴 VERIFIED: Advance to next pass with new legal strategy (Metro 2 or §623 furnisher direct).';
    case 'NOT_DETERMINABLE':
      return '🔍 REVIEW NEEDED: Manual comparison required.';
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export const DeletionOutcomeEngine = {
  analyzeHistoricalPerformance(bureau: string, creditorName: string): StrategyWeight {
    return {
      bureau,
      creditorName,
      successRate: 0.0,
      recommendedStrategy: 'accuracy_challenge',
      totalAttempts: 0,
      historicalMetrics: { deletions: 0, verifications: 0, updates: 0, noResponse: 0 },
    };
  },

  captureOutcome(
    bureau: string,
    creditorName: string,
    outcome: OutcomeDetectionResult,
    meta?: { accountId?: string; passNumber?: number; strategy?: string },
  ) {
    const mapped = mapDetectionToDisputeOutcome(outcome);
    recordOutcome({
      accountId: meta?.accountId ?? creditorName,
      bureau,
      creditorName,
      passNumber: meta?.passNumber ?? 1,
      metro2FlagIds: [],
      personaId: meta?.strategy ?? 'autopilot',
      outcome: mapped,
      daysToResponse: null,
      recordedAt: new Date().toISOString(),
      strategy: meta?.strategy,
    });
    console.log(`[DeletionOutcomeEngine] Captured ${outcome} for ${creditorName} at ${bureau}`);
  },
};
