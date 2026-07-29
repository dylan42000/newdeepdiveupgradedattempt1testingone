export type Metro2Severity = 'critical' | 'high' | 'medium';

export interface Metro2Flag {
  ruleId: string;
  fieldCode: string;
  description: string;
  severity: Metro2Severity;
  fcraReference: string;
  disputeArgument: string;
}

export interface Metro2AuditInput {
  status: string;
  balance: number;
  paymentHistory: string[];
  dateOfFirstDelinquency: string | null;
  dateOpened: string | null;
  creditLimit: number | null;
  accountType: string;
  currentRating: string;
  portfolioType: string;
  specialComment: string | null;
  complianceConditionCode: string | null;
  crossBureauDofds: (string | null)[];
  crossBureauStatuses: string[];
  crossBureauDateOpened: (string | null)[];
}

export function auditMetro2(input: Metro2AuditInput): Metro2Flag[] {
  const flags: Metro2Flag[] = [];

  if (['paid', 'closed', 'transferred', 'paid in full'].some((s) => input.status.toLowerCase().includes(s)) && input.balance > 0) {
    flags.push({
      ruleId: 'M2-001',
      fieldCode: 'Current Balance (Field 20)',
      description: `Account status is "${input.status}" but a balance of $${input.balance} is being reported.`,
      severity: 'critical',
      fcraReference: 'FCRA §623(a)(1) / Metro 2 Field 20',
      disputeArgument: `Metro 2 Field 20 (Current Balance) must reflect $0 when account status code indicates a closed, paid, or transferred account. Continued reporting of a non-zero balance of $${input.balance} on an account with status "${input.status}" constitutes a material inaccuracy under FCRA §623(a)(1) and violates CDIA Metro 2 reporting standards.`,
    });
  }

  const dofds = input.crossBureauDofds.filter(Boolean) as string[];
  const dofdTimestamps = dofds.map((d) => new Date(d).getTime());
  if (dofdTimestamps.length > 1) {
    const range = Math.max(...dofdTimestamps) - Math.min(...dofdTimestamps);
    const rangeDays = range / (1000 * 60 * 60 * 24);
    if (rangeDays > 30) {
      flags.push({
        ruleId: 'M2-002',
        fieldCode: 'Date of First Delinquency (Field 25)',
        description: `DOFD varies by ${Math.round(rangeDays)} days across bureaus: ${dofds.join(' | ')}`,
        severity: 'critical',
        fcraReference: 'FCRA §623(a)(5) / Metro 2 Field 25',
        disputeArgument: `Metro 2 Field 25 (Date of First Delinquency) must be reported consistently across all consumer reporting agencies. A ${Math.round(rangeDays)}-day discrepancy in the reported DOFD across bureaus constitutes re-aging under FCRA §623(a)(5), which prohibits furnishers from reporting a date of delinquency that is later than the actual date.`,
      });
    }
  }

  if (['revolving', 'credit card', 'line of credit'].some((t) => input.accountType.toLowerCase().includes(t)) && (input.creditLimit === null || input.creditLimit === 0)) {
    flags.push({
      ruleId: 'M2-003',
      fieldCode: 'Credit Limit (Field 18)',
      description: 'Revolving account is missing Credit Limit (Field 18).',
      severity: 'high',
      fcraReference: 'FCRA §623(a)(1) / Metro 2 Field 18',
      disputeArgument: `Metro 2 Field 18 (Credit Limit) is a mandatory field for revolving accounts. Omission of the credit limit on a revolving account artificially depresses the consumer's credit utilization calculation and constitutes incomplete reporting under FCRA §623(a)(1).`,
    });
  }

  if (input.currentRating === '1' && input.paymentHistory.some((p) => ['2', '3', '4', '5'].includes(p))) {
    flags.push({
      ruleId: 'M2-004',
      fieldCode: 'Payment Rating (Field 17B) vs. Payment History Profile (Field 23)',
      description: 'Account rated "Current" (1) but payment history profile contains delinquency codes.',
      severity: 'high',
      fcraReference: 'FCRA §623(a)(1) / Metro 2 Fields 17B & 23',
      disputeArgument: `Metro 2 Field 17B (Payment Rating) indicates "Current" while Field 23 (Payment History Profile) contains delinquency codes. This internal inconsistency violates CDIA Metro 2 reporting requirements for data integrity and constitutes inaccurate reporting under FCRA §623(a)(1).`,
    });
  }

  const openedDates = input.crossBureauDateOpened.filter(Boolean) as string[];
  const uniqueOpenedDates = new Set(openedDates.map((d) => new Date(d).toISOString().slice(0, 7)));
  if (uniqueOpenedDates.size > 1) {
    flags.push({
      ruleId: 'M2-005',
      fieldCode: 'Date Opened (Field 26)',
      description: `Date Opened varies across bureaus: ${openedDates.join(' | ')}`,
      severity: 'medium',
      fcraReference: 'FCRA §623(a)(1) / Metro 2 Field 26',
      disputeArgument: `Metro 2 Field 26 (Date Opened) is being reported inconsistently across consumer reporting agencies. The date an account was opened is a static, verifiable data point — any cross-bureau discrepancy indicates either data entry error or non-compliant furnishing practices under FCRA §623(a)(1).`,
    });
  }

  if (input.specialComment?.toLowerCase().includes('account transferred') && input.balance > 0) {
    flags.push({
      ruleId: 'M2-006',
      fieldCode: 'Special Comment (Field 19) + Current Balance (Field 20)',
      description: 'Account marked as transferred but still reporting a positive balance.',
      severity: 'critical',
      fcraReference: 'FCRA §623(a)(1) / Metro 2 Fields 19 & 20',
      disputeArgument: `When Metro 2 Field 19 (Special Comment) is coded for account transfer, Field 20 (Current Balance) must reflect $0. Simultaneous reporting of a transferred status and a positive balance of $${input.balance} is a direct contradiction under CDIA Metro 2 standards and constitutes inaccurate reporting under FCRA §623(a)(1).`,
    });
  }

  if (input.complianceConditionCode === 'XB' && !input.specialComment?.toLowerCase().includes('dispute')) {
    flags.push({
      ruleId: 'M2-007',
      fieldCode: 'Compliance Condition Code (Field 36)',
      description: 'Account marked XB (in dispute) but no dispute notation in Special Comment field.',
      severity: 'medium',
      fcraReference: 'FCRA §611(a)(2) / Metro 2 Field 36',
      disputeArgument: `Metro 2 Field 36 (Compliance Condition Code) is set to XB indicating the account is in dispute. However, no corresponding dispute notation has been applied in Field 19 (Special Comment). This constitutes incomplete compliance notation under FCRA §611(a)(2) and CDIA Metro 2 standards.`,
    });
  }

  return flags.sort((a, b) => {
    const order: Metro2Severity[] = ['critical', 'high', 'medium'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });
}
