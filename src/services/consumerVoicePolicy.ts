export const CONSUMER_VOICE_POLICY = `
CONSUMER AUTHORSHIP POLICY — MANDATORY
The named consumer is the author, sender, and signer of this letter.
Write in first-person singular using I, me, my, and mine.
Never imply that an attorney, law firm, credit-repair organization, advocate,
agent, or representative is speaking. Never use "our client", "my client",
"the consumer", "we represent", "our office", "on behalf of", "counsel for",
"attorney for", or "represented by" to describe the sender.
Do not claim legal expertise. Do not state that a complaint, lawsuit, or notice
has already been filed unless the supplied case history confirms that event.
Use only the supplied account facts and write as the consumer requesting an
accurate investigation, correction, or deletion of inaccurate information.
`.trim();

export type ConsumerVoiceIssueCode =
  | 'THIRD_PARTY_VOICE'
  | 'MISSING_FIRST_PERSON'
  | 'UNCONFIRMED_ACTION'
  | 'EMPTY_LETTER';

export interface ConsumerVoiceIssue {
  code: ConsumerVoiceIssueCode;
  severity: 'repair' | 'hard_block';
  message: string;
  offendingText?: string;
}

const THIRD_PARTY_PATTERNS: RegExp[] = [
  /\bour client\b/i,
  /\bmy client\b/i,
  /\bon behalf of\b/i,
  /\bthe consumer\s+(?:requests?|demands?|disputes?|states?|maintains?)\b/i,
  /\bwe represent\b/i,
  /\bour office\b/i,
  /\bcounsel for\b/i,
  /\battorney for\b/i,
  /\brepresented by\b/i,
];

export function validateConsumerVoice(text: string): ConsumerVoiceIssue[] {
  const body = (text || '').trim();
  if (!body) return [{ code: 'EMPTY_LETTER', severity: 'hard_block', message: 'Letter body is empty.' }];

  const issues: ConsumerVoiceIssue[] = [];
  for (const pattern of THIRD_PARTY_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      issues.push({
        code: 'THIRD_PARTY_VOICE',
        severity: 'repair',
        message: `Representative voice detected: ${match[0]}`,
        offendingText: match[0],
      });
    }
  }

  if (!/\b(?:I|me|my|mine)\b/i.test(body)) {
    issues.push({ code: 'MISSING_FIRST_PERSON', severity: 'repair', message: 'Letter does not use first-person consumer voice.' });
  }

  if (/\b(?:has been filed|I filed|we filed)\b/i.test(body) && !/\b(?:if necessary|intend|plan|may|will consider)\b/i.test(body)) {
    issues.push({
      code: 'UNCONFIRMED_ACTION',
      severity: 'repair',
      message: 'Letter may claim an external filing without a confirmed case-history event.',
    });
  }

  return issues;
}

/**
 * Robust First-Person Consumer Wording Normalizer (World-Class §3.4).
 *
 * Performs comprehensive grammatical person correction BEFORE validation so
 * representative/law-firm phrasing is repaired in place instead of triggering
 * a fatal validation throw.
 *
 * Ordering contract: compound phrases ("on behalf of the consumer",
 * "our client's") MUST be rewritten before their sub-phrases ("the consumer",
 * "our client") — otherwise "on behalf of the consumer" degrades into the
 * ungrammatical "on behalf of I".
 */
export function normalizeConsumerVoice(text: string): string {
  return (text || '')
    // ── Compound representative phrases first (must precede sub-phrase rules) ──
    .replace(/\bon behalf of (?:our client|the consumer|my client)\b/gi, 'on my own behalf')
    .replace(/\bin the name of (?:our client|the consumer|my client)\b/gi, 'in my own name')
    // ── Possessive forms (must precede bare-noun rules) ──
    .replace(/\bour client's\b/gi, 'my')
    .replace(/\bour clients'\b/gi, 'my')
    .replace(/\bmy client's\b/gi, 'my')
    .replace(/\bthe consumer's\b/gi, 'my')
    // ── Bare third-party / law-firm references ──
    .replace(/\bour client\b/gi, 'I')
    .replace(/\bmy client\b/gi, 'I')
    .replace(/\bthe consumer\b/gi, 'I')
    .replace(/\bwe represent\b/gi, 'I am writing regarding')
    .replace(/\bour office\b/gi, 'I')
    .replace(/\bour firm\b/gi, 'I')
    .replace(/\bour law firm\b/gi, 'I')
    .replace(/\bcounsel for\b/gi, 'the account holder for')
    .replace(/\battorney for\b/gi, 'the account holder for')
    .replace(/\brepresented by\b/gi, 'written by')
    // ── Repair resulting double pronouns / awkward sentence starts ──
    .replace(/\bI I\b/g, 'I')
    .replace(/\bI am I\b/gi, 'I am')
    .replace(/(?<=[.!?]\s+)i\b/g, 'I')
    // ── Whitespace hygiene: collapse horizontal runs, preserve paragraph breaks ──
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ ?\n /g, '\n')
    .trim();
}
