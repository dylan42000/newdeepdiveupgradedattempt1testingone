/**
 * Cross-Bureau Inconsistency Detector
 * Compares the same account across Equifax, Experian, and TransUnion
 * to identify reporting inconsistencies — a powerful but underutilized dispute weapon.
 * No competitor does this well. It's your exclusive differentiator.
 */

import { NegativeItem } from '../types';
import { routeAIRequest, type AIMessage } from './aiRouter';

// ── Inconsistency Types ────────────────────────────────────────────────────────

export type InconsistencyType =
  | 'DOFD_MISMATCH'
  | 'BALANCE_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'ACCOUNT_TYPE_MISMATCH'
  | 'PAYMENT_HISTORY_MISMATCH'
  | 'CREDIT_LIMIT_MISMATCH'
  | 'DATE_OPENED_MISMATCH'
  | 'CREDITOR_NAME_MISMATCH'
  | 'MISSING_FROM_BUREAU'
  | 'HIGH_CREDIT_MISMATCH';

export interface CrossBureauInconsistency {
  id: string;
  type: InconsistencyType;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  accountName: string;
  crossBureauGroupId: string;
  bureauValues: Partial<Record<'equifax' | 'experian' | 'transunion', string>>;
  description: string;
  disputeLanguage: string;
  legalBasis: string;
}

// ── Static Cross-Bureau Analysis ───────────────────────────────────────────────

