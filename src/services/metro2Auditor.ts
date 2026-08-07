/**
 * Metro 2 Compliance Auditor
 * Scans credit report items for Metro 2 format violations.
 * Metro 2 is the standard credit reporting format used by all major CRAs.
 * Violations are powerful dispute weapons because furnishers are legally
 * required to comply with the Metro 2 standard.
 */

import { NegativeItem } from '../types';
import { routeAIRequest, type AIMessage } from './aiRouter';

// ── Metro 2 Violation Types ────────────────────────────────────────────────────

export type Metro2ViolationType =
  | 'BALANCE_NOT_ZERO_AFTER_CHARGE_OFF'
  | 'DOFD_INCONSISTENT_ACROSS_BUREAUS'
  | 'DOFD_BEYOND_7_YEARS'
  | 'PAYMENT_HISTORY_CONFLICTS_STATUS'
  | 'ACCOUNT_OPEN_AFTER_CHARGE_OFF'
  | 'BALANCE_EXCEEDS_CREDIT_LIMIT'
  | 'INVALID_ACCOUNT_STATUS_CODE'
  | 'MISSING_DATE_OF_FIRST_DELINQUENCY'
  | 'INCORRECT_COMPLIANCE_CONDITION_CODE'
  | 'RE_AGED_ACCOUNT'
  | 'MIXED_FILE_INDICATORS'
  | 'EDUCATIONAL_DEBT_MISCLASSIFIED'
  | 'MEDICAL_DEBT_MISCLASSIFIED'
  | 'DECEASED_INDICATOR_ERROR'
  | 'DISPUTE_FLAG_NOT_REMOVED'
  | 'ORIGINAL_CREDITOR_MISSING'
  | 'PORTFOLIO_TYPE_MISMATCH';

export interface Metro2Violation {
  id: string;
  type: Metro2ViolationType;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  field: string;
  description: string;
  legalBasis: string;
  disputeLanguage: string;
}

export interface Metro2AuditResult {
  itemId: string;
  violations: Metro2Violation[];
  auditedAt: Date;
  overallRisk: 'HIGH' | 'MEDIUM' | 'LOW' | 'CLEAN';
  aiEnhanced: boolean;
  summary: string;
}

// ── Static Metro 2 Audit (rule-based, no AI needed) ──────────────────────────

