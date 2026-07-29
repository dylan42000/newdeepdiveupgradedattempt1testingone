import type { NegativeItem } from '../types';
import { creditorsAreAliasMatch } from '../data/creditorAliasMatrix';
import { detectOCCARelationship } from './ocCaRelationshipDetector';

/** Auto-merge floor — lowered for aggressive cross-bureau linking when signals corroborate. */
export const AUTO_MERGE_CONFIDENCE = 0.70;
/** Review band only for genuinely ambiguous pairs. */
export const REVIEW_MERGE_FLOOR = 0.55;

export type MergeDecisionTier =
  | 'AUTO_MERGE'
  | 'LINK_ONLY'
  | 'SUGGEST'
  | 'MANUAL_REVIEW'
  | 'NO_MERGE'
  | 'HARD_REFUSE';

export interface MergeSignals {
  creditorName: number;
  accountNumber: number | null;
  balance: number | null;
  dateOpenedOrDofd: number | null;
  accountType: number | null;
  statusFamily?: number | null;
  last4Match?: boolean;
}

export interface MergeCandidate {
  left: NegativeItem;
  right: NegativeItem;
  confidence: number;
  signals: MergeSignals;
  disqualified: boolean;
  reasons: string[];
  decision: MergeDecisionTier;
  campaignGroupId?: string;
}

export interface PendingReviewMerge {
  leftId: string;
  rightId: string;
  left: NegativeItem;
  right: NegativeItem;
  confidence: number;
  signals: MergeSignals;
  reasons: string[];
  decision: MergeDecisionTier;
  campaignGroupId?: string;
}

export interface UnifiedTradeline {
  id: string;
  sourceItems: NegativeItem[];
  bureaus: string[];
  creditorName: string;
  balance: number | null;
  dateOpened: string | null;
  dateOfFirstDelinquency: string | null;
  accountNumber: string;
  unresolvedMaskPositions: number;
  mergeConfidence: number;
}

export interface TradelineMergePlan {
  autoMerged: UnifiedTradeline[];
  pendingReviewMerges: PendingReviewMerge[];
  linkOnlyPairs: PendingReviewMerge[];
}

