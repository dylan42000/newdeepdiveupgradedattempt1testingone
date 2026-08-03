/**
 * Dispute Engine — World-Class 6-Round State Machine
 * The heart of the Autopilot system. Every negative item gets its own
 * per-bureau DisputeBureauTrack that progresses through the escalation ladder.
 *
 * State Machine: CLASSIFIED → ROUND_1_READY → ... → RESOLVED_DELETED (win)
 *                                                  → ATTORNEY_REFERRAL_READY (nuclear)
 */

import { v4 as uuidv4 } from 'uuid';
import { NegativeItem } from '../types';
import { getResolvedAccountNumber } from './tradelineMerger';

// ── Dispute States ─────────────────────────────────────────────────────────────
export type DisputeState =
  | 'CLASSIFIED'
  | 'ROUND_1_READY'
  | 'ROUND_1_GENERATED'
  | 'ROUND_1_SENT'
  | 'ROUND_1_AWAITING'
  | 'ROUND_1_RESPONSE_RECV'
  | 'ROUND_1_DEADLINE_MISSED'
  | 'ROUND_2_READY'
  | 'ROUND_2_GENERATED'
  | 'ROUND_2_SENT'
  | 'ROUND_2_AWAITING'
  | 'ROUND_2_RESPONSE_RECV'
  | 'ROUND_2_DEADLINE_MISSED'
  | 'ROUND_3_READY'
  | 'ROUND_3_GENERATED'
  | 'ROUND_3_SENT'
  | 'ROUND_3_AWAITING'
  | 'ROUND_3_RESPONSE_RECV'
  | 'ROUND_3_DEADLINE_MISSED'
  | 'ROUND_4_READY'
  | 'ROUND_4_GENERATED'
  | 'ROUND_4_SENT'
  | 'ROUND_4_AWAITING'
  | 'ROUND_4_RESPONSE_RECV'
  | 'ROUND_4_DEADLINE_MISSED'
  | 'ROUND_5_READY'
  | 'ROUND_5_GENERATED'
  | 'ROUND_5_SENT'
  | 'ROUND_5_AWAITING'
  | 'ROUND_5_RESPONSE_RECV'
  | 'ROUND_5_DEADLINE_MISSED'
  | 'ROUND_6_READY'
  | 'ROUND_6_GENERATED'
  | 'ROUND_6_SENT'
  | 'ROUND_6_AWAITING'
  | 'ROUND_6_RESPONSE_RECV'
  | 'CFPB_COMPLAINT_READY'
  | 'CFPB_COMPLAINT_FILED'
  | 'LEGAL_DEMAND_READY'
  | 'LEGAL_DEMAND_SENT'
  | 'COURT_FILING_READY'
  | 'ATTORNEY_REFERRAL_READY'
  | 'RESOLVED_DELETED'
  | 'RESOLVED_UPDATED'
  | 'RESOLVED_ACCURATE'
  | 'GOODWILL_PENDING'
  | 'PAY_FOR_DELETE_PENDING'
  | 'PAUSED_SOL'
  | 'PAUSED_ACTIVE_DISPUTE'
  | 'FAILED_ACCURATE';

// ── Bureau Response Types ──────────────────────────────────────────────────────
export type BureauResponseType =
  | 'DELETED'
  | 'UPDATED'
  | 'VERIFIED_ACCURATE'
  | 'FRIVOLOUS'
  | 'IN_DISPUTE_NOTATION'
  | 'NO_RESPONSE_30_DAYS'
  | 'RE_INSERTED'
  | 'PARTIAL_UPDATE';

// ── Round Strategy ─────────────────────────────────────────────────────────────
export type RoundStrategy =
  | 'R1_DISCOVERY_STRIKE'          // §609 + §611 initial
  | 'R2_EVIDENCE_HAMMER'           // MOV demand + deadline violation
  | 'R2_DEADLINE_VIOLATION'        // 30-day missed → FCRA violation
  | 'R3_FURNISHER_BYPASS'          // §623 direct furnisher
  | 'R3_METRO2_AUDIT'              // Metro 2 compliance violations
  | 'R3_GOODWILL_PARALLEL'         // Goodwill to original creditor
  | 'R3_PAY_FOR_DELETE'            // PFD negotiation
  | 'R4_CFPB_COMPLAINT'            // CFPB + FTC + State AG
  | 'R5_LEGAL_DEMAND'              // FCRA lawsuit threat
  | 'R5_CONSUMER_STATEMENT'        // 100-word consumer statement
  | 'R6_SMALL_CLAIMS_PACKAGE'      // Court filing package
  | 'R6_ATTORNEY_REFERRAL'         // Full case docs for attorney
  | 'R6_FINAL_CERTIFIED_DEMAND';   // Last certified demand to CEO

