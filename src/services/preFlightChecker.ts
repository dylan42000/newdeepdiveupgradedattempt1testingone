/**
 * preFlightChecker.ts — Per-Item Pre-Flight Gatekeeper
 *
 * Validates each NegativeItem BEFORE it is dispatched to LetterGeneratorV2.
 * Three gates:
 *  1. DOFD Gate — collections/charge-offs require a populated Date of First
 *     Delinquency. Without it, the FCRA 7-year clock cannot be established,
 *     the letter cannot cite re-aging violations, and the AI will hallucinate dates.
 *  2. Bureau Address Gate — every bureau listed on the item must resolve to a
 *     verified dispute mailing address. Unresolvable bureaus mean the letter
 *     will have a placeholder address block and will fail delivery.
 *  3. Address Enrichment Gate (AddressEnrichment Hook) — validates the
 *     DispatchTarget.address string BEFORE it reaches the AI. Triggers when
 *     the address is suspiciously short (< 12 chars) OR is a bare PO Box with
 *     no city/state/zip. Attempts a fuzzy vault lookup from furnisherAddresses.ts
 *     and silently overwrites bad data when a valid match is found. Blocks
 *     generation entirely when no valid address can be sourced.
 *
 * Items that fail are moved to "Action Required" status rather than being
 * silently skipped or sent with bad data.
 */

import { NegativeItem } from '../types';
import { DispatchTarget } from '../types/creditRepair';
import { isKnownBureau } from './bureauAddressService';
import { findFurnisherAddress, formatFurnisherAddress } from '../data/furnisherAddresses';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreFlightFailureReason =
  | 'DOFD_MISSING'           // Date of First Delinquency not populated
  | 'ADDRESS_UNRESOLVABLE'   // No creditBureau entry maps to a verified address
  | 'FURNISHER_UNKNOWN'      // Furnisher field is null/empty (used when dual-targeting)
  | 'TARGET_ADDRESS_INVALID'; // Target address is incomplete AND vault lookup found nothing

export interface PreFlightFailure {
  item: NegativeItem;
  reasons: PreFlightFailureReason[];
  /** Human-readable message suitable for display in the AutoPilot UI */
  userMessage: string;
}

export interface PreFlightReport {
  /** Items that passed all gates — safe to dispatch to LetterGeneratorV2 */
  passed: NegativeItem[];
  /** Items that failed one or more gates — must be surfaced to the user */
  actionRequired: PreFlightFailure[];
  /** One-line summary for progress logging */
  summary: string;
}

// ─── Account types that REQUIRE a DOFD to generate a defensible dispute ──────

const DOFD_REQUIRED_TYPES = new Set([
  'collection',
  'charge-off',
  'charge off',
  'chargeoff',
  'charged off',
  'repossession',
  'repo',
  'foreclosure',
  'judgment',
  'bankruptcy',
  'other derogatory',
]);

function requiresDofd(item: NegativeItem): boolean {
  const type = (item.typeOfNegative ?? '').toLowerCase();
  for (const t of DOFD_REQUIRED_TYPES) {
    if (type.includes(t)) return true;
  }
  return false;
}

function hasDofd(item: NegativeItem): boolean {
  const dofd = item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency;
  return !!dofd && dofd.trim().length > 0;
}

// ─── Gate 3: AddressEnrichment Hook ─────────────────────────────────────────
// Operates on individual DispatchTarget objects, not on NegativeItems directly.
// Called by TargetPlanner / AutoPilot immediately before passing targets to
// LetterGeneratorV2. The hook is purely synchronous — vault lookups are O(n)
// over the local furnisher dataset (no network I/O required).

/**
 * Trigger condition 1: Address is suspiciously short.
 * Addresses shorter than 12 characters cannot contain a street/PO Box + city +
 * state + zip — they are guaranteed to be truncated or placeholder values.
 */
const MIN_ADDRESS_LENGTH = 12;

/**
 * Trigger condition 2: Address matches a bare PO Box pattern with no
 * city / state / ZIP component. Examples that trigger:
 *   "PO Box 1234"         → triggers (no city/state/zip)
 *   "PO Box 1234, Dallas, TX 75201" → does NOT trigger (has city/state/zip)
 */
const BARE_PO_BOX_RE =
  /^(?:p\.?o\.?\s*box|post\s+office\s+box)\s+\d+\s*$/i;

/**
 * Returns true when the address string should trigger enrichment lookup.
 * Two conditions, either of which is sufficient:
 *  - The address is fewer than MIN_ADDRESS_LENGTH characters
 *  - The address is a bare PO Box with no city/state/zip trailing data
 */
