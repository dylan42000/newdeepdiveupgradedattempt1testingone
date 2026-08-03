/**
 * OC + CA relationship detector (Apex M4) — LINK_ONLY same-debt campaigns.
 */

import type { NegativeItem } from '../types';
import {
  creditorsAreAliasMatch,
  getCreditorFamily,
  isKnownCollectionAgency,
  soldPortfolioRelated,
} from '../data/creditorAliasMatrix';

export type OCCADecision = 'unrelated' | 'link_only' | 'possible_same_account';

export interface OCCARelationship {
  decision: OCCADecision;
  reason: string;
  disputeCaFirst: boolean;
  campaignHint: string;
}

function blob(item: NegativeItem): string {
  return `${item.typeOfNegative} ${item.accountType} ${item.status} ${item.accountStatus}`.toLowerCase();
}

function isChargeOff(item: NegativeItem): boolean {
  return /\bcharge[\s-]?off\b|\bcharged\s*off\b|\b93\b|\b97\b/.test(blob(item));
}

function isCollection(item: NegativeItem): boolean {
  if (isKnownCollectionAgency(item.creditorName)) return true;
  return /\bcollection\b/.test(blob(item));
}

function balancePlausible(a: NegativeItem, b: NegativeItem): boolean {
  const ba = a.balance ?? a.originalBalance;
  const bb = b.balance ?? b.originalBalance;
  if (ba == null || bb == null) return true;
  const low = Math.min(ba, bb);
  const high = Math.max(ba, bb);
  if (low <= 0) return high < 500;
  // CA balance may be higher (fees/interest)
  return high <= low * 1.45 + 200;
}

function originalCreditorLinks(oc: NegativeItem, ca: NegativeItem): boolean {
  const caOc = ca.originalCreditor?.trim();
  if (!caOc) return false;
  if (creditorsAreAliasMatch(oc.creditorName, caOc)) return true;
  if (oc.originalCreditor && creditorsAreAliasMatch(oc.originalCreditor, caOc)) return true;
  if (oc.furnisher && creditorsAreAliasMatch(oc.furnisher, caOc)) return true;
  return false;
}

export function detectOCCARelationship(a: NegativeItem, b: NegativeItem): OCCARelationship {
  const aIsCO = isChargeOff(a);
  const bIsCO = isChargeOff(b);
  const aIsCA = isCollection(a);
  const bIsCA = isCollection(b);

  // Prefer clear OC (charge-off / bank) + CA (collection agency) pairing
  let oc: NegativeItem | null = null;
  let ca: NegativeItem | null = null;

  if (aIsCA && !bIsCA && (bIsCO || !isKnownCollectionAgency(b.creditorName))) {
    ca = a; oc = b;
  } else if (bIsCA && !aIsCA && (aIsCO || !isKnownCollectionAgency(a.creditorName))) {
    ca = b; oc = a;
  } else if (aIsCO && bIsCA) {
    oc = a; ca = b;
  } else if (bIsCO && aIsCA) {
    oc = b; ca = a;
  }

  if (!oc || !ca || oc.id === ca.id) {
    return {
      decision: 'unrelated',
      reason: 'No clear original-creditor charge-off + collection pairing.',
      disputeCaFirst: false,
      campaignHint: '',
    };
  }

  const sold = soldPortfolioRelated(oc.creditorName, ca.creditorName);
  const ocFieldLink = originalCreditorLinks(oc, ca);
  const caFamily = getCreditorFamily(ca.creditorName);
  const balancesOk = balancePlausible(oc, ca);
  const ocDofd = oc.dateOfFirstDelinquency || oc.originalDateOfDelinquency;
  const caOpen = ca.dateOpened || ca.originalOpeningDate;
  let timelineOk = true;
  if (ocDofd && caOpen) {
    const d1 = Date.parse(ocDofd);
    const d2 = Date.parse(caOpen);
    if (!Number.isNaN(d1) && !Number.isNaN(d2) && d2 + 86_400_000 < d1) {
      timelineOk = false;
    }
  }

  if ((sold || ocFieldLink || caFamily?.isCollectionAgency) && balancesOk && timelineOk) {
    return {
      decision: 'link_only',
      reason: ocFieldLink
        ? `Original-creditor field links ${ca.creditorName} → ${ca.originalCreditor}`
        : sold
          ? `Sold-portfolio chain: ${oc.creditorName} → ${ca.creditorName}`
          : `Charge-off + known CA pairing with compatible balances.`,
      disputeCaFirst: true,
      campaignHint: 'Dispute collection agency first via FDCPA §809; keep OC linked.',
    };
  }

  if (balancesOk && (aIsCO || bIsCO) && (aIsCA || bIsCA)) {
    return {
      decision: 'link_only',
      reason: 'Charge-off + collection signals with compatible balances — link for campaign, do not merge.',
      disputeCaFirst: true,
      campaignHint: 'Campaign-group OC+CA; validate CA first.',
    };
  }

  return {
    decision: 'unrelated',
    reason: 'Insufficient OC/CA indicators.',
    disputeCaFirst: false,
    campaignHint: '',
  };
}