export function detectCrossBureauInconsistencies(
  items: NegativeItem[]
): CrossBureauInconsistency[] {
  const inconsistencies: CrossBureauInconsistency[] = [];

  // Group items by crossBureauGroupId or by creditor name + account number similarity
  const groups = groupByAccount(items);

  groups.forEach((group) => {
    if (group.length < 2) return; // Need at least 2 bureaus to compare

    const dofdValues = extractBureauValues(group, (i) =>
      i.originalDateOfDelinquency || i.dateOfFirstDelinquency || null
    );
    const balanceValues = extractBureauValues(group, (i) =>
      i.balance != null ? String(i.balance) : null
    );
    const statusValues = extractBureauValues(group, (i) => i.status ?? null);
    const dateOpenedValues = extractBureauValues(group, (i) => i.dateOpened ?? null);

    const accountName = group[0].creditorName;
    const groupId = group[0].crossBureauGroupId ?? group[0].id;

    // ── DOFD Mismatch ─────────────────────────────────────────────────────────
    if (hasMismatch(dofdValues)) {
      const diff = getMaxDateDiffDays(Object.values(dofdValues).filter(Boolean) as string[]);
      inconsistencies.push({
        id: `xb_dofd_${groupId}`,
        type: 'DOFD_MISMATCH',
        severity: diff > 30 ? 'HIGH' : 'MEDIUM',
        accountName,
        crossBureauGroupId: groupId,
        bureauValues: dofdValues,
        description: `Date of First Delinquency differs across bureaus by ~${diff} days.`,
        legalBasis: 'FCRA §623(a)(1) accuracy requirement; Metro 2 Field 26 consistency rule',
        disputeLanguage: buildDisputeLanguage(
          accountName, 'Date of First Delinquency', dofdValues,
          'This discrepancy in the DOFD directly affects the 7-year reporting window under FCRA §605(a)(4) and constitutes inaccurate reporting.'
        ),
      });
    }

    // ── Balance Mismatch ──────────────────────────────────────────────────────
    if (hasMismatch(balanceValues)) {
      const vals = Object.values(balanceValues).filter(Boolean).map(Number).filter((n) => !isNaN(n));
      const range = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
      inconsistencies.push({
        id: `xb_balance_${groupId}`,
        type: 'BALANCE_MISMATCH',
        severity: range > 500 ? 'HIGH' : 'MEDIUM',
        accountName,
        crossBureauGroupId: groupId,
        bureauValues: balanceValues,
        description: `Balance differs across bureaus by $${range}.`,
        legalBasis: 'FCRA §623(a)(1) — furnisher must report complete and accurate information to all CRAs',
        disputeLanguage: buildDisputeLanguage(
          accountName, 'balance', balanceValues,
          'A furnisher is required under FCRA §623(a)(1) to report the same accurate balance to all consumer reporting agencies. This discrepancy is a direct violation of that requirement.'
        ),
      });
    }

    // ── Status Mismatch ───────────────────────────────────────────────────────
    if (hasMismatch(statusValues)) {
      inconsistencies.push({
        id: `xb_status_${groupId}`,
        type: 'STATUS_MISMATCH',
        severity: 'HIGH',
        accountName,
        crossBureauGroupId: groupId,
        bureauValues: statusValues,
        description: `Account status is reported differently across bureaus.`,
        legalBasis: 'FCRA §623(a)(1); Metro 2 Account Status Code consistency requirement',
        disputeLanguage: buildDisputeLanguage(
          accountName, 'account status', statusValues,
          'Inconsistent account status codes across bureaus violates Metro 2 reporting standards and FCRA §623(a)(1). The furnisher must report the same status to all consumer reporting agencies.'
        ),
      });
    }

    // ── Missing From Bureau ───────────────────────────────────────────────────
    const allBureaus: Array<'equifax' | 'experian' | 'transunion'> = ['equifax', 'experian', 'transunion'];
    const presentBureaus = new Set<string>();
    group.forEach((i) => (i.creditBureau ?? []).forEach((b) => presentBureaus.add(b.toLowerCase())));

    const missingFrom = allBureaus.filter((b) => !presentBureaus.has(b));
    if (missingFrom.length > 0 && presentBureaus.size > 0) {
      // Item present on some bureaus but not all — potentially removed (win!) or inconsistency
      inconsistencies.push({
        id: `xb_missing_${groupId}`,
        type: 'MISSING_FROM_BUREAU',
        severity: 'MEDIUM',
        accountName,
        crossBureauGroupId: groupId,
        bureauValues: {
          equifax: presentBureaus.has('equifax') ? 'Reported' : 'NOT FOUND',
          experian: presentBureaus.has('experian') ? 'Reported' : 'NOT FOUND',
          transunion: presentBureaus.has('transunion') ? 'Reported' : 'NOT FOUND',
        },
        description: `Account appears on ${[...presentBureaus].join(', ')} but not on ${missingFrom.join(', ')}.`,
        legalBasis: 'FCRA §623(a)(1) — if inaccurate, item must be corrected at all bureaus',
        disputeLanguage: `This account from ${accountName} is reported on ${[...presentBureaus].join(' and ')} but absent from ${missingFrom.join(' and ')}. If this item is inaccurate, it must be removed from all reporting bureaus simultaneously. The inconsistency across bureaus constitutes inaccurate reporting under FCRA §623(a)(1).`,
      });
    }

    // ── Date Opened Mismatch ──────────────────────────────────────────────────
    if (hasMismatch(dateOpenedValues)) {
      const diff = getMaxDateDiffDays(Object.values(dateOpenedValues).filter(Boolean) as string[]);
      if (diff > 30) {
        inconsistencies.push({
          id: `xb_opened_${groupId}`,
          type: 'DATE_OPENED_MISMATCH',
          severity: 'LOW',
          accountName,
          crossBureauGroupId: groupId,
          bureauValues: dateOpenedValues,
          description: `Account open date differs by ~${diff} days across bureaus.`,
          legalBasis: 'FCRA §623(a)(1) accuracy requirement',
          disputeLanguage: buildDisputeLanguage(
            accountName, 'account open date', dateOpenedValues,
            'Inconsistent open dates across bureaus indicate unreliable data reporting and must be corrected per FCRA §623(a)(1).'
          ),
        });
      }
    }
  });

  return inconsistencies;
}

// ── Helper: Group items by account ────────────────────────────────────────────

function groupByAccount(items: NegativeItem[]): NegativeItem[][] {
  const groups = new Map<string, NegativeItem[]>();

  items.forEach((item) => {
    // Use crossBureauGroupId if available, otherwise group by creditor + dofd
    const key = item.crossBureauGroupId ||
      `${(item.creditorName ?? '').toLowerCase().replace(/\s+/g, '')}|${item.originalDateOfDelinquency ?? ''}`;
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  });

  return Array.from(groups.values());
}

