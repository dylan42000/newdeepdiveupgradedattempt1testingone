/**
 * On-device classification layer (Apex AD-8).
 *
 * Production path: lightweight local heuristics (no WASM model download).
 * Optional path: Transformers.js behind FEATURE_FLAGS.ON_DEVICE_TRANSFORMERS_JS
 * — intentionally stubbed so builds never pull multi-MB model weights.
 */

import type { NegativeItem } from '../types';
import { FEATURE_FLAGS } from '../config/featureFlags';

export type OnDeviceAccountClass =
  | 'collections'
  | 'charge_off'
  | 'late_payment'
  | 'hard_inquiry'
  | 'public_record'
  | 'student_loan'
  | 'medical'
  | 'mortgage'
  | 'revolving'
  | 'installment'
  | 'unknown';

export type FrivolousRiskBand = 'low' | 'medium' | 'high';

export interface OnDeviceClassification {
  accountClass: OnDeviceAccountClass;
  accountClassConfidence: number;
  disputeAngleScore: number;
  frivolousRisk: FrivolousRiskBand;
  frivolousRiskScore: number;
  engine: 'heuristic' | 'transformers_js' | 'stub';
  notes: string[];
}

function blobOf(item: NegativeItem): string {
  return [
    item.typeOfNegative,
    item.accountType,
    item.status,
    item.accountStatus,
    item.additionalInfo,
    item.creditorName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function classifyAccountHeuristic(item: NegativeItem): {
  accountClass: OnDeviceAccountClass;
  confidence: number;
} {
  const blob = blobOf(item);
  if (/\binquir/.test(blob)) return { accountClass: 'hard_inquiry', confidence: 0.92 };
  if (/bankruptcy|judgment|tax\s*lien|public\s*record/.test(blob)) {
    return { accountClass: 'public_record', confidence: 0.88 };
  }
  if (/student|navient|nelnet|mohela|dept\.?\s*of\s*ed/.test(blob)) {
    return { accountClass: 'student_loan', confidence: 0.85 };
  }
  if (/medical|hospital|clinic|physician/.test(blob)) {
    return { accountClass: 'medical', confidence: 0.8 };
  }
  if (/mortgage|home\s*loan|fannie|freddie/.test(blob)) {
    return { accountClass: 'mortgage', confidence: 0.82 };
  }
  if (/collection|debt\s*buyer|portfolio|lvnv|midland|pra\b/.test(blob)) {
    return { accountClass: 'collections', confidence: 0.9 };
  }
  if (/charge[\s-]?off|chargeoff|93\b/.test(blob)) {
    return { accountClass: 'charge_off', confidence: 0.88 };
  }
  if (/late|30\s*day|60\s*day|90\s*day|delinquen/.test(blob)) {
    return { accountClass: 'late_payment', confidence: 0.75 };
  }
  if (/revolving|credit\s*card|visa|mastercard|amex/.test(blob)) {
    return { accountClass: 'revolving', confidence: 0.7 };
  }
  if (/installment|auto\s*loan|personal\s*loan/.test(blob)) {
    return { accountClass: 'installment', confidence: 0.7 };
  }
  return { accountClass: 'unknown', confidence: 0.4 };
}

function scoreDisputeAngle(item: NegativeItem, accountClass: OnDeviceAccountClass): number {
  let score = 0.45;
  if (item.dateOfFirstDelinquency || item.originalDateOfDelinquency) score += 0.15;
  if (item.accountNumber || item.fullAccountNumber) score += 0.1;
  if (accountClass === 'collections' || accountClass === 'charge_off') score += 0.15;
  if (accountClass === 'hard_inquiry') score += 0.1;
  if ((item.parseConfidence ?? 1) < 0.5) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

function scoreFrivolousRisk(
  item: NegativeItem,
  passHint?: number,
): { band: FrivolousRiskBand; score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0.15;
  const pass = passHint ?? 1;
  const verified =
    item.disputeStatus?.includes('Verified') ||
    (item.verificationCount != null && item.verificationCount >= 2);

  if (pass >= 4 && verified) {
    score += 0.45;
    notes.push('High pass after verification elevates frivolous risk.');
  }
  if (pass >= 3 && !item.dateOfFirstDelinquency && !item.originalDateOfDelinquency) {
    score += 0.2;
    notes.push('Missing DOFD with repeated disputes increases frivolous risk.');
  }
  if (/\bfrivolous\b|\bspam\b/i.test(`${item.additionalInfo || ''} ${item.status || ''}`)) {
    score += 0.3;
    notes.push('Prior frivolous language detected on item notes.');
  }
  if (score >= 0.65) return { band: 'high', score: Math.min(1, score), notes };
  if (score >= 0.35) return { band: 'medium', score, notes };
  return { band: 'low', score, notes };
}

/** Lightweight always-on classifier (no model download). */
export function classifyOnDeviceHeuristic(
  item: NegativeItem,
  opts?: { pass?: number },
): OnDeviceClassification {
  const { accountClass, confidence } = classifyAccountHeuristic(item);
  const frivolous = scoreFrivolousRisk(item, opts?.pass);
  return {
    accountClass,
    accountClassConfidence: confidence,
    disputeAngleScore: scoreDisputeAngle(item, accountClass),
    frivolousRisk: frivolous.band,
    frivolousRiskScore: frivolous.score,
    engine: 'heuristic',
    notes: frivolous.notes,
  };
}

/**
 * Transformers.js stub — returns heuristic result and documents that full model
 * inference is feature-flagged off to protect Electron/Capacitor package size.
 */
async function classifyViaTransformersStub(
  item: NegativeItem,
  opts?: { pass?: number },
): Promise<OnDeviceClassification> {
  const base = classifyOnDeviceHeuristic(item, opts);
  return {
    ...base,
    engine: 'stub',
    notes: [
      ...base.notes,
      'Transformers.js path is stubbed (FEATURE_FLAGS.ON_DEVICE_TRANSFORMERS_JS). Using heuristic fallback.',
    ],
  };
}

/** Public async entry — prefers heuristics unless Transformers flag is on. */
export async function classifyOnDevice(
  item: NegativeItem,
  opts?: { pass?: number },
): Promise<OnDeviceClassification> {
  if (FEATURE_FLAGS.ON_DEVICE_TRANSFORMERS_JS) {
    return classifyViaTransformersStub(item, opts);
  }
  return classifyOnDeviceHeuristic(item, opts);
}

/** Sync helper for Autopilot strategy planning (cycle hot path). */
export function classifyOnDeviceSync(
  item: NegativeItem,
  opts?: { pass?: number },
): OnDeviceClassification {
  return classifyOnDeviceHeuristic(item, opts);
}
