/**
 * strategyRotationEngine.ts — Strategy Rotation + Delinquency Date Guardian
 * GAP-D FIX: Prevents the same legal argument from repeating across multiple passes
 * (which triggers "frivolous" determinations from bureaus who recognize repeated strategies).
 * Also detects illegal re-aging of delinquency dates during the dispute process.
 *
 * Strategy matrix:
 *   double-verified  → Escalate to furnisher direct dispute (FCRA §623)
 *   stalled           → Switch to Metro 2 accuracy / data field challenge
 *   pass4-stalled     → CFPB pre-complaint + Attorney General notice
 *
 * Delinquency date protection:
 *   Per 2026 FCRA amendments, the original delinquency date (ODD) cannot
 *   change as a result of dispute. Re-aging detection flags any change in ODD.
 */

import { NegativeItem } from '../types';
import { PassNumber } from '../types/creditRepair';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StallScenario =
  | 'double-verified'    // Bureau verified the item twice without deleting
  | 'stalled'            // Item has been at the same pass for 2+ cycles with no advancement
  | 'pass4-stalled'      // Stuck at pass 4+ with no progress
  | 'no-response'        // Bureau failed to respond within FCRA window
  | 'freshly-disputed';  // First dispute — no prior history

export interface RotationStrategy {
  /** Short strategy name for logging */
  name: string;
  /** Primary legal hook / statute to lead with */
  primaryLegalHook: string;
  /** Full prompt directive appended to letter generation */
  promptDirective: string;
  /** Recommended target for this strategy */
  recommendedTarget: 'bureau' | 'furnisher' | 'both';
  /** Recommended letter tone */
  tone: 'cooperative' | 'firm' | 'aggressive' | 'regulatory';
}

export interface DisputeHistoryEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Type of event */
  type: 'letter_sent' | 'bureau_response' | 'escalation' | 'resolved';
  /** Bureau name */
  bureau: string;
  /** Pass number when this happened */
  passNumber: PassNumber;
  /** Bureau's response outcome */
  outcome?: 'verified' | 'deleted' | 'updated' | 'no_response' | 'frivolous';
  /** Strategy used for this letter */
  strategyUsed?: string;
  /** Primary legal hook recorded for this dispute */
  primaryLegalHook?: string;
}

export interface ReAgingAlert {
  detected: boolean;
  itemId: string;
  creditorName: string;
  originalDelinquencyDate: string | null;
  currentReportedDate: string | null;
  daysShifted: number;
  message: string;
  legalCitation: string;
}

// ─── Strategy rotation matrix ─────────────────────────────────────────────────

