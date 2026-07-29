/**
 * furnisherChainOfCustodyService.ts — Debt Buyer Chain-of-Custody Attack System (v5.1.0)
 *
 * Analyzes whether a creditor is a debt buyer and builds targeted dispute language
 * attacking their legal standing to report. Debt buyers frequently cannot produce
 * the original signed agreement, complete assignment chain, or full payment history —
 * making their accounts highly vulnerable to FCRA §623(a)(8) challenges.
 *
 * Legal basis: FCRA §623(a)(8) — Furnisher duty to investigate direct disputes.
 *              FDCPA §1692g — Debt validation rights.
 */

import type { NegativeItem } from '../types';

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type FurnisherType =
  | 'ORIGINAL_CREDITOR'
  | 'DEBT_BUYER'
  | 'COLLECTION_AGENCY'
  | 'MEDICAL_PROVIDER'
  | 'UTILITY'
  | 'GOVERNMENT';

export interface ChainOfCustodyAnalysis {
  furnisherType: FurnisherType;
  isDebtBuyer: boolean;
  chainVulnerabilities: string[];
  requiredDocuments: string[];
  attackStrategy: string;
  estimatedDeletionProbability: number;
  debtBuyerName?: string;
}

// ─── KNOWN DEBT BUYER DATABASE ────────────────────────────────────────────────

const KNOWN_DEBT_BUYERS = new Set([
  'MIDLAND CREDIT MANAGEMENT', 'MCM', 'MIDLAND FUNDING',
  'PORTFOLIO RECOVERY', 'PORTFOLIO RECOVERY ASSOCIATES', 'PRA',
  'LVNV FUNDING', 'RESURGENT CAPITAL', 'RESURGENT',
  'CAVALRY SPV', 'CAVALRY PORTFOLIO', 'CAVALRY INVESTMENTS',
  'ASSET ACCEPTANCE', 'ASSET ACCEPTANCE CAPITAL',
  'ENCORE CAPITAL', 'ENCORE CAPITAL GROUP',
  'ASSET RECOVERY SOLUTIONS', 'ARS',
  'UNIFIN', 'UNITED COLLECTION BUREAU', 'UCB',
  'CREDIT CORPS SOLUTIONS',
  'FIRST NATIONAL COLLECTION BUREAU', 'FNCB',
  'NATIONAL CREDIT ADJUSTERS', 'NCA',
  'CONVERGENT OUTSOURCING', 'CONVERGENT',
  'JEFFERSON CAPITAL', 'JEFFERSON CAPITAL SYSTEMS',
  'CURO DEBT', 'CURO',
  'AMERICAN INFOSOURCE', 'ONEMAIN FINANCIAL',
  'FINGERHUT', 'BLUESTEM BRANDS',
  'AMSHER COLLECTION', 'AMSHER',
  'RADIUS GLOBAL SOLUTIONS', 'RADIUS GLOBAL',
  'PHOENIX FINANCIAL SERVICES',
  'CREDIT MANAGEMENT LP', 'CREDIT MANAGEMENT',
  'ENHANCED RECOVERY COMPANY', 'ERC',
  'IC SYSTEM', 'IC SYSTEMS',
  'TRANSWORLD SYSTEMS', 'TSI',
  'COLLECTION BUREAU OF AMERICA', 'CBA',
  'PIONEER CREDIT RECOVERY',
  'GC SERVICES',
  'CONTINENTAL SERVICE GROUP',
  'COLLECTION SYSTEMS INC',
]);

// Patterns that suggest a debt buyer rather than original creditor
const DEBT_BUYER_PATTERNS = [
  /funding\s*(llc|inc|corp)?$/i,
  /capital\s*(management|group|one|solutions)?(\s*(llc|inc|corp))?$/i,
  /recovery\s*(associates|services|solutions)?(\s*(llc|inc|corp))?$/i,
  /receivables\s*(management|solutions)?/i,
  /collection(s)?\s*(services|bureau|group|systems)?(\s*(llc|inc|corp))?$/i,
  /debt\s*(management|recovery|solutions)/i,
  /credit\s*(management|recovery|corps|adjusters)/i,
  /asset\s*(management|recovery|acceptance)/i,
  /financial\s*recovery/i,
  /portfolio\s*(recovery|management|services)/i,
];

