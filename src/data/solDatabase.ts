/**
 * Statute of Limitations Database
 * Per-state SOL for credit card debt, medical debt, written contracts, and oral contracts.
 * SOL data sourced from NCSL and state statutes as of 2025.
 * CRITICAL: SOL running out does NOT remove the item from your credit report (FCRA 7-year rule is separate).
 * SOL affects whether a collector can SUE you — not credit reporting.
 */

export interface SOLData {
  state: string;
  stateCode: string;
  creditCard: number;    // years
  writtenContract: number;
  oralContract: number;
  medicalDebt: number;
  notes: string;
}

export const SOL_DATABASE: Record<string, SOLData> = {
  AL: { state: 'Alabama', stateCode: 'AL', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'Ala. Code §6-2-34' },
  AK: { state: 'Alaska', stateCode: 'AK', creditCard: 3, writtenContract: 6, oralContract: 3, medicalDebt: 3, notes: 'AS §09.10.053' },
  AZ: { state: 'Arizona', stateCode: 'AZ', creditCard: 6, writtenContract: 6, oralContract: 3, medicalDebt: 6, notes: 'ARS §12-548' },
  AR: { state: 'Arkansas', stateCode: 'AR', creditCard: 5, writtenContract: 5, oralContract: 3, medicalDebt: 5, notes: 'Ark. Code §16-56-111' },
  CA: { state: 'California', stateCode: 'CA', creditCard: 4, writtenContract: 4, oralContract: 2, medicalDebt: 3, notes: 'CCP §337' },
  CO: { state: 'Colorado', stateCode: 'CO', creditCard: 6, writtenContract: 6, oralContract: 3, medicalDebt: 6, notes: 'CRS §13-80-103.5' },
  CT: { state: 'Connecticut', stateCode: 'CT', creditCard: 6, writtenContract: 6, oralContract: 3, medicalDebt: 6, notes: 'CGS §52-576' },
  DE: { state: 'Delaware', stateCode: 'DE', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: '10 Del. C. §8106' },
  FL: { state: 'Florida', stateCode: 'FL', creditCard: 5, writtenContract: 5, oralContract: 4, medicalDebt: 5, notes: 'Fla. Stat. §95.11 (2023 amended to 5 from 6 for credit contracts)' },
  GA: { state: 'Georgia', stateCode: 'GA', creditCard: 6, writtenContract: 6, oralContract: 4, medicalDebt: 6, notes: 'OCGA §9-3-24' },
  HI: { state: 'Hawaii', stateCode: 'HI', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'HRS §657-1' },
  ID: { state: 'Idaho', stateCode: 'ID', creditCard: 5, writtenContract: 5, oralContract: 4, medicalDebt: 5, notes: 'IC §5-216' },
  IL: { state: 'Illinois', stateCode: 'IL', creditCard: 5, writtenContract: 10, oralContract: 5, medicalDebt: 8, notes: '735 ILCS 5/13-206' },
  IN: { state: 'Indiana', stateCode: 'IN', creditCard: 10, writtenContract: 10, oralContract: 6, medicalDebt: 10, notes: 'Indiana Code §34-11-2-9' },
  IA: { state: 'Iowa', stateCode: 'IA', creditCard: 5, writtenContract: 10, oralContract: 5, medicalDebt: 5, notes: 'Iowa Code §614.1(4)' },
  KS: { state: 'Kansas', stateCode: 'KS', creditCard: 5, writtenContract: 5, oralContract: 3, medicalDebt: 5, notes: 'KSA 60-511' },
  KY: { state: 'Kentucky', stateCode: 'KY', creditCard: 5, writtenContract: 15, oralContract: 5, medicalDebt: 5, notes: 'KRS 413.120' },
  LA: { state: 'Louisiana', stateCode: 'LA', creditCard: 3, writtenContract: 10, oralContract: 3, medicalDebt: 3, notes: 'La. C.C. Art. 3499' },
  ME: { state: 'Maine', stateCode: 'ME', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: '14 MRS §752' },
  MD: { state: 'Maryland', stateCode: 'MD', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: 'CJP §5-101' },
  MA: { state: 'Massachusetts', stateCode: 'MA', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'ALM GL ch. 260, §2' },
  MI: { state: 'Michigan', stateCode: 'MI', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'MCL 600.5807' },
  MN: { state: 'Minnesota', stateCode: 'MN', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'Minn. Stat. §541.05' },
  MS: { state: 'Mississippi', stateCode: 'MS', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: 'Miss. Code §15-1-29' },
  MO: { state: 'Missouri', stateCode: 'MO', creditCard: 5, writtenContract: 10, oralContract: 5, medicalDebt: 5, notes: 'Mo. Rev. Stat. §516.110' },
  MT: { state: 'Montana', stateCode: 'MT', creditCard: 5, writtenContract: 8, oralContract: 5, medicalDebt: 5, notes: 'MCA §27-2-202' },
  NE: { state: 'Nebraska', stateCode: 'NE', creditCard: 5, writtenContract: 5, oralContract: 4, medicalDebt: 5, notes: 'NRS 25-205' },
  NV: { state: 'Nevada', stateCode: 'NV', creditCard: 6, writtenContract: 6, oralContract: 4, medicalDebt: 6, notes: 'NRS 11.190' },
  NH: { state: 'New Hampshire', stateCode: 'NH', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: 'RSA 508:4' },
  NJ: { state: 'New Jersey', stateCode: 'NJ', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'NJS 2A:14-1' },
  NM: { state: 'New Mexico', stateCode: 'NM', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'NMSA 37-1-3' },
  NY: { state: 'New York', stateCode: 'NY', creditCard: 3, writtenContract: 6, oralContract: 6, medicalDebt: 3, notes: 'CPLR §213 (amended 2021 — credit card SOL reduced to 3 years)' },
  NC: { state: 'North Carolina', stateCode: 'NC', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: 'NC GS §1-52(1)' },
  ND: { state: 'North Dakota', stateCode: 'ND', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'NDCC 28-01-16' },
  OH: { state: 'Ohio', stateCode: 'OH', creditCard: 6, writtenContract: 8, oralContract: 6, medicalDebt: 6, notes: 'ORC §1303.16' },
  OK: { state: 'Oklahoma', stateCode: 'OK', creditCard: 5, writtenContract: 5, oralContract: 3, medicalDebt: 5, notes: '12 Okla. Stat. §95' },
  OR: { state: 'Oregon', stateCode: 'OR', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'ORS 12.080' },
  PA: { state: 'Pennsylvania', stateCode: 'PA', creditCard: 4, writtenContract: 4, oralContract: 4, medicalDebt: 4, notes: '42 Pa. C.S. §5525' },
  RI: { state: 'Rhode Island', stateCode: 'RI', creditCard: 10, writtenContract: 10, oralContract: 10, medicalDebt: 10, notes: 'RIGL §9-1-13' },
  SC: { state: 'South Carolina', stateCode: 'SC', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: 'SC Code §15-3-530' },
  SD: { state: 'South Dakota', stateCode: 'SD', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'SDCL 15-2-13' },
  TN: { state: 'Tennessee', stateCode: 'TN', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'Tenn. Code §28-3-109' },
  TX: { state: 'Texas', stateCode: 'TX', creditCard: 4, writtenContract: 4, oralContract: 4, medicalDebt: 4, notes: 'Tex. Civ. Prac. §16.004' },
  UT: { state: 'Utah', stateCode: 'UT', creditCard: 6, writtenContract: 6, oralContract: 4, medicalDebt: 6, notes: 'UCA §78B-2-307' },
  VT: { state: 'Vermont', stateCode: 'VT', creditCard: 6, writtenContract: 14, oralContract: 6, medicalDebt: 6, notes: '12 V.S.A. §511' },
  VA: { state: 'Virginia', stateCode: 'VA', creditCard: 5, writtenContract: 5, oralContract: 3, medicalDebt: 5, notes: 'Va. Code §8.01-246(4)' },
  WA: { state: 'Washington', stateCode: 'WA', creditCard: 6, writtenContract: 6, oralContract: 3, medicalDebt: 3, notes: 'RCW 4.16.040' },
  WV: { state: 'West Virginia', stateCode: 'WV', creditCard: 10, writtenContract: 10, oralContract: 5, medicalDebt: 10, notes: 'WV Code §55-2-6' },
  WI: { state: 'Wisconsin', stateCode: 'WI', creditCard: 6, writtenContract: 6, oralContract: 6, medicalDebt: 6, notes: 'Wis. Stat. §893.43' },
  WY: { state: 'Wyoming', stateCode: 'WY', creditCard: 8, writtenContract: 8, oralContract: 8, medicalDebt: 8, notes: 'WY Stat. §1-3-105' },
  DC: { state: 'District of Columbia', stateCode: 'DC', creditCard: 3, writtenContract: 3, oralContract: 3, medicalDebt: 3, notes: 'DC Code §12-301' },
};

