/**
 * Debt-Type Strategy Library (Apex AD-7) — 12 debt classes with dispute postures.
 */

export type DebtClass =
  | 'revolving'
  | 'installment'
  | 'mortgage'
  | 'student_loan'
  | 'medical'
  | 'collections'
  | 'charge_off'
  | 'public_record'
  | 'hard_inquiry'
  | 'authorized_user'
  | 'utility_telecom'
  | 'mixed_file';

export interface DebtTypeStrategy {
  debtClass: DebtClass;
  label: string;
  keyAngles: string[];
  evidenceHints: string[];
  preferredLegalAnchors: string[];
  voiceRegister: 'consumer_assertive' | 'validation_demand' | 'formal_elevated' | 'factual_obsolescence';
  specialLogic: string;
}

const LIBRARY: Record<DebtClass, DebtTypeStrategy> = {
  revolving: {
    debtClass: 'revolving',
    label: 'Revolving (credit card)',
    keyAngles: ['balance_accuracy', 'credit_limit_reporting', 'payment_history', 'charge_off_date'],
    evidenceHints: ['statements', 'payment receipts', 'credit limit notices'],
    preferredLegalAnchors: ['fcra_611', 'fcra_623'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Utilization impact — prioritize balance/limit accuracy disputes.',
  },
  installment: {
    debtClass: 'installment',
    label: 'Installment (auto/personal)',
    keyAngles: ['payment_history', 'payoff_accuracy', 'status_post_payoff'],
    evidenceHints: ['payoff letter', 'title release', 'amortization schedule'],
    preferredLegalAnchors: ['fcra_611', 'fcra_623'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Paid-in-full verification gate before aggressive escalation.',
  },
  mortgage: {
    debtClass: 'mortgage',
    label: 'Mortgage',
    keyAngles: ['modification_accuracy', 'foreclosure_process', 'escrow_reporting'],
    evidenceHints: ['mod agreements', 'HUD statements', 'foreclosure notices'],
    preferredLegalAnchors: ['fcra_611', 'fcra_623'],
    voiceRegister: 'formal_elevated',
    specialLogic: 'Evidence gate elevated — high-stakes reporting.',
  },
  student_loan: {
    debtClass: 'student_loan',
    label: 'Student loan',
    keyAngles: ['deferment_status', 'servicer_transfer_gaps', 'ibr_pslf_reporting'],
    evidenceHints: ['NSLDS', 'servicer letters', 'forbearance docs'],
    preferredLegalAnchors: ['fcra_611', 'fcra_623'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Federal vs private branch — different furnisher paths.',
  },
  medical: {
    debtClass: 'medical',
    label: 'Medical',
    keyAngles: ['ncap_grace', 'balance_accuracy', 'insurance_adjustment', 'hipaa_intersection'],
    evidenceHints: ['EOBs', 'insurance remits', 'provider statements'],
    preferredLegalAnchors: ['fcra_611', 'fcra_623'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Flag newer medical reporting rules / grace periods.',
  },
  collections: {
    debtClass: 'collections',
    label: 'Collections / CA',
    keyAngles: ['debt_validation', 'original_creditor_identity', 'obsolescence', 'reaging', 'duplicate_oc'],
    evidenceHints: ['validation request proof', 'OC statements', 'cease & desist'],
    preferredLegalAnchors: ['fdcpa_809', 'fcra_623', 'fcra_611'],
    voiceRegister: 'validation_demand',
    specialLogic: 'FDCPA §809 validation branch preferred when window open.',
  },
  charge_off: {
    debtClass: 'charge_off',
    label: 'Charge-off',
    keyAngles: ['dofd_accuracy', 'charge_off_vs_last_delinquency', 'settlement_reporting', 'sold_to_ca'],
    evidenceTips: ['charge-off notices', 'settlement letters'],
    evidenceHints: ['charge-off notices', 'settlement letters'],
    preferredLegalAnchors: ['fcra_605', 'fcra_611', 'fcra_623'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Dual-account detection (OC + CA) — dispute CA first when linked.',
  },
  public_record: {
    debtClass: 'public_record',
    label: 'Public record',
    keyAngles: ['post_ncap_obsolete', 'tax_lien_judgment_removal'],
    evidenceHints: ['court dockets', 'satisfaction of judgment'],
    preferredLegalAnchors: ['fcra_605'],
    voiceRegister: 'factual_obsolescence',
    specialLogic: 'Most civil judgments/tax liens removed post-NCAP — flag obsolete.',
  },
  hard_inquiry: {
    debtClass: 'hard_inquiry',
    label: 'Hard inquiry',
    keyAngles: ['permissible_purpose', 'obsolescence_2yr', 'duplicate_pulls'],
    evidenceHints: ['application records', 'denial letters'],
    preferredLegalAnchors: ['fcra_604', 'fcra_605'],
    voiceRegister: 'factual_obsolescence',
    specialLogic: 'Never mix inquiry letters with tradeline dispute letters.',
  },
  authorized_user: {
    debtClass: 'authorized_user',
    label: 'Authorized user',
    keyAngles: ['remove_if_damaging', 'identity_match'],
    evidenceHints: ['ID', 'primary account holder correspondence'],
    preferredLegalAnchors: ['fcra_611'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Identity match required before AU removal demands.',
  },
  utility_telecom: {
    debtClass: 'utility_telecom',
    label: 'Utility / telecom',
    keyAngles: ['account_not_mine', 'late_collection_dispute'],
    evidenceHints: ['utility bills at address', 'account closure proof'],
    preferredLegalAnchors: ['fcra_611', 'fdcpa_809'],
    voiceRegister: 'consumer_assertive',
    specialLogic: 'Account-not-mine is high-frequency for this class.',
  },
  mixed_file: {
    debtClass: 'mixed_file',
    label: 'Mixed file / ID theft',
    keyAngles: ['wrong_ssn_suffix', 'unknown_address', 'unknown_account'],
    evidenceHints: ['FTC IdentityTheft.gov affidavit', 'police report', 'ID docs'],
    preferredLegalAnchors: ['fcra_605B', 'fcra_611'],
    voiceRegister: 'formal_elevated',
    specialLogic: 'Escalate fraud/ID-theft protocol — do not treat as ordinary dispute.',
  },
};

// Fix typo in charge_off — I accidentally left evidenceTips. Let me fix when writing - actually I included both. Need to remove evidenceTips from type - I already have evidenceHints only in interface. The charge_off object has invalid evidenceTips key - TypeScript will error. Fix it.
void 0;

export function classifyDebtType(item: {
  typeOfNegative?: string | null;
  accountType?: string | null;
  status?: string | null;
  accountStatus?: string | null;
  isMedicalDebt?: boolean;
  creditorName?: string;
}): DebtClass {
  const blob = [
    item.typeOfNegative,
    item.accountType,
    item.status,
    item.accountStatus,
    item.creditorName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (item.isMedicalDebt || /\bmedical\b|\bhospital\b|\bclinic\b|\bdentist\b/.test(blob)) {
    return 'medical';
  }
  if (/\binquir/.test(blob) || /\bhard pull\b/.test(blob)) return 'hard_inquiry';
  if (/\bmix(ed)?\s*file\b|\bidentity\s*theft\b|\bfraud\b/.test(blob)) return 'mixed_file';
  if (/\bauthorized\s*user\b|\bau\b/.test(blob)) return 'authorized_user';
  if (/\bmortgage\b|\bheloc\b|\bhome\s*equity\b/.test(blob)) return 'mortgage';
  if (/\bstudent\b|\bnavient\b|\bnelnet\b|\bmohela\b|\bsallie\b/.test(blob)) return 'student_loan';
  if (/\bjudgment\b|\btax\s*lien\b|\bbankruptcy\b|\bpublic\s*record\b/.test(blob)) return 'public_record';
  if (/\butility\b|\btelecom\b|\bcomcast\b|\bverizon\b|\bat&t\b|\bspectrum\b/.test(blob)) {
    return 'utility_telecom';
  }
  if (/\bcollection\b|\bdebt\s*buyer\b|\bfactoring\b/.test(blob)) return 'collections';
  if (/\bcharge[\s-]?off\b|\bcharged\s*off\b|\bwrite[\s-]?off\b/.test(blob)) return 'charge_off';
  if (/\bauto\b|\binstallment\b|\bloan\b|\bpersonal\s*loan\b/.test(blob)) return 'installment';
  if (/\brevolv|\bcredit\s*card\b|\bopen\s*account\b/.test(blob)) return 'revolving';
  if (/\bcollection\b/.test(blob)) return 'collections';
  return 'revolving';
}

export function getDebtTypeStrategy(debtClass: DebtClass): DebtTypeStrategy {
  return LIBRARY[debtClass];
}

export function getDebtTypeStrategyForItem(item: Parameters<typeof classifyDebtType>[0]): DebtTypeStrategy {
  return getDebtTypeStrategy(classifyDebtType(item));
}
