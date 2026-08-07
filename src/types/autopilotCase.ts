/**
 * Canonical AutoPilot case model — FINAL-WORLD-CLASS overhaul §5 / §7 / §13.
 * Smallest actionable unit: profile + canonical account + bureau + reporting snapshot.
 */

import type { PassNumber } from './creditRepair';
import type { EvidenceTier } from '../services/evidenceGateService';

export type CaseState =
  | 'IMPORTED'
  | 'NORMALIZED'
  | 'IDENTITY_RESOLVED'
  | 'FACTS_NEEDED'
  | 'EVIDENCE_NEEDED'
  | 'ELIGIBLE'
  | 'PLANNED'
  | 'DRAFTED'
  | 'VALIDATED'
  | 'USER_APPROVAL'
  | 'READY_TO_DISPATCH'
  | 'SENT'
  | 'WAITING'
  | 'RESPONSE_RECEIVED'
  | 'DEADLINE_BREACH'
  | 'DELETED'
  | 'CORRECTED'
  | 'VERIFIED'
  | 'NO_RESPONSE'
  | 'REINSERTED'
  | 'REPLAN'
  | 'RESOLVED'
  | 'MANUAL_REVIEW'
  | 'CLOSED';

export type CasePriorityLabel =
  | 'Strong case'
  | 'Promising'
  | 'Needs evidence'
  | 'Not currently actionable';

export type FactSourceType = 'report' | 'document' | 'user' | 'response' | 'derived';
export type FactConfidence = 'confirmed' | 'high' | 'ambiguous' | 'conflicting';

export type AutopilotTaskType = 'answer' | 'add' | 'review' | 'approve';
export type AutopilotTaskStatus = 'open' | 'held' | 'completed' | 'skipped';

export type AutopilotMode = 'guided' | 'review_each' | 'monitor_only';

export type ResponseOutcomeGranular =
  | 'deleted'
  | 'corrected'
  | 'verified'
  | 'partial_correction'
  | 'no_response'
  | 'frivolous'
  | 'identity_evidence_requested'
  | 'forwarded'
  | 'reinserted'
  | 'unclear';

export type GateName =
  | 'identity'
  | 'merge'
  | 'actionability'
  | 'accuracy'
  | 'evidence'
  | 'timing'
  | 'recipient'
  | 'strategy'
  | 'uniqueness'
  | 'legal'
  | 'packet'
  | 'approval';

export interface CaseFact {
  id: string;
  profileId: string;
  caseId: string;
  field: string;
  value: unknown;
  sourceType: FactSourceType;
  sourceId: string;
  capturedAt: string;
  confidence: FactConfidence;
  userConfirmedAt?: string;
  supersedesFactId?: string;
  /** Required for derived facts — rule id that produced the value */
  derivationRule?: string;
}

export interface CaseSnapshot {
  id: string;
  profileId: string;
  caseId: string;
  bureau: string;
  negativeItemId: string;
  capturedAt: string;
  /** Immutable reporting fields at capture time */
  fields: Record<string, unknown>;
  reportSourceId?: string;
}

export interface CasePriorityBreakdown {
  actionabilityConfidence: number;
  evidenceReadiness: number;
  reportingInconsistency: number;
  creditProfileRelevance: number;
  timingUrgency: number;
  strategyFit: number;
  responseOpportunity: number;
  riskPenalty: number;
  total: number;
}

export interface AutopilotCase {
  id: string;
  profileId: string;
  /** Stable key that survives re-import (account identity hash) */
  canonicalAccountKey: string;
  bureau: string;
  creditorName: string;
  accountDisplay: string;
  negativeItemId: string;
  linkedNegativeItemIds: string[];
  state: CaseState;
  passNumber: PassNumber;
  priorityScore: number;
  priorityLabel: CasePriorityLabel;
  priorityBreakdown?: CasePriorityBreakdown;
  evidenceTier: EvidenceTier;
  currentPlanId?: string;
  currentPacketId?: string;
  snapshotVersion?: string;
  factVersion?: string;
  riskFlags: string[];
  stopReason?: string;
  createdAt: string;
  updatedAt: string;
  lastTransitionAt: string;
}

