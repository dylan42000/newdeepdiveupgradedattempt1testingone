import type { NegativeItem, DisputeRound } from '../types';

export interface LetterDNA {
  accountFingerprint: string;
  narrativePersona: string;
  legalAngle: string;
  tonePitch: 'assertive' | 'professional' | 'legal_threat';
  specificDataPoints: string[];
  uniqueOpeningHook: string;
  closingDemand: string;
}

export interface LetterDNA12 extends LetterDNA {
  narrativePOV: 'first_person_formal' | 'third_person_declarative' | 'direct_assertion';
  sentenceRhythm: 'short_punchy' | 'medium_balanced' | 'long_formal';
  citationStyle: 'inline_parenthetical' | 'footnote_reference' | 'prose_embedded';
  demandIntensity: 'polite_firm' | 'assertive' | 'legally_urgent';
  factualAnchor: 'balance_led' | 'dofd_led' | 'status_led' | 'bureau_field_led';
  closingTone: 'cooperative' | 'non_negotiable' | 'compliance_demand';
  headerFormat: 'subject_line' | 're_format' | 'no_header';
  paragraphCount: 3 | 4 | 5;
}

function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash);
}

function pickFromArray<T>(arr: T[], hash: number): T {
  return arr[hash % arr.length];
}

export function buildLetterDNA(
  item: NegativeItem,
  round: DisputeRound,
  profileId: string
): LetterDNA {
  const seedString = `${item.accountNumber}|${item.creditorName}|${profileId}|${round}`;
  const hash = djb2Hash(seedString);

  const narrativePool = [
    'Forensic Auditor',
    'Compliance Investigator',
    'Consumer Rights Litigant',
    'Statutory Auditor',
    'Data Integrity Officer',
    'Regulatory Examiner',
  ];

  const legalAngles = [
    'FCRA §609 Identity Verification Failure',
    'FCRA §611 Re-investigation Deficiency',
    'FCRA §623 Furnisher Accuracy Breach',
    'Metro 2 Format Violation Cascade',
    'CDIA Reporting Standard Deviation',
    'Cross-Bureau Re-aging Evidence',
  ];

  const tonePitches: LetterDNA['tonePitch'][] = ['assertive', 'professional', 'legal_threat'];

  const openingHooks = [
    'The reporting details for this account contain a specific inconsistency that requires investigation.',
    'This is a formal compliance demand regarding material inaccuracies in the tradeline listed below.',
    'I am exercising my statutory rights under the Fair Credit Reporting Act to challenge the veracity of this entry.',
    'Notice of FCRA violation: the reporting of this account fails minimum accuracy and completeness standards.',
    'By operation of federal law, the information furnished herein must withstand scrutiny; the account below does not.',
  ];

  const closingDemands = [
    'Delete the inaccurate tradeline within thirty (30) days and provide written confirmation of compliance.',
    'Investigate, verify, and permanently remove this entry, submitting proof of corrective action within the statutory window.',
    'Correct all disputed data points, notify every consumer reporting agency to which the inaccurate data was furnished, and certify compliance in writing.',
    'Pursuant to 15 U.S.C. § 1681s-2, cease reporting this account until every field is verified against original source documents.',
    'Within thirty (30) days, furnish a complete file disclosure, itemized correction notice, and Bureau confirmation of deletion.',
  ];

  const fingerprint = hash.toString(16).slice(0, 8);

  const dataPoints: string[] = [];
  if (item.balance !== null && item.balance !== undefined) {
    dataPoints.push(`Exact Balance: $${item.balance}`);
  }
  if (item.originalBalance !== null && item.originalBalance !== undefined) {
    dataPoints.push(`Original Balance: $${item.originalBalance}`);
  }
  if (item.accountNumber) {
    dataPoints.push(`Account Number: ${item.accountNumber}`);
  }
  if (item.creditorName) {
    dataPoints.push(`Creditor Name: ${item.creditorName}`);
  }
  if (item.originalDateOfDelinquency || item.dateOfFirstDelinquency) {
    dataPoints.push(`Exact DOFD: ${item.originalDateOfDelinquency || item.dateOfFirstDelinquency}`);
  }
  if (item.dateOfLastReporting) {
    dataPoints.push(`Date of Last Reporting: ${item.dateOfLastReporting}`);
  }
  if (item.dateOpened || item.originalOpeningDate) {
    dataPoints.push(`Date Opened: ${item.dateOpened || item.originalOpeningDate}`);
  }
  if (item.status) {
    dataPoints.push(`Account Status: ${item.status}`);
  }
  if (item.typeOfNegative) {
    dataPoints.push(`Negative Type: ${item.typeOfNegative}`);
  }
  if (item.autoRemovalDate) {
    dataPoints.push(`Scheduled Auto-Removal Date: ${item.autoRemovalDate}`);
  }
  if (item.paymentHistory) {
    dataPoints.push(`Payment History: ${item.paymentHistory}`);
  }
  if (item.creditLimit !== null && item.creditLimit !== undefined) {
    dataPoints.push(`Credit Limit: $${item.creditLimit}`);
  }
  if (item.furnisher) {
    dataPoints.push(`Furnisher: ${item.furnisher}`);
  }

  return {
    accountFingerprint: fingerprint,
    narrativePersona: pickFromArray(narrativePool, hash),
    legalAngle: pickFromArray(legalAngles, hash),
    tonePitch: pickFromArray(tonePitches, hash),
    specificDataPoints: dataPoints,
    uniqueOpeningHook: pickFromArray(openingHooks, hash),
    closingDemand: pickFromArray(closingDemands, hash),
  };
}

function seededPick<T>(values: readonly T[], seed: number, dimension: number): T {
  return values[Math.abs((seed >>> (dimension % 16)) + dimension * 2654435761) % values.length];
}

export function buildLetterDNA12(item: NegativeItem, profileId: string, pass: number, bureau: string, cycle: number, generationTimestamp: number): LetterDNA12 {
  const legacy = buildLetterDNA(item, Math.max(1, Math.min(6, pass)) as DisputeRound, profileId);
  const seed = djb2Hash(`${item.accountNumber}|${item.creditorName}|${profileId}|${pass}|${bureau}|${cycle}|${Math.floor(generationTimestamp / 60000)}`);
  const intensity = pass >= 4 ? ['assertive', 'legally_urgent'] as const : ['polite_firm', 'assertive'] as const;
  const tones = pass >= 4 ? ['non_negotiable', 'compliance_demand'] as const : ['cooperative', 'non_negotiable'] as const;
  return {
    ...legacy,
    narrativePOV: seededPick(['first_person_formal','third_person_declarative','direct_assertion'] as const, seed, 4),
    sentenceRhythm: seededPick(['short_punchy','medium_balanced','long_formal'] as const, seed, 5),
    citationStyle: seededPick(['inline_parenthetical','footnote_reference','prose_embedded'] as const, seed, 6),
    demandIntensity: seededPick(intensity, seed, 7),
    factualAnchor: seededPick(['balance_led','dofd_led','status_led','bureau_field_led'] as const, seed, 8),
    closingTone: seededPick(tones, seed, 9),
    headerFormat: seededPick(['subject_line','re_format','no_header'] as const, seed, 10),
    paragraphCount: seededPick([3,4,5] as const, seed, 11),
  };
}