const STRATEGY_MATRIX: Record<StallScenario, RotationStrategy> = {
  'freshly-disputed': {
    name: 'Initial Investigation Request',
    primaryLegalHook: 'FCRA §611(a)(1) — Bureau must conduct reasonable reinvestigation',
    promptDirective:
      'STRATEGY: Initial dispute. Focus on clearly identifying the inaccuracy, ' +
      'stating what the correct information is, and requesting investigation under FCRA §611(a)(1). ' +
      'Keep tone professional and cooperative. Do NOT threaten litigation at this stage.',
    recommendedTarget: 'bureau',
    tone: 'cooperative',
  },
  'no-response': {
    name: 'FCRA Failure to Investigate',
    primaryLegalHook: 'FCRA §611(a)(1) — Bureau failed to complete investigation within 30 days; FCRA §616 civil liability',
    promptDirective:
      'STRATEGY: Bureau failed to respond within the FCRA §611(a)(1) 30-day window. ' +
      'The letter MUST: (1) State the original dispute date, (2) Note that 30 calendar days have passed, ' +
      '(3) Invoke FCRA §611(a)(1) failure-to-investigate, (4) Demand immediate deletion or correction ' +
      'per FCRA §611(a)(6), (5) Reference FCRA §616 civil liability for willful non-compliance. ' +
      'Tone: assertive. This is a legal notice, not a request.',
    recommendedTarget: 'bureau',
    tone: 'aggressive',
  },
  'double-verified': {
    name: 'Furnisher Direct Dispute',
    primaryLegalHook: 'FCRA §623(a)(8) — Direct dispute rights with data furnisher',
    promptDirective:
      'STRATEGY: This item has been "verified" by the bureau twice. Bureau verification is suspect ' +
      'when the bureau simply forwards the dispute to the furnisher who then re-confirms their own data. ' +
      'This letter goes DIRECTLY to the FURNISHER (not the bureau). ' +
      'Cite FCRA §623(a)(8) — consumer right to dispute directly with data furnisher. ' +
      'Demand that the furnisher provide documentary evidence of the debt (original signed agreement, ' +
      'payment history, account statements, or certification that they maintain Metro 2 compliant records). ' +
      'Furnisher has 30 days to investigate or must delete/correct the tradeline per FCRA §623(b)(1)(B). ' +
      'Tone: formal and legally precise. Do NOT use bureau-address — use furnisher address.',
    recommendedTarget: 'furnisher',
    tone: 'firm',
  },
  'stalled': {
    name: 'Metro 2 Accuracy Challenge',
    primaryLegalHook: 'FCRA §623(a)(1) — Furnisher may not report information it knows to be inaccurate',
    promptDirective:
      'STRATEGY: This item has stalled — same outcome for 2+ dispute cycles. Change the strategy. ' +
      'Instead of a general dispute, challenge the SPECIFIC Metro 2 data fields being reported. ' +
      'For each disputed field: (1) State the field name (e.g., Account Status, Balance, Date Opened, ' +
      'Payment Rating, Account Type), (2) State the currently reported value, (3) State what the ' +
      'correct value should be, (4) Cite FCRA §623(a)(1) — furnisher may not knowingly report ' +
      'inaccurate information, (5) Reference Metro 2 Format standards for that field. ' +
      'This technical approach bypasses the generic "re-verification" process and forces the bureau ' +
      'to conduct a field-level audit. Tone: technical and precise.',
    recommendedTarget: 'bureau',
    tone: 'firm',
  },
  'pass4-stalled': {
    name: 'Pre-CFPB / AG Escalation Notice',
    primaryLegalHook: 'CFPB Complaint Authority + State AG Consumer Protection + FCRA §616 Civil Liability',
    promptDirective:
      'STRATEGY: Maximum pressure pre-action letter. The item has reached Pass 4+ with no resolution. ' +
      'The letter MUST: ' +
      '(1) State that all good-faith attempts at resolution have been exhausted, ' +
      '(2) Reference that a CFPB complaint has been or will immediately be filed at consumerfinance.gov/complaint, ' +
      '(3) Reference that a complaint to the state Attorney General is pending, ' +
      '(4) Cite FCRA §616 — willful non-compliance is subject to actual damages, statutory damages ' +
      '($100–$1,000 per violation), punitive damages, and attorney\'s fees, ' +
      '(5) Set a FINAL deadline of 7 calendar days for written confirmation of deletion or correction, ' +
      '(6) State that failure to respond will result in immediate civil action. ' +
      'Tone: regulatory. This is a final notice before formal action.',
    recommendedTarget: 'both',
    tone: 'regulatory',
  },
};

// ─── Strategy rotation logic ──────────────────────────────────────────────────

/**
 * Determine the appropriate dispute strategy based on item history and pass number.
 * Rotates strategies to prevent bureau "frivolous" pattern detection.
 *
 * @param item - The negative item being disputed
 * @param passNumber - Current pass number
 * @param outcomeHistory - Sorted history of prior dispute outcomes for this item
 * @returns RotationStrategy with full prompt directive
 */