export interface CasePlanAlternative {
  strategy: string;
  recipient: string;
  reasonRejected: string;
}

export interface CasePlan {
  id: string;
  profileId: string;
  caseId: string;
  snapshotVersion: string;
  factVersion: string;
  createdAt: string;
  recipientType: 'bureau' | 'furnisher' | 'collector' | 'specialty' | 'complaint';
  recipientName: string;
  strategy: string;
  passNumber: PassNumber;
  explainWhy: string[];
  evidenceUsed: string[];
  missingEvidence: string[];
  earliestSafeActionAt: string | null;
  deadlineAt: string | null;
  confidenceLabel: CasePriorityLabel;
  alternatives: CasePlanAlternative[];
  failedGate?: GateName;
  remediationTaskType?: AutopilotTaskType;
}

export interface DispatchPacket {
  id: string;
  profileId: string;
  caseId: string;
  planId: string;
  factVersion: string;
  letterContent: string;
  htmlContent?: string;
  recipientName: string;
  recipientAddress: string;
  returnAddress: string;
  accountReference: string;
  attachments: Array<{ id: string; name: string; category: string }>;
  checklist: string[];
  trackingPlaceholder: string;
  contentHash: string;
  createdAt: string;
  vaultCopyId?: string;
  validationErrors: string[];
  status: 'draft' | 'validated' | 'approved' | 'invalidated' | 'dispatched';
}

export interface PacketApproval {
  id: string;
  profileId: string;
  caseId: string;
  packetId: string;
  contentHash: string;
  approvedAt: string;
  revokedAt?: string;
  mode: AutopilotMode;
}

export interface AutopilotTask {
  id: string;
  profileId: string;
  caseId?: string;
  type: AutopilotTaskType;
  status: AutopilotTaskStatus;
  title: string;
  whyItMatters: string;
  estimatedMinutes: number;
  afterComplete: string;
  privacyImpact: 'none' | 'local_only' | 'leaves_device';
  field?: string;
  createdAt: string;
  completedAt?: string;
  payload?: Record<string, unknown>;
}

export interface AutopilotJob {
  id: string;
  profileId: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  attemptCount: number;
  maxAttempts: number;
  checkpoint?: string;
  lastError?: string;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  payload: Record<string, unknown>;
}

export interface ResponseMatch {
  id: string;
  profileId: string;
  caseId?: string;
  sourceFileName?: string;
  sender: string;
  responseDate: string;
  outcome: ResponseOutcomeGranular;
  reasonCodes: string[];
  changedFields: string[];
  confidence: number;
  needsConfirmation: boolean;
  rawExcerpt?: string;
  matchedAt: string;
  confirmedAt?: string;
}

export interface LearningAggregate {
  id: string;
  profileId: string;
  key: string;
  bureau?: string;
  furnisher?: string;
  accountType?: string;
  issueType?: string;
  evidenceTier?: string;
  strategyFamily?: string;
  pass?: number;
  responseType?: string;
  sampleCount: number;
  favorableCount: number;
  lastUpdatedAt: string;
  recencyWeightedRate: number;
}

export interface AutoPilotEvent {
  id: string;
  profileId: string;
  caseId?: string;
  type: string;
  occurredAt: string;
  actor: 'user' | 'autopilot' | 'system';
  sourceVersion: string;
  payload: Record<string, unknown>;
  previousEventHash?: string;
}

export interface GateResult {
  gate: GateName;
  passed: boolean;
  reason?: string;
  remediation?: {
    taskType: AutopilotTaskType;
    title: string;
    whyItMatters: string;
    field?: string;
  };
}

export interface MissionControlStatus {
  autopilotStatus: 'Running' | 'Needs You' | 'Waiting' | 'Paused' | 'Setup';
  nextBestAction: {
    label: string;
    detail: string;
    estimatedMinutes: number;
    taskId?: string;
    actionKind: 'import' | 'answer' | 'add' | 'approve' | 'scan' | 'monitor' | 'setup';
  };
  activeCases: number;
  waitingOnResponses: number;
  confirmedResults: number;
  pipeline: Record<string, number>;
  success: {
    deletions: number;
    corrections: number;
    activeOpportunities: number;
    avoidedPremature: number;
    estimatedMinutesSaved: number;
  };
}