// ── AI Classification ─────────────────────────────────────────────────────────
export type DisputeCategory =
  | 'not_mine_identity_theft'
  | 'not_mine_mixed_file'
  | 'paid_in_full_shows_balance'
  | 'settled_shows_full_balance'
  | 'included_in_bankruptcy'
  | 'discharged_in_bankruptcy'
  | 'past_7_year_limit'
  | 'inaccurate_dofd'
  | 're_aged_account'
  | 'incorrect_status'
  | 'wrong_balance'
  | 'wrong_credit_limit'
  | 'incorrect_payment_history'
  | 'unauthorized_inquiry'
  | 'duplicate_entry'
  | 'obsolete_account'
  | 'metro2_compliance_violation'
  | 'cross_bureau_inconsistency'
  | 'medical_debt_violates_cfpb_2023'
  | 'collection_after_transfer';

export interface FCRAViolations {
  section609_no_disclosure: boolean;
  section611_no_investigation: boolean;
  section611_no_response_30_days: boolean;
  section623_furnisher_failure: boolean;
  section605_obsolete: boolean;
  section605b_id_theft: boolean;
}

export interface DisputeClassification {
  disputeCategories: DisputeCategory[];
  primaryCategory: DisputeCategory | null;
  fcraViolations: FCRAViolations;
  metro2Violations: string[];
  crossBureauInconsistencies: string[];
  estimatedScoreImpact: number;
  removalLikelihood: number;  // 0.0–1.0
  priorityScore: number;       // 1–100
  estimatedRoundsToRemoval: number;
  recommendedRound1Strategy: string;
  bestLegalArgument: string;
  solStatus: 'within_7yr' | 'beyond_7yr' | 'unknown';
  isMedicalDebt: boolean;
  notes: string;
}

// ── Generated Letter ──────────────────────────────────────────────────────────
export interface GeneratedLetter {
  id: string;
  disputeItemId: string;
  bureauName: string;
  round: number;
  strategy: RoundStrategy;
  content: string;
  generatedAt: Date;
  sentAt: Date | null;
  certifiedMailNumber: string | null;
  printReady: boolean;
  dnaHash: string;  // Uniqueness fingerprint
}

// ── Bureau Response ───────────────────────────────────────────────────────────
export interface BureauResponse {
  id: string;
  bureauName: string;
  responseType: BureauResponseType;
  receivedAt: Date;
  notes: string;
  round: number;
  rawText?: string;
}

// ── Per-Bureau Dispute Track ──────────────────────────────────────────────────
export interface DisputeBureauTrack {
  id: string;
  disputeItemId: string;
  bureauName: 'equifax' | 'experian' | 'transunion';
  currentState: DisputeState;
  currentRound: 1 | 2 | 3 | 4 | 5 | 6;
  rounds: DisputeRoundRecord[];
  nextActionDate: Date | null;
  lastActionDate: Date | null;
  generatedLetters: GeneratedLetter[];
  receivedResponses: BureauResponse[];
  outcome: 'deleted' | 'updated' | 'verified' | 'in_progress' | null;
  cfpbComplaintFiled: boolean;
  cfpbCaseNumber: string | null;
  legalDemandSent: boolean;
  violationLog: string[];  // Running list of documented FCRA violations
}

// ── Dispute Round Record ──────────────────────────────────────────────────────
export interface DisputeRoundRecord {
  roundNumber: 1 | 2 | 3 | 4 | 5 | 6;
  strategy: RoundStrategy;
  letterGeneratedAt: Date | null;
  letterSentAt: Date | null;
  certifiedMailNumber: string | null;
  deadlineDate: Date | null;
  responseReceivedAt: Date | null;
  responseType: BureauResponseType | null;
  notes: string;
  daysSinceLastAction: number;
  fcraViolationDocumented: boolean;
}

// ── Full Dispute Item (engine-level) ──────────────────────────────────────────
export interface DisputeItem {
  id: string;
  negativeItemId: string;  // Links to NegativeItem in AppContext

  // Account Identity
  accountName: string;
  accountNumber: string;
  accountType: 'collection' | 'chargeoff' | 'late_payment' | 'inquiry' | 'bankruptcy' | 'other';

  // Bureau Tracks (one per bureau the item appears on)
  bureauTracks: Partial<Record<'equifax' | 'experian' | 'transunion', DisputeBureauTrack>>;

  // AI Classification
  classification: DisputeClassification | null;

