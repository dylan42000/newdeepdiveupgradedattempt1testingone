/**
 * accountMergeEngine.ts — Smart Cross-Bureau Account Number Merge Engine
 *
 * Issue 2: Reconstruct masked account numbers from all three bureau reports.
 * Each bureau masks/truncates differently:
 *   Equifax:    ****1234
 *   Experian:   XXXX-XXXX-1234
 *   TransUnion: 123456****1234  (partial reveal at front AND back)
 *
 * Positional digit mapping + majority-vote reconstruction recovers up to
 * 100% of digits when all 3 bureaus report the same account.
 *
 * Also detects Metro 2 discrepancies across the merged group.
 */

import type { NegativeItem } from '../types';
import { scoreMergeCandidate } from './tradelineMerger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BureauAccountEntry {
  bureau: string;             // Primary bureau name from item.creditBureau[0]
  rawAccountNumber: string;   // Exactly as parsed from report
  creditorName: string;
  balance: number | null;
  accountType: string;
  openDate?: string | null;
  lastReportedDate?: string | null;
}

export interface MergedAccountResult {
  mergedAccountNumber: string;  // Best reconstruction
  confidenceScore: number;      // 0-100
  revealedDigits: string;       // Confirmed digits, '*' for unknown
  totalDigits: number;
  knownDigitCount: number;
  sources: BureauAccountEntry[];
  matchMethod: 'BALANCE_MATCH' | 'NAME_MATCH' | 'BOTH' | 'DATE_MATCH';
  discrepancies: string[];
  metro2Flags: any[];
}

// ─── STEP 1: Normalize raw account number into a positional digit map ─────────

/**
 * Strip separators and normalize masking characters to '*'.
 * Exported so MergedAccountCard can display normalized values.
 */
export function normalizeAccountNumber(raw: string): string {
  return (raw || '')
    .replace(/[\s\-_.]/g, '')    // Remove separators
    .toUpperCase()
    .replace(/X/g, '*')          // Normalize X masking → *
    .replace(/[^0-9*]/g, '*');   // Any other non-digit → *
}

function extractDigitPositions(normalized: string): Map<number, string> {
  const positions = new Map<number, string>();
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] !== '*') {
      positions.set(i, normalized[i]);
    }
  }
  return positions;
}

// ─── STEP 2–3: Merge multiple bureau account numbers into best reconstruction ───

/**
 * Right-align masks and majority-vote known digits.
 * Refuses to invent digits when positional conflicts exist (returns richest single mask).
 */
export function mergeAccountNumbers(entries: BureauAccountEntry[]): string {
  if (entries.length === 0) return '*';
  if (entries.length === 1) return normalizeAccountNumber(entries[0].rawAccountNumber);

  const normalized = entries.map(e => normalizeAccountNumber(e.rawAccountNumber));
  const maxLen = Math.max(...normalized.map(n => n.length));
  const rightAligned = normalized.map(n => n.padStart(maxLen, '*'));

  // Refuse merge on any positional digit conflict
  for (let i = 0; i < maxLen; i++) {
    const known = new Set<string>();
    for (const padded of rightAligned) {
      if (padded[i] !== '*') known.add(padded[i]);
    }
    if (known.size > 1) {
      return normalized.sort((a, b) => b.replace(/\*/g, '').length - a.replace(/\*/g, '').length)[0];
    }
  }

  const positionVotes = new Map<number, Map<string, number>>();
  for (const padded of rightAligned) {
    for (let i = 0; i < padded.length; i++) {
      const char = padded[i];
      if (char !== '*') {
        if (!positionVotes.has(i)) positionVotes.set(i, new Map());
        const votes = positionVotes.get(i)!;
        votes.set(char, (votes.get(char) ?? 0) + 1);
      }
    }
  }

  let result = '';
  for (let i = 0; i < maxLen; i++) {
    const votes = positionVotes.get(i);
    if (!votes || votes.size === 0) {
      result += '*';
    } else {
      const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      result += winner;
    }
  }

  return result;
}

// ─── STEP 4: Confidence scoring ───────────────────────────────────────────────

export function calculateMergeConfidence(
  mergedNumber: string,
  entries: BureauAccountEntry[],
): number {
  const totalDigits = mergedNumber.length;
  if (totalDigits === 0) return 0;

  const knownDigits = mergedNumber.split('').filter(c => c !== '*').length;
  const digitCoverage = knownDigits / totalDigits;

  // Bonus for multi-bureau confirmation (max 30 points for 3 bureaus)
  const bureauBonus = Math.min(entries.length * 10, 30);

  // Penalty for digit conflicts across bureaus
  const hasDiscrepancy = detectDigitConflicts(entries);
  const discrepancyPenalty = hasDiscrepancy ? 15 : 0;

  return Math.round(
    Math.min(100, digitCoverage * 70 + bureauBonus - discrepancyPenalty),
  );
}

function detectDigitConflicts(entries: BureauAccountEntry[]): boolean {
  if (entries.length < 2) return false;
  const normalized = entries.map(e => normalizeAccountNumber(e.rawAccountNumber));
  const maxLen = Math.max(...normalized.map(n => n.length));

  for (let i = 0; i < maxLen; i++) {
    const knownDigits = new Set<string>();
    for (const norm of normalized) {
      const padded = norm.padStart(maxLen, '*');
      if (padded[i] !== '*') knownDigits.add(padded[i]);
    }
    if (knownDigits.size > 1) return true;
  }
  return false;
}

