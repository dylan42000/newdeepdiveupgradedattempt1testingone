/**
 * METRO 2 COMPLIANCE ANALYZER — UPGRADED PARSER MODULE
 * 
 * Purpose: 
 * - Extract Metro 2 relevant fields accurately from raw credit report text.
 * - Compare the SAME negative account across Equifax / Experian / TransUnion reports.
 * - Flag discrepancies that violate Metro 2 formatting / reporting rules.
 * - Provide merged "golden" account view with reconciled fields + compliance score.
 * 
 * Used by parser index to augment NegativeItem output and auto-merge.
 */

import type { NegativeItem } from '../../types';

export interface Metro2Field {
  field: string;
  value: string | null;
  source: string;
  confidence: number;
}

export interface Metro2AccountSnapshot {
  creditorName: string;
  accountNumber: string;
  accountStatusCode: string | null;   // e.g. '05', '93', '13', '71' etc.
  paymentRating: string | null;       // e.g. '1'–'9', 'G', 'L' etc.
  dateOfFirstDelinquency: string | null;
  dateOpened: string | null;
  balance: number | null;
  originalBalance: number | null;
  currentBalance: number | null;
  amountPastDue: number | null;
  dateReported: string | null;
  ecoaCode: string | null;            // Equifax/ECOA
  specialCommentCode: string | null;
  complianceFlags: string[];
  rawExtracted: Record<string, any>;
}

export interface CrossBureauMetro2Comparison {
  accountKey: string;                 // normalized creditor + last4
  bureaus: string[];
  snapshots: Record<string, Metro2AccountSnapshot>;
  merged: Metro2AccountSnapshot;
  complianceScore: number;            // 0-100
  violations: Array<{
    field: string;
    description: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    bureausInvolved: string[];
  }>;
  recommendedAction: string;
  mergeConfidence: number;
}

export interface Metro2ParseEnhancement {
  metro2Fields: Record<string, any>;
  complianceScore: number;
  violations: CrossBureauMetro2Comparison['violations'];
  crossBureauComparisons: CrossBureauMetro2Comparison[];
}

// Metro 2 Account Status Codes (Field 17B) — common negative ones
const METRO2_STATUS_CODES: Record<string, string> = {
  '05': 'Transferred/Sold',
  '11': 'Current',
  '13': 'Closed/Paid',
  '61': 'Paid in Full',
  '62': 'Paid in Full - was late',
  '63': 'Paid in Full - was charge off',
  '64': 'Paid in Full - was collection',
  '71': '30 days past due',
  '78': '120 days past due',
  '80': 'In Bankruptcy Chapter 7',
  '82': 'In Bankruptcy Chapter 13',
  '83': 'Included in Bankruptcy',
  '84': 'In Bankruptcy',
  '93': 'Charge Off',
  '97': 'Collection',
  'DA': 'Delinquent',
  'DF': 'Default',
};

// Payment rating codes
const METRO2_PAYMENT_RATINGS = ['1','2','3','4','5','6','7','8','9','G','L','0'];

// Patterns for Metro 2 style data (works on ACR + direct reports)
const METRO2_PATTERNS = {
  accountStatus: [
    /account\s*status[:\s]*([0-9]{2})/i,
    /status\s*code[:\s]*([0-9A-Z]{2})/i,
    /\b(93|97|05|71|78|80|82|83|13|61|62)\b/i,
    /narrative\s*code[s]?\s*[:\s]*([0-9]{2,3})/i,
  ],
  paymentRating: [
    /pay\s*status[:\s>]*([0-9GL])/i,
    /payment\s*rating[:\s]*([0-9GL])/i,
    /\b([0-9GL])\s*(?:rating|pay\s*status)/i,
  ],
  amountPastDue: [
    /past\s*due[:\s$]*([0-9,]+(?:\.\d{2})?)/i,
    /amount\s*past\s*due[:\s$]*([0-9,]+)/i,
  ],
  balance: [
    /balance[:\s$]*([0-9,]+(?:\.\d{2})?)/i,
    /current\s*balance[:\s$]*([0-9,]+)/i,
  ],
  ecoa: [
    /ecoa[:\s]*([A-Z0-9])/i,
    /responsibility[:\s]*([A-Z])/i,
  ],
  specialComment: [
    /special\s*comment[:\s]*([A-Z0-9]{2})/i,
    /narrative[:\s]*([A-Z0-9]{2,4})/i,
  ],
};