export function getRotationStrategy(
  item: NegativeItem,
  passNumber: PassNumber,
  outcomeHistory: DisputeHistoryEntry[]
): RotationStrategy & { scenario: StallScenario } {
  // No history → initial fresh dispute
  if (outcomeHistory.length === 0 || passNumber === 1) {
    return { ...STRATEGY_MATRIX['freshly-disputed'], scenario: 'freshly-disputed' };
  }

  // Check for no-response scenario
  const lastEvent = outcomeHistory[outcomeHistory.length - 1];
  if (lastEvent?.outcome === 'no_response') {
    return { ...STRATEGY_MATRIX['no-response'], scenario: 'no-response' };
  }

  // Check for double-verified: two consecutive bureau verifications
  const recentOutcomes = outcomeHistory.slice(-3).map(e => e.outcome);
  const doubleVerified =
    recentOutcomes.filter(o => o === 'verified').length >= 2;
  if (doubleVerified) {
    return { ...STRATEGY_MATRIX['double-verified'], scenario: 'double-verified' };
  }

  // Pass 4+ with no deletion → pre-CFPB escalation
  if (passNumber >= 4) {
    const hasEverBeenDeleted = outcomeHistory.some(e => e.outcome === 'deleted');
    if (!hasEverBeenDeleted) {
      return { ...STRATEGY_MATRIX['pass4-stalled'], scenario: 'pass4-stalled' };
    }
  }

  // Pass 3+ with repeated same strategy → rotate to Metro 2 challenge
  if (passNumber >= 3) {
    const usedStrategies = new Set(outcomeHistory.map(e => e.strategyUsed).filter(Boolean));
    const allSameStrategy = usedStrategies.size <= 1;
    if (allSameStrategy) {
      return { ...STRATEGY_MATRIX['stalled'], scenario: 'stalled' };
    }
  }

  // Default: continue standard escalation path
  const defaultScenario: StallScenario =
    passNumber >= 4 ? 'pass4-stalled' : passNumber >= 3 ? 'stalled' : 'freshly-disputed';
  return { ...STRATEGY_MATRIX[defaultScenario], scenario: defaultScenario };
}

// ─── Delinquency date re-aging detection ─────────────────────────────────────

/**
 * Detect illegal re-aging of original delinquency date (ODD).
 * Per 2026 FCRA amendments, the ODD cannot change as a result of dispute activity.
 * Any change in reported ODD after a dispute is filed is a violation.
 *
 * @param originalItem - The item as it was BEFORE disputes were filed (preserved snapshot)
 * @param currentBureauData - The item as currently reported by the bureau
 * @returns ReAgingAlert with detection result and legal citation
 */
export function checkDelinquencyDateManipulation(
  originalItem: { id: string; creditorName: string; dateReported: string | null; firstDelinquencyDate?: string | null },
  currentBureauData: { dateReported: string | null; firstDelinquencyDate?: string | null }
): ReAgingAlert {
  const originalODD = originalItem.firstDelinquencyDate ?? originalItem.dateReported;
  const currentODD = currentBureauData.firstDelinquencyDate ?? currentBureauData.dateReported;

  if (!originalODD || !currentODD) {
    return {
      detected: false,
      itemId: originalItem.id,
      creditorName: originalItem.creditorName,
      originalDelinquencyDate: originalODD ?? null,
      currentReportedDate: currentODD ?? null,
      daysShifted: 0,
      message: 'Cannot check re-aging — original or current delinquency date is unknown.',
      legalCitation: '',
    };
  }

  const origDate = new Date(originalODD).getTime();
  const currDate = new Date(currentODD).getTime();
  const daysShifted = Math.round((currDate - origDate) / 86_400_000);

  // Any shift forward (re-aging to a LATER date resets the 7-year clock — illegal)
  const detected = daysShifted > 7; // 7-day tolerance for timezone/reporting cycle edge cases

  return {
    detected,
    itemId: originalItem.id,
    creditorName: originalItem.creditorName,
    originalDelinquencyDate: originalODD,
    currentReportedDate: currentODD,
    daysShifted,
    message: detected
      ? `⚠️ RE-AGING DETECTED: ${originalItem.creditorName} original delinquency date shifted forward by ${daysShifted} days (${originalODD} → ${currentODD}). This resets the 7-year reporting clock and is a FCRA violation.`
      : `No re-aging detected for ${originalItem.creditorName} (dates match within tolerance).`,
    legalCitation: detected
      ? 'FCRA §605(c) — Requirement to exclude certain adverse information; 2026 FCRA amendments prohibit re-aging of original delinquency date after dispute. File CFPB complaint if bureau does not immediately correct.'
      : '',
  };
}