  // Financial Impact
  estimatedScoreImpact: number;
  priorityScore: number;
  currentBalance: number;
  originalCreditor: string | null;

  // Date Fields
  dateOpened: Date | null;
  dateOfFirstDelinquency: Date | null;
  dateLastActive: Date | null;
  autoRemovalDate: Date | null;

  // Parallel Tracks
  goodwillLetterStatus: 'none' | 'pending' | 'sent' | 'approved' | 'denied';
  payForDeleteStatus: 'none' | 'pending' | 'offer_sent' | 'accepted' | 'denied';

  // Medical debt flag
  isMedicalDebt: boolean;

  // Metadata
  createdAt: Date;
  lastUpdatedAt: Date;
  notes: string;
  userId: string;  // For multi-profile support
}

// ── State Machine Transitions ─────────────────────────────────────────────────

export const ROUND_SENT_STATE: Record<number, DisputeState> = {
  1: 'ROUND_1_SENT', 2: 'ROUND_2_SENT', 3: 'ROUND_3_SENT',
  4: 'ROUND_4_SENT', 5: 'ROUND_5_SENT', 6: 'ROUND_6_SENT',
};

export const ROUND_AWAITING_STATE: Record<number, DisputeState> = {
  1: 'ROUND_1_AWAITING', 2: 'ROUND_2_AWAITING', 3: 'ROUND_3_AWAITING',
  4: 'ROUND_4_AWAITING', 5: 'ROUND_5_AWAITING', 6: 'ROUND_6_AWAITING',
};

export const ROUND_READY_STATE: Record<number, DisputeState> = {
  1: 'ROUND_1_READY', 2: 'ROUND_2_READY', 3: 'ROUND_3_READY',
  4: 'ROUND_4_READY', 5: 'ROUND_5_READY', 6: 'ROUND_6_READY',
};

export const ROUND_RESPONSE_STATE: Record<number, DisputeState> = {
  1: 'ROUND_1_RESPONSE_RECV', 2: 'ROUND_2_RESPONSE_RECV',
  3: 'ROUND_3_RESPONSE_RECV', 4: 'ROUND_4_RESPONSE_RECV',
  5: 'ROUND_5_RESPONSE_RECV', 6: 'ROUND_6_RESPONSE_RECV',
};

export const ROUND_DEADLINE_MISSED_STATE: Record<number, DisputeState> = {
  1: 'ROUND_1_DEADLINE_MISSED', 2: 'ROUND_2_DEADLINE_MISSED',
  3: 'ROUND_3_DEADLINE_MISSED', 4: 'ROUND_4_DEADLINE_MISSED',
  5: 'ROUND_5_DEADLINE_MISSED',
};

// ── Round Strategy Selection ──────────────────────────────────────────────────

export function getStrategyForRound(
  round: number,
  response: BureauResponseType | null,
  item: Partial<NegativeItem>
): RoundStrategy {
  switch (round) {
    case 1:
      return 'R1_DISCOVERY_STRIKE';
    case 2:
      if (response === 'NO_RESPONSE_30_DAYS') return 'R2_DEADLINE_VIOLATION';
      return 'R2_EVIDENCE_HAMMER';
    case 3:
      return 'R3_FURNISHER_BYPASS';
    case 4:
      return 'R4_CFPB_COMPLAINT';
    case 5:
      return 'R5_LEGAL_DEMAND';
    case 6:
      return 'R6_SMALL_CLAIMS_PACKAGE';
    default:
      return 'R1_DISCOVERY_STRIKE';
  }
}

// ── Transition: Apply Bureau Response ─────────────────────────────────────────

