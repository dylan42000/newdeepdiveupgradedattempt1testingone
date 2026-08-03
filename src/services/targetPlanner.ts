/**
 * targetPlanner.ts — Dual-Target Dispatch Planner
 * Determines whether to send letters to bureau, furnisher, or both.
 * Maps pass numbers to appropriate legal strategies and target combinations.
 */

import { NegativeItem } from '../types';
import { PassNumber, PassStrategy, DispatchTarget } from '../types/creditRepair';
import { BUREAU_DISPUTE_ADDRESSES, findFurnisherAddressWithContacts } from '../data/furnisherAddresses';

export interface TargetPlan {
  itemId: string;
  passNumber: PassNumber;
  targets: DispatchTarget[];
  legalBasis: string[];
  strategyDescription: string;
  /** GAP-E FIX: Structured warnings the caller can surface to the user (e.g., furnisher skipped due to no address) */
  warnings: string[];
}

// Pass → strategy mapping
const PASS_STRATEGIES: Record<PassNumber, { bureau: PassStrategy; furnisher: PassStrategy }> = {
  1: { bureau: 'accuracy_challenge', furnisher: 'accuracy_challenge' },
  2: { bureau: 'method_of_verification', furnisher: 'fdcpa_validation' },
  3: { bureau: 'procedural_violation', furnisher: 'cfpb_complaint_threat' },
  4: { bureau: 'formal_intent_to_complain', furnisher: 'formal_intent_to_complain' },
  5: { bureau: 'final_demand', furnisher: 'final_demand' },
  6: { bureau: 'legal_demand', furnisher: 'legal_demand' },
};

// Pass → legal citations
const PASS_LEGAL_BASIS: Record<PassNumber, string[]> = {
  1: ['FCRA §611(a)'],
  2: ['FCRA §611(a)(7)', 'FDCPA §809(b)', 'FCRA §623(a)(2)'],
  3: ['FCRA §611(a)(1)', 'FCRA §623(b)(1)', 'FCRA §616', 'FCRA §617'],
  4: ['CFPB Dodd-Frank §1034', 'FCRA §616', 'State FCRA Equivalents'],
  5: ['FCRA §616', 'FCRA §617', 'CFPB', 'FTC', 'State AG'],
  6: ['FCRA §616', 'FCRA §617', 'FCRA §611', 'FCRA §623(a)(8)', 'FDCPA §1692g'],
};

const PASS_DESCRIPTIONS: Record<PassNumber, string> = {
  1: 'Accuracy Challenge — Professional first contact, FCRA §611(a) dispute',
  2: 'Method of Verification + FDCPA Demand — Challenge HOW they verified',
  3: 'Procedural Violation + CFPB Threat — Investigation was defective',
  4: 'Formal Intent to File CFPB Complaint — Full legal demand',
  5: 'Final Legal Warning + CFPB Complaint Pack — Maximum escalation',
  6: 'Pre-Litigation Statutory Demand — 15-day deadline, §616/§617 damages cited',
};

export const TargetPlanner = {
  planTargets(
    item: NegativeItem,
    passNumber: PassNumber,
    dualTargetMode: boolean,
    contacts?: any[]
  ): TargetPlan {
    const strategies = PASS_STRATEGIES[passNumber];
    const targets: DispatchTarget[] = [];
    // GAP-E FIX: Collect planner warnings to surface to callers instead of silent skips
    const warnings: string[] = [];

    // Determine which bureaus to target
    const bureaus = item.creditBureau.length > 0 ? item.creditBureau : ['Equifax', 'Experian', 'TransUnion'];

    for (const bureau of bureaus) {
      const address = BUREAU_DISPUTE_ADDRESSES[bureau as keyof typeof BUREAU_DISPUTE_ADDRESSES]
        ?? `${bureau} Consumer Dispute Center, P.O. Box, Unknown`;

      targets.push({
        type: 'bureau',
        name: bureau,
        address,
        passNumber,
        strategy: strategies.bureau,
      });
    }

    // Add furnisher target if dual mode enabled (or Pass 2+ for collectors)
    const isCollector = isCollectionAccount(item);
    const shouldAddFurnisher = dualTargetMode || (passNumber >= 2 && isCollector);

    if (shouldAddFurnisher && item.creditorName) {
      const furnisher = findFurnisherAddressWithContacts(item.creditorName, item, contacts);
      const furnisherAddr = furnisher
        ? `${furnisher.legalName}, ${furnisher.disputeAddress}, ${furnisher.city}, ${furnisher.state} ${furnisher.zip}`
        : null;
      if (furnisherAddr) {
        targets.push({
          type: 'furnisher',
          name: item.creditorName,
          address: furnisherAddr,
          passNumber,
          strategy: strategies.furnisher,
        });
      } else {
        // GAP-E FIX: Do NOT silently skip — record a warning for the caller to surface in the UI
        const msg = `No address found for furnisher “${item.creditorName}” — bureau-only targeting applied for this item. Add the furnisher’s dispute address in Contacts to enable dual-target dispatch.`;
        warnings.push(msg);
        console.warn('[TargetPlanner]', msg);
      }
    }

    return {
      itemId: item.id,
      passNumber,
      targets,
      legalBasis: PASS_LEGAL_BASIS[passNumber],
      strategyDescription: PASS_DESCRIPTIONS[passNumber],
      warnings,
    };
  },

  planAllTargets(
    items: NegativeItem[],
    passNumbers: Record<string, PassNumber>,
    dualTargetMode: boolean,
    contacts?: any[]
  ): TargetPlan[] {
    return items.map(item => {
      const passNumber = passNumbers[item.id] ?? 1;
      return this.planTargets(item, passNumber, dualTargetMode, contacts);
    });
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCollectionAccount(item: NegativeItem): boolean {
  const type = (item.typeOfNegative ?? '').toLowerCase();
  return type.includes('collection') || type.includes('debt');
}
