/**
 * evidenceGateService.ts — Pre-Letter Evidence Readiness Gate
 * GAP-B FIX: Evaluates evidence strength before letter generation.
 * Low-evidence letters are blocked (or downgraded) to prevent frivolous
 * rejections by bureaus that require document substantiation.
 *
 * Scoring:
 *   Government-issued photo ID    → 35 pts
 *   Proof of address (utility/lease) → 25 pts
 *   Dispute-type-specific docs    → up to 25 pts each
 *
 * Tiers:
 *   BLOCKED     (< 35):  Cannot proceed — missing ID
 *   BASIC       (35–59): Can proceed, limited legal hooks
 *   STRONG      (60–84): Full legal argument available
 *   AUDIT_PROOF (85+):   Maximum pressure letter, include doc inventory
 */

export type EvidenceTier = 'BLOCKED' | 'BASIC' | 'STRONG' | 'AUDIT_PROOF';

export type DisputeType =
  | 'not_mine'
  | 'balance_incorrect'
  | 'status_incorrect'
  | 'dates_incorrect'
  | 'identity_theft'
  | 'bankruptcy'
  | 'paid_in_full'
  | 'settled'
  | 'charge_off'
  | 'collection'
  | 'late_payment'
  | 'repossession'
  | 'general';

/** Simplified vault file descriptor — matches VaultFile in vault.types.ts */
export interface EvidenceDoc {
  id: string;
  category: string;        // e.g. 'photo-id', 'proof-of-address', 'payment-history', etc.
  tags?: string[];
  name?: string;
}

export interface EvidenceReadinessResult {
  /** 0–100 composite score */
  score: number;
  /** Tier classification */
  tier: EvidenceTier;
  /** Whether letter generation can proceed */
  canProceed: boolean;
  /** Docs the user is missing that would materially strengthen the dispute */
  missingCritical: string[];
  /** Docs available that the letter should reference */
  availableDocs: EvidenceDoc[];
  /**
   * Modifiers appended to AI letter generation prompts.
   * Each modifier is a sentence instructing the AI to leverage available evidence.
   */
  letterModifiers: string[];
  /** Human-readable explanation for UI display */
  rationale: string;
}

// ─── Category recognition helpers ────────────────────────────────────────────

// Keep these aliases in sync with the human-readable Vault categories.  The
// Vault existed before the readiness gate and stores labels such as "Identity
// Proof"; without aliases, a successfully uploaded driver's license was not
// counted and users remained incorrectly blocked.
export const GOV_ID_CATEGORIES = [
  'photo-id', 'photo_id', 'government-id', 'government_id',
  'drivers-license', 'driver-license', 'driver_license', 'drivers_license',
  "driver's-license", "driver's_license", "driver's license", 'drivers-licence',
  'passport', 'state-id', 'state_id', 'id', 'id-card', 'id_card',
  'identity-proof', 'identity_proof', 'identity proof', 'identity-info', 'identity_info', 'dl',
];
const ADDRESS_PROOF_CATEGORIES = ['proof-of-address', 'proof of address', 'utility-bill', 'utility bill', 'lease-agreement', 'lease agreement', 'bank-statement', 'bank statement', 'address'];
const PAYMENT_PROOF_CATEGORIES = ['payment-history', 'payment-receipt', 'bank-statement', 'cancelled-check', 'payment'];
const POLICE_REPORT_CATEGORIES = ['police-report', 'ftc-report', 'identity-theft-affidavit', 'ftc', 'police'];
const CREDIT_REPORT_CATEGORIES = ['credit-report', 'report', 'bureau-report'];
const CORRESPONDENCE_CATEGORIES = ['correspondence', 'bureau-letter', 'response-letter', 'certified-mail'];
const ORIGINAL_CONTRACT_CATEGORIES = ['original-contract', 'account-agreement', 'original-creditor', 'contract'];
const PAYOFF_CATEGORIES = ['payoff-letter', 'satisfaction-letter', 'zero-balance', 'payoff'];

function normalizeEvidenceLabel(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-');
}

