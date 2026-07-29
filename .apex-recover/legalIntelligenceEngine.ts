/**
 * Legal Intelligence Engine (Apex AD-6) — deterministic FCRA/FDCPA/SOL/DOFD profile.
 * Pure TS; no AI. Strategy Cards must embed this profile.
 */

import type { NegativeItem, PersonalInfo } from '../types';
import type { Metro2Violation } from './metro2Auditor';
import { auditMetro2Static } from './metro2Auditor';
import { assessSol, type SolAssessment } from './solStateMatrix';
import { classifyDebtType, type DebtClass } from './debtTypeStrategyLibrary';

export type DofdConfidence = 'explicit' | 'inferred_from_delinquency' | 'missing';

export interface LegalAnchor {
  id: string;
  statute: string;
  label: string;
  reason: string;
}

export interface DisputeRestriction {
  code: string;
  message: string;
}

export interface UPLRiskFlag {
  code: string;
  message: string;
}

export interface LegalProfile {
  itemId: string;
  debtClass: DebtClass;
  fcra611Applicable: boolean;
  fcra623Applicable: boolean;
  fcra609Applicable: boolean;
  fcra605BApplicable: boolean;
  factaApplicable: boolean;
  fdcpa809Applicable: boolean;
  fdcpa807Applicable: boolean;
  validationWindowOpen: boolean;
  metro2Violations: Metro2Violation[];
  sol: SolAssessment;
  dofdConfidence: DofdConfidence;
  dofd: string | null;
  creditClockExpiresDate: string | null;
  creditClockExpired: boolean;
  obsoletionDisputable: boolean;
  availableAnchors: LegalAnchor[];
  disputeRestrictions: DisputeRestriction[];
  upriskFlags: UPLRiskFlag[];
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function addYears(d: Date, years: number): Date {
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + years);
  return out;
}

function isCollectionLike(item: NegativeItem, debtClass: DebtClass): boolean {
  if (debtClass === 'collections' || debtClass === 'charge_off') return true;
  const blob = `${item.typeOfNegative} ${item.accountType} ${item.status} ${item.accountStatus}`.toLowerCase();
  return /\bcollection\b|\bcharge[\s-]?off\b/.test(blob);
}

export function buildLegalProfile(
  item: NegativeItem,
  personalInfo?: Pick<PersonalInfo, 'state'> | null,
  opts?: { today?: Date; validationNoticeDate?: string | null; fraudFlagged?: boolean },
): LegalProfile {
  const today = opts?.today ?? new Date();
  const debtClass = classifyDebtType(item);
  const collectionLike = isCollectionLike(item, debtClass);

  const explicitDofd = item.dateOfFirstDelinquency || item.originalDateOfDelinquency || null;
  let dofdConfidence: DofdConfidence = 'missing';
  let dofd: string | null = null;
  if (explicitDofd) {
    dofd = explicitDofd;
    dofdConfidence = 'explicit';
  }

  const dofdDate = parseDate(dofd);
  let creditClockExpiresDate: string | null = item.autoRemovalDate ?? null;
  let creditClockExpired = false;
  if (!creditClockExpiresDate && dofdDate) {
    creditClockExpiresDate = addYears(dofdDate, 7).toISOString().slice(0, 10);
  }
  if (creditClockExpiresDate) {
    const exp = parseDate(creditClockExpiresDate);
    creditClockExpired = !!exp && exp.getTime() <= today.getTime();
  }

  const sol = assessSol({
    state: personalInfo?.state,
    anchorDate: dofd || item.dateLastActive || item.dateOfLastReporting || item.originalOpeningDate,
    isCollectionOrChargeOff: collectionLike,
    today,
  });

  let metro2Violations: Metro2Violation[] = [];
  try {
    metro2Violations = [...(item.metro2Violations ?? []), ...auditMetro2Static(item)];
  } catch {
    metro2Violations = item.metro2Violations ?? [];
  }

  // Dedup by id/type+field
  const seen = new Set<string>();
  metro2Violations = metro2Violations.filter((v) => {
    const key = v.id || `${v.type}:${v.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let validationWindowOpen = false;
  if (opts?.validationNoticeDate) {
    const notice = parseDate(opts.validationNoticeDate);
    if (notice) {
      const days = (today.getTime() - notice.getTime()) / 86_400_000;
      validationWindowOpen = days >= 0 && days <= 30;
    }
  }

  const availableAnchors: LegalAnchor[] = [
    {
      id: 'fcra_611',
      statute: '15 U.S.C. § 1681i',
      label: 'FCRA §611 reinvestigation',
      reason: 'Consumer right to dispute inaccurate or incomplete information with CRAs.',
    },
    {
      id: 'fcra_623',
      statute: '15 U.S.C. § 1681s-2',
      label: 'FCRA §623 furnisher duties',
      reason: 'Furnisher must investigate after notice of dispute.',
    },
  ];

  if (collectionLike) {
    availableAnchors.push({
      id: 'fdcpa_809',
      statute: '15 U.S.C. § 1692g',
      label: 'FDCPA §809 validation',
      reason: 'Debt collector validation rights for collection accounts.',
    });
    availableAnchors.push({
      id: 'fdcpa_807',
      statute: '15 U.S.C. § 1692e',
      label: 'FDCPA §807 false representation',
      reason: 'Bars false or misleading representations in connection with debt collection.',
    });
  }

  if (creditClockExpired || sol.solExpired) {
    availableAnchors.push({
      id: 'fcra_605',
      statute: '15 U.S.C. § 1681c',
      label: 'FCRA §605 obsolescence',
      reason: 'Reporting period may have expired — demand deletion of obsolete information.',
    });
  }

  if (opts?.fraudFlagged || debtClass === 'mixed_file') {
    availableAnchors.push({
      id: 'fcra_605B',
      statute: '15 U.S.C. § 1681c-2',
      label: 'FCRA §605B identity theft block',
      reason: 'Identity-theft / mixed-file indicators support block and fraud protocols.',
    });
  }

  if (debtClass === 'hard_inquiry') {
    availableAnchors.push({
      id: 'fcra_604',
      statute: '15 U.S.C. § 1681b',
      label: 'FCRA §604 permissible purpose',
      reason: 'Hard inquiries require a permissible purpose.',
    });
  }

  const disputeRestrictions: DisputeRestriction[] = [];
  if (dofdConfidence === 'explicit') {
    disputeRestrictions.push({
      code: 'DOFDF_PRESENT',
      message: 'Cannot claim DOFD unknown — field is present on the report.',
    });
  }
  if (item.accuracyConfirmedByUser && item.dataSource === 'manual') {
    disputeRestrictions.push({
      code: 'USER_CONFIRMED_FACTS',
      message: 'User-confirmed manual facts must not be contradicted by AI.',
    });
  }

  const upriskFlags: UPLRiskFlag[] = [
    {
      code: 'CONSUMER_VOICE_ONLY',
      message: 'Letters must remain first-person consumer voice — not attorney representation.',
    },
  ];

  return {
    itemId: item.id,
    debtClass,
    fcra611Applicable: true,
    fcra623Applicable: true,
    fcra609Applicable: true,
    fcra605BApplicable: !!opts?.fraudFlagged || debtClass === 'mixed_file',
    factaApplicable: true,
    fdcpa809Applicable: collectionLike,
    fdcpa807Applicable: collectionLike,
    validationWindowOpen,
    metro2Violations,
    sol,
    dofdConfidence,
    dofd,
    creditClockExpiresDate,
    creditClockExpired,
    obsoletionDisputable: creditClockExpired,
    availableAnchors,
    disputeRestrictions,
    upriskFlags,
  };
}
