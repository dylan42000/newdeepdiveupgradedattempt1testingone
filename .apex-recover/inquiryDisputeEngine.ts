/**
 * Inquiry Dispute Engine (Apex AD-9) — hard-pull classification (separate from tradelines).
 */

import type { NegativeItem } from '../types';

export type InquiryStrategy =
  | 'obsolete_removal'
  | 'permissible_purpose_demand'
  | 'duplicate_removal'
  | 'authorized_no_dispute';

export interface InquiryProfile {
  itemId: string;
  inquiryDate: string | null;
  ageYears: number | null;
  strategy: InquiryStrategy;
  legalAnchor: string;
  reason: string;
  blockFromTradelineBatch: boolean;
}

function parseInquiryDate(item: NegativeItem): string | null {
  return item.dateOpened || item.originalOpeningDate || item.dateOfLastReporting || null;
}

export function classifyInquiry(item: NegativeItem, today: Date = new Date()): InquiryProfile {
  const inquiryDate = parseInquiryDate(item);
  let ageYears: number | null = null;
  if (inquiryDate) {
    const t = Date.parse(inquiryDate);
    if (!Number.isNaN(t)) {
      ageYears = (today.getTime() - t) / (1000 * 60 * 60 * 24 * 365.25);
    }
  }

  const blob = `${item.typeOfNegative} ${item.additionalInfo} ${item.status}`.toLowerCase();
  const authorized = /authorized|consumer[\s-]?initiated|i applied|mortgage application/i.test(blob);
  const duplicate = /duplicate|rate[\s-]?shop|same day/i.test(blob);

  if (ageYears != null && ageYears > 2) {
    return {
      itemId: item.id,
      inquiryDate,
      ageYears,
      strategy: 'obsolete_removal',
      legalAnchor: 'fcra_605',
      reason: 'Hard inquiry older than 2 years — obsolescence removal demand.',
      blockFromTradelineBatch: true,
    };
  }

  if (authorized) {
    return {
      itemId: item.id,
      inquiryDate,
      ageYears,
      strategy: 'authorized_no_dispute',
      legalAnchor: 'fcra_604',
      reason: 'Inquiry appears consumer-authorized — do not dispute.',
      blockFromTradelineBatch: true,
    };
  }

  if (duplicate) {
    return {
      itemId: item.id,
      inquiryDate,
      ageYears,
      strategy: 'duplicate_removal',
      legalAnchor: 'fcra_604',
      reason: 'Duplicate / non-rate-shop pull pattern — demand removal.',
      blockFromTradelineBatch: true,
    };
  }

  return {
    itemId: item.id,
    inquiryDate,
    ageYears,
    strategy: 'permissible_purpose_demand',
    legalAnchor: 'fcra_604',
    reason: 'Unknown or unauthorized hard pull — demand permissible purpose.',
    blockFromTradelineBatch: true,
  };
}

export function isInquiryItem(item: NegativeItem): boolean {
  const blob = `${item.typeOfNegative} ${item.accountType}`.toLowerCase();
  return /\binquir/.test(blob);
}
