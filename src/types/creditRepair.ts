/**
 * creditRepair.ts — Extended type definitions for DylandOs Credit Repair Suite v4.0
 * 6-Round Dispute System · World-Class Archive · Credit-Grade Types
 */

// ─── CREDIT PROFILE ────────────────────────────────────────────────────────

export interface CreditProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  dob: string;
  /** Last 4 digits only — stored in UI state. Full SSN stored only in safeStorage. */
  ssnLast4: string;
  /** IPC key used to retrieve full SSN from safeStorage */
  ssnSecureKey: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  avatarInitials: string;
  /** Total removed items count */
  removedCount: number;
  /** Total active dispute items */
  activeCount: number;
  /** Next autopilot cycle date (ISO) */
  nextCycleDate: string | null;
  /** Estimated score impact from removed items */
  estimatedScoreImpact: string | null;
}

// ─── 5-PASS DISPUTE ITEM STATUS ────────────────────────────────────────────

export type PassNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type PassItemStatus =
  | "queued"           // Ready to be included in next cycle
  | "in_dispute"       // Pass letter sent, awaiting response
  | "verified_hold"    // Bureau verified — hold timer running
  | "no_response"      // No response received by deadline
  | "deleted"          // ✅ Successfully deleted
  | "resolved"         // ✅ Updated/corrected to satisfaction
  | "persist_final"    // Pass 5 complete — escalation recommended
  | "overdue"          // FCRA 35-day deadline passed without response
  | "complaint_ready"; // CFPB complaint pack ready for user to file

// ─── HOLD QUEUE ENTRY ──────────────────────────────────────────────────────

export interface HoldQueueEntry {
  id?: string;                 // Stable ID for IndexedDB write-through (backfilled if missing)
  itemId: string;
  profileId: string;
  passNumber: PassNumber;
  holdStartDate: string;       // ISO date when hold began
  holdExpiryDate: string;      // ISO date when hold expires
  verificationBureau: string;  // Which bureau verified
  responseDate: string;        // Date of bureau's verification response
  notes: string;
}

// ─── DISPATCH PLAN ─────────────────────────────────────────────────────────

export interface DispatchTarget {
  type: "bureau" | "furnisher";
  name: string;
  address: string;
  passNumber: PassNumber;
  strategy: PassStrategy;
}

export interface DispatchPlanItem {
  itemId: string;
  itemName: string;
  targets: DispatchTarget[];
  estimatedDeletability: number; // 0-100
  urgencyScore: number;          // 0-100
  passNumber: PassNumber;
}

export interface DispatchPlan {
  profileId: string;
  cycleDate: string;
  totalItems: number;
  items: DispatchPlanItem[];
  estimatedLetterCount: number;
  holdExpiryDates: Record<string, string>; // itemId → next hold expiry
}

// ─── PASS STRATEGIES ───────────────────────────────────────────────────────

export type PassStrategy =
  | "accuracy_challenge"          // Pass 1
  | "method_of_verification"      // Pass 2
  | "fdcpa_validation"            // Pass 2 (collector target)
  | "procedural_violation"        // Pass 3
  | "cfpb_complaint_threat"       // Pass 3
  | "formal_intent_to_complain"   // Pass 4
  | "final_demand"                // Pass 5
  | "cfpb_complaint_pack"         // Pass 5 output
  | "failure_to_investigate"      // No-response protocol (any pass)
  | "goodwill"                    // Side-track for late payments
  | "pay_for_delete"              // Side-track for collections
  | "legal_demand";              // Pass 6 — pre-litigation statutory demand

// ─── GENERATED LETTER (V2) ─────────────────────────────────────────────────

export interface GeneratedLetterV2 {
  id: string;
  profileId: string;
  itemId: string;
  itemName: string;
  passNumber: PassNumber;
  strategy: PassStrategy;
  targetType: "bureau" | "furnisher";
  targetName: string;
  targetAddress: string;
  legalCitations: string[];
  letterContent: string;
  htmlContent: string;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  certifiedMailNumber: string | null;
  archivePath: string | null;
  status: "draft" | "blocked" | "approved" | "queued" | "sent" | "archived";
  wordCount: number;
  validationErrors: string[];
  cycleId: string;
  scheduledMailingDate?: string;
  uniquenessScore?: number;
  strategyCardId?: string;
  explainWhy?: string[];
  evidenceTier?: string;
  primaryAngle?: string;
  /**
   * World-Class §2/§8: provenance of the letter body through the
   * LetterGenerationOrchestrator pipeline.
   *   ai_primary            → clean AI draft, all hard gates passed
   *   ai_repaired           → AI draft fixed by the targeted JSON repair pass
   *   deterministic_fallback → Stage-7 local Metro 2 template (AI unavailable)
   */
  letterSourceType?: 'ai_primary' | 'ai_repaired' | 'deterministic_fallback';
  /** Human-readable explainability trail shown on the LetterAuditBadge. */
  auditExplanation?: string;
}