export function isGovIdDoc(d: EvidenceDoc, linkedIdentityDocId?: string): boolean {
  if (!d) return false;
  if (linkedIdentityDocId && d.id === linkedIdentityDocId) return true;
  const cat = normalizeEvidenceLabel(d.category);
  const name = (d.name ?? '').toLowerCase();
  const id = (d.id ?? '').toLowerCase();
  if (GOV_ID_CATEGORIES.includes(cat) || GOV_ID_CATEGORIES.includes(d.category?.toLowerCase())) return true;
  if ((d.tags ?? []).some(t => GOV_ID_CATEGORIES.includes(normalizeEvidenceLabel(t)))) return true;
  return (
    name.includes('driver') || name.includes('license') || name.includes('passport') ||
    name.includes('state id') || name.includes('photo id') || name.includes('identity') ||
    name.includes('dl.') || name.endsWith('_dl') || name.startsWith('dl_') ||
    id.includes('license') || id.includes('driver')
  );
}

export function hasGovIdDocument(docs: EvidenceDoc[], linkedIdentityDocId?: string): boolean {
  if (linkedIdentityDocId && docs.some(d => d.id === linkedIdentityDocId)) return true;
  return docs.some(d => isGovIdDoc(d, linkedIdentityDocId));
}

function hasCategory(docs: EvidenceDoc[], cats: string[]): boolean {
  return docs.some(d =>
    cats.includes(normalizeEvidenceLabel(d.category)) ||
    (d.tags ?? []).some(t => cats.includes(normalizeEvidenceLabel(t)))
  );
}

function docsWithCategory(docs: EvidenceDoc[], cats: string[]): EvidenceDoc[] {
  return docs.filter(d =>
    cats.includes(normalizeEvidenceLabel(d.category)) ||
    (d.tags ?? []).some(t => cats.includes(normalizeEvidenceLabel(t)))
  );
}

export interface EvidenceEvaluationOptions {
  identityInfoConfirmed?: boolean;
  identityDocId?: string;
}

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate evidence readiness for a dispute.
 *
 * @param vaultDocs - Documents currently in the user's vault
 * @param disputeType - Type of dispute being filed
 * @param options - Optional evaluation parameters (e.g. user confirmed identity info, linked identity doc)
 * @returns EvidenceReadinessResult with score, tier, gate, and letter modifiers
 */
