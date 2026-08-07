/**
 * A/B Letter Strategy Tracker (Apex AD-13) — local win-rate experiments.
 */

import type { DebtClass } from './debtTypeStrategyLibrary';

export type DisputeOutcomeLite =
  | 'deleted'
  | 'corrected'
  | 'verified'
  | 'no_response'
  | 'frivolous_rejection'
  | 'goodwill_accepted'
  | 'other';

export interface StrategyExperiment {
  experimentId: string;
  angle: string;
  legalAnchor: string;
  bureauTarget: string;
  creditorClass: string;
  debtType: DebtClass | string;
  pass: number;
  outcome: DisputeOutcomeLite | null;
  cycleId: string;
  itemId: string;
  recordedAt: string;
}

export interface StrategyWinRate {
  angle: string;
  bureau: string;
  debtType: string;
  sampleSize: number;
  deletionRate: number;
  correctionRate: number;
  verificationRate: number;
  noResponseRate: number;
  confidence: 'low' | 'medium' | 'high';
}

const STORAGE_KEY = 'dylandos_ab_strategy_tracker_v1';

function loadAll(): StrategyExperiment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(rows: StrategyExperiment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-2000)));
  } catch {
    /* quota */
  }
}

function confidenceFor(n: number): 'low' | 'medium' | 'high' {
  if (n >= 10) return 'high';
  if (n >= 5) return 'medium';
  return 'low';
}

export const AbStrategyTracker = {
  record(experiment: Omit<StrategyExperiment, 'experimentId' | 'recordedAt'> & { experimentId?: string }): void {
    const rows = loadAll();
    rows.push({
      ...experiment,
      experimentId: experiment.experimentId ?? `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      recordedAt: new Date().toISOString(),
    });
    saveAll(rows);
  },

  recordOutcome(params: {
    itemId: string;
    angle: string;
    bureau: string;
    debtType: string;
    outcome: DisputeOutcomeLite;
    cycleId?: string;
    pass?: number;
    creditorClass?: string;
    legalAnchor?: string;
  }): void {
    this.record({
      angle: params.angle,
      legalAnchor: params.legalAnchor ?? 'fcra_611',
      bureauTarget: params.bureau,
      creditorClass: params.creditorClass ?? 'unknown',
      debtType: params.debtType,
      pass: params.pass ?? 1,
      outcome: params.outcome,
      cycleId: params.cycleId ?? 'manual',
      itemId: params.itemId,
    });
  },

  computeWinRates(filter?: { bureau?: string; debtType?: string }): StrategyWinRate[] {
    const rows = loadAll().filter((r) => r.outcome != null);
    const buckets = new Map<string, StrategyExperiment[]>();
    for (const r of rows) {
      if (filter?.bureau && r.bureauTarget !== filter.bureau) continue;
      if (filter?.debtType && r.debtType !== filter.debtType) continue;
      const key = `${r.angle}||${r.bureauTarget}||${r.debtType}`;
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }

    const out: StrategyWinRate[] = [];
    for (const [key, list] of buckets) {
      const [angle, bureau, debtType] = key.split('||');
      const n = list.length;
      const rate = (pred: (o: DisputeOutcomeLite) => boolean) =>
        list.filter((r) => r.outcome && pred(r.outcome)).length / n;
      out.push({
        angle,
        bureau,
        debtType,
        sampleSize: n,
        deletionRate: rate((o) => o === 'deleted' || o === 'goodwill_accepted'),
        correctionRate: rate((o) => o === 'corrected'),
        verificationRate: rate((o) => o === 'verified'),
        noResponseRate: rate((o) => o === 'no_response'),
        confidence: confidenceFor(n),
      });
    }
    return out.sort((a, b) => b.deletionRate - a.deletionRate);
  },

  getBestAngle(params: {
    bureau: string;
    debtType: string;
    creditorName?: string;
  }): StrategyWinRate | null {
    const rates = this.computeWinRates({ bureau: params.bureau, debtType: params.debtType });
    const eligible = rates.filter((r) => r.sampleSize >= 5);
    if (eligible.length === 0) return rates[0] ?? null;
    return eligible[0];
  },
};
