import { NegativeItem } from '../types';
import { HealedAccount } from './accountHealingEngine';
import { Metro2Violation, auditMetro2Static, Metro2AuditResult } from './metro2Auditor';

/**
 * Task 2: Metro 2 Compliance Engine
 * Scans grouped accounts for cross-bureau contradictions.
 * Appends metro2Violations array to account objects.
 */
export const Metro2AuditEngine = {
  auditGroupedAccounts(healedAccounts: any[]): void {
    for (const group of healedAccounts) {
      // Find cross-bureau contradictions
      const violations: Metro2Violation[] = [];
      const items = group.originalItems;

      if (items.length > 1) {
        // 1. Status Mismatch
        const statuses = items.map(i => ({ bureau: i.creditBureau[0] || 'Unknown', status: i.status }));
        const uniqueStatuses = new Set(statuses.map(s => s.status?.toLowerCase()).filter(Boolean));
        if (uniqueStatuses.size > 1) {
          violations.push({
            id: `v_cross_status_${group.mergedAccountNumber}`,
            type: 'INVALID_ACCOUNT_STATUS_CODE',
            severity: 'HIGH',
            field: 'status',
            description: `Status contradiction across bureaus: ${statuses.map(s => `${s.bureau}: ${s.status}`).join(', ')}`,
            legalBasis: 'FCRA §623(a)(1) accuracy requirement; Metro 2 exact match standards',
            disputeLanguage: `This account is reporting contradictory statuses across different credit bureaus (${statuses.map(s => `${s.bureau}: ${s.status}`).join(', ')}). A single account cannot simultaneously hold multiple statuses. This violates the Metro 2 Account Status Code standards and FCRA §623(a)(1) requirement for maximum possible accuracy. I demand immediate correction to a uniform status or deletion of the tradeline.`
          });
        }

        // 2. Balance Inconsistency
        const balances = items.map(i => ({ bureau: i.creditBureau[0] || 'Unknown', balance: i.balance }));
        const validBalances = balances.filter(b => b.balance != null);
        const uniqueBalances = new Set(validBalances.map(b => b.balance));
        if (uniqueBalances.size > 1) {
          violations.push({
            id: `v_cross_balance_${group.mergedAccountNumber}`,
            type: 'BALANCE_NOT_ZERO_AFTER_CHARGE_OFF', // Reusing a related type
            severity: 'MEDIUM',
            field: 'balance',
            description: `Balance contradiction across bureaus: ${validBalances.map(b => `${b.bureau}: $${b.balance}`).join(', ')}`,
            legalBasis: 'FCRA §623(a)(1) accuracy requirement',
            disputeLanguage: `The reported balance for this account contradicts itself across different bureaus (${validBalances.map(b => `${b.bureau}: $${b.balance}`).join(', ')}). This constitutes inaccurate reporting under FCRA §623(a)(1). I demand that the balance be corrected to be uniformly accurate or the item be deleted.`
          });
        }

        // 3. DOFD Conflict
        const dofds = items.map(i => ({ bureau: i.creditBureau[0] || 'Unknown', dofd: i.originalDateOfDelinquency || i.dateOfFirstDelinquency }));
        const validDofds = dofds.filter(d => !!d.dofd);
        const uniqueDofds = new Set(validDofds.map(d => d.dofd));
        if (uniqueDofds.size > 1) {
          violations.push({
            id: `v_cross_dofd_${group.mergedAccountNumber}`,
            type: 'DOFD_INCONSISTENT_ACROSS_BUREAUS',
            severity: 'HIGH',
            field: 'dateOfFirstDelinquency',
            description: `DOFD contradiction across bureaus: ${validDofds.map(d => `${d.bureau}: ${d.dofd}`).join(', ')}`,
            legalBasis: 'FCRA §623(a)(1) accuracy requirement; FCRA §605(a)(4)',
            disputeLanguage: `My reports show different Dates of First Delinquency for what appears to be the same account (${validDofds.map(d => `${d.bureau}: ${d.dofd}`).join(', ')}). Please investigate this material inconsistency, identify the accurate date from your records, and correct or delete any information that is inaccurate, incomplete, or cannot be verified.`
          });
        }
      }

      // Add individual static audits
      for (const item of items) {
        const itemViolations = auditMetro2Static(item);
        item.metro2Violations = [...(item.metro2Violations || []), ...itemViolations, ...violations];
      }
    }
  }
};