// ─── STEP 5: Account matching across bureaus ──────────────────────────────────

/**
 * Group NegativeItems from different bureaus that represent the same real account,
 * then reconstruct the best possible account number for each group.
 */
export function matchAccountsAcrossBureaus(allItems: NegativeItem[]): MergedAccountResult[] {
  const groups: NegativeItem[][] = [];
  const used = new Set<string>();

  for (const item of allItems) {
    if (used.has(item.id)) continue;

    const group: NegativeItem[] = [item];
    used.add(item.id);

    for (const other of allItems) {
      if (used.has(other.id)) continue;
      if (isSameAccount(item, other)) {
        group.push(other);
        used.add(other.id);
      }
    }

    if (group.length > 1) groups.push(group);
  }

  return groups.map(buildMergedResult);
}

/** Compatibility wrapper — tradelineMerger is the single merge authority. */
function isSameAccount(a: NegativeItem, b: NegativeItem): boolean {
  return scoreMergeCandidate(a, b).decision === 'AUTO_MERGE';
}

export function normalizeCreditorName(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')   // Normalize punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ INC$| LLC$| CORP$| NA$| FSB$| BANK$/, ''); // Remove corporate suffixes
}

function getAccountSuffix(accountNumber: string): string | null {
  const normalized = normalizeAccountNumber(accountNumber);
  const knownDigits = normalized.replace(/\*/g, '');
  return knownDigits.length >= 4 ? knownDigits.slice(-4) : null;
}

function determinMatchMethod(entries: BureauAccountEntry[]): MergedAccountResult['matchMethod'] {
  if (entries.length < 2) return 'NAME_MATCH';

  const balances = entries.map(e => e.balance).filter(b => b !== null) as number[];
  const hasBalanceMatch =
    balances.length >= 2 && Math.abs(balances[0] - balances[1]) <= 5;

  const nameSet = new Set(entries.map(e => normalizeCreditorName(e.creditorName)));
  const hasNameMatch = nameSet.size === 1;

  if (hasBalanceMatch && hasNameMatch) return 'BOTH';
  if (hasBalanceMatch) return 'BALANCE_MATCH';
  return 'NAME_MATCH';
}

function buildDiscrepancyList(group: NegativeItem[]): string[] {
  const discrepancies: string[] = [];

  // Check balance differences
  const balances = group.map(i => ({ bureau: i.creditBureau[0], balance: i.balance }));
  const uniqueBalances = new Set(balances.map(b => b.balance));
  if (uniqueBalances.size > 1) {
    discrepancies.push(
      `Balance discrepancy: ${balances.map(b => `${b.bureau}=$${b.balance ?? 'N/A'}`).join(', ')}`,
    );
  }

  // Check status differences
  const statuses = group.map(i => ({ bureau: i.creditBureau[0], status: i.status }));
  const uniqueStatuses = new Set(statuses.map(s => s.status));
  if (uniqueStatuses.size > 1) {
    discrepancies.push(
      `Status discrepancy: ${statuses.map(s => `${s.bureau}=${s.status}`).join(', ')}`,
    );
  }

  // Check DOFD differences
  const dofds = group
    .filter(i => i.originalDateOfDelinquency || i.dateOfFirstDelinquency)
    .map(i => ({
      bureau: i.creditBureau[0],
      dofd: i.originalDateOfDelinquency ?? i.dateOfFirstDelinquency,
    }));
  const uniqueDofds = new Set(dofds.map(d => d.dofd));
  if (dofds.length > 1 && uniqueDofds.size > 1) {
    discrepancies.push(
      `DOFD discrepancy (re-aging risk): ${dofds.map(d => `${d.bureau}=${d.dofd}`).join(', ')}`,
    );
  }

  return discrepancies;
}

function buildMergedResult(group: NegativeItem[]): MergedAccountResult {
  const entries: BureauAccountEntry[] = group.map(item => ({
    bureau: item.creditBureau[0] ?? 'Unknown',
    rawAccountNumber: item.accountNumber ?? '',
    creditorName: item.creditorName,
    balance: item.balance ?? null,
    accountType: item.accountType ?? '',
    openDate: item.dateOpened ?? item.originalOpeningDate ?? null,
    lastReportedDate: item.dateOfLastReporting ?? null,
  }));

  const mergedNumber = mergeAccountNumbers(entries);
  const confidence = calculateMergeConfidence(mergedNumber, entries);
  const knownCount = mergedNumber.split('').filter(c => c !== '*').length;
  const metro2Flags: any[] = [];

  return {
    mergedAccountNumber: mergedNumber,
    confidenceScore: confidence,
    revealedDigits: mergedNumber,
    totalDigits: mergedNumber.length,
    knownDigitCount: knownCount,
    sources: entries,
    matchMethod: determinMatchMethod(entries),
    discrepancies: buildDiscrepancyList(group),
    metro2Flags,
  };
}