export function applyBureauResponse(
  track: DisputeBureauTrack,
  response: BureauResponseType,
  notes: string
): DisputeBureauTrack {
  const updated = { ...track };
  const responseRecord: BureauResponse = {
    id: uuidv4(),
    bureauName: track.bureauName,
    responseType: response,
    receivedAt: new Date(),
    notes,
    round: track.currentRound,
  };

  updated.receivedResponses = [...track.receivedResponses, responseRecord];
  updated.lastActionDate = new Date();

  switch (response) {
    case 'DELETED':
      updated.currentState = 'RESOLVED_DELETED';
      updated.outcome = 'deleted';
      break;

    case 'UPDATED':
    case 'PARTIAL_UPDATE':
      updated.currentState = 'RESOLVED_UPDATED';
      updated.outcome = 'updated';
      break;

    case 'RE_INSERTED': {
      // Illegal re-insertion — documents FCRA violation and escalates
      const violation = `Round ${track.currentRound}: Item illegally re-inserted after deletion — FCRA §611(f) violation.`;
      updated.violationLog = [...track.violationLog, violation];
      updated.currentState = nextRoundReadyState(track.currentRound);
      updated.currentRound = Math.min(6, track.currentRound + 1) as 1|2|3|4|5|6;
      break;
    }

    case 'NO_RESPONSE_30_DAYS': {
      const violation = `Round ${track.currentRound}: Bureau failed to respond within 30 days — FCRA §611(a)(1) violation.`;
      updated.violationLog = [...track.violationLog, violation];
      updated.currentState = nextRoundReadyState(track.currentRound);
      updated.currentRound = Math.min(6, track.currentRound + 1) as 1|2|3|4|5|6;
      break;
    }

    case 'FRIVOLOUS':
      // Frivolous determination with supporting evidence → escalate to Round 3+ furnisher
      updated.currentState = nextRoundReadyState(track.currentRound);
      updated.currentRound = Math.min(6, track.currentRound + 1) as 1|2|3|4|5|6;
      break;

    case 'VERIFIED_ACCURATE':
      if (track.currentRound >= 6) {
        updated.currentState = 'ATTORNEY_REFERRAL_READY';
      } else {
        updated.currentState = nextRoundReadyState(track.currentRound);
        updated.currentRound = Math.min(6, track.currentRound + 1) as 1|2|3|4|5|6;
      }
      break;

    default:
      updated.currentState = ROUND_RESPONSE_STATE[track.currentRound] ?? 'ROUND_1_RESPONSE_RECV';
  }

  return updated;
}

function nextRoundReadyState(currentRound: number): DisputeState {
  const next = Math.min(6, currentRound + 1);
  return ROUND_READY_STATE[next] ?? 'ROUND_6_READY';
}

// ── Factory: Create new DisputeBureauTrack ─────────────────────────────────────

export function createBureauTrack(
  disputeItemId: string,
  bureauName: 'equifax' | 'experian' | 'transunion'
): DisputeBureauTrack {
  return {
    id: uuidv4(),
    disputeItemId,
    bureauName,
    currentState: 'ROUND_1_READY',
    currentRound: 1,
    rounds: [],
    nextActionDate: new Date(),
    lastActionDate: null,
    generatedLetters: [],
    receivedResponses: [],
    outcome: null,
    cfpbComplaintFiled: false,
    cfpbCaseNumber: null,
    legalDemandSent: false,
    violationLog: [],
  };
}

// ── Factory: Create DisputeItem from NegativeItem ─────────────────────────────

export function createDisputeItemFromNegative(
  item: NegativeItem,
  userId: string = 'default'
): DisputeItem {
  const bureaus = (item.creditBureau || []).map((b) => b.toLowerCase()) as Array<'equifax' | 'experian' | 'transunion'>;
  const tracks: Partial<Record<'equifax' | 'experian' | 'transunion', DisputeBureauTrack>> = {};
  const disputeItemId = uuidv4();

  bureaus.forEach((bureau) => {
    tracks[bureau] = createBureauTrack(disputeItemId, bureau);
  });

  const dofd = item.dateOfFirstDelinquency || item.originalDateOfDelinquency;
  const autoRemoval = item.autoRemovalDate
    ? new Date(item.autoRemovalDate)
    : dofd ? (() => { const d = new Date(dofd); d.setFullYear(d.getFullYear() + 7); return d; })()
    : null;

  return {
    id: disputeItemId,
    negativeItemId: item.id,
    accountName: item.creditorName,
    accountNumber: getResolvedAccountNumber(item),
    accountType: mapAccountType(item.typeOfNegative),
    bureauTracks: tracks,
    classification: null,
    estimatedScoreImpact: item.priorityScore ?? 0,
    priorityScore: item.priorityScore ?? 0,
    currentBalance: item.balance ?? 0,
    originalCreditor: item.originalCreditor ?? null,
    dateOpened: item.dateOpened ? new Date(item.dateOpened) : null,
    dateOfFirstDelinquency: dofd ? new Date(dofd) : null,
    dateLastActive: item.dateLastActive ? new Date(item.dateLastActive) : null,
    autoRemovalDate: autoRemoval,
    goodwillLetterStatus: 'none',
    payForDeleteStatus: 'none',
    isMedicalDebt: (item.typeOfNegative || '').toLowerCase().includes('medical') ||
                   (item.additionalInfo || '').toLowerCase().includes('medical'),
    createdAt: new Date(),
    lastUpdatedAt: new Date(),
    notes: '',
    userId,
  };
}