function extractBureauValues(
  group: NegativeItem[],
  extractor: (item: NegativeItem) => string | null
): Partial<Record<'equifax' | 'experian' | 'transunion', string>> {
  const result: Partial<Record<'equifax' | 'experian' | 'transunion', string>> = {};
  const bureauMap: Record<string, 'equifax' | 'experian' | 'transunion'> = {
    equifax: 'equifax',
    experian: 'experian',
    transunion: 'transunion',
  };

  group.forEach((item) => {
    const value = extractor(item);
    if (!value) return;
    (item.creditBureau ?? []).forEach((b) => {
      const mapped = bureauMap[b.toLowerCase()];
      if (mapped) result[mapped] = value;
    });
  });

  return result;
}

function hasMismatch(values: Partial<Record<string, string>>): boolean {
  const unique = new Set(Object.values(values).filter(Boolean));
  return unique.size > 1;
}

function getMaxDateDiffDays(dates: string[]): number {
  if (dates.length < 2) return 0;
  const timestamps = dates.map((d) => new Date(d).getTime()).filter((t) => !isNaN(t));
  if (timestamps.length < 2) return 0;
  const maxTs = Math.max(...timestamps);
  const minTs = Math.min(...timestamps);
  return Math.round((maxTs - minTs) / (1000 * 60 * 60 * 24));
}