export function isAddressIncomplete(address: string): boolean {
  const trimmed = (address ?? '').trim();
  if (trimmed.length < MIN_ADDRESS_LENGTH) return true;
  if (BARE_PO_BOX_RE.test(trimmed)) return true;
  return false;
}

/**
 * Result returned by enrichTargetAddress().
 */
export type AddressEnrichmentResult =
  | { status: 'ok'; address: string; source: 'original' | 'vault' }
  | { status: 'enriched'; address: string; source: 'vault'; vaultName: string }
  | { status: 'blocked'; address: null; errorMessage: string };

import { AddressResearchAgent, getPendingAddressResearch } from './addressResearchAgent';

/**
 * AddressEnrichment Hook.
 *
 * Inspects a single DispatchTarget.address string and either:
 *  - Passes it through unchanged when it already looks complete.
 *  - Silently overwrites it with the vault address when the vault has a
 *    fuzzy match for creditorName.
 *  - Returns a "blocked" result when the address is bad AND the vault has
 *    no match, preventing the item from reaching the AI.
 *
 * @param targetAddress   The address string currently on the DispatchTarget.
 * @param creditorName    The item's creditorName used for vault lookup.
 * @returns               An AddressEnrichmentResult describing the outcome.
 */
export async function enrichTargetAddress(
  targetAddress: string,
  creditorName: string,
): Promise<AddressEnrichmentResult> {
  // Fast-path: address already looks complete — pass through untouched.
  if (!isAddressIncomplete(targetAddress)) {
    return { status: 'ok', address: targetAddress, source: 'original' };
  }

  // Trigger condition met — attempt vault fuzzy lookup.
  console.warn(
    `[AddressEnrichment] Incomplete target address detected for "${creditorName}": "${targetAddress}". ` +
    `Querying Address Vault...`
  );

  const vaultHit = findFurnisherAddress(creditorName);

  if (vaultHit) {
    const enriched = formatFurnisherAddress(vaultHit);
    console.info(
      `[AddressEnrichment] ✅ Vault match found for "${creditorName}" → "${vaultHit.legalName}". ` +
      `Silently replacing address.`
    );
    return {
      status: 'enriched',
      address: enriched,
      source: 'vault',
      vaultName: vaultHit.legalName,
    };
  }

  // Fallback to AddressResearchAgent if no vault hit
  const agentHit = await AddressResearchAgent.searchAndVaultAddress(creditorName);
  if (agentHit) {
    const enriched = formatFurnisherAddress(agentHit);
    return {
      status: 'enriched',
      address: enriched,
      source: 'vault',
      vaultName: agentHit.legalName,
    };
  }

  const pending = getPendingAddressResearch(creditorName);

  // No vault hit and agent failed — block generation
  const candidateText = pending
    ? ` AI found a candidate: ${pending.candidate.legalName}, ${pending.candidate.disputeAddress}, ${pending.candidate.city}, ${pending.candidate.state} ${pending.candidate.zip}. Verify and save it in Address Book first.`
    : '';
  const errorMessage =
    `Generation Blocked: no verified dispute address for "${creditorName}".` +
    candidateText + ` Open Address Lookup to confirm an address before generating or approving this letter.`;
  console.error(`[AddressEnrichment] ❌ ${errorMessage}`);
  return { status: 'blocked', address: null, errorMessage };
}

/**
 * Convenience wrapper: enriches a DispatchTarget in-place.
 *
 * - If enrichment succeeds (original or vault), mutates `target.address` and
 *   returns true.
 * - If blocked, leaves `target.address` unchanged and returns false.
 *
 * The caller (AutoPilot / TargetPlanner loop) should skip letter generation
 * for the item when this returns false, and surface the blocking error in the
 * AutoPilot queue via the standard PreFlightFailure channel.
 *
 * @param creditorName  The NegativeItem.creditorName for vault lookup.
 * @returns             The full AddressEnrichmentResult so callers can log details.
 */
export async function enrichTarget(
  target: DispatchTarget,
  creditorName: string,
): Promise<AddressEnrichmentResult> {
  const result = await enrichTargetAddress(target.address, creditorName);
  if (result.status !== 'blocked' && result.address !== null) {
    target.address = result.address;
  }
  return result;
}

// ─── Main Gate Runner ─────────────────────────────────────────────────────────

