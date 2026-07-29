export type DisputeRound = 1 | 2 | 3 | 4 | 5 | 6;

// PersonalInfo — exported here for use by services that can't import from AppContext
export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ssn: string;
  dob: string;
}
export type MailDeliveryProvider = "lob" | "postgrid" | "stannp" | "manual";
export type DisputeItemStatus =
  | "Undisputed"
  | "Round1-Pending"
  | "Round1-Verified"
  | "Round2-Pending"
  | "Round2-Verified"
  | "Round3-Pending"
  | "Round3-Verified"
  | "Round4-Legal"
  | "Round4-Verified"
  | "Round5-CFPB"
  | "Round5-Verified"
  | "Round6-PreLit"
  | "Deleted"
  | "Won";

export interface ItemNote {
  id: string;
  date: string;
  text: string;
  certifiedMailTracking?: string;
}

export interface NegativeItem {
  id: string;
  creditorName: string;
  accountNumber: string;
  balance: number | null;
  typeOfNegative: string;
  originalDateOfDelinquency: string | null;
  dateOfLastReporting: string | null;
  originalOpeningDate: string | null;
  status: string;
  creditBureau: string[];
  additionalInfo: string;
  // Dispute tracking (A1)
  disputeRound: DisputeRound;
  disputeStatus: DisputeItemStatus;
  lastDisputeDate: string | null;
  disputeDeadline: string | null;
  priorityScore: number; // A9
  estimatedScoreImpact: string | null; // O14
  notes: ItemNote[]; // O6
  solDropDate: string | null; // A15 / O8
  // Upgrade 5 — Per-item strategy override
  forceStrategy?: "default" | "goodwill" | "pay-for-delete" | "aggressive" | "legal";
  // Upgrade 6 — Goodwill eligibility flag
  goodwillEligible?: boolean;
  // Upgrade 7 — Pay-for-Delete eligibility flag
  p4dEligible?: boolean;
  // Upgrade 18 — SOL Pause Guard
  solPaused?: boolean;
  // Upgrade 11 — Furnisher bypass flag (double-verified)
  doubleVerified?: boolean;
  verificationCount?: number;
  // Extended credit data — populated by AI parser
  dateOpened?: string | null;
  dateClosed?: string | null;
  dateLastActive?: string | null;
  dateOfFirstDelinquency?: string | null;  // explicit DOFD (mirrors originalDateOfDelinquency)
  autoRemovalDate?: string | null;          // DOFD + 7 years per FCRA §1681c(a)(1)
  originalCreditor?: string | null;
  accountType?: string | null;
  creditLimit?: number | null;
  originalBalance?: number | null;
  paymentHistory?: string | null;           // e.g. “3×30d, 1×60d, 2×90d”
  furnisher?: string | null;  // Parser Upgrade 1 — Full account number reconstructed from partial/masked across bureaus
  fullAccountNumber?: string | null;
  // Parser Upgrade 2 — Cross-bureau deduplication group ID (UUID shared across same account on multiple reports)
  crossBureauGroupId?: string | null;
  /** LINK_ONLY campaign identity — shared across bureau rows without collapsing into one tradeline */
  campaignGroupId?: string | null;
  // Parser Upgrade 4 — Confidence score from AI parsing (0–1)
  parseConfidence?: number | null;
  // Parser Upgrade 3 — Dispute contact info extracted from report text
  disputeContactPhone?: string | null;
  disputeContactAddress?: string | null;
  // Upgrade 8 — Medical debt specialist flag
  isMedicalDebt?: boolean;
  // Manual entry trust metadata (used to override strict grounding blocks)
  dataSource?: "parser" | "manual" | "import";
  accuracyConfirmedByUser?: boolean;
  accuracyConfirmedAt?: string | null;
  accuracyConfirmationNote?: string | null;
  // Issue 4 — Metro 2 audit field: Account Status code (Metro 2 Field 17B)
  // e.g. '05' (transferred), '11' (current), '13' (paid/closed), '61'–'64' (paid in full),
  //      '71'/'78' (past due), '80'/'82'/'83'/'84' (BK), '93'/'97' (charge-off/loss)
  // Distinct from `status` which tracks dispute tracking state.
  accountStatus?: string | null;
  metro2Violations?: import('./services/metro2Auditor').Metro2Violation[];
}

export interface DisputeLetter {
  id: string;
  negativeItemIds: string[];
  content: string;
  /** BUG-04 FIX: Full formatted HTML with sender/recipient blocks from buildLetterHTML() */
  htmlContent?: string;
  /** BUG-10 FIX: Clean body HTML without the RE: line (for PDF rebuild path) */
  bodyContent?: string;
  /** Track which engine version generated this letter */
  letterVersion?: 'v1' | 'v2';
  createdAt: string;
  status: "Draft" | "Sent" | "Resolved";
  bureau: string;
  round: DisputeRound;
  batchId: string | null;
  templateType: LetterTemplateType;
  // Upgrade 1 — Certified Mail
  certifiedMail?: boolean;
  trackingNumber?: string;
  mailed?: boolean;
  mailedAt?: string | null;
  // Upgrade 16 — Dispute Strength Score
  disputeStrengthScore?: number; // 1-10
  disputeStrengthReason?: string;
  // Upgrade 2 — Dual Dispute target
  targetType?: "bureau" | "furnisher" | "dual";
  // Upgrade 1 — Uniqueness engine metadata
  uniquenessFingerprint?: string;
  similarityScore?: number;
  rewriteAttempts?: number;
  // Upgrade 5 — Reason code rotator selection
  selectedDisputeAngle?: string;
  // Upgrade 3 — Print-to-mail metadata
  mailDeliveryProvider?: MailDeliveryProvider;
  mailDeliveryId?: string;
  mailSentAt?: string | null;
  mailDeliveredAt?: string | null;
  mailCostCents?: number | null;
  // Upgrade 7 — Genealogy tracking field
  aiProviderUsed?: "groq" | "gemini" | "cloudflare" | "openai" | "unknown";
}

