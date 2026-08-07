import { NegativeItem } from '../types';

// ─── LEGACY INTERFACE (kept for backward compatibility) ──────────────────────

export interface ExpirationReport {
  daysUntilRemoval: number;
  shouldSkipDispute: boolean;
  removalDate: string;
}

export function calculateFcraRemovalDate(dateOfFirstDelinquency: string): string {
  const dofdTime = new Date(dateOfFirstDelinquency).getTime();
  if (isNaN(dofdTime)) return new Date().toISOString();
  const DAY_IN_MS = 86400000;
  // 7 years (approx 365.25 days/year) + 180 days = 2556.75 + 180 = 2736.75 days
  const totalDays = Math.floor(7 * 365.25 + 180); // 2736
  const removalTime = dofdTime + (totalDays * DAY_IN_MS);
  return new Date(removalTime).toISOString();
}

export function evaluateExpirationRisk(item: NegativeItem): ExpirationReport {
  const dofdStr = item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency;
  if (!dofdStr) {
    return {
      daysUntilRemoval: 9999,
      shouldSkipDispute: false,
      removalDate: new Date(Date.now() + 86400000 * 9999).toISOString(),
    };
  }

  const removalDateStr = calculateFcraRemovalDate(dofdStr);
  const removalEpoch = new Date(removalDateStr).getTime();
  const currentEpoch = Date.now();
  const daysUntilRemoval = Math.floor((removalEpoch - currentEpoch) / 86400000);
  const shouldSkipDispute = daysUntilRemoval <= 180;

  return { daysUntilRemoval, shouldSkipDispute, removalDate: removalDateStr };
}

// ─── FULL PRODUCTION EXPIRATION RADAR (v5.1.0) ───────────────────────────────

export interface ExpirationRadarResult {
  itemId: string;
  creditorName: string;
  dofd: string;
  expirationDate: Date;
  daysUntilExpiration: number;    // Negative = already expired
  status: 'EXPIRED' | 'IMMINENT' | 'APPROACHING' | 'DISTANT';
  deletionProbability: number;    // 0-100
  recommendedAction: string;
  urgencyScore: number;           // 0-100 for batch selector priority
}

/**
 * Run the full Expiration Radar against a list of negative items.
 * Returns results sorted by urgency (expired first, then imminent, etc.).
 */
export function runExpirationRadar(items: NegativeItem[]): ExpirationRadarResult[] {
  const today = new Date();
  const results: ExpirationRadarResult[] = [];

  for (const item of items) {
    const dofdStr = item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency;
    if (!dofdStr) continue;

    const dofd = new Date(dofdStr);
    if (isNaN(dofd.getTime())) continue;

    const expirationDate = new Date(dofd);
    expirationDate.setFullYear(expirationDate.getFullYear() + 7);

    const daysUntilExpiration = Math.floor(
      (expirationDate.getTime() - today.getTime()) / 86400000
    );

    let status: ExpirationRadarResult['status'];
    let deletionProbability: number;
    let recommendedAction: string;
    let urgencyScore: number;

    if (daysUntilExpiration <= 0) {
      status = 'EXPIRED';
      deletionProbability = 97;
      urgencyScore = 100;
      recommendedAction = `IMMEDIATE: File FCRA §605(a) violation demand. This account expired ${Math.abs(daysUntilExpiration)} days ago and must be deleted NOW.`;
    } else if (daysUntilExpiration <= 180) {
      status = 'IMMINENT';
      deletionProbability = 85;
      urgencyScore = 90;
      recommendedAction = `HIGH PRIORITY: File Pass 1 dispute now citing FCRA §605(a) and upcoming expiration. Expiration in ${daysUntilExpiration} days.`;
    } else if (daysUntilExpiration <= 365) {
      status = 'APPROACHING';
      deletionProbability = 72;
      urgencyScore = 75;
      recommendedAction = `MEDIUM PRIORITY: Dispute soon to establish paper trail before expiration. ${daysUntilExpiration} days remaining.`;
    } else {
      status = 'DISTANT';
      deletionProbability = 30;
      urgencyScore = 20;
      recommendedAction = `Low urgency. ${Math.round(daysUntilExpiration / 365)} years until expiration.`;
    }

    results.push({
      itemId: item.id,
      creditorName: item.creditorName,
      dofd: dofdStr,
      expirationDate,
      daysUntilExpiration,
      status,
      deletionProbability,
      recommendedAction,
      urgencyScore,
    });
  }

  return results.sort((a, b) => b.urgencyScore - a.urgencyScore);
}

/**
 * Calculate expiration bonus score for use in itemScorer.ts deletability calc.
 */
export function calculateExpirationBonus(item: NegativeItem): number {
  const radar = runExpirationRadar([item]);
  if (radar.length === 0) return 0;
  switch (radar[0].status) {
    case 'EXPIRED':    return 40;
    case 'IMMINENT':   return 25;
    case 'APPROACHING': return 15;
    default:           return 0;
  }
}