// ─── MAIN ANALYSIS FUNCTION ───────────────────────────────────────────────────

/**
 * Analyze a negative item's creditor to determine if they are a debt buyer
 * and build targeted chain-of-custody attack strategy.
 */
export function analyzeChainOfCustody(item: NegativeItem): ChainOfCustodyAnalysis {
  const creditorUpper = item.creditorName.toUpperCase().trim();
  const creditorNorm = creditorUpper.replace(/[.,]/g, '').trim();

  // Check against known debt buyer database
  const isKnownDebtBuyer = [...KNOWN_DEBT_BUYERS].some(buyer =>
    creditorNorm.includes(buyer) || buyer.includes(creditorNorm.slice(0, 12))
  );

  // Check against structural patterns
  const matchesPattern = DEBT_BUYER_PATTERNS.some(pattern =>
    pattern.test(item.creditorName)
  );

  const isDebtBuyer = isKnownDebtBuyer || matchesPattern;

  if (isDebtBuyer) {
    return {
      furnisherType: 'DEBT_BUYER',
      isDebtBuyer: true,
      debtBuyerName: item.creditorName,
      chainVulnerabilities: [
        'Debt buyer purchased account without original signed agreement in most cases',
        'No privity of contract between consumer and debt buyer',
        'Cannot produce original account opening documentation',
        'Cannot verify original terms, interest rates, or payment history from account inception',
        'Chain of assignment documentation frequently incomplete or contains gaps',
        'Bill of sale typically does not include individual account documentation',
      ],
      requiredDocuments: [
        'Complete and unbroken chain of assignment from original creditor through all intermediate parties',
        'Bill of sale for each assignment in the chain',
        'Original signed credit agreement bearing consumer signature',
        'Complete payment history from account opening through date of assignment',
        'Original account number as assigned by primary creditor',
        'Proof of legal authority to collect/report in consumer\'s state of residence',
      ],
      attackStrategy: `
DEBT BUYER CHAIN-OF-CUSTODY ATTACK (HIGH PRIORITY):
This account is owned by a third-party debt buyer, not the original creditor.
Letter must:
1. Demand complete chain of assignment documentation per FCRA §623(a)(8)
2. Demand the original signed credit agreement bearing consumer signature
3. Challenge legal standing to report — no privity of contract with consumer
4. Note that debt buyers frequently cannot produce required documentation
5. Reference: failure to produce documentation requires immediate deletion
6. Cite: FDCPA §1692g (debt validation) + FCRA §623(a)(2) + FCRA §623(a)(8)
      `.trim(),
      estimatedDeletionProbability: 68,
    };
  }

  // Check if it's a collection agency (not original creditor)
  const isCollectionAgency =
    creditorNorm.includes('COLLECTION') ||
    creditorNorm.includes('COLLECTIONS') ||
    (item.originalCreditor != null && item.originalCreditor !== item.creditorName);

  if (isCollectionAgency) {
    return {
      furnisherType: 'COLLECTION_AGENCY',
      isDebtBuyer: false,
      chainVulnerabilities: [
        'Collection agency operating on behalf of original creditor — may have limited documentation',
        'Must prove they have authority to collect and report on behalf of original creditor',
        'Must conduct reasonable investigation under FCRA §623(a)(8)',
      ],
      requiredDocuments: [
        'Written authorization to collect/report on behalf of original creditor',
        'Original account documentation from the creditor',
        'Complete payment history',
      ],
      attackStrategy: 'Standard FCRA §611 accuracy challenge + §623 furnisher direct dispute + demand for collection authorization',
      estimatedDeletionProbability: 48,
    };
  }

  // Original creditor
  return {
    furnisherType: 'ORIGINAL_CREDITOR',
    isDebtBuyer: false,
    chainVulnerabilities: [
      'Must produce specific Metro 2 reporting documentation',
      'Must prove investigation was conducted (not merely a database lookup)',
      'Must verify reporting against CDIA Metro 2 standards',
    ],
    requiredDocuments: [
      'Account statement showing complete payment history',
      'Original signed credit agreement',
      'Proof of address on file at time of account opening',
    ],
    attackStrategy: 'Standard FCRA §611 accuracy challenge + Metro 2 compliance challenge',
    estimatedDeletionProbability: 38,
  };
}

