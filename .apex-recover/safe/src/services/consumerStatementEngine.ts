/**
 * Consumer Statement Engine (Apex AD-14) — FCRA 100-word consumer statements.
 * For items that cannot be deleted but can be contextualized on the report.
 */

import type { NegativeItem } from '../types';

export const CONSUMER_STATEMENT_WORD_LIMIT = 100;

export interface ConsumerStatement {
  itemId: string;
  creditorName: string;
  draft: string;
  wordCount: number;
  withinLimit: boolean;
  eligibilityReason: string;
  guidance: string[];
}

export function isStatementEligible(item: NegativeItem, pass?: number): {
  eligible: boolean;
  reason: string;
} {
  const verified =
    item.disputeStatus?.includes('Verified') ||
    (item.verificationCount != null && item.verificationCount >= 2);
  const highPass = pass != null ? pass >= 5 : true;

  if (item.disputeStatus === 'Won' || /deleted|removed/i.test(item.disputeStatus || '')) {
    return { eligible: false, reason: 'Item already deleted — statement not needed.' };
  }

  if (!verified && !(pass != null && pass >= 6)) {
    return {
      eligible: false,
      reason: 'Statements are recommended after verification or late-pass exhaustion.',
    };
  }

  if (!highPass && !verified) {
    return { eligible: false, reason: 'Continue dispute ladder before attaching a statement.' };
  }

  return {
    eligible: true,
    reason: 'Verified / late-pass item — consumer may contextualize with a ≤100-word statement.',
  };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function enforceWordLimit(text: string, limit = CONSUMER_STATEMENT_WORD_LIMIT): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(' ');
  return words.slice(0, limit).join(' ');
}

/** Deterministic draft — no cloud call; user edits before sending to bureaus. */
export function draftConsumerStatement(item: NegativeItem): ConsumerStatement {
  const eligibility = isStatementEligible(item);
  const creditor = item.creditorName || 'this creditor';
  const accountHint =
    (item.accountNumber || item.fullAccountNumber || '').replace(/\D/g, '').slice(-4) || '****';

  const draft = enforceWordLimit(
    [
      `I am submitting this consumer statement regarding the ${creditor} account ending in ${accountHint}.`,
      'I dispute aspects of how this account has been characterized and request that this statement remain part of my file.',
      'Any remaining balance or status should be read in light of my good-faith efforts to resolve the matter.',
      'This statement is made under my rights as a consumer and is not an admission of liability beyond what the record already shows.',
    ].join(' '),
  );

  const wordCount = countWords(draft);
  return {
    itemId: item.id,
    creditorName: creditor,
    draft,
    wordCount,
    withinLimit: wordCount <= CONSUMER_STATEMENT_WORD_LIMIT,
    eligibilityReason: eligibility.reason,
    guidance: [
      'Keep the statement factual and under 100 words (FCRA consumer statement practice).',
      'Do not invent account numbers, balances, or dates not on your report.',
      'Submit separately to each bureau that still reports the item.',
      'A statement contextualizes — it does not guarantee deletion or score change.',
    ],
  };
}

export function validateConsumerStatement(text: string): {
  ok: boolean;
  wordCount: number;
  issues: string[];
} {
  const wordCount = countWords(text);
  const issues: string[] = [];
  if (wordCount === 0) issues.push('Statement is empty.');
  if (wordCount > CONSUMER_STATEMENT_WORD_LIMIT) {
    issues.push(`Exceeds ${CONSUMER_STATEMENT_WORD_LIMIT}-word limit (${wordCount} words).`);
  }
  if (/as an attorney|legal counsel|we demand/i.test(text)) {
    issues.push('Avoid attorney persona or demand language in a consumer statement.');
  }
  return { ok: issues.length === 0, wordCount, issues };
}