export type DebtType = 'creditCard' | 'writtenContract' | 'oralContract' | 'medicalDebt';

export interface SOLCalculation {
  stateCode: string;
  stateName: string;
  debtType: DebtType;
  solYears: number;
  dofd: Date;
  solExpirationDate: Date;
  isExpired: boolean;
  daysRemaining: number;
  yearsRemaining: number;
  fcraRemovalDate: Date;  // 7 years from DOFD — separate from SOL
  isFCRAExpired: boolean;
  warning: string | null;
  legalNote: string;
}

export function calculateSOL(
  stateCode: string,
  debtType: DebtType,
  dofd: Date
): SOLCalculation | null {
  const sol = SOL_DATABASE[stateCode.toUpperCase()];
  if (!sol) return null;

  const solYears = sol[debtType];
  const solExpiration = new Date(dofd);
  solExpiration.setFullYear(solExpiration.getFullYear() + solYears);

  const fcraRemoval = new Date(dofd);
  fcraRemoval.setFullYear(fcraRemoval.getFullYear() + 7);

  const now = new Date();
  const msRemaining = solExpiration.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const isExpired = daysRemaining <= 0;
  const isFCRAExpired = fcraRemoval.getTime() < now.getTime();

  let warning: string | null = null;
  if (!isExpired && daysRemaining <= 90) {
    warning = `⚠️ SOL expires in ${daysRemaining} days — do NOT make any payment or acknowledgment of the debt, as this may restart the SOL clock.`;
  } else if (isExpired) {
    warning = 'SOL expired — this debt is time-barred. Collectors cannot sue you to collect it. Any new collection activity may trigger FDCPA protections.';
  }

  return {
    stateCode: stateCode.toUpperCase(),
    stateName: sol.state,
    debtType,
    solYears,
    dofd,
    solExpirationDate: solExpiration,
    isExpired,
    daysRemaining: Math.max(0, daysRemaining),
    yearsRemaining: Math.max(0, daysRemaining / 365.25),
    fcraRemovalDate: fcraRemoval,
    isFCRAExpired,
    warning,
    legalNote: sol.notes,
  };
}

export function getStates(): Array<{ code: string; name: string }> {
  return Object.values(SOL_DATABASE).map((s) => ({
    code: s.stateCode,
    name: s.state,
  }));
}
