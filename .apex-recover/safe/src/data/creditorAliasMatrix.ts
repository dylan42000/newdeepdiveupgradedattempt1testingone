/**
 * Creditor alias families + sold-portfolio chains for merge/scoring (Apex AD-M2).
 */

export interface CreditorAliasFamily {
  canonical: string;
  aliases: string[];
  /** Known debt buyers / CAs that often buy this OC's portfolios */
  soldTo?: string[];
  portfolioIndicator?: boolean;
  /** True if this canonical is a collection agency / debt buyer */
  isCollectionAgency?: boolean;
}

export const CREDITOR_ALIAS_MATRIX: CreditorAliasFamily[] = [
  { canonical: 'CAPITAL_ONE', aliases: ['CAP1', 'CAPITAL ONE BANK', 'CAP ONE', 'CAPITALONE', 'CAPITAL ONE NA'] },
  { canonical: 'CHASE', aliases: ['JPMC', 'JPMORGAN', 'JP MORGAN', 'CHASE BANK', 'CHASE CARD'], soldTo: ['RESURGENT', 'LVNV', 'PORTFOLIO_RECOVERY'], portfolioIndicator: true },
  { canonical: 'CITI', aliases: ['CITIBANK', 'CITI BANK', 'CITICARDS', 'CITICORP'] },
  { canonical: 'AMEX', aliases: ['AMERICAN EXPRESS', 'AMEX BANK', 'AMERICAN EXPRESS CENTURION'] },
  { canonical: 'DISCOVER', aliases: ['DISCOVER BANK', 'DISCOVER FIN', 'DISCOVER FINANCIAL'] },
  { canonical: 'BANK_OF_AMERICA', aliases: ['BOA', 'B OF A', 'BANK OF AMERICA NA', 'BANKAMERICA'] },
  { canonical: 'WELLS_FARGO', aliases: ['WELLS', 'WF BANK', 'WELLS FARGO BANK', 'WACHOVIA'] },
  { canonical: 'SYNCHRONY', aliases: ['SYNCHRONY BANK', 'SYNCB', 'GE CAPITAL RETAIL'] },
  { canonical: 'TD_BANK', aliases: ['TD BANK NA', 'TD CONSUMER', 'TORONTO DOMINION'] },
  { canonical: 'US_BANK', aliases: ['U.S. BANK', 'USBANK', 'US BANK NA'] },
  { canonical: 'NAVY_FEDERAL', aliases: ['NFCU', 'NAVY FEDERAL CREDIT UNION'] },
  { canonical: 'PORTFOLIO_RECOVERY', aliases: ['PRA', 'PORTFOLIO RECOVERY ASSOC', 'PORTFOLIO RECOV', 'PORTFOLIO RECOVERY ASSOCIATES'], isCollectionAgency: true },
  { canonical: 'MIDLAND_CREDIT', aliases: ['MCM', 'MIDLAND FUNDING', 'MIDLAND CREDIT MGMT', 'MIDLAND CREDIT MANAGEMENT'], isCollectionAgency: true },
  { canonical: 'LVNV', aliases: ['LVNV FUNDING', 'RESURGENT', 'RESURGENT CAPITAL'], isCollectionAgency: true },
  { canonical: 'JEFFERSON_CAPITAL', aliases: ['JCAP', 'JEFFERSON CAPITAL SYSTEMS'], isCollectionAgency: true },
  { canonical: 'CAVALRY', aliases: ['CAVALRY SPV', 'CAVALRY PORTFOLIO', 'CAVALRY INVESTMENTS'], isCollectionAgency: true },
  { canonical: 'ASSET_ACCEPTANCE', aliases: ['ASSET ACCEPTANCE LLC', 'ASSET ACCEPTANCE CAPITAL'], isCollectionAgency: true },
  { canonical: 'IC_SYSTEM', aliases: ['IC SYSTEM', 'I.C. SYSTEM'], isCollectionAgency: true },
  { canonical: 'CONVERGENT', aliases: ['CONVERGENT OUTSOURCING', 'CONVERGENT HEALTHCARE'], isCollectionAgency: true },
  { canonical: 'AFNI', aliases: ['AFNI INC', 'AFNI COLLECTIONS'], isCollectionAgency: true },
  { canonical: 'CREDIT_ONE', aliases: ['CREDIT ONE BANK', 'CREDITONE'] },
  { canonical: 'FINGERHUT', aliases: ['FINGERHUT DIRECT', 'BLST', 'BLUELINE'] },
  { canonical: 'TOYOTA', aliases: ['TOYOTA MOTOR CREDIT', 'TMCC', 'TOYOTA FINANCIAL'] },
  { canonical: 'GM_FINANCIAL', aliases: ['GMAC', 'GM FINANCIAL', 'ALLY FINANCIAL', 'ALLY BANK'] },
  { canonical: 'SALLIE_MAE', aliases: ['SLM', 'NAVIENT', 'SALLIEMAE'] },
  { canonical: 'NELNET', aliases: ['NELNET INC', 'NELNET STUDENT'] },
  { canonical: 'GREAT_LAKES', aliases: ['GREAT LAKES EDUCATIONAL', 'NELNET GREAT LAKES'] },
  { canonical: 'MOHELA', aliases: ['MOHELA STUDENT', 'HIGHER EDUCATION LOAN'] },
];

function normalizeKey(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\b(LLC|INC|CORP|NA|BANK|CREDIT|UNION|ASSOC|ASSOCIATES|MGMT|MANAGEMENT|FINANCIAL|SERVICES|CO|COMPANY)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX = new Map<string, CreditorAliasFamily>();
for (const family of CREDITOR_ALIAS_MATRIX) {
  ALIAS_INDEX.set(normalizeKey(family.canonical.replace(/_/g, ' ')), family);
  for (const alias of family.aliases) {
    ALIAS_INDEX.set(normalizeKey(alias), family);
  }
}

export function resolveCreditorCanonical(name: string): string | null {
  const key = normalizeKey(name);
  if (!key) return null;
  const direct = ALIAS_INDEX.get(key);
  if (direct) return direct.canonical;
  // Prefix / contains fallback for truncated report names
  for (const [aliasKey, family] of ALIAS_INDEX) {
    if (aliasKey.length >= 5 && (key.includes(aliasKey) || aliasKey.includes(key))) {
      return family.canonical;
    }
  }
  return null;
}

export function getCreditorFamily(name: string): CreditorAliasFamily | null {
  const canonical = resolveCreditorCanonical(name);
  if (!canonical) return null;
  return CREDITOR_ALIAS_MATRIX.find((f) => f.canonical === canonical) ?? null;
}

export function creditorsAreAliasMatch(a: string, b: string): boolean {
  const ca = resolveCreditorCanonical(a);
  const cb = resolveCreditorCanonical(b);
  if (ca && cb) return ca === cb;
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function isKnownCollectionAgency(name: string): boolean {
  const family = getCreditorFamily(name);
  return !!family?.isCollectionAgency;
}

export function soldPortfolioRelated(ocName: string, caName: string): boolean {
  const oc = getCreditorFamily(ocName);
  const ca = resolveCreditorCanonical(caName);
  if (!oc?.soldTo || !ca) return false;
  return oc.soldTo.includes(ca);
}