export function evaluateEvidenceReadiness(
  vaultDocs: EvidenceDoc[],
  disputeType: DisputeType,
  options?: EvidenceEvaluationOptions,
): EvidenceReadinessResult {
  let score = 0;
  const missingCritical: string[] = [];
  const letterModifiers: string[] = [];

  // ── Government-issued photo ID (35 pts) — required for ANY letter ────────
  const hasGovId =
    Boolean(options?.identityInfoConfirmed) ||
    Boolean(options?.identityDocId) ||
    hasGovIdDocument(vaultDocs, options?.identityDocId);
  if (hasGovId) {
    score += 35;
    const idDocs = vaultDocs.filter(d => isGovIdDoc(d, options?.identityDocId));
    const docName = idDocs.length > 0 ? (idDocs[0].name ?? idDocs[0].category) : "Driver's License / Official ID";
    letterModifiers.push(
      `Consumer identity info and government-issued photo ID confirmed (${docName}). Reference FACTA §605B which requires bureaus to accept identity documentation.`
    );
  } else {
    missingCritical.push('Government-issued photo ID (driver\'s license, passport, or state ID) — required for all disputes');
  }

  // ── Proof of address (25 pts) ─────────────────────────────────────────────
  const hasAddressProof = hasCategory(vaultDocs, ADDRESS_PROOF_CATEGORIES);
  if (hasAddressProof) {
    score += 25;
    const addrDocs = docsWithCategory(vaultDocs, ADDRESS_PROOF_CATEGORIES);
    letterModifiers.push(
      `Proof of current address provided (${addrDocs[0].name ?? addrDocs[0].category}). Include in exhibit list.`
    );
  } else {
    missingCritical.push('Proof of current address (utility bill, lease agreement, or bank statement)');
  }

  // ── Dispute-type-specific document scoring (up to 50 pts) ────────────────
  switch (disputeType) {
    case 'not_mine':
    case 'identity_theft': {
      // Police report / FTC report is highly valuable for not-mine disputes
      if (hasCategory(vaultDocs, POLICE_REPORT_CATEGORIES)) {
        score += 25;
        letterModifiers.push(
          'Consumer has filed a police report / FTC identity theft report. Cite FCRA §605B (block of information resulting from identity theft) and demand immediate suppression pending investigation.'
        );
      } else {
        missingCritical.push('Police report or FTC Identity Theft Report (IdentityTheft.gov) — critical for not-mine disputes');
      }
      if (hasCategory(vaultDocs, CREDIT_REPORT_CATEGORIES)) {
        score += 15;
        letterModifiers.push(
          'Consumer\'s credit report copy attached. Reference the specific tradeline under dispute with exact account number and date as it appears on the report.'
        );
      }
      break;
    }
    case 'paid_in_full':
    case 'settled': {
      if (hasCategory(vaultDocs, PAYOFF_CATEGORIES)) {
        score += 25;
        letterModifiers.push(
          'Consumer has a payoff/satisfaction letter. Attach as Exhibit A and cite FCRA §623(a)(2) — furnisher obligation to correct after full payment.'
        );
      } else {
        missingCritical.push('Payoff letter, satisfaction letter, or zero-balance statement from original creditor');
      }
      if (hasCategory(vaultDocs, PAYMENT_PROOF_CATEGORIES)) {
        score += 15;
        letterModifiers.push(
          'Payment history documentation provided. Reference specific payment dates and amounts in the dispute letter to establish compliance.'
        );
      }
      break;
    }
    case 'balance_incorrect': {
      if (hasCategory(vaultDocs, PAYMENT_PROOF_CATEGORIES)) {
        score += 25;
        letterModifiers.push(
          'Payment records available. Reference FCRA §623 — furnisher must report only accurate balances. Attach payment records as supporting exhibits.'
        );
      } else {
        missingCritical.push('Bank statements or payment receipts showing the correct balance history');
      }
      if (hasCategory(vaultDocs, CORRESPONDENCE_CATEGORIES)) {
        score += 10;
        letterModifiers.push(
          'Prior correspondence with creditor/bureau available. Reference this correspondence to establish disputed balance has been acknowledged.'
        );
      }
      break;
    }
    case 'status_incorrect':
    case 'late_payment': {
      if (hasCategory(vaultDocs, PAYMENT_PROOF_CATEGORIES)) {
        score += 25;
        letterModifiers.push(
          'Payment history documentation attached. Cite FCRA §623(a)(1) — obligation to report accurate account status. Specific payment dates contradict late/derogatory status reported.'
        );
      } else {
        missingCritical.push('Bank statements or payment receipts proving on-time payment history');
      }
      if (hasCategory(vaultDocs, ORIGINAL_CONTRACT_CATEGORIES)) {
        score += 10;
        letterModifiers.push(
          'Original account agreement available. Reference contractual payment terms to demonstrate that reported late payment does not align with account terms.'
        );
      }
      break;
    }
    case 'dates_incorrect': {
      if (hasCategory(vaultDocs, ORIGINAL_CONTRACT_CATEGORIES)) {
        score += 25;
        letterModifiers.push(
          'Original account agreement attached. Use to establish correct account open date and original delinquency date. Note: under 2026 FCRA amendments, original delinquency date cannot be re-aged after disputes.'
        );
      } else {
        missingCritical.push('Original account agreement or first billing statement to establish correct dates');
      }
      if (hasCategory(vaultDocs, CORRESPONDENCE_CATEGORIES)) {
        score += 10;
        letterModifiers.push('Prior written correspondence may establish original account dates.');
      }
      break;
    }
    case 'bankruptcy': {
      if (hasCategory(vaultDocs, ['bankruptcy-discharge', 'discharge-order', 'bankruptcy-schedule', 'bankruptcy'])) {
        score += 25;
        letterModifiers.push(
          'Bankruptcy discharge order available. Attach as Exhibit A. Under 11 U.S.C. §524, all discharged debts must be reported as $0 balance with discharged status. Reference FCRA §623(a)(1) for Metro 2 compliance requirement.'
        );
      } else {
        missingCritical.push('Bankruptcy discharge order (from PACER.gov or your bankruptcy attorney)');
      }
      break;
    }
    case 'charge_off':
    case 'collection': {
      if (hasCategory(vaultDocs, PAYMENT_PROOF_CATEGORIES)) {
        score += 15;
        letterModifiers.push(
          'Payment records available. Use to establish the original delinquency date and any partial payments that affect the 7-year reporting clock under FCRA §605(a)(4).'
        );
      }
      if (hasCategory(vaultDocs, CORRESPONDENCE_CATEGORIES)) {
        score += 15;
        letterModifiers.push(
          'Correspondence with collector/original creditor available. Reference FDCPA §809 debt validation rights. If no validation was provided within 30 days, collection activity must cease.'
        );
      } else {
        missingCritical.push('Any prior written correspondence with the collection agency or original creditor');
      }
      break;
    }
    case 'repossession': {
      if (hasCategory(vaultDocs, ORIGINAL_CONTRACT_CATEGORIES)) {
        score += 20;
        letterModifiers.push(
          'Original loan/lease agreement attached. Verify that repossession procedures followed UCC Article 9 and state law. Note whether a deficiency balance is being claimed.'
        );
      }
      if (hasCategory(vaultDocs, CORRESPONDENCE_CATEGORIES)) {
        score += 15;
        letterModifiers.push(
          'Correspondence available. Use to establish whether pre-repossession cure-right notices were sent per UCC §9-614.'
        );
      }
      break;
    }
    default: {
      // General dispute — credit report + prior correspondence boosts score
      if (hasCategory(vaultDocs, CREDIT_REPORT_CATEGORIES)) {
        score += 15;
        letterModifiers.push(
          'Credit report copy available. Reference the specific tradeline data point under dispute.'
        );
      }
      if (hasCategory(vaultDocs, CORRESPONDENCE_CATEGORIES)) {
        score += 10;
        letterModifiers.push('Prior correspondence with bureau/furnisher supports dispute history.');
      }
      break;
    }
  }

  // ── Clamp to 100 ─────────────────────────────────────────────────────────
  score = Math.min(100, score);

  // ── Determine tier ────────────────────────────────────────────────────────
  let tier: EvidenceTier;
  if (score < 35) {
    tier = 'BLOCKED';
  } else if (score < 60) {
    tier = 'BASIC';
  } else if (score < 85) {
    tier = 'STRONG';
  } else {
    tier = 'AUDIT_PROOF';
    letterModifiers.push(
      'EVIDENCE LEVEL: AUDIT_PROOF. The letter should open with a summary of attached documentary exhibits, number them sequentially (Exhibit A, B, C...), and reference each by exhibit number in the legal argument section.'
    );
  }

  const canProceed = tier !== 'BLOCKED';

  // ── Build rationale ───────────────────────────────────────────────────────
  let rationale = '';
  if (tier === 'BLOCKED') {
    rationale = `Evidence score ${score}/100 — BLOCKED. Missing government-issued photo ID, which is required before any dispute letter is sent. Upload your ID to the Vault to unlock letter generation.`;
  } else if (tier === 'BASIC') {
    rationale = `Evidence score ${score}/100 — BASIC. Letter will be sent but may receive reduced response. ${missingCritical.length > 0 ? `Upload: ${missingCritical.join('; ')} to strengthen your dispute.` : ''}`;
  } else if (tier === 'STRONG') {
    rationale = `Evidence score ${score}/100 — STRONG. Solid documentation base. Letter will include document references.${missingCritical.length > 0 ? ` Optional upgrade: ${missingCritical[0]}.` : ''}`;
  } else {
    rationale = `Evidence score ${score}/100 — AUDIT_PROOF. Maximum pressure letter with full document exhibit list.`;
  }

  return {
    score,
    tier,
    canProceed,
    missingCritical,
    availableDocs: vaultDocs,
    letterModifiers,
    rationale,
  };
}
