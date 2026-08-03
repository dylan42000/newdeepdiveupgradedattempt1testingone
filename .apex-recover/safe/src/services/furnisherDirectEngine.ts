/**
 * Furnisher-direct dispute branch (Apex L3) — §623 pivot after repeated verifies.
 */

import type { NegativeItem } from '../types';

export interface FurnisherDisputePlan {
  itemId: string;
  recommended: boolean;
  furnisherName: string;
  legalBasis: 'fcra_623' | 'fdcpa_809';
  certifiedMailRequired: boolean;
  responseDeadlineDays: number;
  letterType: 'furnisher_direct' | 'debt_validation' | 'both';
  reason: string;
}

export function planFurnisherDirect(item: NegativeItem): FurnisherDisputePlan {
  const furnisherName = item.furnisher || item.originalCreditor || item.creditorName;
  const verifies = item.verificationCount ?? 0;
  const doubleVerified = item.doubleVerified === true || verifies >= 3;
  const collection = /\bcollection\b/i.test(`${item.typeOfNegative} ${item.accountType}`);

  if (doubleVerified) {
    return {
      itemId: item.id,
      recommended: true,
      furnisherName,
      legalBasis: collection ? 'fdcpa_809' : 'fcra_623',
      certifiedMailRequired: true,
      responseDeadlineDays: 30,
      letterType: collection ? 'both' : 'furnisher_direct',
      reason: `Bureau verified ${verifies || 3}+ times — pivot to furnisher-direct §623.`,
    };
  }

  return {
    itemId: item.id,
    recommended: false,
    furnisherName,
    legalBasis: 'fcra_623',
    certifiedMailRequired: true,
    responseDeadlineDays: 30,
    letterType: 'furnisher_direct',
    reason: 'Furnisher-direct not yet indicated (verification count below threshold).',
  };
}
