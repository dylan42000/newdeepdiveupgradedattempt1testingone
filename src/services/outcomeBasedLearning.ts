/**
 * Outcome-Based Learning Service
 * Tracks which dispute strategies succeed against which bureaus and creditors,
 * then surfaces recommendations to improve future round selections.
 *
 * Data is persisted in IndexedDB `disputeOutcomes` store (added in v3 upgrade).
 */

import { aiComplete } from './aiRouter';
import type { RoundStrategy, BureauResponseType } from './disputeEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OutcomeResult = 'deleted' | 'updated' | 'verified' | 'no_response' | 're_inserted';

export interface DisputeOutcome {
  id: string;                      // UUID
  createdAt: string;               // ISO date
  negativeItemType: string;        // 'collection' | 'late_payment' | 'charge_off' | etc.
  bureauName: string;              // 'Equifax' | 'Experian' | 'TransUnion'
  creditorName: string;
  strategyUsed: RoundStrategy;
  round: number;
  bureauResponse: BureauResponseType;
  outcome: OutcomeResult;
  daysToResponse: number;
  letterVariation?: string;        // DNA hash of the winning letter
  /** Optional: AI-extracted notes from bureau response */
  notes?: string;
}

export interface StrategyStats {
  strategy: RoundStrategy;
  totalUses: number;
  deletions: number;
  updates: number;
  verifieds: number;
  noResponses: number;
  deletionRate: number;        // 0–1
  successRate: number;         // deletions + updates / total
  avgDaysToResponse: number;
}

export interface RecommendationResult {
  recommendedStrategy: RoundStrategy;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  alternativeStrategy?: RoundStrategy;
  basedOnSamples: number;
}

// ─── Local in-memory store (augmented by IndexedDB via callers) ──────────────

let _outcomes: DisputeOutcome[] = [];

export function loadOutcomes(outcomes: DisputeOutcome[]): void {
  _outcomes = outcomes;
}

export function getAllOutcomes(): DisputeOutcome[] {
  return _outcomes;
}

// ─── Record a new outcome ─────────────────────────────────────────────────────

