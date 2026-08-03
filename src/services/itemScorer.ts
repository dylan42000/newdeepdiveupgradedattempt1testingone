/**
 * itemScorer.ts — Deletability & Urgency Scoring for Dispute Items
 * Scores each negative item for:
 * - Deletability: how likely it is to be removed (0-100)
 * - Urgency: how important it is to dispute NOW (0-100)
 * Used by BatchSelector to prioritize dispatch order.
 */

import { NegativeItem } from '../types';
import { PassNumber } from '../types/creditRepair';
import { evaluateExpirationRisk, calculateExpirationBonus } from './expirationRadarService';

export interface ItemScore {
  itemId: string;
  deletability: number;   // 0-100: probability of successful deletion
  urgency: number;        // 0-100: how urgently to dispatch
  totalScore: number;     // Weighted composite score
  reasoning: string;      // Human-readable explanation
  passRecommendation: PassNumber;
  isEligible?: boolean;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const ItemScorer = {
  scoreItem(item: NegativeItem, currentPassNumber: PassNumber = 1): ItemScore {
    const deletability = calculateDeletability(item, currentPassNumber);
    const urgency = calculateUrgency(item);
    let totalScore = Math.round(deletability * 0.6 + urgency * 0.4);
    let reasoning = buildReasoning(item, deletability, urgency, currentPassNumber);
    const passRecommendation = recommendPass(item);
    let isEligible = true;

    const expirationRisk = evaluateExpirationRisk(item);
    if (expirationRisk.shouldSkipDispute) {
      totalScore = 0;
      isEligible = false;
      reasoning = 'Statutory FCRA auto-removal imminent';
    }

    return {
      itemId: item.id,
      deletability,
      urgency,
      totalScore,
      reasoning,
      passRecommendation,
      isEligible,
    };
  },

  scoreItems(items: NegativeItem[], currentPassNumbers?: Record<string, PassNumber>): ItemScore[] {
    return items.map(item => {
      const passNum = currentPassNumbers?.[item.id] ?? 1;
      return this.scoreItem(item, passNum);
    }).sort((a, b) => b.totalScore - a.totalScore);
  },
};

// ─── Deletability Score ──────────────────────────────────────────────────────

function calculateDeletability(item: NegativeItem, passNumber: PassNumber): number {
  let score = 50; // Baseline

  const type = (item.typeOfNegative || '').toLowerCase();
  const bureauCount = item.creditBureau.length;

  // Age factor: older items are closer to auto-removal and bureaus are less likely to defend them
  if (item.originalDateOfDelinquency) {
    const yearsOld = (Date.now() - new Date(item.originalDateOfDelinquency).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (yearsOld >= 6) score += 25;       // Near 7-year drop — bureaus often preemptively delete
    else if (yearsOld >= 5) score += 18;
    else if (yearsOld >= 4) score += 12;
    else if (yearsOld >= 3) score += 6;
    else if (yearsOld < 2) score -= 10;   // Very fresh — harder to dispute
  }

  // Expiration bonus (v5.1.0): use precision radar for FCRA 7-year proximity scoring
  score += calculateExpirationBonus(item);

  // Type factor
  if (type.includes('medical')) score += 20;         // Medical debt has new CFPB protections
  if (type.includes('collection') && (item.balance ?? 0) < 500) score += 15;  // Small balance = easy P4D
  if (type.includes('duplicate')) score += 30;       // Procedural error = easy win
  if (type.includes('fraud') || type.includes('identity')) score += 35; // ID theft = strong grounds
  if (type.includes('inquiry')) score += 25;         // Inquiries often deletable
  if (type.includes('paid')) score += 15;            // Paid charge-offs — goodwill angle
  if (type.includes('bankruptcy')) score -= 15;      // Bankruptcies are harder to remove

  // Reporting only on 1 bureau = easier (less entities to fight)
  if (bureauCount === 1) score += 10;
  if (bureauCount === 3) score -= 5;

  // Freshness bonus: never-disputed items are highest priority (fresh = highest chance of quick deletion)
  // Verified items go to back of line — other fresh items get disputed first, then we come back harder
  const verCount = item.verificationCount ?? 0;
  if (verCount === 0) score += 15;       // Never disputed — prioritize these first
  else if (verCount === 1) score += 0;   // Disputed once — neutral
  else if (verCount >= 2) score -= 15;   // Multiple verifications — back of line

  // Pass escalation: higher passes have different success rates
  const passModifiers: Record<PassNumber, number> = { 1: 0, 2: 5, 3: 8, 4: 5, 5: -5, 6: -8 };
  score += passModifiers[passNumber] ?? 0;

  // Parse confidence: low confidence means item may have errors = higher deletability
  if (item.parseConfidence !== null && item.parseConfidence !== undefined) {
    if (item.parseConfidence < 0.6) score += 12; // Questionable data = dispute grounds
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─── Urgency Score ───────────────────────────────────────────────────────────

function calculateUrgency(item: NegativeItem): number {
  let score = 30; // Baseline urgency

  const type = (item.typeOfNegative || '').toLowerCase();

  // High-impact items = high urgency
  if (type.includes('bankruptcy')) score += 40;
  else if (type.includes('charge-off') || type.includes('chargeoff')) score += 35;
  else if (type.includes('collection')) score += 30;
  else if (type.includes('foreclosure') || type.includes('repossession')) score += 38;
  else if (type.includes('judgment')) score += 42;
  else if (type.includes('90') || type.includes('120')) score += 25;
  else if (type.includes('60')) score += 18;
  else if (type.includes('30') || type.includes('late')) score += 12;

  // Bureau coverage: appearing on all 3 = higher urgency
  if (item.creditBureau.length === 3) score += 15;
  else if (item.creditBureau.length === 2) score += 8;

  // Balance: higher balance items carry more weight urgency-wise
  const balance = item.balance ?? 0;
  if (balance > 10000) score += 15;
  else if (balance > 5000) score += 10;
  else if (balance > 1000) score += 5;

  // SOL near expiry: if within 1 year of 7-year drop, slightly less urgent
  if (item.autoRemovalDate) {
    const daysUntilDrop = Math.floor((new Date(item.autoRemovalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilDrop < 365) score -= 15; // Close to falling off naturally
    if (daysUntilDrop < 0) score -= 30;   // Already past 7 years — skip
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─── Pass Recommendation ─────────────────────────────────────────────────────

function recommendPass(item: NegativeItem): PassNumber {
  const status = item.disputeStatus ?? '';

  if (status.includes('Round1') || status === 'Undisputed') return 1;
  if (status.includes('Round2')) return 2;
  if (status.includes('Round3')) return 3;
  if (status.includes('Round4')) return 4;
  if (status.includes('Round5') || status.includes('Round6')) return 5;

  return 1;
}

// ─── Reasoning ───────────────────────────────────────────────────────────────

function buildReasoning(item: NegativeItem, deletability: number, urgency: number, passNumber: PassNumber): string {
  const parts: string[] = [];
  const type = (item.typeOfNegative || '').toLowerCase();

  if (deletability >= 70) parts.push('High deletability — strong dispute grounds');
  else if (deletability >= 50) parts.push('Moderate deletability — standard dispute strategy');
  else parts.push('Lower deletability — escalated strategy recommended');

  if (urgency >= 70) parts.push('high urgency (major derogatory)');
  else if (urgency >= 40) parts.push('moderate urgency');
  else parts.push('lower urgency');

  if (type.includes('medical')) parts.push('medical debt (CFPB protections apply)');
  if (type.includes('paid')) parts.push('paid account (goodwill eligible)');
  if ((item.verificationCount ?? 0) > 1) parts.push(`verified ${item.verificationCount}× (MOV demand warranted)`);
  if (passNumber >= 3) parts.push('escalated pass — regulatory pressure applicable');

  return parts.join(' · ');
}
