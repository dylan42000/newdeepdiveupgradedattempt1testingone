import { recordDisputeOutcome, idbGetAll, type DisputeOutcomeRecord } from './indexedDB';

export type DisputeOutcome = 'deleted' | 'modified' | 'verified' | 'no_response' | 'in_progress';

export interface OutcomeRecord {
  accountId: string;
  bureau: string;
  creditorName: string;
  passNumber: number;
  metro2FlagIds: string[];
  personaId: string;
  outcome: DisputeOutcome;
  daysToResponse: number | null;
  recordedAt: string;
  strategy?: string;
  accountType?: string;
}

export interface BureauCreditorStat {
  bureau: string;
  creditorName: string;
  passNumber: number | null;
  total: number;
  deleted: number;
  verified: number;
  noResponse: number;
  deletionRate: number;
}

const outcomeStore: OutcomeRecord[] = [];
let hydrated = false;

function mapToIdbOutcome(
  record: OutcomeRecord,
): 'success' | 'failure' | 'partial' {
  switch (record.outcome) {
    case 'deleted':
      return 'success';
    case 'modified':
      return 'partial';
    case 'verified':
    case 'no_response':
      return 'failure';
    case 'in_progress':
      return 'partial';
    default: {
      const _exhaustive: never = record.outcome;
      return _exhaustive;
    }
  }
}

export function recordOutcome(record: OutcomeRecord): void {
  outcomeStore.push(record);
  console.info(
    `[OutcomeTracker] Recorded "${record.outcome}" for ${record.creditorName} / ${record.bureau} / Pass ${record.passNumber}`,
  );
  void recordDisputeOutcome({
    id: `${record.accountId}:${record.bureau}:${record.recordedAt}:${record.passNumber}`,
    disputeItemId: record.accountId,
    accountType: record.accountType ?? 'unknown',
    bureau: record.bureau,
    strategy: record.strategy ?? record.personaId ?? 'unknown',
    roundNumber: record.passNumber,
    outcome: mapToIdbOutcome(record),
    daysToResolve: record.daysToResponse ?? 0,
    recordedAt: record.recordedAt,
  }).catch((e) => console.warn('[OutcomeTracker] IDB persist failed', e));
}

export async function loadOutcomesFromIdb(): Promise<void> {
  if (hydrated) return;
  try {
    const rows = await idbGetAll<DisputeOutcomeRecord>('disputeOutcomes');
    for (const row of rows) {
      const exists = outcomeStore.some(
        (o) =>
          o.accountId === row.disputeItemId &&
          o.bureau === row.bureau &&
          o.recordedAt === row.recordedAt &&
          o.passNumber === row.roundNumber,
      );
      if (exists) continue;
      let outcome: DisputeOutcome = 'in_progress';
      switch (row.outcome) {
        case 'success':
          outcome = 'deleted';
          break;
        case 'partial':
          outcome = 'modified';
          break;
        case 'failure':
          outcome = 'verified';
          break;
        default: {
          const _exhaustive: never = row.outcome;
          void _exhaustive;
          outcome = 'in_progress';
        }
      }
      outcomeStore.push({
        accountId: row.disputeItemId,
        bureau: row.bureau,
        creditorName: 'unknown',
        passNumber: row.roundNumber,
        metro2FlagIds: [],
        personaId: row.strategy,
        outcome,
        daysToResponse: row.daysToResolve,
        recordedAt: row.recordedAt,
        strategy: row.strategy,
        accountType: row.accountType,
      });
    }
    hydrated = true;
  } catch (e) {
    console.warn('[OutcomeTracker] IDB hydrate failed', e);
  }
}

export function getPriorOutcomesForItem(accountId: string): OutcomeRecord[] {
  return outcomeStore.filter((r) => r.accountId === accountId);
}

export function getRecommendedStartingPass(creditorName: string, bureau: string): number {
  const relevant = outcomeStore.filter(
    (r) =>
      r.creditorName.toLowerCase() === creditorName.toLowerCase() &&
      r.bureau === bureau &&
      r.outcome === 'deleted',
  );
  if (relevant.length === 0) return 1;
  return Math.min(...relevant.map((r) => r.passNumber));
}

export function getHighValueMetro2Flags(creditorName: string): string[] {
  const deletions = outcomeStore.filter(
    (r) =>
      r.creditorName.toLowerCase() === creditorName.toLowerCase() &&
      r.outcome === 'deleted',
  );
  const flagFrequency: Record<string, number> = {};
  for (const record of deletions) {
    for (const flagId of record.metro2FlagIds) {
      flagFrequency[flagId] = (flagFrequency[flagId] ?? 0) + 1;
    }
  }
  return Object.entries(flagFrequency)
    .sort(([, a], [, b]) => b - a)
    .map(([flagId]) => flagId);
}

export function getCreditorSuccessRate(creditorName: string): {
  total: number;
  deleted: number;
  rate: number;
} {
  const all = outcomeStore.filter(
    (r) => r.creditorName.toLowerCase() === creditorName.toLowerCase(),
  );
  const deleted = all.filter((r) => r.outcome === 'deleted').length;
  return { total: all.length, deleted, rate: all.length > 0 ? deleted / all.length : 0 };
}

export function getBureauCreditorStats(): BureauCreditorStat[] {
  const map = new Map<string, BureauCreditorStat>();
  for (const r of outcomeStore) {
    const key = `${r.bureau}|${r.creditorName.toLowerCase()}|${r.passNumber}`;
    const curr = map.get(key) ?? {
      bureau: r.bureau,
      creditorName: r.creditorName,
      passNumber: r.passNumber,
      total: 0,
      deleted: 0,
      verified: 0,
      noResponse: 0,
      deletionRate: 0,
    };
    curr.total += 1;
    if (r.outcome === 'deleted') curr.deleted += 1;
    if (r.outcome === 'verified') curr.verified += 1;
    if (r.outcome === 'no_response') curr.noResponse += 1;
    curr.deletionRate = curr.total > 0 ? curr.deleted / curr.total : 0;
    map.set(key, curr);
  }
  return [...map.values()].sort((a, b) => b.deletionRate - a.deletionRate);
}

/** Test helper — clear in-memory store */
export function _resetOutcomeStoreForTests(): void {
  outcomeStore.length = 0;
  hydrated = false;
}