// ─── AUTOPILOT CYCLE RESULT ────────────────────────────────────────────────

export interface AutoPilotCycleResult {
  cycleId: string;
  profileId: string;
  startedAt: string;
  completedAt: string;
  itemsProcessed: number;
  lettersGenerated: number;
  itemsSkippedDuplicate: number;
  itemsOnHold: number;
  /** GAP-A: Count of items auto-advanced due to inertia (no outcome logged for 45-60d) */
  inertiaEscalations?: number;
  /** GAP-J: Entropy dispatch schedule for anti-automation staggered mailing dates */
  entropySchedule?: import('../services/entropyDispatchScheduler').EntropyDispatchSchedule;
  errors: string[];
  dispatchPlan: DispatchPlan;
  letters: GeneratedLetterV2[];
  nextCycleDate: string;
  preFlightPassed: boolean;
  preFlightErrors: string[];
  /**
   * Task 1 — Pre-Flight Gatekeeper: NegativeItem IDs that failed the per-item
   * pre-flight check (DOFD missing / bureau address unresolvable). These items
   * were NOT dispatched to LetterGeneratorV2 this cycle and must be surfaced
   * to the user as "Action Required" in the AutoPilot UI.
   */
  itemsRequiringAction?: string[];
  /** Recoverable per-target failures, surfaced in Cycle Health rather than lost in logs. */
  resolutionTaskIds?: string[];
  /** Per-item strategy cards produced this cycle */
  strategyCards?: import('../services/itemStrategyPlanner').ItemStrategyCard[];
  batchRationaleStructured?: import('../services/batchSelector').BatchRationaleStructured;
  proposedActions?: Array<{
    itemId: string;
    creditorName: string;
    explainWhy: string[];
    primaryAngle?: string;
    frivolousRisk?: string;
  }>;
}

export interface AutoPilotEngineState {
  isRunning: boolean;
  lastCycleDate: string | null;
  lastCycleResult: AutoPilotCycleResult | null;
  nextCycleDate: string | null;
  schedulerActive: boolean;
  totalCyclesRun: number;
}

// ─── AUTOPILOT SETTINGS V2 ─────────────────────────────────────────────────

export interface AutoPilotSettingsV2 {
  enabled: boolean;
  batchFraction: 0.25 | 0.33;        // 25% or 33% of items per cycle
  maxItemsPerBatch: number;
  dualTargetMode: boolean;            // Dispute bureau + furnisher simultaneously
  holdDaysByPass: Record<PassNumber, number>; // { 1: 60, 2: 60, 3: 45, 4: 30, 5: 14, 6: 15 }
  cycleIntervalDays: number;          // Days between cycles (recommend 32)
  letterAutoApprove: boolean;         // Power user mode — skip review screen
  aiModel: "gpt-4o" | "claude-3.5" | "gemini-pro" | "groq";
  noResponseThresholdDays: number;    // Days before declaring no-response (default 35)
  autoGenerateCFPBOnPass5: boolean;   // Auto-generate CFPB complaint pack on Pass 5
  autoGenerateStateAGOnPass5: boolean;
  backupBeforeCycle: boolean;
}

export interface AutoPilotSettingsV3 extends AutoPilotSettingsV2 {
  letterAutoApproveEnabled: boolean;
  letterAutoApprovePassThreshold: number;
  letterAutoApproveMaxPass: number;
  autoMailDispatch: boolean;
  autoMailProvider: 'lob' | 'postgrid' | 'stannp' | 'none';
  adaptiveDuplicateWindow: boolean;
  adaptiveFrivolousHold: boolean;
  autoAttachVaultDocsByType: boolean;
  staleCycleAlertDays: number;
  requireFactualAnchorValidation: boolean;
}

// ─── VALIDATION ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LetterValidationResult extends ValidationResult {
  letterId: string;
  wordCount: number;
  legalCitationsPresent: boolean;
  targetInfo: { name: string; address: string };
  consumerInfo: { name: string; address: string };
  accountDetails: { name: string; number: string };
}