export function extractMetro2Fields(blockText: string, bureau: string): Partial<Metro2AccountSnapshot> {
  const upper = blockText.toUpperCase();
  const snapshot: Partial<Metro2AccountSnapshot> = {
    accountStatusCode: null,
    paymentRating: null,
    amountPastDue: null,
    balance: null,
    originalBalance: null,
    currentBalance: null,
    ecoaCode: null,
    specialCommentCode: null,
    complianceFlags: [],
    rawExtracted: {},
  };

  // Account Status Code (priority)
  for (const p of METRO2_PATTERNS.accountStatus) {
    const m = blockText.match(p);
    if (m && m[1]) {
      const code = m[1].toUpperCase().padStart(2, '0');
      if (METRO2_STATUS_CODES[code] || /^[0-9]{2}$/.test(code)) {
        snapshot.accountStatusCode = code;
        snapshot.rawExtracted.accountStatus = code;
        break;
      }
    }
  }

  // Payment Rating
  for (const p of METRO2_PATTERNS.paymentRating) {
    const m = blockText.match(p);
    if (m && m[1] && METRO2_PAYMENT_RATINGS.includes(m[1].toUpperCase())) {
      snapshot.paymentRating = m[1].toUpperCase();
      break;
    }
  }

  // Amounts
  const pastDueMatch = blockText.match(METRO2_PATTERNS.amountPastDue[0]) || blockText.match(METRO2_PATTERNS.amountPastDue[1]);
  if (pastDueMatch) {
    snapshot.amountPastDue = parseFloat(pastDueMatch[1].replace(/,/g, '')) || null;
  }

  const balMatch = blockText.match(METRO2_PATTERNS.balance[0]) || blockText.match(METRO2_PATTERNS.balance[1]);
  if (balMatch) {
    const val = parseFloat(balMatch[1].replace(/,/g, '')) || null;
    snapshot.balance = val;
    snapshot.currentBalance = val;
  }

  // ECOA
  for (const p of METRO2_PATTERNS.ecoa) {
    const m = blockText.match(p);
    if (m && m[1]) {
      snapshot.ecoaCode = m[1].toUpperCase();
      break;
    }
  }

  // Special comment / narrative
  for (const p of METRO2_PATTERNS.specialComment) {
    const m = blockText.match(p);
    if (m && m[1]) {
      snapshot.specialCommentCode = m[1].toUpperCase();
      break;
    }
  }

  // Compliance heuristics
  const flags: string[] = [];
  if (snapshot.accountStatusCode === '93' && !/charge.?off/i.test(upper)) {
    flags.push('STATUS_93_WITHOUT_CHARGEOFF_KEYWORD');
  }
  if (snapshot.paymentRating && ['5','6','7','8','9'].includes(snapshot.paymentRating) && snapshot.accountStatusCode === '11') {
    flags.push('PAY_RATING_CONFLICT_WITH_CURRENT_STATUS');
  }
  if (snapshot.amountPastDue && snapshot.amountPastDue > 0 && snapshot.accountStatusCode === '13') {
    flags.push('PAST_DUE_ON_CLOSED_ACCOUNT');
  }

  snapshot.complianceFlags = flags;
  return snapshot;
}

export function normalizeAccountKey(creditor: string, accountNumber: string): string {
  const normCred = creditor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
  const last4 = (accountNumber || '').replace(/[^0-9]/g, '').slice(-4).padStart(4, '0');
  return `${normCred}:${last4}`;
}

export function compareSnapshotsForMetro2(
  snapshots: Record<string, Metro2AccountSnapshot>
): CrossBureauMetro2Comparison {
  const bureaus = Object.keys(snapshots);
  const first = Object.values(snapshots)[0];
  const accountKey = normalizeAccountKey(first.creditorName || 'UNKNOWN', first.accountNumber || '');

  const violations: CrossBureauMetro2Comparison['violations'] = [];
  let totalScore = 100;

  // Compare critical fields across bureaus
  const fieldsToCompare: (keyof Metro2AccountSnapshot)[] = [
    'accountStatusCode', 'paymentRating', 'dateOfFirstDelinquency', 'balance', 'amountPastDue'
  ];

  for (const field of fieldsToCompare) {
    const values = bureaus.map(b => snapshots[b][field]).filter(v => v != null);
    if (values.length >= 2) {
      const unique = new Set(values.map(v => JSON.stringify(v)));
      if (unique.size > 1) {
        const desc = `${field} differs across bureaus: ${[...unique].join(' vs ')}`;
        const sev: 'HIGH' | 'MEDIUM' | 'LOW' = field.includes('Status') || field.includes('Delinquency') ? 'HIGH' : 'MEDIUM';
        violations.push({
          field: String(field),
          description: desc,
          severity: sev,
          bureausInvolved: bureaus,
        });
        totalScore -= (sev === 'HIGH' ? 18 : 9);
      }
    }
  }

  // Check for Metro2 status-code vs keyword mismatch
  for (const b of bureaus) {
    const snap = snapshots[b];
    if (snap.accountStatusCode === '93' && !/charge|off|loss/i.test((snap.rawExtracted as any).status || '')) {
      violations.push({
        field: 'accountStatusCode',
        description: `Bureau ${b} reports status 93 (Charge-Off) without explicit charge-off language`,
        severity: 'MEDIUM',
        bureausInvolved: [b],
      });
      totalScore -= 7;
    }
  }

  const complianceScore = Math.max(0, Math.min(100, Math.round(totalScore)));

  // Build merged best-of snapshot
  const merged: Metro2AccountSnapshot = {
    creditorName: first.creditorName,
    accountNumber: first.accountNumber,
    accountStatusCode: first.accountStatusCode,
    paymentRating: first.paymentRating,
    dateOfFirstDelinquency: first.dateOfFirstDelinquency,
    dateOpened: first.dateOpened,
    balance: first.balance,
    originalBalance: first.originalBalance,
    currentBalance: first.currentBalance,
    amountPastDue: first.amountPastDue,
    dateReported: first.dateReported,
    ecoaCode: first.ecoaCode,
    specialCommentCode: first.specialCommentCode,
    complianceFlags: [...new Set(bureaus.flatMap(b => snapshots[b].complianceFlags || []))],
    rawExtracted: {},
  };

  // Prefer explicit high-confidence values
  for (const b of bureaus) {
    const s = snapshots[b];
    if (s.accountStatusCode && (!merged.accountStatusCode || s.accountStatusCode === '93')) merged.accountStatusCode = s.accountStatusCode;
    if (s.dateOfFirstDelinquency) merged.dateOfFirstDelinquency = s.dateOfFirstDelinquency;
    if (s.balance && (merged.balance == null || s.balance > (merged.balance || 0))) merged.balance = s.balance;
  }

  const mergeConfidence = Math.max(0.6, (100 - violations.length * 6) / 100);

  return {
    accountKey,
    bureaus,
    snapshots,
    merged,
    complianceScore,
    violations,
    recommendedAction: violations.length > 2 ? 'MANUAL_REVIEW_FOR_METRO2' : violations.length > 0 ? 'VERIFY_REPORTING' : 'COMPLIANT',
    mergeConfidence,
  };
}

