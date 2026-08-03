/**
 * Goodwill Campaign Engine (Apex AD-10) — eligibility + ladder (not FCRA disputes).
 */

import type { NegativeItem } from '../types';
import { getCreditorFamily } from '../data/creditorAliasMatrix';

export type GoodwillTone = 'empathetic_professional' | 'hardship_narrative' | 'loyalty_appeal';
export type GoodwillApproach = 'letter' | 'phone_then_letter' | 'escalated_executive';

export interface GoodwillProfile {
  itemId: string;
  accountStatus: 'paid' | 'settled' | 'paid_charge_off' | 'closed_paid' | 'unknown';
  creditorClass: string;
  goodwillApproachRecommended: GoodwillApproach;
  toneProfile: GoodwillTone;
  expectedSuccessRate: 'high' | 'medium' | 'low';
  passLabel: 'GW-1' | 'GW-2' | 'GW-3';
}

function detectPaidStatus(item: NegativeItem): GoodwillProfile['accountStatus'] {
  const blob = `${item.status} ${item.accountStatus} ${item.typeOfNegative}`.toLowerCase();
  if (/\bsettled\b/.test(blob)) return 'settled';
  if (/\bpaid\b.*\bcharge/.test(blob) || /\bcharge.*\bpaid\b/.test(blob)) return 'paid_charge_off';
  if (/\bclosed\b.*\bpaid\b|\bpaid\b.*\bclosed\b|\bpaid\s*in\s*full\b|\b61\b|\b62\b|\b63\b|\b64\b/.test(blob)) {
    return 'closed_paid';
  }
  if (/\bpaid\b/.test(blob)) return 'paid';
  return 'unknown';
}

export function evaluateGoodwillEligibility(item: NegativeItem): {
  eligible: boolean;
  profile: GoodwillProfile | null;
  reason: string;
} {
  if (item.forceStrategy === 'goodwill' || item.goodwillEligible) {
    // fall through to build profile
  }

  const status = detectPaidStatus(item);
  const hasLateHistory = /\blate\b|\b30\b|\b60\b|\b90\b|delinquen/i.test(
    `${item.paymentHistory || ''} ${item.typeOfNegative} ${item.additionalInfo}`,
  );
  const paidLike = status !== 'unknown';
  const eligible = paidLike && (hasLateHistory || item.goodwillEligible === true || item.forceStrategy === 'goodwill');

  if (!eligible && item.forceStrategy !== 'goodwill') {
    return {
      eligible: false,
      profile: null,
      reason: 'Not paid/settled with late-history goodwill profile.',
    };
  }

  const family = getCreditorFamily(item.creditorName);
  const creditorClass = family?.canonical ?? 'unknown';
  let expectedSuccessRate: GoodwillProfile['expectedSuccessRate'] = 'medium';
  let tone: GoodwillTone = 'empathetic_professional';
  let approach: GoodwillApproach = 'letter';

  if (/CREDIT_UNION|NAVY_FEDERAL|LOCAL/i.test(creditorClass)) {
    expectedSuccessRate = 'high';
    tone = 'loyalty_appeal';
  } else if (/CAPITAL_ONE|CHASE|CITI|AMEX|DISCOVER|BANK_OF_AMERICA|WELLS/i.test(creditorClass)) {
    expectedSuccessRate = 'medium';
    approach = 'phone_then_letter';
  } else if (family?.isCollectionAgency) {
    expectedSuccessRate = 'low';
    return {
      eligible: false,
      profile: null,
      reason: 'Collection agencies rarely grant goodwill — use validation/dispute path.',
    };
  }

  if (status === 'settled') tone = 'hardship_narrative';

  const profile: GoodwillProfile = {
    itemId: item.id,
    accountStatus: paidLike ? status : 'unknown',
    creditorClass,
    goodwillApproachRecommended: approach,
    toneProfile: tone,
    expectedSuccessRate,
    passLabel: 'GW-1',
  };

  return {
    eligible: true,
    profile,
    reason: 'Paid/settled account eligible for goodwill request (not an FCRA dispute).',
  };
}

/** Goodwill letters must not cite FCRA demand language. */
export function goodwillLetterGuard(text: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (/15\s*U\.?S\.?C\.?|FCRA|§\s*611|§\s*623|reinvestigation|I demand deletion/i.test(text)) {
    issues.push('Goodwill letters must not cite FCRA dispute rights or demand language.');
  }
  return { ok: issues.length === 0, issues };
}
