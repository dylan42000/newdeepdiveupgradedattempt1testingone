import type { NegativeItem } from '../../types';
import { extractPrefix, extractSuffix } from '../creditReportParser/accountNumberReconstructor';

export type BalanceRange = 'zero' | 'under_500' | '500_2k' | '2k_10k' | 'over_10k' | 'unknown';
export interface MergeKey { creditorNormalized: string; accountSuffix: string; accountPrefix: string | null; dateOpenedMonth: string | null; accountType: string; balanceRange: BalanceRange }

export function normalizeCreditorName(name = ''): string {
  return name.toLowerCase().replace(/\b(llc|inc|corp|corporation|ltd|na|n\.a\.|fsb|bank|financial|services|group|co)\b/gi, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizeAccountType(type?: string | null): string { return (type ?? 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_'); }
export function bucketBalance(value?: number | null): BalanceRange { return value == null ? 'unknown' : value === 0 ? 'zero' : value < 500 ? 'under_500' : value < 2000 ? '500_2k' : value < 10000 ? '2k_10k' : 'over_10k'; }
export function truncateToMonth(value?: string | null): string | null { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? value.match(/\d{1,2}\/\d{4}/)?.[0] ?? null : d.toISOString().slice(0, 7); }
export function buildMergeKey(item: NegativeItem): MergeKey { return { creditorNormalized: normalizeCreditorName(item.creditorName), accountSuffix: extractSuffix(item.accountNumber), accountPrefix: extractPrefix(item.accountNumber), dateOpenedMonth: truncateToMonth(item.dateOpened ?? item.originalOpeningDate), accountType: normalizeAccountType(item.accountType ?? item.typeOfNegative), balanceRange: bucketBalance(item.balance) }; }