export type LetterTemplateType =
  | "609-Identity"
  | "609-Disclosure"
  | "611-Reinvestigation"
  | "623-Furnisher"
  | "611a7-MethodOfInvestigation"
  | "Goodwill"
  | "PayForDelete"
  | "CeaseAndDesist"
  | "DualDispute-BureauFurnisher"
  | "CFPBComplaint"
  | "CFPBComplaintStateAG"
  | "PreLitigation"
  | "AggressiveDual"
  | "ReInsertionViolation";

export interface CreditReport {
  id: string;
  fileName: string;
  uploadDate: string;
  status: "Processing" | "Completed" | "Failed";
  extractedItemsCount: number;
  bureau?: string;
}

// Vault document interface used by Vault.tsx
export interface VaultDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  category: string;
  uploadDate: string;
  data: ArrayBuffer | string;
  tags: string[];
}

// A8 / O2 — Persistent event log
export type HistoryEventType =
  | "report_uploaded"
  | "items_parsed"
  | "letter_generated"
  | "letter_sent"
  | "response_logged"
  | "item_deleted"
  | "item_updated"
  | "item_added"
  | "item_won"
  | "batch_started"
  | "batch_completed"
  | "escalation_triggered"
  | "escalation"
  | "score_entry_added"
  | "score_updated"
  | "vault_upload"
  | "data_backup"
  | "dispute_letter_sent"
  | "campaign_started"
  | "campaign_completed"
  | "autopilot_cycle_run"
  | "note_added";

export interface HistoryEvent {
  id: string;
  timestamp: string;
  type: HistoryEventType;
  title: string;
  detail: string;
  itemId?: string;
  letterId?: string;
  bureau?: string;
  round?: DisputeRound;
  outcome?: string;
}

// A2 / A10 — Autopilot batch + campaign
export type BatchStatus = "Preview" | "Active" | "Complete" | "Waiting";

export interface AutopilotBatch {
  id: string;
  campaignId: string;
  createdAt: string;
  itemIds: string[];
  letterIds: string[];
  round: DisputeRound;
  status: 'pending' | 'sent' | 'responded' | 'complete';
  stats: {
    total: number;
    sent: number;
    responded: number;
    deleted: number;
    verified: number;
  };
  // Legacy / extended fields — kept for backward compat
  bureau?: string;
  sentAt?: string | null;
  deadlineAt?: string | null;
  responseDue?: string | null;
  mailMode?: "stamp" | "certified";
  scheduledSendDate?: string | null;
  mailed?: boolean;
  mailedAt?: string | null;
  targetType?: "bureau" | "furnisher" | "dual";
}

// Upgrade 19 — Personalization variables
export interface PersonalizationVars {
  hardshipReason: string;
  preferredName: string;
  specialInstructions: string;
}

export interface AutopilotCampaign {
  id: string;
  name: string;
  startDate: string;
  totalItems: number;
  resolvedItems: number;
  currentRound: DisputeRound;
  status: "Active" | "Paused" | "Complete";
  batches: AutopilotBatch[];
  // Upgrade 20 — Campaign Success Report
  successReport?: string;
  completedAt?: string;
  winRate?: number;
}

// O3 — Score tracker (single-entry model: one score + bureau per entry)
export interface ScoreEntry {
  id: string;
  date: string;
  score: number;
  bureau: string;
  notes?: string;
  // Legacy per-bureau breakout (optional — kept for backward compat)
  equifax?: number | null;
  experian?: number | null;
  transunion?: number | null;
}

// A8 — Autopilot event log entry
export interface AutopilotLogEvent {
  id: string;
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  type?: 'cycle' | 'letter' | 'response' | 'campaign' | 'system';
  metadata?: Record<string, unknown>;
}

// ─── Credit Builder Types ──────────────────────────────────────────────────

// CB-1 — Utilization War Room + Mix Analyzer + Age/CLI
export interface CreditCard {
  id: string;
  name: string;          // "Chase Freedom"
  issuer: string;
  type: "revolving" | "installment" | "open";
  limit: number;
  balance: number;
  apr: number;
  openedDate: string;    // YYYY-MM-DD
  cliRequestedDate?: string | null;
  isAuthorizedUser?: boolean;
}

// CB-2 — Hard Inquiry Fade Timer
export interface HardInquiry {
  id: string;
  creditor: string;
  purpose: "auto" | "mortgage" | "credit-card" | "personal-loan" | "other";
  bureau: string;
  date: string;          // YYYY-MM-DD
  notes?: string;
}

// CB-3 — Authorized User Tracker
export interface AuthorizedUserAccount {
  id: string;
  ownerName: string;     // "Mom", "Spouse"
  creditor: string;
  limit: number;
  balance: number;
  openedDate: string;    // YYYY-MM-DD
  status: "Active" | "Closed";
}

// CB-4 — Experian Boost / Program Tracker
export interface BoostProgram {
  id: string;
  name: string;
  bureau: string;
  enrolled: boolean;
  estimatedPoints: number;
  notes: string;
}