export function auditMetro2Static(item: NegativeItem): Metro2Violation[] {
  const violations: Metro2Violation[] = [];
  const now = new Date();

  // ── Violation 1: DOFD missing on derogatory accounts ──────────────────────
  const isDerogatory = ['collection', 'charge-off', 'chargeoff', 'charged off', 'late payment', 'delinquent']
    .some((t) => (item.typeOfNegative ?? '').toLowerCase().includes(t));

  if (isDerogatory && !item.originalDateOfDelinquency && !item.dateOfFirstDelinquency) {
    violations.push({
      id: `v_dofd_missing_${item.id}`,
      type: 'MISSING_DATE_OF_FIRST_DELINQUENCY',
      severity: 'HIGH',
      field: 'dateOfFirstDelinquency',
      description: 'Date of First Delinquency (DOFD) is not reported on a derogatory account.',
      legalBasis: 'FCRA §605(a)(4); Metro 2 Field 26 requirement',
      disputeLanguage: 'The Date of First Delinquency (DOFD), required by Metro 2 Field 26 and FCRA §605(a)(4), is absent from this tradeline. Without a DOFD, the credit bureau cannot calculate the 7-year reporting window, making the continued reporting of this item a violation of federal law.',
    });
  }

  // ── Violation 2: Balance not $0 after charge-off on sold debt ─────────────
  const isChargeOff = (item.typeOfNegative ?? '').toLowerCase().includes('charge') ||
                      (item.status ?? '').toLowerCase().includes('charge');
  const hasBalance = item.balance != null && item.balance > 0;
  const isSoldDebt = item.originalCreditor != null && item.originalCreditor !== item.creditorName;

  if (isChargeOff && hasBalance && isSoldDebt) {
    violations.push({
      id: `v_balance_chargeoff_${item.id}`,
      type: 'BALANCE_NOT_ZERO_AFTER_CHARGE_OFF',
      severity: 'HIGH',
      field: 'balance',
      description: `Balance shows $${item.balance} but account has been charged off and sold to ${item.creditorName}.`,
      legalBasis: 'Metro 2 Account Status Code 97 requires balance = $0 when charged off',
      disputeLanguage: `This account shows a balance of $${item.balance} despite being charged off and transferred to ${item.creditorName}. Per Metro 2 reporting standards, Account Status Code 97 (charged off) requires the balance field to reflect $0 on the original creditor\'s tradeline after the debt has been sold or transferred. Reporting a non-zero balance constitutes a Metro 2 compliance violation.`,
    });
  }

  // ── Violation 3: Account beyond 7-year FCRA reporting limit ───────────────
  const dofdStr = item.originalDateOfDelinquency || item.dateOfFirstDelinquency;
  if (dofdStr) {
    const dofd = new Date(dofdStr);
    const ageMs = now.getTime() - dofd.getTime();
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
    if (ageYears > 7.1) {
      violations.push({
        id: `v_7yr_${item.id}`,
        type: 'DOFD_BEYOND_7_YEARS',
        severity: 'HIGH',
        field: 'originalDateOfDelinquency',
        description: `Account DOFD is ${dofdStr} — ${ageYears.toFixed(1)} years ago. Exceeds 7-year FCRA limit.`,
        legalBasis: 'FCRA §605(a)(1) — 7-year reporting limit from DOFD',
        disputeLanguage: `The Date of First Delinquency for this account is ${dofdStr}, which is ${ageYears.toFixed(1)} years ago. Under FCRA §605(a)(1), negative information must be removed no later than 7 years from the DOFD. Continued reporting of this item is a violation of federal law and I demand its immediate deletion.`,
      });
    }
  }

  // ── Violation 4: Balance exceeds original credit limit ────────────────────
  if (item.balance != null && item.creditLimit != null && item.balance > item.creditLimit * 1.5) {
    violations.push({
      id: `v_balance_limit_${item.id}`,
      type: 'BALANCE_EXCEEDS_CREDIT_LIMIT',
      severity: 'MEDIUM',
      field: 'balance',
      description: `Balance ($${item.balance}) exceeds credit limit ($${item.creditLimit}) by more than 50%.`,
      legalBasis: 'Metro 2 Balance Amount field validation; FCRA §623(a)(1) accuracy requirement',
      disputeLanguage: `The reported balance of $${item.balance} exceeds the credit limit of $${item.creditLimit} by an amount inconsistent with the account type and history. This constitutes inaccurate reporting under FCRA §623(a)(1) accuracy requirements and violates Metro 2 data integrity standards.`,
    });
  }

  // ── Violation 5: Re-aged account detection ────────────────────────────────
  if (item.dateOpened && dofdStr) {
    const opened = new Date(item.dateOpened);
    const dofd = new Date(dofdStr);
    // If DOFD is BEFORE the account opened date — data error / re-aging
    if (dofd < opened) {
      violations.push({
        id: `v_reaged_${item.id}`,
        type: 'RE_AGED_ACCOUNT',
        severity: 'HIGH',
        field: 'originalDateOfDelinquency',
        description: `DOFD (${dofdStr}) is before account open date (${item.dateOpened}) — indicates re-aging.`,
        legalBasis: 'FCRA §605(a)(4); FTC guidance on re-aging',
        disputeLanguage: `The Date of First Delinquency of ${dofdStr} precedes the account open date of ${item.dateOpened}, which is a logical impossibility and strong indicator of illegal re-aging. Re-aging a debt by resetting the DOFD to extend the reporting timeline is a direct violation of FCRA §605(a)(4) and FTC enforcement guidance. I demand immediate deletion and investigation of this data furnisher.`,
      });
    }
  }

  // ── Violation 6: Collection without original creditor ────────────────────
  if ((item.typeOfNegative ?? '').toLowerCase().includes('collection') && !item.originalCreditor) {
    violations.push({
      id: `v_orig_creditor_${item.id}`,
      type: 'ORIGINAL_CREDITOR_MISSING',
      severity: 'MEDIUM',
      field: 'originalCreditor',
      description: 'Collection account does not identify the original creditor.',
      legalBasis: 'FCRA §623(a)(1); Metro 2 Original Creditor Name field requirement',
      disputeLanguage: 'This collection account fails to identify the original creditor as required by Metro 2 standards and FCRA §623(a)(1). Without the original creditor\'s identity, I cannot verify that this debt belongs to me, constituting inaccurate reporting under federal law.',
    });
  }

  return violations;
}

// ── AI-Enhanced Metro 2 Audit ──────────────────────────────────────────────────