/**
 * Main entry: Enhance a list of parsed negative items with Metro 2 data + cross-bureau compliance.
 * Called from index.ts after main parsing + merging.
 */
export function enhanceWithMetro2Compliance(
  items: NegativeItem[],
  rawFullText: string
): { enhancedItems: NegativeItem[]; metro2Report: Metro2ParseEnhancement } {
  const crossComparisons: CrossBureauMetro2Comparison[] = [];
  const keyToItems: Record<string, NegativeItem[]> = {};

  // Group items by normalized account key across bureaus
  items.forEach(item => {
    const key = normalizeAccountKey(item.creditorName, item.accountNumber || item.fullAccountNumber || '');
    if (!keyToItems[key]) keyToItems[key] = [];
    keyToItems[key].push(item);
  });

  const enhancedItems = items.map(item => {
    const bureau = (item.creditBureau && item.creditBureau[0]) || 'Unknown';
    // Reconstruct block-like text from known fields + rawSnippet for pattern matching
    const syntheticBlock = [
      item.creditorName,
      item.accountNumber,
      item.status,
      item.typeOfNegative,
      item.additionalInfo,
      item.rawSnippet || '',
      `Balance: ${item.balance}`,
      `DOFD: ${item.dateOfFirstDelinquency}`,
    ].filter(Boolean).join('\n');

    const metroSnapshot = extractMetro2Fields(syntheticBlock + '\n' + rawFullText.slice(0, 1800), bureau);

    // Attach Metro2 fields onto item
    const enhanced: NegativeItem = {
      ...item,
      accountStatus: metroSnapshot.accountStatusCode || item.accountStatus || null,
      // attach extra compliance metadata via notes or extended (we use additionalInfo + parseConfidence)
    };

    // Store raw metro2 for later use
    (enhanced as any).metro2Snapshot = metroSnapshot;

    return enhanced;
  });

  // Run cross-bureau comparisons for groups that appear on 2+ bureaus
  Object.entries(keyToItems).forEach(([key, group]) => {
    if (group.length < 2) return;

    const snapshots: Record<string, Metro2AccountSnapshot> = {};
    group.forEach(it => {
      const b = (it.creditBureau?.[0] || 'Unknown');
      snapshots[b] = (it as any).metro2Snapshot || extractMetro2Fields(it.additionalInfo + ' ' + (it.status || ''), b);
    });

    const comparison = compareSnapshotsForMetro2(snapshots);
    crossComparisons.push(comparison);

    // Attach compliance data to all items in this group
    group.forEach(it => {
      const idx = enhancedItems.findIndex(e => e.id === it.id);
      if (idx >= 0) {
        enhancedItems[idx].metro2Violations = comparison.violations;
        if (!enhancedItems[idx].parseConfidence) enhancedItems[idx].parseConfidence = comparison.mergeConfidence;
      }
    });
  });

  const overallCompliance = crossComparisons.length
    ? Math.round(crossComparisons.reduce((s, c) => s + c.complianceScore, 0) / crossComparisons.length)
    : 95;

  return {
    enhancedItems,
    metro2Report: {
      metro2Fields: {},
      complianceScore: overallCompliance,
      violations: crossComparisons.flatMap(c => c.violations),
      crossBureauComparisons: crossComparisons,
    },
  };
}

export function getMetro2ComplianceSummary(items: NegativeItem[]): string {
  const withViolations = items.filter(i => (i.metro2Violations?.length || 0) > 0);
  if (withViolations.length === 0) return 'All accounts appear Metro 2 compliant across bureaus.';
  return `${withViolations.length} accounts have Metro 2 reporting discrepancies requiring review.`;
}