// ─── ARCHIVE / VAULT ───────────────────────────────────────────────────────

export interface StoredReport {
  id: string;
  profileId: string;
  fileName: string;
  uploadDate: string;
  bureau: string;
  encryptedPath: string;   // Path relative to vault root
  sha256Hash: string;
  sizeBytes: number;
  metadata: ReportMetadata;
}

export interface ReportMetadata {
  bureau: string;
  reportDate: string;
  itemsFound: number;
  source: "pdf" | "csv" | "manual";
}

export interface StoredLetter {
  id: string;
  profileId: string;
  cycleId: string;
  letterData: GeneratedLetterV2;
  encryptedPath: string;
  sha256Hash: string;
  archivedAt: string;
}

export interface StoredResponse {
  id: string;
  profileId: string;
  itemId: string;
  letterId: string;
  encryptedPath: string;
  sha256Hash: string;
  receivedDate: string;
  outcome: "deleted" | "verified" | "updated" | "no_response";
  bureau: string;
  metadata: ResponseMetadata;
  aiAnalysis: string | null;
}

export interface ResponseMetadata {
  bureau: string;
  responseDate: string;
  outcome: "deleted" | "verified" | "updated" | "no_response";
  notesFromUser: string;
}

export interface ArchiveDirectory {
  profileId: string;
  reports: StoredReport[];
  letters: StoredLetter[];
  responses: StoredResponse[];
  totalSizeBytes: number;
  lastUpdated: string;
}

// ─── DISPUTE HISTORY ───────────────────────────────────────────────────────

export type DisputeEventTypeV2 =
  | "pass_letter_sent"
  | "pass_letter_generated"
  | "bureau_response_received"
  | "item_deleted"
  | "item_verified"
  | "item_updated"
  | "item_no_response"
  | "hold_started"
  | "hold_expired"
  | "cycle_started"
  | "cycle_completed"
  | "autopilot_enabled"
  | "autopilot_disabled"
  | "report_uploaded"
  | "report_parsed"
  | "duplicate_prevented"
  | "validation_failed"
  | "backup_created"
  | "cfpb_complaint_generated"
  | "state_ag_complaint_generated"
  | "certified_mail_entered"
  | "user_note_added"
  | "profile_created"
  | "profile_switched";

export interface DisputeEventV2 {
  id: string;
  timestamp: string;        // ISO — immutable once written
  profileId: string;
  type: DisputeEventTypeV2;
  title: string;
  detail: string;
  itemId?: string;
  letterId?: string;
  cycleId?: string;
  passNumber?: PassNumber;
  bureau?: string;
  outcome?: string;
  certifiedMailNumber?: string;
  metadata?: Record<string, unknown>;
}

// ─── TIMELINE / FCRA DEADLINES ─────────────────────────────────────────────

export interface FCRADeadline {
  id: string;
  profileId: string;
  itemId: string;
  itemName: string;
  bureau: string;
  passNumber: PassNumber;
  letterSentDate: string;
  deadlineDate: string;     // letterSentDate + FCRA days
  status: "active" | "overdue" | "resolved" | "extended";
  fcraSection: string;      // e.g. "§611(a)(1)"
  overdueByDays: number;    // 0 if not overdue
  sourceEventId?: string;
  targetType?: "bureau" | "furnisher";
  deliveryProof?: string;
  calculationRule?: string;
}

export interface DisputeRoundTracker {
  batchId: string;
  dateExported: string; // ISO string
  statutoryDeadline: string; // 35 days from export
  currentRound: PassNumber;
  hasUserLoggedResponse: boolean;
}


// ─── CFPB COMPLAINT PACK ───────────────────────────────────────────────────

export interface CFPBComplaintPack {
  id: string;
  profileId: string;
  itemId: string;
  generatedAt: string;
  bureauComplaintDraft: string;
  furnisherComplaintDraft: string;
  disputeHistorySummary: string;
  ftcReportDraft: string | null;
  stateAGComplaintDraft: string | null;
  cfpbSubmissionUrl: string;
  ftcSubmissionUrl: string;
  stateAGInfo: { state: string; url: string; address: string } | null;
}

// ─── SCHEDULER STATE ───────────────────────────────────────────────────────

export interface SchedulerState {
  profileId: string;
  nextCycleDate: string | null;
  lastCycleDate: string | null;
  cycleIntervalDays: number;
  isScheduled: boolean;
  missedCycles: number;
}