function mapAccountType(type: string): DisputeItem['accountType'] {
  const t = (type || '').toLowerCase();
  if (t.includes('collection')) return 'collection';
  if (t.includes('charge')) return 'chargeoff';
  if (t.includes('late') || t.includes('30') || t.includes('60') || t.includes('90') || t.includes('120')) return 'late_payment';
  if (t.includes('inquiry')) return 'inquiry';
  if (t.includes('bankruptcy')) return 'bankruptcy';
  return 'other';
}

// ── CFPB Readiness Check ──────────────────────────────────────────────────────

export function isCFPBComplaintReady(bureauTrack: DisputeBureauTrack): boolean {
  // Must have at least Round 1 and Round 2 completed with verified responses
  const completedRounds = bureauTrack.rounds.filter((r) => r.responseType !== null).length;
  if (completedRounds < 2) return false;

  // Must have at least one VERIFIED_ACCURATE or NO_RESPONSE_30_DAYS response
  const hasInvalidResponse = bureauTrack.receivedResponses.some((r) =>
    ['VERIFIED_ACCURATE', 'NO_RESPONSE_30_DAYS', 'FRIVOLOUS'].includes(r.responseType)
  );

  // Must have at least 60 days elapsed since first letter
  const firstRound = bureauTrack.rounds[0];
  if (!firstRound?.letterSentAt) return false;
  const daysSinceStart = (Date.now() - firstRound.letterSentAt.getTime()) / (1000 * 60 * 60 * 24);

  return hasInvalidResponse && daysSinceStart >= 60;
}

// ── FCRA Damages Calculator ───────────────────────────────────────────────────

export interface DamagesEstimate {
  statutoryMin: number;   // $100 per violation
  statutoryMax: number;   // $1,000 per violation
  violationCount: number;
  totalMin: number;
  totalMax: number;
  punitivePossible: boolean;
  breakdown: string[];
}

export function calculateFCRADamages(bureauTrack: DisputeBureauTrack): DamagesEstimate {
  const violations = bureauTrack.violationLog;
  const count = violations.length;
  const punitive = count >= 3;  // Pattern of willful non-compliance

  return {
    statutoryMin: 100,
    statutoryMax: 1000,
    violationCount: count,
    totalMin: count * 100,
    totalMax: count * 1000,
    punitivePossible: punitive,
    breakdown: violations,
  };
}

// ── Letter DNA Hash (Uniqueness Fingerprint) ──────────────────────────────────

export interface LetterVariationSeed {
  itemId: string;
  bureau: string;
  round: number;
  openingStyle: 'statement' | 'question' | 'declaration' | 'demand';
  focusAngle: 'legal' | 'factual' | 'procedural' | 'emotional_impact';
  priorLetterHashes: string[];
}

export function generateLetterDNA(item: DisputeItem, bureau: string, round: number): LetterVariationSeed {
  const track = item.bureauTracks[bureau as 'equifax' | 'experian' | 'transunion'];
  const priorHashes = track?.generatedLetters.map((l) => l.dnaHash) ?? [];

  const openingStyles: LetterVariationSeed['openingStyle'][] = ['statement', 'question', 'declaration', 'demand'];
  const focusAngles: LetterVariationSeed['focusAngle'][] = ['legal', 'factual', 'procedural', 'emotional_impact'];

  // Rotate styles to ensure diversity
  const styleIndex = round % openingStyles.length;
  const angleIndex = (round + item.id.charCodeAt(0)) % focusAngles.length;

  return {
    itemId: item.id,
    bureau,
    round,
    openingStyle: openingStyles[styleIndex],
    focusAngle: focusAngles[angleIndex],
    priorLetterHashes: priorHashes,
  };
}

// ── Summary helpers ───────────────────────────────────────────────────────────

export function getDisputeProgress(item: DisputeItem): {
  totalBureaus: number;
  deleted: number;
  inProgress: number;
  highestRound: number;
} {
  const tracks = Object.values(item.bureauTracks);
  return {
    totalBureaus: tracks.length,
    deleted: tracks.filter((t) => t?.outcome === 'deleted').length,
    inProgress: tracks.filter((t) => t?.outcome === 'in_progress' || t?.outcome === null).length,
    highestRound: Math.max(...tracks.map((t) => t?.currentRound ?? 1)),
  };
}

export function isItemFullyResolved(item: DisputeItem): boolean {
  const tracks = Object.values(item.bureauTracks);
  return tracks.length > 0 && tracks.every((t) =>
    t?.outcome === 'deleted' || t?.outcome === 'updated' || t?.outcome === 'verified'
  );
}
