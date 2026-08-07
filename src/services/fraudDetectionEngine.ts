/**
 * Fraud / identity-theft detection (Apex AD-12) — passive scan on parse/cycle.
 */

import type { NegativeItem, PersonalInfo } from '../types';

export type FraudSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface FraudFlag {
  code: string;
  severity: FraudSeverity;
  rule: string;
  action: string;
  fcraPath: string | null;
  itemId: string;
}

export function scanForFraud(
  item: NegativeItem,
  ctx?: {
    allItems?: NegativeItem[];
    personalInfo?: Pick<PersonalInfo, 'ssn' | 'address' | 'city' | 'state'> | null;
  },
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  const blob = `${item.creditorName} ${item.typeOfNegative} ${item.additionalInfo} ${item.status}`.toLowerCase();
  const all = ctx?.allItems ?? [];

  if (/\bmix(ed)?\s*file\b|\bidentity\s*theft\b|\bnot\s*mine\b|\bfraud\b/.test(blob)) {
    flags.push({
      code: 'mixedFileSuffix',
      severity: 'critical',
      rule: 'Mixed-file / identity-theft language present on item.',
      action: 'escalate_mixed_file_protocol',
      fcraPath: '§605B block right',
      itemId: item.id,
    });
  }

  // Wrong address furnishing vs profile address
  const profileAddr = (ctx?.personalInfo?.address || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const itemAddr = `${item.disputeContactAddress || ''} ${item.additionalInfo || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (
    profileAddr.length >= 8 &&
    itemAddr.length >= 8 &&
    !itemAddr.includes(profileAddr.slice(0, 8)) &&
    /address|lived|residence/i.test(item.additionalInfo || '')
  ) {
    flags.push({
      code: 'wrongAddressFurnishing',
      severity: 'medium',
      rule: 'Address language on item does not correlate with profile address.',
      action: 'address_dispute + fraud_flag',
      fcraPath: '§611',
      itemId: item.id,
    });
  }

  // Recent open unknown — opened in last 6 months with very low parse confidence
  const opened = item.dateOpened || item.originalOpeningDate;
  if (opened) {
    const t = Date.parse(opened);
    if (!Number.isNaN(t)) {
      const months = (Date.now() - t) / (1000 * 60 * 60 * 24 * 30);
      if (months <= 6 && (item.parseConfidence ?? 1) < 0.4) {
        flags.push({
          code: 'recentOpenUnknown',
          severity: 'high',
          rule: 'Recently opened account with low parse confidence — review for not-mine.',
          action: 'account_not_mine_dispute',
          fcraPath: '§611',
          itemId: item.id,
        });
      }
    }
  }

  // Duplicate same creditor + same open date across bureaus with digit conflict is handled by merge;
  // here flag when same creditor appears with wildly different account suffixes
  const siblings = all.filter(
    (o) => o.id !== item.id && o.creditorName.toLowerCase() === item.creditorName.toLowerCase(),
  );
  for (const sib of siblings) {
    const a = (item.fullAccountNumber || item.accountNumber || '').replace(/\D/g, '').slice(-4);
    const b = (sib.fullAccountNumber || sib.accountNumber || '').replace(/\D/g, '').slice(-4);
    if (a.length === 4 && b.length === 4 && a !== b) {
      const openA = item.dateOpened || item.originalOpeningDate;
      const openB = sib.dateOpened || sib.originalOpeningDate;
      if (openA && openB && openA.slice(0, 7) === openB.slice(0, 7)) {
        flags.push({
          code: 'duplicateSSNAccount',
          severity: 'high',
          rule: 'Same creditor + similar open month with conflicting account suffixes.',
          action: 'link_review',
          fcraPath: '§611',
          itemId: item.id,
        });
        break;
      }
    }
  }

  if (/\binquir/.test(blob) && /unauthorized|unknown|not\s*authorized/i.test(blob)) {
    flags.push({
      code: 'unauthorizedInquiry',
      severity: 'medium',
      rule: 'Hard pull marked unauthorized / unknown.',
      action: 'inquiry_dispute_604',
      fcraPath: '§604',
      itemId: item.id,
    });
  }

  return flags;
}

export function scanReportForFraud(
  items: NegativeItem[],
  personalInfo?: Pick<PersonalInfo, 'ssn' | 'address' | 'city' | 'state'> | null,
): FraudFlag[] {
  const all: FraudFlag[] = [];
  for (const item of items) {
    all.push(...scanForFraud(item, { allItems: items, personalInfo }));
  }
  // Address bombarding — ≥3 distinct unknown address strings in additionalInfo
  const addrHits = items
    .map((i) => i.additionalInfo || '')
    .filter((t) => /unknown address|address on file/i.test(t));
  if (addrHits.length >= 3) {
    all.push({
      code: 'addressBombarding',
      severity: 'medium',
      rule: '≥3 unknown-address indicators across the file.',
      action: 'address_discrepancy_notice',
      fcraPath: '§611',
      itemId: items[0]?.id ?? 'file',
    });
  }
  return all;
}
