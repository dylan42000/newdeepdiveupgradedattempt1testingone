/**
 * Creditor alias families + sold-portfolio chains for merge/scoring (Apex AD-M2).
 * Expanded aggressively for real-world bureau furnisher name variants.
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
  {
    canonical: 'CAPITAL_ONE',
    aliases: [
      'CAP1', 'CAP 1', 'CAPITAL ONE BANK', 'CAP ONE', 'CAPITALONE', 'CAPITAL ONE NA',
      'CAPITAL ONE BANK USA', 'CAPITAL ONE BANK USA NA', 'CAPITAL ONE AUTO', 'CAP ONE AUTO',
      'CAPITAL ONE RETAIL', 'CONVERGENT CAPITAL ONE',
    ],
    soldTo: ['MIDLAND_CREDIT', 'PORTFOLIO_RECOVERY', 'LVNV', 'CAVALRY'],
    portfolioIndicator: true,
  },
  {
    canonical: 'CHASE',
    aliases: [
      'JPMC', 'JPMCB', 'JPMORGAN', 'JP MORGAN', 'JP MORGAN CHASE', 'JPMORGAN CHASE',
      'CHASE BANK', 'CHASE CARD', 'CHASE CARD SERVICES', 'JPMCB CARD SERVICES',
      'CHASE BANK USA', 'CHASE AUTO',
    ],
    soldTo: ['RESURGENT', 'LVNV', 'PORTFOLIO_RECOVERY', 'MIDLAND_CREDIT'],
    portfolioIndicator: true,
  },
  {
    canonical: 'CITI',
    aliases: [
      'CITIBANK', 'CITI BANK', 'CITICARDS', 'CITICORP', 'CBNA', 'CITIBANK NA',
      'CITI CARDS', 'CITIBANK CREDIT CARD', 'CITI RETAIL SERVICES',
    ],
    soldTo: ['PORTFOLIO_RECOVERY', 'MIDLAND_CREDIT', 'LVNV'],
    portfolioIndicator: true,
  },
  {
    canonical: 'AMEX',
    aliases: [
      'AMERICAN EXPRESS', 'AMEX BANK', 'AMERICAN EXPRESS CENTURION',
      'AMERICAN EXPRESS NATIONAL BANK', 'AMEX CENTURION', 'AEBNB',
    ],
  },
  {
    canonical: 'DISCOVER',
    aliases: [
      'DISCOVER BANK', 'DISCOVER FIN', 'DISCOVER FINANCIAL', 'DISCOVER CARD',
      'DFS', 'DISCOVERBANK',
    ],
  },
  {
    canonical: 'BANK_OF_AMERICA',
    aliases: [
      'BOA', 'BOFA', 'B OF A', 'BANK OF AMERICA NA', 'BANKAMERICA',
      'BANK OF AMERICA CARD', 'FIA CARD SERVICES', 'FIA',
    ],
    soldTo: ['MIDLAND_CREDIT', 'PORTFOLIO_RECOVERY'],
    portfolioIndicator: true,
  },
  {
    canonical: 'WELLS_FARGO',
    aliases: [
      'WELLS', 'WF BANK', 'WELLS FARGO BANK', 'WACHOVIA', 'WELLS FARGO CARD',
      'WELLS FARGO NA', 'WFNNB',
    ],
  },
  {
    canonical: 'SYNCHRONY',
    aliases: [
      'SYNCHRONY BANK', 'SYNCB', 'GE CAPITAL RETAIL', 'GECRB', 'SYNCHRONYBANK',
      // Common store-branded Synchrony programs
      'PAYPAL CREDIT', 'SYNCB PAYPAL', 'SYNCB / PAYPAL', 'SYNCB/PAYPAL',
      'AMAZON STORE CARD', 'SYNCB AMAZON', 'CARECREDIT', 'SYNCB CARECREDIT',
      'WALMART MC', 'SYNCB WALMART', 'GAP CARD', 'OLD NAVY CARD', 'ATHLETA CARD',
      'SAMS CLUB', 'TJX REWARDS', 'LOWES CARD', 'HOME DEPOT CONSUMER',
      'CHEVRON TEXACO', 'BELK REWARDS', 'DILLARDS', 'JCPENNEY CREDIT',
    ],
  },
  {
    canonical: 'TD_BANK',
    aliases: ['TD BANK NA', 'TD CONSUMER', 'TORONTO DOMINION', 'TD BANK USA'],
  },
  {
    canonical: 'US_BANK',
    aliases: ['U.S. BANK', 'USBANK', 'US BANK NA', 'US BANK CARD', 'ELAN FINANCIAL'],
  },
  {
    canonical: 'NAVY_FEDERAL',
    aliases: ['NFCU', 'NAVY FEDERAL CREDIT UNION', 'NAVY FEDERAL'],
  },
  {
    canonical: 'PORTFOLIO_RECOVERY',
    aliases: [
      'PRA', 'PORTFOLIO RECOVERY ASSOC', 'PORTFOLIO RECOV',
      'PORTFOLIO RECOVERY ASSOCIATES', 'PORTFOLIO RECOVERY ASSOCIATES LLC',
      'PRA RECEIVABLES', 'PRA GROUP',
    ],
    isCollectionAgency: true,
  },
  {
    canonical: 'MIDLAND_CREDIT',
    aliases: [
      'MCM', 'MIDLAND FUNDING', 'MIDLAND CREDIT MGMT', 'MIDLAND CREDIT MANAGEMENT',
      'MIDLAND FUNDING LLC', 'MIDLAND CREDIT MANAGEMENT INC', 'MIDLAND FUNDING NCC',
      'ENCORE CAPITAL', 'ENCORE',
    ],
    isCollectionAgency: true,
  },
  {
    canonical: 'LVNV',
    aliases: [
      'LVNV FUNDING', 'LVNV FUNDING LLC', 'RESURGENT', 'RESURGENT CAPITAL',
      'RESURGENT CAPITAL SERVICES', 'SHERMAN ACQUISITION', 'SHERMAN FINANCIAL',
    ],
    isCollectionAgency: true,
  },
  {
    canonical: 'JEFFERSON_CAPITAL',
    aliases: ['JCAP', 'JEFFERSON CAPITAL SYSTEMS', 'JEFFERSON CAPITAL', 'JCS'],
    isCollectionAgency: true,
  },
  {
    canonical: 'CAVALRY',
    aliases: [
      'CAVALRY SPV', 'CAVALRY PORTFOLIO', 'CAVALRY INVESTMENTS',
      'CAVALRY SPV I', 'CAVALRY PORTFOLIO SERVICES',
    ],
    isCollectionAgency: true,
  },
  {
    canonical: 'ASSET_ACCEPTANCE',
    aliases: ['ASSET ACCEPTANCE LLC', 'ASSET ACCEPTANCE CAPITAL', 'ASSET ACCEPTANCE'],
    isCollectionAgency: true,
  },
  {
    canonical: 'IC_SYSTEM',
    aliases: ['IC SYSTEM', 'I.C. SYSTEM', 'IC SYSTEM INC'],
    isCollectionAgency: true,
  },
  {
    canonical: 'CONVERGENT',
    aliases: ['CONVERGENT OUTSOURCING', 'CONVERGENT HEALTHCARE', 'CONVERGENT'],
    isCollectionAgency: true,
  },
  {
    canonical: 'AFNI',
    aliases: ['AFNI INC', 'AFNI COLLECTIONS', 'AFNI'],
    isCollectionAgency: true,
  },
  {
    canonical: 'CREDIT_ONE',
    aliases: ['CREDIT ONE BANK', 'CREDITONE', 'CREDIT ONE BANK NA'],
  },
  {
    canonical: 'FINGERHUT',
    aliases: ['FINGERHUT DIRECT', 'BLST', 'BLUELINE', 'BLST FINANCIAL'],
  },
  {
    canonical: 'TOYOTA',
    aliases: ['TOYOTA MOTOR CREDIT', 'TMCC', 'TOYOTA FINANCIAL', 'TOYOTA FINANCIAL SERVICES'],
  },
  {
    canonical: 'GM_FINANCIAL',
    aliases: ['GMAC', 'GM FINANCIAL', 'ALLY FINANCIAL', 'ALLY BANK', 'ALLY'],
  },
  {
    canonical: 'SALLIE_MAE',
    aliases: ['SLM', 'NAVIENT', 'SALLIEMAE', 'SALLIE MAE'],
  },
  {
    canonical: 'NELNET',
    aliases: ['NELNET INC', 'NELNET STUDENT'],
  },
  {
    canonical: 'GREAT_LAKES',
    aliases: ['GREAT LAKES EDUCATIONAL', 'NELNET GREAT LAKES'],
  },
  {
    canonical: 'MOHELA',
    aliases: ['MOHELA STUDENT', 'HIGHER EDUCATION LOAN'],
  },
  {
    canonical: 'BARCLAYS',
    aliases: ['BARCLAYS BANK', 'BARCLAYCARD', 'BARCLAYS BANK DELAWARE'],
  },
  {
    canonical: 'PNC',
    aliases: ['PNC BANK', 'PNC BANK NA', 'NATIONAL CITY'],
  },
  {
    canonical: 'TRUIST',
    aliases: ['TRUIST BANK', 'BBANDT', 'BB&T', 'SUNTRUST'],
  },
  {
    canonical: 'HSBC',
    aliases: ['HSBC BANK', 'HSBC BANK USA', 'HSBC CARD'],
  },
  {
    canonical: 'KOHLS',
    aliases: ['KOHLS DEPARTMENT STORE', 'CAPITAL ONE KOHLS', 'KOHLS CHARGE'],
  },
  {
    canonical: 'MACYS',
    aliases: ['MACYS', "MACY'S", 'MDSN', 'DEPARTMENT STORES NATIONAL'],
  },
  {
    canonical: 'COMENITY',
    aliases: [
      'COMENITY BANK', 'COMENITY CAPITAL', 'BREAD FINANCIAL', 'ADS',
      'WORLD FINANCIAL NETWORK', 'WFNNB COMENITY',
    ],
  },
  {
    canonical: 'GATEWAY',
    aliases: ['GATEWAY FINANCIAL', 'GATEWAY RECOVERY', 'GATEWAY ARC'],
    isCollectionAgency: true,
  },
  {
    canonical: 'RADIUS_GLOBAL',
    aliases: ['RADIUS GLOBAL SOLUTIONS', 'RGS', 'RADIUS'],
    isCollectionAgency: true,
  },
  {
    canonical: 'TRANSWORLD',
    aliases: ['TRANSWORLD SYSTEMS', 'TSI', 'TRANSWORLD SYSTEMS INC'],
    isCollectionAgency: true,
  },
  {
    canonical: 'FINANCIAL_RECOVERY',
    aliases: ['FINANCIAL RECOVERY SERVICES', 'FRS'],
    isCollectionAgency: true,
  },
];

/** Tokens too generic to allow substring alias equality */
const WEAK_ALIAS_TOKENS = new Set([
  'BANK', 'CREDIT', 'CARD', 'FINANCIAL', 'SERVICES', 'SERVICE', 'NATIONAL',
  'AMERICAN', 'UNITED', 'FIRST', 'CAPITAL', 'FUNDING', 'ACCOUNT',
]);