const METRO2_AI_AUDIT_PROMPT = `You are a Metro 2 credit reporting compliance expert with deep knowledge of FCRA and CDIA Metro 2 format requirements.

Analyze this credit report item for Metro 2 compliance violations. Return ONLY a valid JSON object (no markdown):

{
  "violations": [
    {
      "type": "VIOLATION_TYPE_STRING",
      "severity": "HIGH|MEDIUM|LOW",
      "field": "field_name",
      "description": "clear description",
      "legalBasis": "cite specific law/code",
      "disputeLanguage": "ready-to-use dispute language citing the violation"
    }
  ],
  "summary": "one sentence summary of most critical violations",
  "overallRisk": "HIGH|MEDIUM|LOW|CLEAN"
}

Account Data:
`;

export async function auditMetro2WithAI(item: NegativeItem): Promise<Metro2AuditResult> {
  const staticViolations = auditMetro2Static(item);

  const itemData = JSON.stringify({
    creditorName: item.creditorName,
    accountNumber: item.accountNumber,
    balance: item.balance,
    typeOfNegative: item.typeOfNegative,
    status: item.status,
    originalDateOfDelinquency: item.originalDateOfDelinquency,
    dateOpened: item.dateOpened,
    dateClosed: item.dateClosed,
    dateLastActive: item.dateLastActive,
    originalCreditor: item.originalCreditor,
    creditLimit: item.creditLimit,
    paymentHistory: item.paymentHistory,
    accountType: item.accountType,
    creditBureau: item.creditBureau,
  }, null, 2);

  try {
    const messages: AIMessage[] = [
      { role: 'user', content: METRO2_AI_AUDIT_PROMPT + itemData },
    ];

    const response = await routeAIRequest(messages, {
      taskType: 'analyze',
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 2048,
    });

    const parsed = JSON.parse(response);
    const aiViolations: Metro2Violation[] = (parsed.violations ?? []).map((v: any, i: number) => ({
      id: `v_ai_${item.id}_${i}`,
      type: v.type ?? 'INVALID_ACCOUNT_STATUS_CODE',
      severity: v.severity ?? 'MEDIUM',
      field: v.field ?? 'unknown',
      description: v.description ?? '',
      legalBasis: v.legalBasis ?? '',
      disputeLanguage: v.disputeLanguage ?? '',
    }));

    // Merge static + AI violations, deduplicate by type
    const allViolations = [...staticViolations];
    aiViolations.forEach((av) => {
      if (!allViolations.some((sv) => sv.type === av.type)) {
        allViolations.push(av);
      }
    });

    const overallRisk: Metro2AuditResult['overallRisk'] =
      allViolations.some((v) => v.severity === 'HIGH') ? 'HIGH' :
      allViolations.some((v) => v.severity === 'MEDIUM') ? 'MEDIUM' :
      allViolations.length > 0 ? 'LOW' : 'CLEAN';

    return {
      itemId: item.id,
      violations: allViolations,
      auditedAt: new Date(),
      overallRisk,
      aiEnhanced: true,
      summary: parsed.summary ?? `Found ${allViolations.length} Metro 2 violation(s).`,
    };
  } catch (e) {
    console.warn('[Metro2Auditor] AI audit failed, using static results only', e);
    const overallRisk: Metro2AuditResult['overallRisk'] =
      staticViolations.some((v) => v.severity === 'HIGH') ? 'HIGH' :
      staticViolations.some((v) => v.severity === 'MEDIUM') ? 'MEDIUM' :
      staticViolations.length > 0 ? 'LOW' : 'CLEAN';

    return {
      itemId: item.id,
      violations: staticViolations,
      auditedAt: new Date(),
      overallRisk,
      aiEnhanced: false,
      summary: `Found ${staticViolations.length} Metro 2 violation(s) via static analysis.`,
    };
  }
}

// ── Batch audit ────────────────────────────────────────────────────────────────

export async function auditAllItemsMetro2(items: NegativeItem[]): Promise<Metro2AuditResult[]> {
  const results: Metro2AuditResult[] = [];
  for (const item of items) {
    // Static only for batch to avoid excessive AI calls
    const violations = auditMetro2Static(item);
    const overallRisk: Metro2AuditResult['overallRisk'] =
      violations.some((v) => v.severity === 'HIGH') ? 'HIGH' :
      violations.some((v) => v.severity === 'MEDIUM') ? 'MEDIUM' :
      violations.length > 0 ? 'LOW' : 'CLEAN';

    results.push({
      itemId: item.id,
      violations,
      auditedAt: new Date(),
      overallRisk,
      aiEnhanced: false,
      summary: violations.length > 0
        ? `${violations.length} violation(s) detected.`
        : 'No static violations detected.',
    });
  }
  return results;
}