// ─── PROMPT SECTION BUILDER ───────────────────────────────────────────────────

/**
 * Builds a chain-of-custody attack section for injection into an AI letter prompt.
 * Returns empty string if creditor is an original creditor (no attack applicable).
 */
export function buildChainOfCustodySection(analysis: ChainOfCustodyAnalysis): string {
  if (!analysis.isDebtBuyer) return '';

  return `
## DEBT BUYER CHAIN-OF-CUSTODY ATTACK (HIGH PRIORITY — USE THIS):

This creditor is a THIRD-PARTY DEBT BUYER. They purchased this alleged debt and likely lack:
- Original signed agreement bearing consumer signature
- Complete and unbroken chain of assignment documentation
- Full payment history from account inception

REQUIRED DISPUTE LANGUAGE (include this or a paraphrase):
"As this account appears to be owned by a third-party debt buyer rather than the original creditor, I hereby demand production of: (1) a complete and unbroken chain of assignment from the original creditor through all intermediate parties to the current reporting entity; (2) the original signed credit agreement bearing my signature; and (3) complete payment history from account inception. Pursuant to FCRA §623(a)(8) and FDCPA §1692g, failure to produce these documents confirms this reporting entity lacks adequate legal standing to report this account and it must be immediately deleted from all consumer reporting agency files."

Estimated deletion probability if this argument is properly cited: ${analysis.estimatedDeletionProbability}%
  `.trim();
}

/**
 * Build a direct furnisher dispute letter prompt using the chain-of-custody analysis.
 */
export function buildFurnisherDirectDisputePrompt(
  item: NegativeItem,
  analysis: ChainOfCustodyAnalysis,
  personalInfo: { firstName: string; lastName: string; address: string; city: string; state: string; zip: string }
): string {
  const requiredDocsText = analysis.requiredDocuments
    .map((doc, i) => `${i + 1}. ${doc}`)
    .join('\n');

  return `
Write a formal direct dispute letter to a furnisher under FCRA §623(a)(8).

CONSUMER: ${personalInfo.firstName} ${personalInfo.lastName}
ADDRESS: ${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}
FURNISHER TYPE: ${analysis.furnisherType}
CREDITOR: ${item.creditorName}
ACCOUNT: ${item.accountNumber ? `ending ${item.accountNumber.slice(-4)}` : 'on file'}
BALANCE: $${item.balance ?? 0}
ISSUE: ${item.typeOfNegative}

DISPUTE STRATEGY: ${analysis.attackStrategy}

REQUIRED DOCUMENTATION DEMANDS (list all of these):
${requiredDocsText}

LEGAL BASIS:
- FCRA §623(a)(8): Direct dispute to furnisher
- FCRA §623(a)(2): Duty to correct inaccurate information  
- FDCPA §1692g: Debt validation rights (30-day window)
${analysis.isDebtBuyer ? '- FCRA §623(a)(1): Accuracy requirements for furnishers\n- Chain of assignment documentation required' : ''}

TONE: Formal, precise, legally grounded. Reference specific FCRA sections by number.
Length: 350-450 words. Demand a written response within 30 days.
Include a specific statement that failure to provide documentation will require deletion.
  `.trim();
}