export function recordOutcome(outcome: DisputeOutcome): void {
  _outcomes.push(outcome);
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * Filter outcomes by bureau and/or creditor name (partial match).
 */
function filterOutcomes(bureauName?: string, creditorName?: string, itemType?: string): DisputeOutcome[] {
  return _outcomes.filter(o => {
    if (bureauName && o.bureauName !== bureauName) return false;
    if (creditorName && !o.creditorName.toLowerCase().includes(creditorName.toLowerCase())) return false;
    if (itemType && o.negativeItemType !== itemType) return false;
    return true;
  });
}

/**
 * Compute success stats for every strategy, optionally filtered.
 */
export function computeStrategyStats(
  bureauName?: string,
  creditorName?: string,
  itemType?: string
): StrategyStats[] {
  const relevant = filterOutcomes(bureauName, creditorName, itemType);
  const byStrategy = new Map<RoundStrategy, DisputeOutcome[]>();

  for (const o of relevant) {
    const arr = byStrategy.get(o.strategyUsed) ?? [];
    arr.push(o);
    byStrategy.set(o.strategyUsed, arr);
  }

  const stats: StrategyStats[] = [];
  for (const [strategy, outcomes] of byStrategy.entries()) {
    const deletions = outcomes.filter(o => o.outcome === 'deleted').length;
    const updates = outcomes.filter(o => o.outcome === 'updated').length;
    const verifieds = outcomes.filter(o => o.outcome === 'verified').length;
    const noResponses = outcomes.filter(o => o.outcome === 'no_response').length;
    const totalDays = outcomes.reduce((sum, o) => sum + (o.daysToResponse || 0), 0);

    stats.push({
      strategy,
      totalUses: outcomes.length,
      deletions,
      updates,
      verifieds,
      noResponses,
      deletionRate: deletions / outcomes.length,
      successRate: (deletions + updates) / outcomes.length,
      avgDaysToResponse: outcomes.length > 0 ? totalDays / outcomes.length : 0,
    });
  }

  // Sort by success rate descending
  return stats.sort((a, b) => b.successRate - a.successRate);
}

/**
 * Returns the best strategy for a given context based on historical data.
 * Falls back to `defaultStrategy` when not enough data.
 */
export function recommendStrategy(
  defaultStrategy: RoundStrategy,
  bureauName?: string,
  creditorName?: string,
  itemType?: string,
  minSamples = 3
): RecommendationResult {
  const stats = computeStrategyStats(bureauName, creditorName, itemType);

  const topStats = stats.filter(s => s.totalUses >= minSamples);

  if (topStats.length === 0) {
    return {
      recommendedStrategy: defaultStrategy,
      confidence: 'low',
      reason: 'No historical data — using engine default.',
      basedOnSamples: 0,
    };
  }

  const best = topStats[0];
  const second = topStats[1];
  const confidence: 'high' | 'medium' | 'low' =
    best.successRate >= 0.7 ? 'high' :
    best.successRate >= 0.4 ? 'medium' : 'low';

  return {
    recommendedStrategy: best.strategy,
    confidence,
    reason: `${(best.successRate * 100).toFixed(0)}% success rate across ${best.totalUses} disputes${bureauName ? ` at ${bureauName}` : ''}.`,
    alternativeStrategy: second?.strategy,
    basedOnSamples: best.totalUses,
  };
}

// ─── AI-Enhanced Pattern Analysis ────────────────────────────────────────────

/**
 * Use AI to summarize patterns in outcome data and generate actionable insights.
 * Call sparingly — this consumes AI tokens.
 */
export async function generateAIInsights(
  bureauName?: string,
  topN = 10
): Promise<string> {
  const relevant = filterOutcomes(bureauName).slice(-topN * 3); // Recent outcomes
  if (relevant.length < 5) {
    return 'Not enough outcome data to generate insights. Complete at least 5 dispute rounds first.';
  }

  const summary = relevant
    .slice(-topN)
    .map(o =>
      `${o.bureauName} | ${o.creditorName} | ${o.negativeItemType} | ` +
      `Round ${o.round} | ${o.strategyUsed} → ${o.outcome} (${o.daysToResponse}d)`
    )
    .join('\n');

  const systemPrompt = `You are an expert credit repair strategist. Analyze these dispute outcomes and identify patterns to improve future dispute success rates. Be specific and actionable.`;

  const userPrompt = `Recent dispute outcomes:
${summary}

Provide:
1. Top 3 patterns observed (what works, what doesn't)
2. Specific recommendations for the user
3. Any red flags or unusual bureau behaviors detected
Keep response under 200 words.`;

  try {
    return await aiComplete(systemPrompt, userPrompt, 'analyze');
  } catch {
    return 'AI insight generation unavailable — check your API keys in Settings.';
  }
}

// ─── Export / Summary ─────────────────────────────────────────────────────────

export interface OutcomeSummary {
  totalDisputes: number;
  totalDeletions: number;
  totalUpdates: number;
  overallSuccessRate: number;
  bestBureau: string;
  bestStrategy: RoundStrategy | null;
  avgDaysToResolution: number;
}

export function getOutcomeSummary(): OutcomeSummary {
  if (_outcomes.length === 0) {
    return {
      totalDisputes: 0,
      totalDeletions: 0,
      totalUpdates: 0,
      overallSuccessRate: 0,
      bestBureau: 'N/A',
      bestStrategy: null,
      avgDaysToResolution: 0,
    };
  }

  const deletions = _outcomes.filter(o => o.outcome === 'deleted').length;
  const updates = _outcomes.filter(o => o.outcome === 'updated').length;
  const totalDays = _outcomes.reduce((s, o) => s + (o.daysToResponse || 0), 0);

  // Best bureau = highest deletion rate
  const bureauStats: Record<string, { wins: number; total: number }> = {};
  for (const o of _outcomes) {
    if (!bureauStats[o.bureauName]) bureauStats[o.bureauName] = { wins: 0, total: 0 };
    bureauStats[o.bureauName].total++;
    if (o.outcome === 'deleted' || o.outcome === 'updated') bureauStats[o.bureauName].wins++;
  }
  const bestBureau = Object.entries(bureauStats).sort((a, b) =>
    b[1].wins / b[1].total - a[1].wins / a[1].total
  )[0]?.[0] ?? 'N/A';

  const stratStats = computeStrategyStats();
  const bestStrategy = stratStats[0]?.strategy ?? null;

  return {
    totalDisputes: _outcomes.length,
    totalDeletions: deletions,
    totalUpdates: updates,
    overallSuccessRate: (deletions + updates) / _outcomes.length,
    bestBureau,
    bestStrategy,
    avgDaysToResolution: totalDays / _outcomes.length,
  };
}