/**
 * Runs the pre-flight gate on a list of NegativeItems (typically the selected
 * batch from BatchSelector). Call this immediately before dispatching items to
 * LetterGeneratorV2 — NOT before BatchSelector, so the batch size stays stable.
 *
 * @param items  The candidate NegativeItems from the current cycle batch.
 * @param opts   Optional flags to tighten/loosen individual gates.
 */
export function runPreFlightCheck(
  items: NegativeItem[],
  opts: {
    /** Skip the DOFD gate for non-derogatory item types. Default: true (smart mode). */
    dofdSmartMode?: boolean;
    /** Skip the bureau address gate. Default: false. */
    skipAddressGate?: boolean;
  } = {}
): PreFlightReport {
  const { dofdSmartMode = true, skipAddressGate = false } = opts;

  const passed: NegativeItem[] = [];
  const actionRequired: PreFlightFailure[] = [];

  for (const item of items) {
    const reasons: PreFlightFailureReason[] = [];

    // ── Gate 1: DOFD ──────────────────────────────────────────────────────────
    const needsDofd = dofdSmartMode ? requiresDofd(item) : true;
    if (needsDofd && !hasDofd(item)) {
      reasons.push('DOFD_MISSING');
    }

    // ── Gate 2: Bureau Address ────────────────────────────────────────────────
    if (!skipAddressGate) {
      const bureaus = item.creditBureau ?? [];
      if (bureaus.length === 0) {
        // No bureaus at all → unresolvable
        reasons.push('ADDRESS_UNRESOLVABLE');
      } else {
        const hasResolvable = bureaus.some((b) => isKnownBureau(b));
        if (!hasResolvable) {
          reasons.push('ADDRESS_UNRESOLVABLE');
        }
      }
    }

    if (reasons.length > 0) {
      actionRequired.push({
        item,
        reasons,
        userMessage: buildUserMessage(item, reasons),
      });
    } else {
      passed.push(item);
    }
  }

  const summary =
    actionRequired.length === 0
      ? `✅ Pre-flight passed: all ${passed.length} item(s) cleared`
      : `✅ ${passed.length} item(s) cleared · ⚠️ ${actionRequired.length} item(s) require action (${actionRequired.map((f) => f.item.creditorName).join(', ')})`;

  return { passed, actionRequired, summary };
}

// ─── User Message Builder ─────────────────────────────────────────────────────

function buildUserMessage(item: NegativeItem, reasons: PreFlightFailureReason[]): string {
  const parts: string[] = [`${item.creditorName}:`];

  if (reasons.includes('DOFD_MISSING')) {
    parts.push(
      'Date of First Delinquency (DOFD) is missing. ' +
      'Add the DOFD in the item editor before this item can be disputed. ' +
      'Without it, the FCRA 7-year window cannot be established and the dispute letter will be legally weak.'
    );
  }

  if (reasons.includes('ADDRESS_UNRESOLVABLE')) {
    const bureaus = item.creditBureau ?? [];
    parts.push(
      `Bureau address unresolvable for: [${bureaus.join(', ') || 'none'}]. ` +
      'Only Equifax, Experian, and TransUnion have verified dispute addresses. ' +
      'Edit the item and set the correct bureau(s).'
    );
  }

  if (reasons.includes('FURNISHER_UNKNOWN')) {
    parts.push(
      'Furnisher name is empty. Add the original creditor/furnisher name to enable dual-target dispatch.'
    );
  }

  if (reasons.includes('TARGET_ADDRESS_INVALID')) {
    parts.push(
      `Generation Blocked: Invalid Target Address. ` +
      `The dispatch address for this creditor is incomplete and could not be resolved ` +
      `from the Address Vault. Please update the Address Vault with a valid mailing address for "${item.creditorName}" ` +
      `before this item can be dispatched.`
    );
  }

  return parts.join(' ');
}

// ─── Single-Item Convenience Check ───────────────────────────────────────────

/**
 * Quick gate check for a single item. Returns `true` if the item passes all
 * pre-flight gates and is safe to dispatch. Used by the NegativeItems page
 * to show per-item "Action Required" badges without running a full cycle.
 */
export function checkSingleItem(item: NegativeItem): {
  passed: boolean;
  reasons: PreFlightFailureReason[];
  userMessage: string;
} {
  const report = runPreFlightCheck([item]);
  if (report.passed.length === 1) {
    return { passed: true, reasons: [], userMessage: '' };
  }
  const failure = report.actionRequired[0];
  return {
    passed: false,
    reasons: failure?.reasons ?? [],
    userMessage: failure?.userMessage ?? '',
  };
}