const MASK_CHAR = /[xX*#?\u2022]/;
const DAY_MS = 86_400_000;
const GENERIC_NAME_WORDS = new Set([
  'ACCOUNT', 'AMERICAN', 'BANK', 'CARD', 'CREDIT', 'FINANCE', 'FINANCIAL',
  'FIRST', 'NATIONAL', 'SERVICE', 'SERVICES', 'THE', 'UNITED', 'STORE',
]);

function canonicalBureau(value: string): string {
  const compact = value.toLowerCase().replace(/[^a-z]/g, '');
  if (compact === 'tu' || compact.includes('transunion')) return 'transunion';
  if (compact === 'eq' || compact.includes('equifax')) return 'equifax';
  if (compact === 'ex' || compact.includes('experian')) return 'experian';
  return compact;
}

function bureauSet(item: NegativeItem): Set<string> {
  return new Set((item.creditBureau ?? []).map(canonicalBureau).filter(Boolean));
}

function sharesBureau(left: NegativeItem, right: NegativeItem): boolean {
  const rightBureaus = bureauSet(right);
  return [...bureauSet(left)].some(bureau => rightBureaus.has(bureau));
}

export function normalizeCreditorForMatch(value: string | null | undefined): string {
  let cleaned = (value ?? '').toUpperCase()
    .replace(/\bCAP\s*ONE\b/g, 'CAPITAL ONE')
    .replace(/\bCAP1\b/g, 'CAPITAL ONE')
    .replace(/\bBOFA\b/g, 'BANK OF AMERICA')
    .replace(/\bB\s*OF\s*A\b/g, 'BANK OF AMERICA')
    .replace(/\bCITI\s*BANK\b/g, 'CITIBANK')
    .replace(/\bAMEX\b/g, 'AMERICAN EXPRESS')
    .replace(/\bSYNCB\b/g, 'SYNCHRONY')
    .replace(/\bCBNA\b/g, 'CITIBANK')
    .replace(/\bJPMCB\b/g, 'JPMORGAN CHASE')
    .replace(/\bJPMC\b/g, 'JPMORGAN CHASE')
    .replace(/\bMCM\b/g, 'MIDLAND CREDIT MANAGEMENT')
    .replace(/\bPRA\b/g, 'PORTFOLIO RECOVERY')
    .replace(/\bCAPITAL ONE BY .*$/g, 'CAPITAL ONE')
    .replace(/\bSYNCB\s*\/\s*/g, 'SYNCHRONY ');
  cleaned = cleaned
    .replace(/\b(N\.?A\.?|INCORPORATED|INC|LLC|LTD|CORP(?:ORATION)?|COMPANY|CO|FSB|USA|ASSOCIATES|ASSOC|MGMT|MANAGEMENT)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

export function jaroWinkler(left: string, right: string): number {
  const a = normalizeCreditorForMatch(left).replace(/\s/g, '');
  const b = normalizeCreditorForMatch(right).replace(/\s/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  const range = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const matchedA = new Array(a.length).fill(false);
  const matchedB = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j <= Math.min(i + range, b.length - 1); j++) {
      if (!matchedB[j] && a[i] === b[j]) {
        matchedA[i] = true; matchedB[j] = true; matches++; break;
      }
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let cursor = 0;
  for (let i = 0; i < a.length; i++) {
    if (!matchedA[i]) continue;
    while (!matchedB[cursor]) cursor++;
    if (a[i] !== b[cursor]) transpositions++;
    cursor++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function meaningfulNameWords(value: string): string[] {
  return normalizeCreditorForMatch(value).split(' ').filter(word => word.length >= 3 && !GENERIC_NAME_WORDS.has(word));
}

function rawCreditorScore(left: string, right: string): number {
  const a = normalizeCreditorForMatch(left);
  const b = normalizeCreditorForMatch(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (creditorsAreAliasMatch(left, right)) return 0.95;
  const wordsA = meaningfulNameWords(a);
  const wordsB = meaningfulNameWords(b);
  const overlap = wordsA.filter(word => wordsB.includes(word)).length;
  const containment = (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b));
  const fuzzy = jaroWinkler(a, b);
  if (containment || (overlap > 0 && overlap / Math.max(wordsA.length, wordsB.length, 1) >= 0.5)) {
    return Math.max(0.88, fuzzy);
  }
  return fuzzy;
}

/** Best creditor identity across primary name, originalCreditor, and furnisher fields. */
function creditorScore(left: NegativeItem, right: NegativeItem): number {
  const leftNames = [left.creditorName, left.originalCreditor, left.furnisher].filter(Boolean) as string[];
  const rightNames = [right.creditorName, right.originalCreditor, right.furnisher].filter(Boolean) as string[];
  let best = 0;
  for (const a of leftNames) {
    for (const b of rightNames) {
      best = Math.max(best, rawCreditorScore(a, b));
    }
  }
  return best;
}

function cleanAccount(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/[X#?\u2022]/g, '*').replace(/[^A-Z0-9*]/g, '');
}

function bestAccount(item: NegativeItem): string {
  return cleanAccount(item.fullAccountNumber || item.accountNumber);
}

/** Extract the last N visible (non-mask) digits from an account token. */
function visibleLastN(value: string | null | undefined, n: number): string | null {
  const cleaned = cleanAccount(value);
  if (!cleaned) return null;
  // A prefix-only token (for example 123456****) does not reveal a last four.
  // Do not skip over its trailing mask and accidentally treat the prefix as a
  // suffix, which would manufacture a false account-number conflict.
  if (MASK_CHAR.test(cleaned[cleaned.length - 1])) return null;
  const digits: string[] = [];
  for (let i = cleaned.length - 1; i >= 0 && digits.length < n; i--) {
    const char = cleaned[i];
    if (MASK_CHAR.test(char)) return null;
    if (/[0-9]/.test(char)) digits.unshift(char);
  }
  return digits.length === n ? digits.join('') : null;
}

function visibleLast4(value: string | null | undefined): string | null {
  return visibleLastN(value, 4);
}

function last4Conflict(left: NegativeItem, right: NegativeItem): boolean {
  const leftLast4 = visibleLast4(bestAccount(left));
  const rightLast4 = visibleLast4(bestAccount(right));
  return leftLast4 != null && rightLast4 != null && leftLast4 !== rightLast4;
}

function last4Equal(left: NegativeItem, right: NegativeItem): boolean {
  const leftLast4 = visibleLast4(bestAccount(left));
  const rightLast4 = visibleLast4(bestAccount(right));
  return leftLast4 != null && rightLast4 != null && leftLast4 === rightLast4;
}

function last5Equal(left: NegativeItem, right: NegativeItem): boolean {
  const a = visibleLastN(bestAccount(left), 5);
  const b = visibleLastN(bestAccount(right), 5);
  return a != null && b != null && a === b;
}

interface AccountComparison { score: number | null; conflict: boolean; compared: number }

function visibleRunAtStart(value: string): number {
  let count = 0;
  for (const char of value) {
    if (MASK_CHAR.test(char)) break;
    if (isRecoverableChar(char)) count++;
    else break;
  }
  return count;
}

function visibleRunAtEnd(value: string): number {
  let count = 0;
  for (let index = value.length - 1; index >= 0; index--) {
    const char = value[index];
    if (MASK_CHAR.test(char)) break;
    if (isRecoverableChar(char)) count++;
    else break;
  }
  return count;
}

function compareAlignedAccountTokens(a: string, b: string, alignment: 'left' | 'right'): AccountComparison {
  const width = Math.max(a.length, b.length);
  const aa = alignment === 'right' ? a.padStart(width, '*') : a.padEnd(width, '*');
  const bb = alignment === 'right' ? b.padStart(width, '*') : b.padEnd(width, '*');
  let compared = 0;
  let matches = 0;
  for (let index = 0; index < width; index++) {
    if (MASK_CHAR.test(aa[index]) || MASK_CHAR.test(bb[index])) continue;
    compared++;
    if (aa[index] === bb[index]) matches++;
  }
  return {
    score: compared ? matches / compared : null,
    conflict: compared > 0 && matches < compared,
    compared,
  };
}

/**
 * Compare known characters with right-alignment (bureau masks differ in length).
 * Also boosts when visible last-4/5 suffixes align even if mask lengths differ wildly.
 */
function compareAccountNumbers(left: NegativeItem, right: NegativeItem): AccountComparison {
  const a = bestAccount(left);
  const b = bestAccount(right);
  if (!a || !b) {
    // Empty / fully masked — no digit evidence
    if (last4Equal(left, right)) return { score: 1, conflict: false, compared: 4 };
    return { score: null, conflict: false, compared: 0 };
  }

  // Credit reports can expose either end of an account number.  Right alignment
  // is correct for the common last-four mask; left alignment is required for a
  // prefix-only mask such as 123456**** compared with 123456****1234.  Never
  // let a matching prefix override two conflicting visible suffixes.
  const suffixIsAuthoritative = visibleRunAtEnd(a) >= 3 && visibleRunAtEnd(b) >= 3;
  const prefixCanAnchor = visibleRunAtStart(a) >= 3 && visibleRunAtStart(b) >= 3;
  const comparison = !suffixIsAuthoritative && prefixCanAnchor
    ? compareAlignedAccountTokens(a, b, 'left')
    : compareAlignedAccountTokens(a, b, 'right');
  const { compared, conflict, score } = comparison;

  if (compared > 0) {
    // Suffix alignment can still rescue right-aligned last4 when front digits conflict poorly —
    // but true digit conflicts remain conflicts.
    if (conflict) return { score, conflict: true, compared };
    if (last5Equal(left, right)) return { score: 1, conflict: false, compared: Math.max(compared, 5) };
    if (last4Equal(left, right)) return { score: Math.max(score, 0.98), conflict: false, compared: Math.max(compared, 4) };
    return { score, conflict: false, compared };
  }

  // No overlapping known positions — fall back to suffix identity
  if (last5Equal(left, right)) return { score: 1, conflict: false, compared: 5 };
  if (last4Equal(left, right)) return { score: 0.98, conflict: false, compared: 4 };
  return { score: null, conflict: false, compared: 0 };
}

function balanceScore(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  const delta = Math.abs(a - b);
  if (delta <= 50) return 1;
  const baseline = Math.max(Math.abs(a), Math.abs(b), 1);
  if (delta <= 300 || delta / baseline <= 0.22) return 0.92;
  if (delta / baseline <= 0.40) return 0.6;
  return Math.max(0, 1 - delta / baseline);
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function dateScore(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = parseDate(a), right = parseDate(b);
  if (left == null || right == null) return null;
  const days = Math.abs(left - right) / DAY_MS;
  if (days <= 60) return 1;
  if (days <= 120) return 0.85;
  if (days <= 210) return 0.45;
  return 0;
}

function primaryDate(item: NegativeItem): string | null | undefined {
  return item.dateOpened ?? item.originalOpeningDate ?? item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency;
}

function dofdDate(item: NegativeItem): string | null | undefined {
  return item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency;
}

function typeScore(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = normalize(a), right = normalize(b);
  if (!left || !right) return null;
  return left === right || left.includes(right) || right.includes(left) ? 1 : 0;
}

function statusFamilyScore(left: NegativeItem, right: NegativeItem): number | null {
  const blob = (item: NegativeItem) =>
    `${item.typeOfNegative} ${item.status} ${item.accountStatus ?? ''} ${item.accountType ?? ''}`.toLowerCase();
  const family = (text: string): string | null => {
    if (/\bcollection\b|\bcollect\b/.test(text)) return 'collection';
    if (/\bcharge[\s-]?off\b|\bcharged\s*off\b|\b93\b|\b97\b/.test(text)) return 'chargeoff';
    if (/\blate\b|\bdelinquen|\bpast\s*due\b|\b30\b|\b60\b|\b90\b|\b120\b/.test(text)) return 'delinquent';
    if (/\brepossession\b|\brepo\b/.test(text)) return 'repo';
    if (/\bforeclos/.test(text)) return 'foreclosure';
    return null;
  };
  const a = family(blob(left));
  const b = family(blob(right));
  if (!a || !b) return null;
  if (a === b) return 1;
  // Collection ↔ charge-off are related but not identity — mild corroboration only
  if ((a === 'collection' && b === 'chargeoff') || (a === 'chargeoff' && b === 'collection')) return 0.55;
  return 0;
}

function buildCampaignGroupId(left: NegativeItem, right: NegativeItem): string {
  return [left.id, right.id].sort().join(':');
}

interface ScoredPair {
  left: NegativeItem;
  right: NegativeItem;
  confidence: number;
  signals: MergeSignals;
  disqualified: boolean;
  reasons: string[];
  sameBureau: boolean;
  hardNameConflict: boolean;
  digitConflict: boolean;
  last4Mismatch: boolean;
  strongName: boolean;
  strongDigits: boolean;
  hasDigitCorroboration: boolean;
  hasIdentityGate: boolean;
  corroborators: number;
  strongSignalCount: number;
  borderlineNoDigits: boolean;
  aliasMatch: boolean;
}

function scorePair(left: NegativeItem, right: NegativeItem): ScoredPair {
  const sameBureau = sharesBureau(left, right);
  const creditorName = creditorScore(left, right);
  const account = compareAccountNumbers(left, right);
  const balance = balanceScore(left.balance ?? left.originalBalance, right.balance ?? right.originalBalance);
  const openedScore = dateScore(primaryDate(left), primaryDate(right));
  const dofdScore = dateScore(dofdDate(left), dofdDate(right));
  const dateOpenedOrDofd =
    openedScore != null && dofdScore != null
      ? Math.max(openedScore, dofdScore)
      : openedScore ?? dofdScore;
  const accountType = typeScore(left.accountType ?? left.typeOfNegative, right.accountType ?? right.typeOfNegative);
  const statusFamily = statusFamilyScore(left, right);
  const last4Match = last4Equal(left, right);
  const aliasMatch = creditorsAreAliasMatch(left.creditorName, right.creditorName)
    || (!!left.originalCreditor && creditorsAreAliasMatch(left.originalCreditor, right.creditorName))
    || (!!right.originalCreditor && creditorsAreAliasMatch(left.creditorName, right.originalCreditor));

  const signals: MergeSignals = {
    creditorName,
    accountNumber: account.score,
    balance,
    dateOpenedOrDofd,
    accountType,
    statusFamily,
    last4Match,
  };
  const reasons: string[] = [];

  const hardNameConflict = creditorName < 0.55 && !aliasMatch;
  const last4Mismatch = last4Conflict(left, right);
  const digitConflict = account.conflict || last4Mismatch;
  const strongName = creditorName >= 0.85 || aliasMatch;
  const strongDigits = (account.score != null && account.score >= 0.98 && account.compared >= 3) || last4Match;
  const hasDigitCorroboration = last4Match || (account.compared >= 1 && account.score != null && account.score >= 0.75);

  const balanceOk = balance != null && balance >= 0.75;
  const dateOk = dateOpenedOrDofd != null && dateOpenedOrDofd >= 0.75;
  const statusOk = statusFamily != null && statusFamily >= 0.75;

  // Identity-grade corroborators: balance/date (status alone is too weak — most negatives share "collection")
  const hardCorroboratorScores = [balance, dateOpenedOrDofd]
    .filter((score): score is number => score != null && score >= 0.75);
  const corroborators = hardCorroboratorScores.length
    + (statusOk ? 1 : 0)
    + (accountType != null && accountType >= 0.75 ? 1 : 0);

  // 2-of-N strong signals: last4/digits, balance, date/DOFD (status is soft-only)
  const strongSignalFlags = [
    last4Match || strongDigits,
    balanceOk,
    dateOk,
  ];
  const strongSignalCount = strongSignalFlags.filter(Boolean).length;

  // Without digits, date proximity is required for identity (prevents Synchrony×N false merges)
  const hasIdentityGate =
    strongDigits
    || (strongName && hasDigitCorroboration && hardCorroboratorScores.length >= 1)
    || (strongName && dateOk && balanceOk)
    || (aliasMatch && strongSignalCount >= 2 && (hasDigitCorroboration || dateOk))
    || (strongName && last4Match);

  // Truly ambiguous: strong name + balance but no digits and no date
  const borderlineNoDigits =
    strongName
    && !hasDigitCorroboration
    && !dateOk
    && balanceOk;

  const disqualified = sameBureau || hardNameConflict || digitConflict || !hasIdentityGate;

  if (sameBureau) reasons.push('Entries share a bureau, so they remain separate.');
  if (last4Mismatch) reasons.push('Visible last-4 account digits conflict.');
  if (account.conflict) reasons.push(`Known account characters conflict in ${account.compared} comparable position(s).`);
  if (hardNameConflict) reasons.push('Creditor names do not identify the same furnisher.');
  if (last4Match) reasons.push('Visible last-4 account digits match.');
  if (strongDigits) reasons.push(`${account.compared} known account character(s) match.`);
  if (strongName) reasons.push('Creditor names strongly match after alias normalization.');
  if (aliasMatch) reasons.push('Creditor aliases resolve to the same family.');
  if (balance != null && balance >= 0.75) reasons.push('Balances are compatible across reporting dates.');
  if (dateOpenedOrDofd != null && dateOpenedOrDofd >= 0.75) reasons.push('Opened/DOFD dates align.');
  if (statusFamily != null && statusFamily >= 0.75) reasons.push('Status family aligns (collection/charge-off/etc.).');
  if (strongSignalCount >= 2 && aliasMatch) reasons.push(`Alias match with ${strongSignalCount} strong signals (2-of-N).`);
  if (borderlineNoDigits) reasons.push('Name+balance only with no digit/date corroboration — manual review.');

  const weighted: Array<[number, number]> = [
    [creditorName, 0.32],
    ...(account.score == null ? [] : [[account.score, 0.28] as [number, number]]),
    ...(balance == null ? [] : [[balance, 0.16] as [number, number]]),
    ...(dateOpenedOrDofd == null ? [] : [[dateOpenedOrDofd, 0.14] as [number, number]]),
    ...(accountType == null ? [] : [[accountType, 0.05] as [number, number]]),
    ...(statusFamily == null ? [] : [[statusFamily, 0.05] as [number, number]]),
  ];
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let confidence = weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / Math.max(totalWeight, 0.01);

  if (strongDigits && strongName) confidence = Math.max(confidence, 0.94);
  else if (last4Match && aliasMatch) confidence = Math.max(confidence, 0.92);
  else if (strongDigits && corroborators >= 1) confidence = Math.max(confidence, 0.86);
  else if (aliasMatch && strongSignalCount >= 2) confidence = Math.max(confidence, 0.84);
  else if (strongName && corroborators >= 2) confidence = Math.max(confidence, 0.82);
  else if (strongName && corroborators >= 1 && hasDigitCorroboration) confidence = Math.max(confidence, 0.80);

  if (last4Mismatch || digitConflict || hardNameConflict) confidence = 0;
  else if (disqualified && !sameBureau) confidence = Math.max(0, Math.min(confidence, AUTO_MERGE_CONFIDENCE - 0.01));

  return {
    left,
    right,
    confidence: Math.max(0, Math.min(1, confidence)),
    signals,
    disqualified,
    reasons,
    sameBureau,
    hardNameConflict,
    digitConflict,
    last4Mismatch,
    strongName,
    strongDigits,
    hasDigitCorroboration,
    hasIdentityGate,
    corroborators,
    strongSignalCount,
    borderlineNoDigits,
    aliasMatch,
  };
}

function resolveDecisionTier(scored: ScoredPair): MergeDecisionTier {
  const {
    confidence, sameBureau, hardNameConflict, digitConflict, last4Mismatch,
    strongName, hasIdentityGate, corroborators, borderlineNoDigits,
    aliasMatch, strongSignalCount, strongDigits,
  } = scored;

  if (last4Mismatch || digitConflict || hardNameConflict) return 'HARD_REFUSE';
  if (sameBureau) return confidence >= REVIEW_MERGE_FLOOR ? 'HARD_REFUSE' : 'NO_MERGE';

  // Name + balance alone with no other evidence → review only
  if (borderlineNoDigits) return 'MANUAL_REVIEW';

  // Aggressive auto: alias/strong name + 2-of-N, or classic identity gate + threshold
  const twoOfN = (aliasMatch || strongName) && strongSignalCount >= 2;
  if (
    (confidence >= AUTO_MERGE_CONFIDENCE && hasIdentityGate && !scored.disqualified)
    || (twoOfN && confidence >= AUTO_MERGE_CONFIDENCE - 0.02 && !scored.disqualified && !borderlineNoDigits)
    || (strongDigits && strongName && confidence >= 0.68)
  ) {
    return 'AUTO_MERGE';
  }

  if (!hasIdentityGate && strongName && corroborators >= 1 && confidence >= REVIEW_MERGE_FLOOR) {
    return 'LINK_ONLY';
  }
  if (confidence >= REVIEW_MERGE_FLOOR) return 'SUGGEST';
  return 'NO_MERGE';
}

export function decideMergeTier(left: NegativeItem, right: NegativeItem): MergeCandidate {
  // OC + CA pairs are campaign-linked, never collapsed into one tradeline
  const occa = detectOCCARelationship(left, right);
  if (occa.decision === 'link_only') {
    return {
      left,
      right,
      confidence: 0.72,
      signals: {
        creditorName: creditorScore(left, right),
        accountNumber: compareAccountNumbers(left, right).score,
        balance: balanceScore(left.balance ?? left.originalBalance, right.balance ?? right.originalBalance),
        dateOpenedOrDofd: dateScore(primaryDate(left), primaryDate(right)),
        accountType: typeScore(left.accountType ?? left.typeOfNegative, right.accountType ?? right.typeOfNegative),
      },
      disqualified: false,
      reasons: [occa.reason, occa.campaignHint].filter(Boolean),
      decision: 'LINK_ONLY',
      campaignGroupId: buildCampaignGroupId(left, right),
    };
  }

  const scored = scorePair(left, right);
  const decision = resolveDecisionTier(scored);
  const campaignGroupId = decision === 'LINK_ONLY'
    ? buildCampaignGroupId(left, right)
    : undefined;
  return {
    left: scored.left,
    right: scored.right,
    confidence: scored.confidence,
    signals: scored.signals,
    disqualified: scored.disqualified,
    reasons: scored.reasons,
    decision,
    campaignGroupId,
  };
}

export function scoreMergeCandidate(left: NegativeItem, right: NegativeItem): MergeCandidate {
  return decideMergeTier(left, right);
}

function isRecoverableChar(char: string | undefined): char is string {
  return Boolean(char && /[A-Z0-9]/.test(char) && !MASK_CHAR.test(char));
}

/** Right-align source tokens and fill only positions supported by non-conflicting source characters. */
export function stitchAccountNumbers(items: NegativeItem[]): { accountNumber: string; unresolvedMaskPositions: number } {
  const accounts = items.map(bestAccount).filter(Boolean);
  if (!accounts.length) return { accountNumber: '', unresolvedMaskPositions: 0 };
  const maxLength = Math.max(...accounts.map(value => value.length));
  // A source that shows only a leading run (123456****) is left-anchored;
  // ordinary last-four and middle masks remain right-anchored.  This lets a
  // complementary bureau reveal both ends without guessing any hidden digit.
  const aligned = accounts.map(value => {
    const prefixOnly = visibleRunAtStart(value) >= 3 && visibleRunAtEnd(value) < 3;
    return prefixOnly ? value.padEnd(maxLength, '*') : value.padStart(maxLength, '*');
  });
  const output: string[] = [];
  let unresolvedMaskPositions = 0;
  for (let index = 0; index < maxLength; index++) {
    const known = [...new Set(aligned.map(value => value[index]).filter(isRecoverableChar))];
    if (known.length === 1) output.push(known[0]);
    else { output.push('*'); unresolvedMaskPositions++; }
  }
  return { accountNumber: output.join(''), unresolvedMaskPositions };
}

function toUnifiedTradeline(sourceItems: NegativeItem[], index: number): UnifiedTradeline {
  const stitched = stitchAccountNumbers(sourceItems);
  const candidates = sourceItems.flatMap((item, itemIndex) => sourceItems.slice(itemIndex + 1).map(other => scoreMergeCandidate(item, other)));
  return {
    id: sourceItems.map(item => item.id).sort().join(':') || `tradeline-${index}`,
    sourceItems,
    bureaus: [...new Set(sourceItems.flatMap(item => item.creditBureau ?? []))],
    creditorName: [...sourceItems].sort((a, b) => b.creditorName.length - a.creditorName.length)[0].creditorName,
    balance: sourceItems.find(item => item.balance != null)?.balance ?? null,
    dateOpened: sourceItems.find(item => item.dateOpened)?.dateOpened ?? sourceItems.find(item => item.originalOpeningDate)?.originalOpeningDate ?? null,
    dateOfFirstDelinquency: sourceItems.find(item => item.dateOfFirstDelinquency)?.dateOfFirstDelinquency ?? sourceItems.find(item => item.originalDateOfDelinquency)?.originalDateOfDelinquency ?? null,
    ...stitched,
    mergeConfidence: candidates.length ? Math.min(...candidates.map(candidate => candidate.confidence)) : 1,
  };
}

function groupCanAccept(group: NegativeItem[], item: NegativeItem): { accepted: boolean; confidence: number } {
  if (group.some(existing => sharesBureau(existing, item))) return { accepted: false, confidence: 0 };
  const comparisons = group.map(existing => scoreMergeCandidate(existing, item));
  // Allow group growth when every edge is AUTO_MERGE (LINK_ONLY must not collapse rows)
  if (comparisons.some(candidate => candidate.decision !== 'AUTO_MERGE')) return { accepted: false, confidence: 0 };
  return { accepted: true, confidence: Math.min(...comparisons.map(candidate => candidate.confidence)) };
}

export function mergeTradelines(items: NegativeItem[]): UnifiedTradeline[] {
  const groups: NegativeItem[][] = items.map(item => [item]);
  const candidates: Array<{ left: NegativeItem; right: NegativeItem; confidence: number }> = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const candidate = scoreMergeCandidate(items[i], items[j]);
    if (candidate.decision === 'AUTO_MERGE') candidates.push({ left: items[i], right: items[j], confidence: candidate.confidence });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  for (const edge of candidates) {
    const leftIndex = groups.findIndex(group => group.some(item => item.id === edge.left.id));
    const rightIndex = groups.findIndex(group => group.some(item => item.id === edge.right.id));
    if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) continue;
    const leftGroup = groups[leftIndex], rightGroup = groups[rightIndex];
    const compatible = rightGroup.every(item => groupCanAccept(leftGroup, item).accepted);
    if (!compatible) continue;
    groups[leftIndex] = [...leftGroup, ...rightGroup];
    groups.splice(rightIndex, 1);
  }
  return groups.map((sourceItems, index) => toUnifiedTradeline(sourceItems, index));
}

function pairKey(a: string, b: string): string { return [a, b].sort().join(':'); }

function toPendingReview(candidate: MergeCandidate): PendingReviewMerge {
  return {
    leftId: candidate.left.id,
    rightId: candidate.right.id,
    left: candidate.left,
    right: candidate.right,
    confidence: candidate.confidence,
    signals: candidate.signals,
    reasons: candidate.reasons,
    decision: candidate.decision,
    campaignGroupId: candidate.campaignGroupId,
  };
}

export function buildTradelineMergePlan(items: NegativeItem[]): TradelineMergePlan {
  const mergedGroups = mergeTradelines(items);
  const autoMerged = mergedGroups.filter(group => group.sourceItems.length > 1);
  const autoMergedIds = new Set(autoMerged.flatMap(group => group.sourceItems.map(item => item.id)));
  const pendingReviewMerges: PendingReviewMerge[] = [];
  const linkOnlyPairs: PendingReviewMerge[] = [];
  const linkReserved = new Set<string>();

  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const left = items[i], right = items[j];
    // Still allow LINK_ONLY across items that were not auto-merged together
    const bothAutoGrouped = autoMergedIds.has(left.id) && autoMergedIds.has(right.id)
      && autoMerged.some(g => g.sourceItems.some(s => s.id === left.id) && g.sourceItems.some(s => s.id === right.id));
    if (bothAutoGrouped) continue;

    const candidate = scoreMergeCandidate(left, right);
    switch (candidate.decision) {
      case 'SUGGEST':
      case 'MANUAL_REVIEW':
        if (!autoMergedIds.has(left.id) && !autoMergedIds.has(right.id)) {
          pendingReviewMerges.push(toPendingReview(candidate));
        }
        break;
      case 'LINK_ONLY': {
        const key = pairKey(left.id, right.id);
        if (linkReserved.has(key)) break;
        linkReserved.add(key);
        linkOnlyPairs.push(toPendingReview(candidate));
        break;
      }
      case 'AUTO_MERGE':
      case 'HARD_REFUSE':
      case 'NO_MERGE':
        break;
      default: {
        const _exhaustive: never = candidate.decision;
        return _exhaustive;
      }
    }
  }
  pendingReviewMerges.sort((a, b) => b.confidence - a.confidence);
  const reserved = new Set<string>();
  const bestOnly = pendingReviewMerges.filter(candidate => {
    const key = pairKey(candidate.leftId, candidate.rightId);
    if (reserved.has(candidate.leftId) || reserved.has(candidate.rightId) || reserved.has(key)) return false;
    reserved.add(candidate.leftId); reserved.add(candidate.rightId); reserved.add(key);
    return true;
  });
  linkOnlyPairs.sort((a, b) => b.confidence - a.confidence);
  return { autoMerged, pendingReviewMerges: bestOnly, linkOnlyPairs };
}

export function isAccountNumberIncomplete(accountNumber: string | null | undefined): boolean {
  if (!accountNumber || !accountNumber.trim()) return true;
  const cleaned = cleanAccount(accountNumber);
  return MASK_CHAR.test(cleaned) || !/^\d{4}$/.test(cleaned.slice(-4));
}

export function resolvePostProcessedAccountNumber(item: NegativeItem): string {
  return (item.fullAccountNumber || item.accountNumber || '').trim();
}

/**
 * Single display/letter identity for a tradeline.  `accountNumber` preserves
 * the exact source-report token; `fullAccountNumber` is the conflict-safe
 * cross-bureau reconstruction.  Consumers should use this helper whenever an
 * account number is shown, validated, or inserted into a generated document.
 */
export function getResolvedAccountNumber(item: Pick<NegativeItem, 'accountNumber' | 'fullAccountNumber'>): string {
  return (item.fullAccountNumber || item.accountNumber || '').trim();
}
