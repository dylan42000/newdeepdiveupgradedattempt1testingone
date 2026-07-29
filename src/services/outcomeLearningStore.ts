/**
 * outcomeLearningStore.ts — Single durable outcome store (v5.2)
 *
 * Replaces parallel disputeOutcomeTracker / outcomeBasedLearning usage for
 * Autopilot decisions. Persists to localStorage; BatchSelector + pass choice
 * read from here only.
 */

export type LearnedOutcome =
  | 'deleted'
  | 'updated'
  | 'verified'
  | 'no_response'
  | 'frivolous';

export interface LearnedOutcomeRecord {
  id: string;
  profileId: string;
  itemId: string;
  creditorName: string;
  bureau: string;
  passNumber: number;
  strategy?: string;
  outcome: LearnedOutcome;
  recordedAt: string;
  metro2FlagIds?: string[];
}

export interface CreditorBureauStats {
  creditorKey: string;
  bureau: string;
  total: number;
  deletions: number;
  verifications: number;
  updates: number;
  noResponse: number;
  successRate: number;
  bestStartingPass: number;
  recommendedStrategy: string | null;
}

const STORAGE_KEY = 'dylandos_outcome_learning_v1';

function loadAll(): LearnedOutcomeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(records: LearnedOutcomeRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-2000)));
  } catch {
    /* quota */
  }
}

function creditorKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const OutcomeLearningStore = {
  record( partial: Omit<LearnedOutcomeRecord, 'id' | 'recordedAt'>): LearnedOutcomeRecord {
    const record: LearnedOutcomeRecord = {
      ...partial,
      id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      recordedAt: new Date().toISOString(),
    };
    const all = loadAll();
    all.push(record);
    saveAll(all);
    return record;
  },

  getAll(profileId?: string): LearnedOutcomeRecord[] {
    const all = loadAll();
    return profileId ? all.filter((r) => r.profileId === profileId) : all;
  },

  getStats(creditorName: string, bureau?: string): CreditorBureauStats {
    const key = creditorKey(creditorName);
    const relevant = loadAll().filter((r) => {
      if (creditorKey(r.creditorName) !== key) return false;
      if (bureau && r.bureau.toLowerCase() !== bureau.toLowerCase()) return false;
      return true;
    });

    const deletions = relevant.filter((r) => r.outcome === 'deleted').length;
    const verifications = relevant.filter((r) => r.outcome === 'verified').length;
    const updates = relevant.filter((r) => r.outcome === 'updated').length;
    const noResponse = relevant.filter((r) => r.outcome === 'no_response').length;
    const total = relevant.length;
    const successRate = total > 0 ? deletions / total : 0;

    const deletedPasses = relevant
      .filter((r) => r.outcome === 'deleted')
      .map((r) => r.passNumber);
    const bestStartingPass =
      deletedPasses.length > 0 ? Math.min(...deletedPasses) : 1;

    const strategyCounts = new Map<string, number>();
    for (const r of relevant.filter((x) => x.outcome === 'deleted' && x.strategy)) {
      strategyCounts.set(r.strategy!, (strategyCounts.get(r.strategy!) ?? 0) + 1);
    }
    const recommendedStrategy =
      [...strategyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      creditorKey: key,
      bureau: bureau ?? 'all',
      total,
      deletions,
      verifications,
      updates,
      noResponse,
      successRate,
      bestStartingPass,
      recommendedStrategy,
    };
  },

  /** Boost for BatchSelector: higher when historical deletion rate is strong. */
  getSelectionBoost(creditorName: string, bureau?: string): number {
    const stats = this.getStats(creditorName, bureau);
    if (stats.total < 2) return 0;
    // Up to +25 for high deletion rate, down to -10 for chronic verification
    if (stats.successRate >= 0.5) return Math.round(15 + stats.successRate * 10);
    if (stats.verifications > stats.deletions && stats.total >= 3) return -10;
    return Math.round(stats.successRate * 12);
  },

  recommendStartingPass(creditorName: string, bureau: string): number {
    return this.getStats(creditorName, bureau).bestStartingPass;
  },
};
