/**
 * Cross-Bureau Matrix Component
 * Visual comparison table showing the same account's data across all 3 bureaus.
 * Highlights discrepancies in balance, DOFD, status, and more.
 * Integrates with crossBureauAnalyzer.ts for inconsistency detection.
 */

import React, { useMemo } from 'react';
import type { NegativeItem } from '../types';
import type { CrossBureauInconsistency } from '../services/crossBureauAnalyzer';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CrossBureauMatrixProps {
  /** All negative items (component groups them by crossBureauGroupId) */
  negativeItems: NegativeItem[];
  /** Inconsistencies detected by crossBureauAnalyzer */
  inconsistencies?: CrossBureauInconsistency[];
  onDisputeInconsistency?: (inconsistency: CrossBureauInconsistency) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const BUREAUS = ['Equifax', 'Experian', 'TransUnion'] as const;

interface BureauDataRow {
  bureau: string;
  balance: number | null;
  status: string | null;
  dofd: string | null;
  dateOpened: string | null;
  accountType: string | null;
  hasDiscrepancy: boolean;
}

interface AccountGroup {
  groupId: string;
  accountName: string;
  creditorName: string;
  bureauRows: BureauDataRow[];
  inconsistencyCount: number;
  missingBureaus: string[];
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatBalance(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `$${val.toLocaleString()}`;
}

function getBureauColor(bureau: string): { text: string; bg: string; dot: string } {
  switch (bureau) {
    case 'Equifax':    return { text: 'text-red-400',   bg: 'bg-red-900/20',    dot: 'bg-red-500' };
    case 'Experian':   return { text: 'text-blue-400',  bg: 'bg-blue-900/20',   dot: 'bg-blue-500' };
    case 'TransUnion': return { text: 'text-sky-400',   bg: 'bg-sky-900/20',    dot: 'bg-sky-500' };
    default:           return { text: 'text-gray-400',  bg: 'bg-gray-800',      dot: 'bg-gray-500' };
  }
}

function groupItemsByAccount(items: NegativeItem[]): AccountGroup[] {
  // Group by crossBureauGroupId first, then by creditorName as fallback
  const grouped = new Map<string, NegativeItem[]>();

  for (const item of items) {
    const key = item.crossBureauGroupId ?? `solo_${item.id}`;
    const arr = grouped.get(key) ?? [];
    arr.push(item);
    grouped.set(key, arr);
  }

  const groups: AccountGroup[] = [];

  for (const [groupId, groupItems] of grouped.entries()) {
    const first = groupItems[0];
    const bureauRows: BureauDataRow[] = [];
    const presentBureaus = new Set<string>();

    for (const item of groupItems) {
      const bureauList = item.creditBureau ?? [];
      for (const bureau of BUREAUS) {
        if (bureauList.some(b => b.toLowerCase().includes(bureau.toLowerCase()))) {
          presentBureaus.add(bureau);
          bureauRows.push({
            bureau,
            balance: item.balance,
            status: item.status,
            dofd: item.originalDateOfDelinquency ?? item.dateOfFirstDelinquency,
            dateOpened: item.originalOpeningDate ?? item.dateOpened,
            accountType: item.accountType ?? item.typeOfNegative,
            hasDiscrepancy: false, // filled in below
          });
        }
      }
    }

    // Detect discrepancies within the group
    const balances = bureauRows.map(r => r.balance).filter(b => b !== null);
    const statuses = bureauRows.map(r => r.status).filter(Boolean);
    const dofds = bureauRows.map(r => r.dofd).filter(Boolean);

    const balanceMismatch = new Set(balances).size > 1;
    const statusMismatch = new Set(statuses.map(s => s!.toLowerCase())).size > 1;
    const dofdMismatch = new Set(dofds).size > 1;

    for (const row of bureauRows) {
      row.hasDiscrepancy = balanceMismatch || statusMismatch || dofdMismatch;
    }

    const missingBureaus = BUREAUS.filter(b => !presentBureaus.has(b));

    groups.push({
      groupId,
      accountName: first.accountNumber ?? first.creditorName ?? 'Unknown',
      creditorName: first.creditorName ?? first.originalCreditor ?? 'Unknown',
      bureauRows,
      inconsistencyCount: (balanceMismatch ? 1 : 0) + (statusMismatch ? 1 : 0) + (dofdMismatch ? 1 : 0) + missingBureaus.length,
      missingBureaus,
    });
  }

  // Sort: most inconsistencies first
  return groups.sort((a, b) => b.inconsistencyCount - a.inconsistencyCount);
}

// ─── Cell comparison helper ────────────────────────────────────────────────────

function CellValue({ value, values, highlight }: {
  value: string;
  values: string[];
  highlight: boolean;
}) {
  const isMismatch = highlight && new Set(values.filter(Boolean)).size > 1;
  return (
    <td className={`px-2 py-2 text-xs text-center ${isMismatch ? 'text-orange-300 font-semibold' : 'text-gray-300'}`}>
      {isMismatch && <span className="mr-1">⚠️</span>}
      {value}
    </td>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CrossBureauMatrix({
  negativeItems,
  inconsistencies = [],
  onDisputeInconsistency,
}: CrossBureauMatrixProps) {
  const groups = useMemo(() => {
    // Only show items with a crossBureauGroupId or items appearing on multiple bureaus
    const multiItems = negativeItems.filter(item =>
      item.crossBureauGroupId || (item.creditBureau?.length ?? 0) > 1
    );
    if (multiItems.length === 0) return groupItemsByAccount(negativeItems);
    return groupItemsByAccount(multiItems);
  }, [negativeItems]);

  const totalDiscrepancies = groups.reduce((s, g) => s + g.inconsistencyCount, 0);

  if (groups.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 text-center text-gray-500 text-sm">
        No cross-bureau data available. Upload credit reports from all 3 bureaus to enable comparison.
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div>
          <h2 className="text-sm font-bold text-white">Cross-Bureau Comparison Matrix</h2>
          <p className="text-xs text-gray-400">{groups.length} accounts analyzed</p>
        </div>
        {totalDiscrepancies > 0 && (
          <div className="flex items-center gap-1.5 bg-orange-900/30 border border-orange-700/40 rounded-full px-3 py-1">
            <span className="text-orange-400 text-xs font-bold">{totalDiscrepancies}</span>
            <span className="text-orange-400 text-xs">discrepancies found</span>
          </div>
        )}
      </div>

      {/* Account groups */}
      <div className="divide-y divide-gray-800">
        {groups.map(group => (
          <div key={group.groupId} className="p-3">
            {/* Account header */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-semibold text-white">{group.creditorName}</span>
                {group.accountName !== group.creditorName && (
                  <span className="text-xs text-gray-500 ml-2">#{group.accountName}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {group.missingBureaus.length > 0 && (
                  <span className="text-xs text-orange-400">
                    Missing: {group.missingBureaus.join(', ')}
                  </span>
                )}
                {group.inconsistencyCount > 0 && (
                  <span className="text-xs bg-orange-900/30 text-orange-300 border border-orange-700/40 px-2 py-0.5 rounded-full">
                    {group.inconsistencyCount} issue{group.inconsistencyCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Comparison table */}
            {group.bureauRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left px-2 py-1 font-medium">Bureau</th>
                      <th className="text-center px-2 py-1 font-medium">Balance</th>
                      <th className="text-center px-2 py-1 font-medium">Status</th>
                      <th className="text-center px-2 py-1 font-medium">DOFD</th>
                      <th className="text-center px-2 py-1 font-medium">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.bureauRows.map(row => {
                      const colors = getBureauColor(row.bureau);
                      const allBalances = group.bureauRows.map(r => formatBalance(r.balance));
                      const allStatuses = group.bureauRows.map(r => r.status ?? '—');
                      const allDofds = group.bureauRows.map(r => formatDate(r.dofd));

                      return (
                        <tr key={row.bureau} className={`${colors.bg} rounded`}>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                              <span className={`font-semibold ${colors.text}`}>{row.bureau.slice(0, 3)}</span>
                            </div>
                          </td>
                          <CellValue
                            value={formatBalance(row.balance)}
                            values={allBalances}
                            highlight={row.hasDiscrepancy}
                          />
                          <CellValue
                            value={row.status ?? '—'}
                            values={allStatuses}
                            highlight={row.hasDiscrepancy}
                          />
                          <CellValue
                            value={formatDate(row.dofd)}
                            values={allDofds}
                            highlight={row.hasDiscrepancy}
                          />
                          <td className="px-2 py-2 text-xs text-center text-gray-400">
                            {formatDate(row.dateOpened)}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Missing bureaus */}
                    {group.missingBureaus.map(bureau => {
                      const colors = getBureauColor(bureau);
                      return (
                        <tr key={`missing_${bureau}`} className="opacity-40">
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                              <span className={`font-semibold ${colors.text}`}>{bureau.slice(0, 3)}</span>
                            </div>
                          </td>
                          <td colSpan={4} className="px-2 py-2 text-xs text-center text-gray-600 italic">
                            Not reported
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Dispute action — show if there are inconsistencies */}
            {group.inconsistencyCount > 0 && onDisputeInconsistency && (
              <div className="mt-2">
                {inconsistencies
                  .filter(inc => inc.crossBureauGroupId === group.groupId)
                  .slice(0, 3)
                  .map(inc => (
                    <div
                      key={inc.id}
                      className="flex items-center justify-between mt-1 p-1.5 bg-orange-900/10 border border-orange-800/30 rounded text-xs text-orange-300 cursor-pointer hover:bg-orange-900/20 transition-colors"
                      onClick={() => onDisputeInconsistency(inc)}
                    >
                      <span>⚠️ {inc.description}</span>
                      <span className="text-orange-500 ml-2 flex-shrink-0">Dispute →</span>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