function buildDisputeLanguage(
  accountName: string,
  field: string,
  bureauValues: Partial<Record<string, string>>,
  consequence: string
): string {
  const valueList = Object.entries(bureauValues)
    .filter(([, v]) => v)
    .map(([bureau, value]) => `${capitalize(bureau)}: ${value}`)
    .join('; ');

  return `The ${field} for ${accountName} is reported inconsistently across credit bureaus: ${valueList}. ${consequence}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── AI-Enhanced Cross-Bureau Analysis ─────────────────────────────────────────

export async function analyzeWithAI(
  items: NegativeItem[]
): Promise<CrossBureauInconsistency[]> {
  const staticResults = detectCrossBureauInconsistencies(items);

  if (staticResults.length === 0) return [];

  // Ask AI to validate and enhance the detected inconsistencies
  const prompt = `You are a credit dispute expert analyzing cross-bureau inconsistencies. 
Review these detected inconsistencies and enhance the dispute language with specific legal citations.
Respond with ONLY a valid JSON array of enhanced objects matching the input structure.

Detected inconsistencies:
${JSON.stringify(staticResults.slice(0, 5), null, 2)}`;

  try {
    const messages: AIMessage[] = [{ role: 'user', content: prompt }];
    const response = await routeAIRequest(messages, {
      taskType: 'analyze',
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 2048,
    });

    const enhanced = JSON.parse(response);
    if (Array.isArray(enhanced)) {
      return enhanced.map((e: any, i: number) => ({
        ...staticResults[i],
        ...e,
        id: staticResults[i]?.id ?? e.id,
      }));
    }
  } catch (e) {
    console.warn('[CrossBureauAnalyzer] AI enhancement failed, returning static results', e);
  }

  return staticResults;
}

// ── Summary ────────────────────────────────────────────────────────────────────

export function summarizeInconsistencies(inconsistencies: CrossBureauInconsistency[]): {
  totalCount: number;
  highCount: number;
  byType: Record<string, number>;
  topAccounts: string[];
} {
  const byType: Record<string, number> = {};
  const accountCounts = new Map<string, number>();

  inconsistencies.forEach((inc) => {
    byType[inc.type] = (byType[inc.type] ?? 0) + 1;
    accountCounts.set(inc.accountName, (accountCounts.get(inc.accountName) ?? 0) + 1);
  });

  const topAccounts = Array.from(accountCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  return {
    totalCount: inconsistencies.length,
    highCount: inconsistencies.filter((i) => i.severity === 'HIGH').length,
    byType,
    topAccounts,
  };
}

// ── Task 2: Cross-Bureau Kill Shot — Deletion Detection ───────────────────────

/**
 * Given a specific NegativeItem being disputed at one bureau, scans ALL items
 * in the app state for a sibling entry (same account, different bureau) that has
 * already been deleted or won.
 *
 * When such a sibling is found, the AutoPilot engine injects a "Kill Shot"
 * directive into the AI prompt for Pass 2+ letters:
 *   "TransUnion has already deleted this item for inaccuracies. Failure of
 *    Equifax to do the same constitutes a willful violation of FCRA §611."
 *
 * Detection logic uses two matching strategies (in priority order):
 *  1. crossBureauGroupId match (exact — set by the parser during import)
 *  2. creditor name + DOFD fingerprint match (fuzzy — handles manual entries)
 *
 * @param item      The item currently being disputed (the "surviving" bureau copy)
 * @param allItems  The full negative items array from app state
 * @returns         { deletedByBureau, survivingBureau } if a deletion is found, else null
 */
export function findCrossBureauDeletions(
  item: NegativeItem,
  allItems: NegativeItem[]
): { deletedByBureau: string; survivingBureau: string } | null {
  // Determine the target bureau(s) this item is reported on
  const itemBureaus = new Set((item.creditBureau ?? []).map((b) => b.toLowerCase()));

  // The deleted statuses we recognize as a confirmed deletion win
  const DELETED_STATUSES = new Set(['Deleted', 'Won']);

  // ── Strategy 1: crossBureauGroupId match ────────────────────────────────────
  if (item.crossBureauGroupId) {
    const siblings = allItems.filter(
      (other) =>
        other.id !== item.id &&
        other.crossBureauGroupId === item.crossBureauGroupId &&
        DELETED_STATUSES.has(other.disputeStatus)
    );

    for (const sibling of siblings) {
      // Find the bureau(s) that the sibling was on (and is now deleted from)
      const siblingBureaus = sibling.creditBureau ?? [];
      const deletedBureau = siblingBureaus.find((b) => !itemBureaus.has(b.toLowerCase()));
      if (deletedBureau) {
        const survivingBureau = [...itemBureaus][0] ?? 'this bureau';
        const deletedBureauDisplayName = normalizeBureauDisplayName(deletedBureau);
        const survivingBureauDisplayName = normalizeBureauDisplayName(survivingBureau);
        return {
          deletedByBureau: deletedBureauDisplayName,
          survivingBureau: survivingBureauDisplayName,
        };
      }
    }
  }

  // ── Strategy 2: Creditor name + DOFD fingerprint match ──────────────────────
  const creditorKey = (item.creditorName ?? '').toLowerCase().replace(/\s+/g, '');
  const dofd = item.originalDateOfDelinquency ?? item.dateOfFirstDelinquency ?? '';

  if (creditorKey.length > 2) {
    const siblings = allItems.filter((other) => {
      if (other.id === item.id) return false;
      if (!DELETED_STATUSES.has(other.disputeStatus)) return false;

      const otherKey = (other.creditorName ?? '').toLowerCase().replace(/\s+/g, '');
      if (otherKey !== creditorKey) return false;

      // DOFD must match if both items have it (prevents false positives on common creditors)
      const otherDofd = other.originalDateOfDelinquency ?? other.dateOfFirstDelinquency ?? '';
      if (dofd && otherDofd && dofd !== otherDofd) return false;

      // Must be on a different bureau
      const otherBureaus = new Set((other.creditBureau ?? []).map((b) => b.toLowerCase()));
      const hasOverlap = [...itemBureaus].some((b) => otherBureaus.has(b));
      return !hasOverlap || otherBureaus.size > 0;
    });

    for (const sibling of siblings) {
      const siblingBureaus = sibling.creditBureau ?? [];
      const deletedBureau = siblingBureaus.find((b) => !itemBureaus.has(b.toLowerCase()));
      if (deletedBureau) {
        const survivingBureau = [...itemBureaus][0] ?? 'this bureau';
        return {
          deletedByBureau: normalizeBureauDisplayName(deletedBureau),
          survivingBureau: normalizeBureauDisplayName(survivingBureau),
        };
      }
    }
  }

  return null;
}

/** Normalize any bureau name variant to the canonical display name */
function normalizeBureauDisplayName(bureau: string): string {
  const lower = bureau.toLowerCase();
  if (lower.includes('equifax')) return 'Equifax';
  if (lower.includes('experian')) return 'Experian';
  if (lower.includes('transunion') || lower.includes('trans union')) return 'TransUnion';
  return bureau;
}

