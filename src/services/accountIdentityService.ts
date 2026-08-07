import type { NegativeItem } from '../types';
import { jaroWinkler } from './tradelineMerger';

export interface AccountMatchSignals {
  creditor: number;
  knownDigits: number | null;
  balance: number | null;
  openedDate: number | null;
  delinquencyDate: number | null;
  accountType: number | null;
}

export interface AccountMatchCandidate {
  leftId: string;
  rightId: string;
  confidence: number;
  signals: AccountMatchSignals;
  reasons: string[];
}

export interface AccountIdentityPlan {
  autoGroups: NegativeItem[][];
  reviewCandidates: AccountMatchCandidate[];
}

const DAY = 86_400_000;

function canonicalCreditor(value: string): string {
  const normalized = (value || '').toLowerCase()
    .replace(/\b(n\.?a\.?|inc|llc|corp|corporation|company|bank|usa|financial|services?)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aliases: Array<[RegExp, string]> = [
    [/\bcap one\b/g, 'capital one'],
    [/\bbofa\b/g, 'bank of america'],
    [/\bciti bank\b/g, 'citibank'],
    [/\bsynchrony bank\b/g, 'synchrony'],
    [/\bamex\b/g, 'american express'],
  ];
  return aliases.reduce((name, [pattern, replacement]) => name.replace(pattern, replacement), normalized);
}

function bureaus(item: NegativeItem): Set<string> {
  return new Set((item.creditBureau || []).map(value => value.toLowerCase().replace(/\s/g, '')));
}

function differentBureau(a: NegativeItem, b: NegativeItem): boolean {
  return ![...bureaus(a)].some(value => bureaus(b).has(value));
}

function digits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function knownDigitScore(a: string, b: string): number | null {
  if (a.length < 3 || b.length < 3) return null;
  const max = Math.min(a.length, b.length, 8);
  let best = 0;
  for (let width = 3; width <= max; width++) {
    const strength = Math.min(1, width / 4);
    if (a.slice(0, width) === b.slice(0, width)) best = Math.max(best, strength);
    if (a.slice(-width) === b.slice(-width)) best = Math.max(best, strength);
    if (a.includes(b.slice(0, width)) || b.includes(a.slice(0, width))) best = Math.max(best, strength * .9);
  }
  return best;
}

function relativeNumberScore(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  const delta = Math.abs(a - b);
  if (delta <= 10) return 1;
  const baseline = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.max(0, 1 - delta / baseline);
}

function dateScore(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const left = Date.parse(a), right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  const days = Math.abs(left - right) / DAY;
  if (days <= 31) return 1;
  if (days <= 90) return .7;
  return Math.max(0, 1 - days / 730);
}

function textScore(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const left = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const right = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!left || !right) return null;
  return left === right ? 1 : left.includes(right) || right.includes(left) ? .8 : 0;
}

export function scoreAccountMatch(left: NegativeItem, right: NegativeItem): AccountMatchCandidate {
  const creditor = jaroWinkler(canonicalCreditor(left.creditorName), canonicalCreditor(right.creditorName));
  const knownDigits = knownDigitScore(digits(left.accountNumber), digits(right.accountNumber));
  const balance = relativeNumberScore(left.balance ?? left.originalBalance, right.balance ?? right.originalBalance);
  const openedDate = dateScore(left.dateOpened ?? left.originalOpeningDate, right.dateOpened ?? right.originalOpeningDate);
  const delinquencyDate = dateScore(left.dateOfFirstDelinquency ?? left.originalDateOfDelinquency, right.dateOfFirstDelinquency ?? right.originalDateOfDelinquency);
  const accountType = textScore(left.accountType, right.accountType);
  const signals = { creditor, knownDigits, balance, openedDate, delinquencyDate, accountType };
  const weighted: Array<[number, number]> = [
    [creditor, .34],
    ...(knownDigits == null ? [] : [[knownDigits, .24] as [number, number]]),
    ...(balance == null ? [] : [[balance, .16] as [number, number]]),
    ...(openedDate == null ? [] : [[openedDate, .12] as [number, number]]),
    ...(delinquencyDate == null ? [] : [[delinquencyDate, .09] as [number, number]]),
    ...(accountType == null ? [] : [[accountType, .05] as [number, number]]),
  ];
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let confidence = weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / Math.max(totalWeight, .01);
  const reasons: string[] = [];
  if (!differentBureau(left, right)) { confidence = 0; reasons.push('Same-bureau entries require separate duplicate analysis.'); }
  if (creditor >= .9) reasons.push('Creditor names strongly match.');
  if (knownDigits != null && knownDigits >= .65) reasons.push('Known account digits overlap.');
  if (balance != null && balance >= .9) reasons.push('Reported balances are compatible.');
  if (openedDate != null && openedDate >= .9) reasons.push('Opened dates are compatible.');
  if (creditor < .65) { confidence *= .45; reasons.push('Creditor names conflict.'); }
  return { leftId: left.id, rightId: right.id, confidence: Math.max(0, Math.min(1, confidence)), signals, reasons };
}

export function buildAccountIdentityPlan(items: NegativeItem[]): AccountIdentityPlan {
  const candidates: AccountMatchCandidate[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const candidate = scoreAccountMatch(items[i], items[j]);
    if (candidate.confidence >= .70) candidates.push(candidate);
  }

  const parent = new Map(items.map(item => [item.id, item.id]));
  const find = (id: string): string => {
    const p = parent.get(id) || id;
    if (p === id) return id;
    const root = find(p); parent.set(id, root); return root;
  };
  const union = (a: string, b: string) => parent.set(find(b), find(a));
  candidates.filter(candidate => candidate.confidence >= .92).forEach(candidate => union(candidate.leftId, candidate.rightId));
  const grouped = new Map<string, NegativeItem[]>();
  for (const item of items) {
    const root = find(item.id);
    const group = grouped.get(root) || []; group.push(item); grouped.set(root, group);
  }

  return {
    autoGroups: [...grouped.values()].filter(group => group.length > 1),
    reviewCandidates: candidates.filter(candidate => candidate.confidence >= .70 && candidate.confidence < .92).sort((a, b) => b.confidence - a.confidence),
  };
}

/** Reconstruct only when source mask positions establish alignment; otherwise preserve the best displayed token. */
export function reconstructProvenAccountNumber(items: NegativeItem[]): string {
  const tokens = items.map(item => item.fullAccountNumber || item.accountNumber).filter(Boolean) as string[];
  if (!tokens.length) return '';
  const normalized = tokens.map(token => token.toUpperCase().replace(/[\s._-]/g, '').replace(/[X#?•]/g, '*'));
  const lengths = new Set(normalized.map(token => token.length));
  if (lengths.size !== 1) return normalized.sort((a, b) => b.replace(/\*/g, '').length - a.replace(/\*/g, '').length)[0];
  const output: string[] = [];
  for (let index = 0; index < normalized[0].length; index++) {
    const known = [...new Set(normalized.map(token => token[index]).filter(char => /\d/.test(char)))];
    output.push(known.length === 1 ? known[0] : '*');
  }
  return output.join('');
}