function normalizeKey(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/\bCAP\s*ONE\b/g, 'CAPITAL ONE')
    .replace(/\bBOFA\b/g, 'BANK OF AMERICA')
    .replace(/\bJPMCB\b/g, 'JPMORGAN CHASE')
    .replace(/\bSYNCB\b/g, 'SYNCHRONY')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\b(LLC|INC|CORP|CORPORATION|NA|N A|BANK|CREDIT|UNION|ASSOC|ASSOCIATES|MGMT|MANAGEMENT|FINANCIAL|SERVICES|SERVICE|CO|COMPANY|USA|FSB|THE)\b/g, ' ')
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

function isWeakKey(key: string): boolean {
  if (!key || key.length < 4) return true;
  const words = key.split(' ').filter(Boolean);
  return words.every((w) => WEAK_ALIAS_TOKENS.has(w) || w.length <= 2);
}

export function resolveCreditorCanonical(name: string): string | null {
  const key = normalizeKey(name);
  if (!key || isWeakKey(key)) return null;
  const direct = ALIAS_INDEX.get(key);
  if (direct) return direct.canonical;
  // Prefix / contains fallback for truncated report names (min length guards false hits)
  for (const [aliasKey, family] of ALIAS_INDEX) {
    if (aliasKey.length < 5 || isWeakKey(aliasKey)) continue;
    if (key.includes(aliasKey) || (key.length >= 5 && aliasKey.includes(key))) {
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
  if (!na || !nb || isWeakKey(na) || isWeakKey(nb)) return false;
  if (na === nb) return true;
  // Require substantial overlap — avoid single-token false friends like AMERICAN*
  const minLen = 6;
  if (na.length >= minLen && nb.length >= minLen && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
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
