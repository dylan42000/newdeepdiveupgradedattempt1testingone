/**
 * autoPilotEngineV2.ts — 6-Round Escalating Dispute Engine
 * Zero-bug design with credit-grade reliability rules (Rules 1-10).
 * Orchestrates: batch selection, target planning, letter generation, 
 * hold queue, timeline tracking, duplicate prevention, archive.
 */

import { NegativeItem } from '../types';
import {
  AutoPilotSettingsV2, AutoPilotSettingsV3, AutoPilotCycleResult, AutoPilotEngineState,
  DispatchPlan, DispatchPlanItem, GeneratedLetterV2, PassNumber,
  ValidationResult, SchedulerState,
} from '../types/creditRepair';
import { BatchSelector } from './batchSelector';
import { TargetPlanner } from './targetPlanner';
import { generateDisputeLetter, DisputeLetterRequest, GeneratedLetter } from './letterGeneratorV2';
import { orchestrateLetterGeneration } from './letterGenerationOrchestrator';
import { HoldQueue } from './holdQueue';
import { TimelineTracker } from './timelineTracker';
import { DisputeHistoryService } from './disputeHistoryService';
import { ArchiveService } from './archiveService';
import { ItemScorer } from './itemScorer';
import { assertNoBoilerplate, BoilerplateDetectedException } from './letterValidator';
import { sanitizeForLog } from './sanitizer';
import { v4 as uuidv4 } from 'uuid';
import { scanForUnfilledTokens } from './placeholderService';
// BUG-08 FIX: Import IndexedDB accessors for durable pass number storage
import { idbSavePassNumbers, idbLoadPassNumbers, idbSaveEngineState } from './autopilotMigration';
// BUG-09 FIX: Import escalation engine for clean FCRA no-response loop
import { applyEscalations } from './escalationEngine';
// GAP-A: Import inertia escalation service for 3-tier stalled-outcome detection
import { evaluateInertia } from './inertiaEscalationService';
import type { InertiaAction } from './inertiaEscalationService';
// GAP-B: Import evidence gate to block/modify letters by vault doc strength
import { evaluateEvidenceReadiness, EvidenceDoc, DisputeType } from './evidenceGateService';
// GAP-D: Import strategy rotation engine for anti-pattern legal argument rotation
import { getRotationStrategy, checkDelinquencyDateManipulation, DisputeHistoryEntry } from './strategyRotationEngine';
// GAP-G: Import frivolous response counter-attack protocol
import { buildFrivolousChallengePlan } from './frivolousResponseService';
// GAP-I: Import bureau tone calibration engine for bureau-specific letter tuning
import { getBureauCalibrationDirective, BureauName } from './bureauCalibrationEngine';
// GAP-J: Import entropy dispatch scheduler for anti-automation staggering
import { buildEntropyDispatchSchedule, getScheduledDateForItem } from './entropyDispatchScheduler';
// GAP-H: Import cycle audit service for persistent cycle history
import { saveCycleAuditRecord } from './cycleAuditService';
import { evaluateDisputeUniqueness } from './antiSpamDisputeEngine';
import { DeletionOutcomeEngine } from './deletionOutcomeEngine';
import { buildLetterDNA, LetterDNA } from './letterDNA';
import { assessFrivolousRisk } from './frivolousFlagGuard';
import { generateDirectDispute } from './directFurnisherEngine';
import { isGoodwillEligible, autoSelectGoodwillStrategy } from './goodwillLetterEngine';
import { analyzeChainOfCustody } from './furnisherChainOfCustodyService';
import { projectScoreImpact } from './scoreImpactProjector';
import { auditMetro2, Metro2AuditInput } from './metro2AuditService';
import { runExpirationRadar } from './expirationRadarService';
// Task 1: Per-item pre-flight gatekeeper (DOFD + address validation)
import { runPreFlightCheck, enrichTarget } from './preFlightChecker';
// Task 2: Cross-bureau kill shot — detect sibling bureau deletions
import { findCrossBureauDeletions } from './crossBureauAnalyzer';
// QUEUE FIX: Import concurrency-capped queue manager to prevent Groq 429 crashes
import { apiQueueManager } from './apiQueueManager';
import { HealedAccount, normalizeCreditorName, computeConfidenceScore } from './accountHealingEngine';
import { Metro2AuditEngine } from './metro2AuditEngine';
import { DisputeClockEngine } from './disputeClockEngine';
import {
  isAccountNumberIncomplete,
  resolvePostProcessedAccountNumber,
} from './tradelineMerger';
import { shouldPivotPass1ToDisclosure } from './disputePromptBuilder';
import {
  planBatchStrategies,
  strategyHintsFromCards,
} from './itemStrategyPlanner';
import { loadOutcomesFromIdb, recordOutcome } from './disputeOutcomeTracker';
import {
  getPriorLetterContentsForItem,
  persistLetterForUniqueness,
  setSessionPriorLetters,
  clearSessionPriorLetters,
  type PriorLetterRef,
} from './priorLetterReader';
import { AntiSpamDisputeEngine } from './antiSpamDisputeEngine';
import { queueDisputeResolutionTask, resolveDisputeResolutionTasks } from './disputeResolutionQueue';

interface PersonalInfo {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  ssn?: string;
  dob?: string;
}

// ─── Pass 6 Pre-Litigation Strategy (v5.1.0) ─────────────────────────────────

export const PASS_6_STRATEGY = {
  passNumber: 6 as const,
  name: 'Pre-Litigation Statutory Demand',
  citations: ['FCRA §616', 'FCRA §617', 'FCRA §611', 'FCRA §623'],
  triggerConditions: [
    'Pass 5 completed with no resolution',
    'CFPB complaint has been filed',
    '45+ days since Pass 5 letter with no substantive response',
  ],
  strategy: 'legal_demand' as const,
  holdDays: 15,
  description:
    'Final pre-litigation demand. Cites statutory damages of $100–$1,000 per willful violation ' +
    '(FCRA §616) and $1,000+ for negligent non-compliance (FCRA §617). Gives the respondent ' +
    'a 15-day deadline before legal action referral. References all prior passes and CFPB complaint.',
};

export const DEFAULT_SETTINGS_V2: AutoPilotSettingsV2 = {
  enabled: false,
  batchFraction: 0.33,
  maxItemsPerBatch: 8,
  dualTargetMode: true,
  holdDaysByPass: { 1: 60, 2: 60, 3: 45, 4: 30, 5: 14, 6: 15 },
  cycleIntervalDays: 32,
  letterAutoApprove: false,
  aiModel: 'groq',
  noResponseThresholdDays: 35,
  autoGenerateCFPBOnPass5: true,
  autoGenerateStateAGOnPass5: false,
  backupBeforeCycle: true,
};
export const DEFAULT_SETTINGS_V3: AutoPilotSettingsV3 = {
  ...DEFAULT_SETTINGS_V2,
  letterAutoApproveEnabled: false,
  letterAutoApprovePassThreshold: 70,
  letterAutoApproveMaxPass: 4,
  autoMailDispatch: false,
  autoMailProvider: 'none',
  adaptiveDuplicateWindow: true,
  adaptiveFrivolousHold: true,
  autoAttachVaultDocsByType: true,
  staleCycleAlertDays: 35,
  requireFactualAnchorValidation: true,
};

const STATE_STORAGE_KEY = 'dylandos_autopilot_v2_state';
const PASS_STORAGE_KEY = 'dylandos_item_passes_v2';

class AutoPilotEngineV2Class {
  private state: AutoPilotEngineState = {
    isRunning: false,
    lastCycleDate: null,
    lastCycleResult: null,
    nextCycleDate: null,
    schedulerActive: false,
    totalCyclesRun: 0,
  };

  // ─── Public API ────────────────────────────────────────────────────────────

  getState(): AutoPilotEngineState {
    return { ...this.state };
  }

  loadState(): AutoPilotEngineState {
    try {
      const saved = localStorage.getItem(STATE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AutoPilotEngineState>;
        this.state = {
          ...this.state,
          lastCycleDate: parsed.lastCycleDate ?? this.state.lastCycleDate,
          lastCycleResult: parsed.lastCycleResult ?? this.state.lastCycleResult,
          nextCycleDate: parsed.nextCycleDate ?? this.state.nextCycleDate,
          schedulerActive: parsed.schedulerActive ?? this.state.schedulerActive,
          totalCyclesRun: parsed.totalCyclesRun ?? this.state.totalCyclesRun,
        };
      }
    } catch {
      // Use defaults
    }
    return this.state;
  }

  // ─── Main Cycle Runner ─────────────────────────────────────────────────────

  async runCycle(params: {
    profileId: string;
    items: NegativeItem[];
    personalInfo: PersonalInfo;
    settings: AutoPilotSettingsV2 | AutoPilotSettingsV3;
    onProgress?: (msg: string) => void;
    /** GAP-B: Vault documents to gate evidence readiness. */
    vaultDocs?: EvidenceDoc[];
    /** Prior letter bodies from AppContext / history for uniqueness checks */
    priorLetters?: PriorLetterRef[];
  }): Promise<AutoPilotCycleResult> {
    const { profileId, items, personalInfo, settings, onProgress, vaultDocs, priorLetters } = params;
    if (priorLetters?.length) setSessionPriorLetters(priorLetters);
    else clearSessionPriorLetters();
    await loadOutcomesFromIdb();

    if (this.state.isRunning) {
      throw new Error('AutoPilot cycle already running — please wait');
    }

    const cycleId = uuidv4();
    this.state.isRunning = true;
    this._persistState();

    const progress = (msg: string) => {
      console.log(`[AutoPilotV2] ${msg}`);
      onProgress?.(msg);
    };

    const result: AutoPilotCycleResult = {
      cycleId,
      profileId,
      startedAt: new Date().toISOString(),
      completedAt: '',
      itemsProcessed: 0,
      lettersGenerated: 0,
      itemsSkippedDuplicate: 0,
      itemsOnHold: 0,
      errors: [],
      dispatchPlan: {
        profileId,
        cycleDate: new Date().toISOString(),
        totalItems: 0,
        items: [],
        estimatedLetterCount: 0,
        holdExpiryDates: {},
      },
      letters: [],
      nextCycleDate: this._calculateNextCycleDate(settings).toISOString(),
      preFlightPassed: false,
      preFlightErrors: [],
      itemsRequiringAction: [],
      resolutionTaskIds: [],
    };

    try {
      // ── Rule 10: Backup before cycle ────────────────────────────────────
      if (settings.backupBeforeCycle) {
        progress('Creating pre-cycle backup...');
        await this._backupBeforeCycle(profileId, items);
      }

      // ── Pre-flight check ─────────────────────────────────────────────
      progress('Running pre-flight checks...');
      const preflight = await this._preFlightCheck(personalInfo, items);
      result.preFlightPassed = preflight.isValid;
      result.preFlightErrors = preflight.errors;
      if (preflight.warnings.length > 0) {
        preflight.warnings.forEach((warning) => progress(`Pre-flight warning: ${warning}`));
      }

      if (!preflight.isValid) {
        progress(`Pre-flight FAILED: ${preflight.errors.join(', ')}`);
        // Fatal errors stop the cycle — warnings do not
        const hasFatalErrors = preflight.errors.some(e => e.includes('FATAL'));
        if (hasFatalErrors) {
          throw new Error(`Pre-flight check failed: ${preflight.errors.join('; ')}`);
        }
      }

      await DisputeHistoryService.init();
      await DisputeHistoryService.logEvent({
        profileId,
        type: 'cycle_started',
        title: 'AutoPilot Cycle V2 Started',
        detail: `Processing ${items.length} items with ${Math.round(settings.batchFraction * 100)}% batch fraction`,
        cycleId,
      });

      // ── Process hold queue ────────────────────────────────────────────
      progress('Processing hold queue...');
      const { nowEligible, stillHeld } = HoldQueue.processQueue(profileId);
      result.itemsOnHold = stillHeld.length;
      progress(`Hold queue: ${nowEligible.length} eligible, ${stillHeld.length} still held`);

      // ── Check overdue items + BUG-09 FIX: auto-escalate when FCRA 30-day window is missed ──
      // Delegates to escalationEngine.applyEscalations for clean separation of concerns.
      const overdueDeadlines = TimelineTracker.getOverdue(profileId);
      if (overdueDeadlines.length > 0) {
        progress(`⚠️ ${overdueDeadlines.length} FCRA deadlines overdue — auto-escalating pass numbers`);
      }

      // ── Get current pass numbers ──────────────────────────────────────
      let passNumbers = this._loadPassNumbers(profileId);
      // Imports and earlier app versions stored progression on the item rather
      // than in the V2 pass map. Hydrate once so a Round 4 item never appears
      // as Round 1 merely because the map has not been created yet.
      let hydratedLegacyPasses = false;
      for (const item of items) {
        if (passNumbers[item.id] != null) continue;
        const itemRound = Math.min(6, Math.max(1, Number(item.disputeRound) || 1)) as PassNumber;
        passNumbers[item.id] = itemRound;
        hydratedLegacyPasses = true;
      }
      if (hydratedLegacyPasses) this._savePassNumbers(profileId, passNumbers);

      // BUG-09 FIX: Delegate to escalationEngine for the no-response escalation loop.
      const { passes: escalatedPasses, escalatedCount } = await applyEscalations(
        profileId,
        passNumbers,
        progress
      );
      if (escalatedCount > 0) {
        passNumbers = escalatedPasses;
        this._savePassNumbers(profileId, passNumbers);
      }

      // ── GAP-A FIX: 3-tier inertia escalation ─────────────────────────────
      // Delegated to inertiaEscalationService for clean separation of concerns.
      // Tier 1 (Day 30+): nudge warning | Tier 2 (Day 45+): advance pass | Tier 3 (Day 60+): force
      const inertiaResult = await evaluateInertia(profileId, items, passNumbers, progress);
      if (inertiaResult.escalatedCount > 0) {
        passNumbers = inertiaResult.updatedPasses;
        this._savePassNumbers(profileId, passNumbers);
        progress(`[INERTIA] ${inertiaResult.escalatedCount} item(s) auto-advanced due to stalled outcomes`);
      }
      const inertiaEscalationCount = inertiaResult.escalatedCount;
      result.inertiaEscalations = inertiaEscalationCount;

      // Promote pass numbers for hold-expired items
      for (const holdEntry of nowEligible) {
        const currentPass = passNumbers[holdEntry.itemId] ?? 1;
        passNumbers[holdEntry.itemId] = Math.min(6, currentPass + 1) as PassNumber;
      }

      // ── Pre-filter items with recent letters (prevents batch selecting all-duplicate items) ──
      const recentlyGeneratedItemIds = new Set<string>();
      for (const item of items) {
        const passForItem = passNumbers[item.id] ?? 1;
        const isDup = await this._checkDuplicateLetter(item.id, passForItem, profileId, item.creditBureau[0], settings);
        if (isDup) recentlyGeneratedItemIds.add(item.id);
      }
      const freshItems = items.filter(i => !recentlyGeneratedItemIds.has(i.id));
      if (recentlyGeneratedItemIds.size > 0) {
        progress(`Pre-filter: ${recentlyGeneratedItemIds.size} item(s) already have Pass letters — excluded from batch`);
      }

      // ── Strategy Card MVP (before batch for diversity hints) ──────────
      const inertiaByItem: Record<string, InertiaAction> = {};
      for (const ir of inertiaResult.items) {
        inertiaByItem[ir.itemId] = ir.action;
      }
      const holdReasons: Record<string, string> = {};
      for (const h of HoldQueue.getAll(profileId)) {
        if (h.notes) holdReasons[h.itemId] = h.notes;
      }
      const prelimCards = planBatchStrategies(freshItems, {
        passNumbers,
        dualTargetMode: settings.dualTargetMode,
        vaultDocs,
        inertiaByItem,
        holdReasons,
      });
      const strategyHints = strategyHintsFromCards(prelimCards);

      // ── Batch selection (diversity-aware) ─────────────────────────────
      progress('Selecting optimal batch...');
      const batchResult = BatchSelector.selectBatch(
        freshItems,
        profileId,
        settings,
        passNumbers,
        strategyHints,
      );
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(`Batch: ${batchResult.selected.length} selected, ${batchResult.skippedOnHold.length} on hold`);
      progress(`Rationale: ${batchResult.batchRationale}`);
      result.batchRationaleStructured = batchResult.batchRationaleStructured;

      // Finalize strategy cards for selected batch only
      const strategyCards = planBatchStrategies(batchResult.selected, {
        passNumbers,
        dualTargetMode: settings.dualTargetMode,
        vaultDocs,
        inertiaByItem,
        holdReasons,
      });
      const strategyByItemId = new Map(strategyCards.map((c) => [c.itemId, c]));
      result.strategyCards = strategyCards;
      result.proposedActions = strategyCards.map((c) => ({
        itemId: c.itemId,
        creditorName: batchResult.selected.find((i) => i.id === c.itemId)?.creditorName ?? c.itemId,
        explainWhy: c.explainWhy,
        primaryAngle: c.primaryAngle,
        frivolousRisk: c.frivolousRisk,
      }));
      for (const card of strategyCards) {
        progress(`[STRATEGY] ${card.itemId.slice(0, 8)}… angle=${card.primaryAngle} — ${card.explainWhy[0] ?? ''}`);
      }

      // ── Task 1: Per-item Pre-Flight Gate ──────────────────────────────
      // Runs AFTER batch selection so batch sizing stays stable.
      // Items failing DOFD or address gates are moved to Action Required
      // and removed from dispatch — they are never sent to LetterGeneratorV2.
      const preFlightReport = runPreFlightCheck(batchResult.selected);
      progress(`[PRE-FLIGHT] ${preFlightReport.summary}`);

      // ── Frivolous Dispute Guard ────────────────────────────────────────
      // Assess each item for frivolous rejection risk BEFORE target planning.
      // High-risk items are held for 14 days to cool off and avoid bureau rejection.
      const frivolousHoldIds = new Set<string>();
      for (const item of preFlightReport.passed) {
        const passForItem = passNumbers[item.id] ?? 1;
        let historyForStrategy: import('./strategyRotationEngine').DisputeHistoryEntry[] = [];
        if (passForItem >= 2) {
          const events = await DisputeHistoryService.getByItem(profileId, item.id);
          historyForStrategy = events
            .filter(e => e.type === 'pass_letter_sent' || e.type === 'bureau_response_received')
            .map(e => ({
              timestamp: e.timestamp,
              type: e.type === 'pass_letter_sent' ? 'letter_sent' as const : 'bureau_response' as const,
              bureau: (e as { bureau?: string }).bureau ?? 'Unknown',
              passNumber: ((e as { passNumber?: number }).passNumber ?? passForItem) as PassNumber,
              outcome: (e as { outcome?: 'verified' | 'deleted' | 'updated' | 'no_response' | 'frivolous' }).outcome,
              strategyUsed: (e as { strategyUsed?: string }).strategyUsed,
              primaryLegalHook: (e as { primaryLegalHook?: string }).primaryLegalHook,
            }));
        }
        const strategy = getRotationStrategy(item, passForItem as PassNumber, historyForStrategy);
        const risk = assessFrivolousRisk(item, historyForStrategy, strategy);
        if (risk.riskLevel === 'high' && risk.recommendation === 'hold') {
          progress(`🚫 [FRIVOLOUS GUARD] ${item.creditorName} — ${risk.flags.join('; ')}`);
          HoldQueue.addToHold({
            itemId: item.id,
            profileId,
            passNumber: passForItem as PassNumber,
            verificationBureau: 'FrivolousGuard',
            responseDate: new Date().toISOString(),
            holdDaysOverride: 14,
            notes: `Frivolous Guard hold: ${risk.flags.join('; ')}`,
          });
          result.itemsOnHold++;
          frivolousHoldIds.add(item.id);
          await DisputeHistoryService.logEvent({
            profileId,
            type: 'validation_failed',
            title: `Frivolous Guard Hold: ${item.creditorName}`,
            detail: `High frivolous risk — ${risk.flags.join('; ')}`,
            itemId: item.id,
          });
        }
      }

      // Exclude high-risk items that were just placed on hold
      const eligibleItems = preFlightReport.passed.filter(i => !frivolousHoldIds.has(i.id));

      for (const failure of preFlightReport.actionRequired) {
        progress(`⚠️ [PRE-FLIGHT BLOCKED] ${failure.userMessage}`);
        result.itemsRequiringAction = result.itemsRequiringAction ?? [];
        result.itemsRequiringAction.push(failure.item.id);
        result.errors.push(`Pre-flight blocked: ${failure.userMessage}`);
        result.resolutionTaskIds?.push(queueDisputeResolutionTask({
          profileId, itemId: failure.item.id, creditorName: failure.item.creditorName,
          reason: failure.reasons.includes('TARGET_ADDRESS_INVALID') || failure.reasons.includes('ADDRESS_UNRESOLVABLE') ? 'address_verification' : 'missing_facts',
          message: failure.userMessage, retryable: true,
        }).id);
        // Log to dispute history so the user can see it in the History panel
        await DisputeHistoryService.logEvent({
          profileId,
          type: 'validation_failed',
          title: `⚠️ Pre-Flight Blocked: ${failure.item.creditorName}`,
          detail: failure.userMessage,
          itemId: failure.item.id,
        });
      }

      // Only dispatch items that passed the pre-flight gate AND frivolous guard
      const preFlightPassedItems = eligibleItems;
      // Rebuild planItems from passed items only
      const preFlightPassedIds = new Set(preFlightPassedItems.map(i => i.id));

      // v5.1.0: Score impact projection — log expected value scores for selected items
      if (batchResult.selected.length > 0) {
        try {
          const projections = projectScoreImpact(batchResult.selected);
          const topItem = projections[0];
          if (topItem) {
            progress(`[SCORE PROJECTOR] Top priority: ${topItem.creditorName} — EV score ${topItem.expectedValueScore}, deletion prob ${topItem.deletionProbability}%, projected +${topItem.projectedGainIfDeleted}pts`);
          }
        } catch { /* non-blocking */ }
      }

      if (batchResult.selected.length === 0) {
        progress('No items eligible for dispatch this cycle');
        result.completedAt = new Date().toISOString();
        this.state.isRunning = false;
        this.state.lastCycleDate = result.startedAt;
        this.state.lastCycleResult = result;
        this.state.nextCycleDate = result.nextCycleDate;
        this.state.totalCyclesRun++;
        this._persistState();
        return result;
      }

      // ── Target planning ───────────────────────────────────────────────
      progress('Planning dispatch targets...');
      // Use only pre-flight-passed items for target planning
      const preFlightSelectedForTargets = batchResult.selected.filter(i => preFlightPassedIds.has(i.id));
      const targetPlans = TargetPlanner.planAllTargets(preFlightSelectedForTargets, passNumbers, settings.dualTargetMode);

      // GAP-E FIX: Surface furnisher-not-found warnings so the UI can notify the user
      for (const plan of targetPlans) {
        for (const warning of plan.warnings ?? []) {
          progress(`⚠️ ${warning}`);
        }
      }

      // ── Build dispatch plan ───────────────────────────────────────────
      const scores = batchResult.scores;
      const planItems: DispatchPlanItem[] = preFlightSelectedForTargets.map((item, i) => {
        const targetPlan = targetPlans[i];
        const score = scores.find(s => s.itemId === item.id);
        return {
          itemId: item.id,
          itemName: item.creditorName,
          targets: targetPlan.targets,
          estimatedDeletability: score?.deletability ?? 50,
          urgencyScore: score?.urgency ?? 50,
          passNumber: passNumbers[item.id] ?? 1,
        };
      });

      result.dispatchPlan = {
        profileId,
        cycleDate: new Date().toISOString(),
        totalItems: planItems.length,
        items: planItems,
        estimatedLetterCount: planItems.reduce((sum, p) => sum + p.targets.length, 0),
        holdExpiryDates: {},
      };

      result.itemsProcessed = planItems.length;

      // ── Letter generation ─────────────────────────────────────────────
      const allLetters: GeneratedLetterV2[] = [];

      // ── Batch Rate-Limit Guard ─────────────────────────────────────────────
      // Each LLM call in the loop below is throttled by apiQueueManager's
      // MIN_REQUEST_INTERVAL_MS (3 s) at the queue level, but we also enforce a
      // mandatory 3-second cooldown at the batch loop level so we never fire more
      // than one LLM request per 3 seconds regardless of queue internals.
      // This is intentionally separate from apiQueueManager's retry backoff so
      // that even a *successful* request is followed by a mandatory pause.
      let batchLLMCallCount = 0;
      const batchCooldownMs = 3_000; // 3-second mandatory inter-letter delay
      const batchDelay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

      progress(`Generating letters for ${planItems.length} items...`);

      for (const planItem of planItems) {
        const item = batchResult.selected.find(i => i.id === planItem.itemId)!;
        const passNumber = planItem.passNumber as PassNumber;

        // ── Rule 8: Duplicate check ──────────────────────────────────
        const isDuplicate = await this._checkDuplicateLetter(item.id, passNumber, profileId, item.creditBureau[0], settings);
        if (isDuplicate) {
          result.itemsSkippedDuplicate++;
          progress(`Skipped duplicate: ${item.creditorName} Pass ${passNumber}`);
          continue;
        }

        // ── GAP-B: Evidence gate ─────────────────────────────────────
        let evidenceModifiers: string[] = [];
        if (vaultDocs) {
          const disputeType = mapTypeToDisputeType(item.typeOfNegative);
          const gate = evaluateEvidenceReadiness(vaultDocs, disputeType);
          if (!gate.canProceed) {
            progress(`[EVIDENCE-BLOCKED] ${item.creditorName}: ${gate.rationale}`);
            result.errors.push(`Evidence gate blocked ${item.creditorName}: missing government ID`);
            continue;
          }
          evidenceModifiers = gate.letterModifiers;
          if (evidenceModifiers.length > 0) {
            progress(`[EVIDENCE-GATE] ${item.creditorName}: ${gate.tier} tier — ${evidenceModifiers.length} modifier(s) injected`);
          }
        }

        // Build dispute history summary for higher passes
        let disputeHistory = '';
        let historyForStrategy: DisputeHistoryEntry[] = [];
        if (passNumber >= 3) {
          const events = await DisputeHistoryService.getByItem(profileId, item.id);
          disputeHistory = events
            .filter(e => e.type === 'pass_letter_sent' || e.type === 'bureau_response_received')
            .map(e => `${new Date(e.timestamp).toLocaleDateString()}: ${e.title}`)
            .join('\n');
          // Build typed history for strategy rotation engine
          historyForStrategy = events
            .filter(e => e.type === 'pass_letter_sent' || e.type === 'bureau_response_received')
            .map(e => ({
              timestamp: e.timestamp,
              type: e.type === 'pass_letter_sent' ? 'letter_sent' as const : 'bureau_response' as const,
              bureau: (e as { bureau?: string }).bureau ?? 'Unknown',
              passNumber: ((e as { passNumber?: number }).passNumber ?? passNumber) as PassNumber,
              outcome: (e as { outcome?: DisputeHistoryEntry['outcome'] }).outcome,
              strategyUsed: (e as { strategyUsed?: string }).strategyUsed,
            }));
        }

        // ── GAP-D: Strategy rotation — rotate legal argument to prevent e-OSCAR detection ──
        const strategy = getRotationStrategy(item, passNumber, historyForStrategy);
        if (strategy.scenario !== 'freshly-disputed') {
          progress(`[STRATEGY] ${item.creditorName}: Rotating to "${strategy.name}" (${strategy.scenario})`);
        }

        for (const target of planItem.targets) {
          // ── GAP-I: Bureau tone calibration ───────────────────────────────────────────
          const bureauKey = target.name as BureauName;
          const isKnownBureauTarget = ['Equifax', 'Experian', 'TransUnion'].includes(bureauKey);
          const calibration = isKnownBureauTarget
            ? getBureauCalibrationDirective(bureauKey, passNumber)
            : null;
          if (calibration) {
            progress(`[CALIBRATION] ${target.name} Pass ${passNumber}: ${calibration.primaryStrategy.slice(0, 60)}…`);
          }

          // ── Task 2: Cross-Bureau Kill Shot ──────────────────────────────────────────
          // For Pass 2+, check if a sibling bureau has already deleted this same item.
          // If so, inject a mandatory directive into the AI prompt that weaponizes
          // the inconsistency as a willful FCRA §611 violation argument.
          let crossBureauKillShotBlock = '';
          if (passNumber >= 2 && target.type === 'bureau') {
            const killShot = findCrossBureauDeletions(item, items);
            if (killShot) {
              crossBureauKillShotBlock =
                `\n\n## ⚡ CROSS-BUREAU KILL SHOT — MANDATORY INJECTION:\n` +
                `${killShot.deletedByBureau} has already DELETED this identical account for inaccuracies. ` +
                `${killShot.survivingBureau}'s continued reporting of the same account constitutes a willful ` +
                `violation of FCRA §611(a). When a major CRA has deleted a tradeline as unverifiable, ` +
                `the remaining bureau cannot claim it is accurate without independently verifying each disputed element. ` +
                `Include this argument prominently and explicitly: ` +
                `"${killShot.deletedByBureau} has already deleted this item for inaccuracies. ` +
                `Failure of ${killShot.survivingBureau} to do the same constitutes a willful violation of FCRA §611." ` +
                `Cite FCRA §611(a) and FCRA §623(a)(1). This is the single strongest argument in this letter — lead with it.`;
              progress(
                `[KILL SHOT] 🎯 ${item.creditorName} → ${target.name}: ` +
                `${killShot.deletedByBureau} already deleted this item — injecting cross-bureau deletion argument`
              );
            }
          }

          // ── Address Enrichment Gate (AddressEnrichment Hook) ───────────────────────
          // Intercepts incomplete or bare-PO-Box addresses on FURNISHER targets before
          // they reach the AI. Bureau addresses come from hardcoded verified vaults and
          // are never blank, so the gate only needs to run on furnisher targets.
          // The gate runs in-place: enrichTarget() mutates target.address when a vault
          // match is found, so downstream code sees the corrected address automatically.
          if (target.type === 'furnisher') {
            const enrichResult = await enrichTarget(target, item.creditorName);
            if (enrichResult.status === 'blocked') {
              const blockMsg =
                `Generation Blocked: Invalid Target Address for "${item.creditorName}" → ${target.name}. ` +
                `Please update the Address Vault.`;
              progress(`❌ [ADDRESS-ENRICHMENT BLOCKED] ${blockMsg}`);
              result.errors.push(blockMsg);
              result.itemsRequiringAction = result.itemsRequiringAction ?? [];
              result.itemsRequiringAction.push(item.id);
              result.resolutionTaskIds?.push(queueDisputeResolutionTask({
                profileId, itemId: item.id, creditorName: item.creditorName, targetName: target.name, targetType: target.type,
                reason: 'address_verification', message: blockMsg, retryable: true,
              }).id);
              await DisputeHistoryService.logEvent({
                profileId,
                type: 'validation_failed',
                title: `❌ Address Vault Blocked: ${item.creditorName}`,
                detail: blockMsg,
                itemId: item.id,
              });
              continue; // Skip letter generation for this target — do NOT send bad address to AI
            }
            if (enrichResult.status === 'enriched') {
              progress(
                `[ADDRESS-ENRICHMENT] ✅ Auto-corrected address for "${item.creditorName}" ` +
                `from vault match "${enrichResult.vaultName}".`
              );
            }
          }

          try {
            progress(`Generating Pass ${passNumber} letter → ${target.name} (${target.type})...`);

            // v5.1.0: Pass 6 uses the dedicated pre-litigation prompt builder
            const pass6PromptOverride = passNumber === 6
              ? buildPass6Prompt({
                item,
                bureau: target.name,
                personalInfo,
                disputeHistory,
                priorPassCount: 5,
              })
              : undefined;

            // --- Healing & Metro 2 Engines ---
            const matchingItems = items.filter(i => normalizeCreditorName(i.creditorName) === normalizeCreditorName(item.creditorName));
            const scoreAccounts = matchingItems.map(i => ({
              bureau: i.creditBureau[0] ?? 'unknown',
              balance: i.balance ?? 0,
              status: i.status ?? '',
              dofd: i.dateOfFirstDelinquency ?? i.originalDateOfDelinquency ?? null,
              creditorName: i.creditorName
            }));
            const confidence = computeConfidenceScore(scoreAccounts);
            // Prefer post-stitch / manual-override account token for Pass 1 disclosure gating.
            const postProcessedAccount = resolvePostProcessedAccountNumber(item);
            const pass1DisclosurePivot =
              passNumber === 1 && shouldPivotPass1ToDisclosure(item, passNumber);
            const accountStillIncomplete = isAccountNumberIncomplete(postProcessedAccount);

            if (pass1DisclosurePivot) {
              progress(
                `[PASS-1 PIVOT] ${item.creditorName} — incomplete account (${postProcessedAccount || 'empty'}); ` +
                `forcing Verification of Information / Disclosure Demand (Passes 2–6 resume normal escalation).`,
              );
            }

            const healedAccount: HealedAccount = {
              id: item.id,
              creditorName: normalizeCreditorName(item.creditorName),
              reconstructedAccountNumber: postProcessedAccount || item.accountNumber,
              balance: item.balance ?? 0,
              status: item.status ?? '',
              dateOpened: item.dateOpened ?? item.originalOpeningDate ?? undefined,
              dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? undefined,
              confidenceScore: confidence.total,
              healingFlags: pass1DisclosurePivot
                ? ['pass1_disclosure_pivot', 'account_number_incomplete']
                : accountStillIncomplete
                  ? ['account_number_incomplete']
                  : [],
              // Pass 1 only: intercept standard accuracy challenge when account remains masked.
              // Passes 2–6 keep their planned legal escalation paths.
              requiresDisclosureRequest: pass1DisclosurePivot,
            };

            const metro2Input: Metro2AuditInput = {
              status: item.status ?? '',
              balance: item.balance ?? 0,
              paymentHistory: (item as any).paymentHistoryProfile ? (item as any).paymentHistoryProfile.split('') : [],
              dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null,
              dateOpened: item.dateOpened ?? item.originalOpeningDate ?? null,
              creditLimit: item.creditLimit ?? (item as any).highCredit ?? null,
              accountType: item.accountType ?? '',
              currentRating: (item as any).currentRating ?? '',
              portfolioType: (item as any).portfolioType ?? '',
              specialComment: (item as any).specialComment ?? null,
              complianceConditionCode: (item as any).complianceConditionCode ?? null,
              crossBureauDofds: matchingItems.map(i => i.dateOfFirstDelinquency ?? i.originalDateOfDelinquency ?? null),
              crossBureauStatuses: matchingItems.map(i => i.status ?? ''),
              crossBureauDateOpened: matchingItems.map(i => i.dateOpened ?? i.originalOpeningDate ?? null)
            };
            const metro2Flags = auditMetro2(metro2Input);

            const req: DisputeLetterRequest = {
              account: healedAccount,
              item,
              profileId,
              metro2Flags,
              passNumber: passNumber as any,
              bureau: target.name.toLowerCase() as 'experian' | 'equifax' | 'transunion',
              consumerName: `${personalInfo.firstName} ${personalInfo.lastName}`,
              consumerAddress: `${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}`,
              todayDate: new Date().toISOString().split('T')[0]
              ,cycleNumber: this.state.totalCyclesRun + 1
            };

            // ── World-Class §2.3: Unified LetterGenerationOrchestrator ──────
            // ONE path for every letter: primary AI → targeted repair →
            // deterministic Metro 2 fallback. A letter is ALWAYS produced —
            // silent item skips (Roadmap §1.1) are eliminated by design.
            const orchestrated = await orchestrateLetterGeneration(req, async (r): Promise<GeneratedLetter> => {
              if (passNumber === 3) {
                progress(`Pass 3 — routing to Direct Furnisher Engine for ${item.creditorName} → ${target.name}`);
                const dna = buildLetterDNA(item, passNumber as any, profileId);
                const directResult = await generateDirectDispute(item, {
                  consumerName: r.consumerName,
                  consumerAddress: r.consumerAddress,
                  todayDate: r.todayDate,
                  metro2Flags: r.metro2Flags,
                  targetName: target.name,
                  targetAddress: target.address,
                }, dna);
                if (!directResult || !directResult.body) {
                  // Queue fail-safe resolved null (AI exhausted) — signal the
                  // orchestrator to engage the deterministic fallback.
                  throw new Error('Direct furnisher engine returned no usable draft (AI providers exhausted).');
                }
                return {
                  body: directResult.body,
                  persona: directResult.persona,
                  passNumber: r.passNumber,
                  bureau: r.bureau,
                  metro2FlagsUsed: r.metro2Flags,
                  requiresDisclosure: false,
                  generatedAt: new Date().toISOString(),
                };
              }
              return generateDisputeLetter(r);
            });
            const rawLetterBody = orchestrated.body;
            const rawLetterPersona = orchestrated.persona;
            progress(
              `[ORCHESTRATOR] ${item.creditorName} → ${target.name}: source=${orchestrated.sourceType}` +
              (orchestrated.diagnostics.length ? ` · ${orchestrated.diagnostics.length} diagnostic(s)` : ' · clean pass') +
              ` — ${orchestrated.auditExplanation}`,
            );

            // Map to GeneratedLetterV2 format
            const strategyCard = strategyByItemId.get(item.id);
            const letter = {
              id: orchestrated.id,
              profileId,
              itemId: item.id,
              itemName: item.creditorName,
              targetName: target.name,
              targetAddress: target.address,
              targetType: target.type,
              passNumber: passNumber,
              strategy: rawLetterPersona as any,
              status: 'draft',
              letterContent: rawLetterBody,
              htmlContent: `<p>${escapeLetterHtml(rawLetterBody).replace(/\n/g, '<br>')}</p>`,
              cycleId,
              // Orchestrator diagnostics are advisory (repair vs hard_block already
              // resolved upstream) — recorded for the audit trail, not blockers.
              validationErrors: orchestrated.diagnostics.map((d) => `[${d.severity}] ${d.code}: ${d.message}`),
              uniquenessScore: orchestrated.uniquenessScore,
              legalCitations: strategyCard?.legalAnchors ?? [],
              createdAt: new Date().toISOString(),
              approvedAt: null,
              sentAt: null,
              certifiedMailNumber: null,
              archivePath: null,
              wordCount: orchestrated.wordCount,
              letterSourceType: orchestrated.sourceType,
              auditExplanation: orchestrated.auditExplanation,
              strategyCardId: strategyCard?.id,
              explainWhy: strategyCard?.explainWhy,
              evidenceTier: strategyCard?.evidenceTier,
              primaryAngle: strategyCard?.primaryAngle,
            } as unknown as GeneratedLetterV2;

            const unresolvedTokens = scanForUnfilledTokens(letter.letterContent || letter.htmlContent || '');
            if (unresolvedTokens.length > 0) {
              letter.validationErrors = unresolvedTokens.map(token => `Unresolved placeholder: ${token}`);
              letter.status = 'blocked';
              result.errors.push(
                `Unresolved placeholders in ${item.creditorName} Pass ${passNumber}: ${unresolvedTokens.join(', ')}`
              );
              await DisputeHistoryService.logEvent({
                profileId,
                type: 'validation_failed',
                title: `Letter blocked — unresolved placeholder: ${item.creditorName}`,
                detail: letter.validationErrors.join('; '),
                itemId: item.id,
                letterId: letter.id,
                cycleId,
                passNumber,
                bureau: target.name,
              });
            }

            // Apply Anti-Spam engine mutation and uniqueness check against REAL prior bodies
            if (letter.letterContent) {
              const priorBodies = await getPriorLetterContentsForItem(item.id, target.name);
              // Include letters already generated earlier in this same cycle for the same item
              for (const prior of allLetters) {
                if (prior.itemId === item.id && prior.letterContent) {
                  priorBodies.push(prior.letterContent);
                }
              }
              let uniqueness = evaluateDisputeUniqueness(
                letter.letterContent,
                priorBodies,
                passNumber,
              );
              letter.uniquenessScore = uniqueness.score;

              if (uniqueness.riskLevel === 'HIGH_RISK_FRIVOLOUS') {
                progress(
                  `[Anti-Spam] ⚠️ High uniqueness risk for ${item.creditorName} at ${target.name} (score ${uniqueness.score}). Remxing syntax…`,
                );
                letter.letterContent = AntiSpamDisputeEngine.generateUniqueSyntacticStructure(
                  letter.letterContent,
                  `${letter.id}:${passNumber}`,
                );
                letter.htmlContent = `<p>${escapeLetterHtml(letter.letterContent).replace(/\n/g, '<br>')}</p>`;
                uniqueness = evaluateDisputeUniqueness(
                  letter.letterContent,
                  priorBodies,
                  passNumber,
                );
                letter.uniquenessScore = uniqueness.score;
                if (uniqueness.riskLevel === 'HIGH_RISK_FRIVOLOUS') {
                  letter.status = 'blocked';
                  letter.validationErrors = [
                    ...(letter.validationErrors ?? []),
                    `Uniqueness HIGH_RISK_FRIVOLOUS after remix (score ${uniqueness.score}) — blocked pending manual rewrite`,
                  ];
                  progress(
                    `[Anti-Spam] 🚫 Blocked ${item.creditorName} → ${target.name}: still near-duplicate after remix`,
                  );
                }
              } else if (uniqueness.riskLevel === 'CAUTION') {
                progress(
                  `[Anti-Spam] Caution uniqueness ${uniqueness.score} for ${item.creditorName} — consider Metro 2 enrichment`,
                );
              }
            }

            // Hard strategy blocks (verified×2 same basis etc.)
            if (strategyCard?.blockReasons.length && strategyCard.frivolousRisk === 'HIGH') {
              const forceHold = strategyCard.blockReasons.some((r) =>
                r.toLowerCase().includes('identical legal basis'),
              );
              if (forceHold && letter.status !== 'blocked') {
                HoldQueue.addToHold({
                  itemId: item.id,
                  profileId,
                  passNumber: passNumber as PassNumber,
                  verificationBureau: 'StrategyCard',
                  responseDate: new Date().toISOString(),
                  holdDaysOverride: 14,
                  notes: strategyCard.blockReasons.join('; '),
                });
                letter.status = 'blocked';
                letter.validationErrors = [
                  ...(letter.validationErrors ?? []),
                  ...strategyCard.blockReasons,
                ];
                progress(`[STRATEGY BLOCK] ${item.creditorName}: ${strategyCard.blockReasons[0]}`);
              }
            }

            // Archive the generated draft. Generation is not mailing: no response
            // deadline is created until a provider acceptance or explicit manual-mail event.
            await ArchiveService.archiveLetter(letter, profileId);
            await persistLetterForUniqueness(letter);
            letter.archivePath = `profiles/${profileId}/disputes/cycle_${cycleId.slice(0, 8)}/${letter.id}.enc`;

            // Log event
            await DisputeHistoryService.logLetterGenerated(
              profileId, item.id, letter.id, passNumber, target.name,
              { sourceType: letter.letterSourceType, auditExplanation: letter.auditExplanation },
            );

            const v3 = settings as Partial<AutoPilotSettingsV3>;
            const autoApproveEnabled = v3.letterAutoApproveEnabled ?? settings.letterAutoApprove;
            if (autoApproveEnabled && letter.status !== 'blocked') {
              const threshold = v3.letterAutoApprovePassThreshold ?? 70;
              const maxPass = v3.letterAutoApproveMaxPass ?? 4;
              const resolvedAccount = resolvePostProcessedAccountNumber(item);
              const hasAnchor = !v3.requireFactualAnchorValidation || !resolvedAccount || letter.letterContent.includes(resolvedAccount.replace(/\D/g,'').slice(-4));
              const frivolousFlags = passNumber >= 2 ? await DisputeHistoryService.getRecentFrivolousFlags(profileId,item.id,target.name,90) : 0;
              if (passNumber <= maxPass && (letter.uniquenessScore ?? 0) >= threshold && hasAnchor && frivolousFlags === 0) {
                letter.status = 'approved';
                letter.approvedAt = new Date().toISOString();
                await ArchiveService.archiveLetter(letter, profileId);
                progress(`[AUTO-APPROVE] ${item.creditorName} → ${target.name} passed every quality gate`);
              } else {
                progress(`[AUTO-APPROVE BLOCKED] ${item.creditorName} → ${target.name}: pass/uniqueness/anchor/frivolous gate`);
              }
            }

            allLetters.push(letter);
            resolveDisputeResolutionTasks(profileId, item.id, target.name);

            // ── Mandatory inter-request cooldown ──────────────────────────
            // After every successful LLM letter generation, wait 3 seconds before
            // proceeding to the next target. This keeps the provider token bucket
            // from being exhausted by rapid successive calls in a 10-item batch.
            batchLLMCallCount++;
            progress(
              `[RATE-GUARD] Letter ${batchLLMCallCount} generated. ` +
              `Cooling down ${batchCooldownMs / 1000}s before next request...`
            );
            await batchDelay(batchCooldownMs);
          } catch (e) {
            const errMsg = `Failed to generate letter for ${item.creditorName} → ${target.name}: ${e}`;
            result.errors.push(errMsg);
            const rawError = e instanceof Error ? e.message : String(e);
            const aiCapacity = /AI_RATE_LIMIT|cooling down|rate limit/i.test(rawError);
            const validationFailure = /validation|boilerplate|fabrication|grounding|voice repair/i.test(rawError);
            result.itemsRequiringAction = result.itemsRequiringAction ?? [];
            if (!result.itemsRequiringAction.includes(item.id)) result.itemsRequiringAction.push(item.id);
            result.resolutionTaskIds?.push(queueDisputeResolutionTask({
              profileId, itemId: item.id, creditorName: item.creditorName, targetName: target.name, targetType: target.type,
              reason: aiCapacity ? 'ai_capacity' : validationFailure ? 'validation_failure' : 'generation_failure',
              message: rawError, retryable: !validationFailure,
              retryAfter: aiCapacity ? new Date(Date.now() + 60_000).toISOString() : undefined,
            }).id);
            console.error(`[AutoPilotV2] ${errMsg}`);
          }
        }
      }

      // ── Rule 1: Validate all letters ──────────────────────────────
      progress('Validating letters...');
      for (const letter of allLetters) {
        const vr = { isValid: true, errors: [] as string[] };
        try {
          assertNoBoilerplate(letter.letterContent || letter.htmlContent || "");
        } catch (e) {
          if (e instanceof BoilerplateDetectedException) {
            vr.isValid = false;
            vr.errors.push(e.message);
          } else {
            vr.isValid = false;
            vr.errors.push(String(e));
          }
        }
        if (!vr.isValid) {
          letter.validationErrors = vr.errors;
          letter.status = 'blocked';
          result.errors.push(`Letter ${letter.id} validation: ${vr.errors.join('; ')}`);
        }
      }

      result.letters = allLetters;
      result.lettersGenerated = allLetters.length;

      // ── GAP-J: Build entropy dispatch schedule ────────────────────
      // Stagger letter dispatch dates so e-OSCAR anti-automation rules are not triggered.
      if (allLetters.length > 0) {
        const scheduleInputs = allLetters.map(l => ({
          item: batchResult.selected.find(i => i.id === l.itemId) ?? batchResult.selected[0],
          passNumber: (l.passNumber ?? 1) as PassNumber,
          bureau: l.targetName ?? 'Unknown',
          targetType: (l.targetType ?? 'bureau') as 'bureau' | 'furnisher',
        }));
        const entropySchedule = buildEntropyDispatchSchedule(scheduleInputs, new Date());
        result.entropySchedule = entropySchedule;
        progress(`[ENTROPY] ${entropySchedule.summary}`);

        for (const l of allLetters.filter(letter => letter.status !== 'blocked')) {
          l.scheduledMailingDate = getScheduledDateForItem(entropySchedule, l.itemId ?? '', l.targetName ?? 'Unknown');
        }
      }

      // ── GAP-D: Re-aging detection ─────────────────────────────────
      for (const item of batchResult.selected) {
        if (item.originalDateOfDelinquency || item.dateOfFirstDelinquency) {
          const reAgingCheck = checkDelinquencyDateManipulation(
            {
              id: item.id,
              creditorName: item.creditorName,
              dateReported: item.originalDateOfDelinquency ?? null,
              firstDelinquencyDate: item.originalDateOfDelinquency ?? item.dateOfFirstDelinquency ?? null,
            },
            {
              dateReported: item.originalDateOfDelinquency ?? null,
              firstDelinquencyDate: item.dateOfFirstDelinquency ?? null,
            }
          );
          if (reAgingCheck.detected) {
            progress(`[RE-AGING ALERT] ${reAgingCheck.message}`);
            result.errors.push(`RE-AGING DETECTED: ${reAgingCheck.creditorName} — ${reAgingCheck.legalCitation}`);
          }
        }
      }

      // ── Update pass numbers ──────────────────────────────────────
      for (const planItem of planItems) {
        if (!passNumbers[planItem.itemId]) {
          passNumbers[planItem.itemId] = 1;
        }
      }
      this._savePassNumbers(profileId, passNumbers);

      // ── Cycle complete log ────────────────────────────────────────
      await DisputeHistoryService.logCycleCompleted(profileId, cycleId, {
        dispatched: allLetters.length,
        onHold: result.itemsOnHold,
        removed: 0,
      });

      progress(`✅ Cycle complete: ${allLetters.length} letters generated`);

    } catch (e) {
      const errMsg = String(e);
      result.errors.push(errMsg);
      console.error('[AutoPilotV2] Cycle error:', sanitizeForLog(errMsg));
    } finally {
      result.completedAt = new Date().toISOString();
      this.state.isRunning = false;
      this.state.lastCycleDate = result.startedAt;
      this.state.lastCycleResult = result;
      this.state.nextCycleDate = result.nextCycleDate;
      this.state.totalCyclesRun++;
      this._persistState();

      // GAP-H FIX: Persist full cycle audit record to IndexedDB for history panel
      saveCycleAuditRecord({
        cycleId,
        profileId,
        runAt: result.startedAt,
        engineVersion: 'v2',
        durationMs: result.completedAt
          ? new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()
          : 0,
        itemsProcessed: result.itemsProcessed,
        lettersGenerated: result.lettersGenerated,
        skippedItems: result.itemsSkippedDuplicate,
        escalationsTriggered: (result as AutoPilotCycleResult & { inertiaEscalations?: number }).inertiaEscalations ?? 0,
        inertiaEscalations: (result as AutoPilotCycleResult & { inertiaEscalations?: number }).inertiaEscalations ?? 0,
        itemResults: result.letters.map(l => ({
          itemId: l.itemId ?? '',
          creditorName: l.itemName ?? '',
          bureau: l.targetName ?? '',
          passNumber: l.passNumber ?? 1,
          action: 'letter_generated' as const,
          letterId: l.id,
          letterType: l.strategy ?? 'standard',
          strategyCardId: l.strategyCardId,
          explainWhy: l.explainWhy,
        })),
        validationResults: {
          totalChecked: result.letters.length,
          passedValidation: result.letters.filter(l => !l.validationErrors?.length).length,
          failedValidation: result.letters.filter(l => l.validationErrors?.length).length,
          failureReasons: result.errors,
        },
        aiProviderUsed: 'aiRouter',
        trigger: 'manual',
        warnings: [],
        errors: result.errors,
        rawResultSummary: { cycleId, lettersGenerated: result.lettersGenerated },
        strategyCards: result.strategyCards,
      }).catch(() => { });
    }

    clearSessionPriorLetters();
    return result;
  }

  // ─── Response Handler ──────────────────────────────────────────────────────

  async handleResponse(params: {
    profileId: string;
    itemId: string;
    bureau: string;
    outcome: 'deleted' | 'verified' | 'updated' | 'no_response' | 'frivolous';
    passNumber: PassNumber;
    letterId: string;
    settings: AutoPilotSettingsV2;
  }): Promise<void> {
    const { profileId, itemId, bureau, outcome, passNumber, letterId, settings } = params;

    await DisputeHistoryService.init();
    await DisputeHistoryService.logResponseReceived(profileId, itemId, bureau, outcome as string, passNumber);

    TimelineTracker.resolveByItem(profileId, itemId, bureau);

    // Map outcome to DeletionOutcomeEngine outcome types
    let mappedOutcome: 'DELETED' | 'VERIFIED_UNCHANGED' | 'STATUS_CHANGED' | 'NOT_DETERMINABLE' = 'NOT_DETERMINABLE';
    if (outcome === 'deleted') mappedOutcome = 'DELETED';
    else if (outcome === 'verified') mappedOutcome = 'VERIFIED_UNCHANGED';
    else if (outcome === 'updated') mappedOutcome = 'STATUS_CHANGED';

    // Wire DeletionOutcomeEngine + durable outcome tracker
    try {
      DeletionOutcomeEngine.captureOutcome(bureau, itemId, mappedOutcome as any, {
        accountId: itemId,
        passNumber,
      });
      recordOutcome({
        accountId: itemId,
        bureau,
        creditorName: itemId,
        passNumber,
        metro2FlagIds: [],
        personaId: 'autopilot',
        outcome:
          outcome === 'deleted'
            ? 'deleted'
            : outcome === 'verified'
              ? 'verified'
              : outcome === 'updated'
                ? 'modified'
                : outcome === 'no_response'
                  ? 'no_response'
                  : 'in_progress',
        daysToResponse: null,
        recordedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[AutoPilotV2] DeletionOutcomeEngine capture failed', e);
    }

    if (outcome === 'deleted') {
      HoldQueue.releaseFromHold(profileId, itemId);
      const passNumbers = this._loadPassNumbers(profileId);
      delete passNumbers[itemId];
      this._savePassNumbers(profileId, passNumbers);
    } else if (outcome === 'verified') {
      // Start hold for next pass
      const holdDays = settings.holdDaysByPass[passNumber] ?? 60;
      HoldQueue.addToHold({
        itemId,
        profileId,
        passNumber,
        verificationBureau: bureau,
        responseDate: new Date().toISOString(),
        holdDaysOverride: holdDays,
      });
      await DisputeHistoryService.logHoldStarted(
        profileId, itemId, passNumber,
        new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000).toISOString()
      );
    } else if (outcome === 'no_response') {
      // FCRA failure to investigate — immediate escalation
      const currentPass = this._loadPassNumbers(profileId)[itemId] ?? passNumber;
      const nextPass = Math.min(6, currentPass + 1) as PassNumber;
      const updatedPasses = this._loadPassNumbers(profileId);
      updatedPasses[itemId] = nextPass;
      this._savePassNumbers(profileId, updatedPasses);

      await DisputeHistoryService.logEvent({
        profileId,
        type: 'item_no_response',
        title: `⚠️ No Response — ${bureau} — FCRA Overdue`,
        detail: `No response by FCRA deadline. Auto-escalating to Pass ${nextPass}. Failure-to-investigate letter warranted.`,
        itemId, bureau, passNumber,
      });
    } else if (outcome === 'frivolous') {
      // GAP-G FIX: Dedicated frivolous response handler
      await this.handleFrivolousResponse({ profileId, itemId, bureau, passNumber, letterId, settings });
    }
  }

  // ─── GAP-G FIX: Frivolous Response Protocol ───────────────────────────────
  // FCRA §611(a)(3) allows bureaus to dismiss "frivolous or irrelevant" disputes
  // but REQUIRES: (1) written notice within 5 business days, (2) statement of reasons.
  // The counter-strategy: force the bureau to justify the frivolous determination
  // by demanding the specific reasons in writing, then reframe the next letter to
  // explicitly address each reason cited. Do NOT accept a frivolous determination
  // without demanding the required statutory notice.

  async handleFrivolousResponse(params: {
    profileId: string;
    itemId: string;
    bureau: string;
    passNumber: PassNumber;
    letterId: string;
    settings: AutoPilotSettingsV2;
  }): Promise<{ nextAction: string; escalatedToPass: PassNumber; requiresFrivolousChallenge: boolean }> {
    const { profileId, itemId, bureau, passNumber, settings } = params;

    await DisputeHistoryService.init();

    // Log the frivolous determination event
    await DisputeHistoryService.logEvent({
      profileId,
      type: 'bureau_response_received',
      title: `⚠️ Frivolous Determination — ${bureau} — Pass ${passNumber}`,
      detail:
        `${bureau} has issued a "frivolous or irrelevant" determination under FCRA §611(a)(3). ` +
        `REQUIRED RESPONSE: Demand written notice per §611(a)(3)(B). ` +
        `Next letter must challenge the frivolous determination directly and provide additional specifics.`,
      itemId,
      bureau,
      passNumber,
    });

    // FCRA §611(a)(3)(B) requires the bureau to provide written notice of frivolous determination
    // with reasons within 5 business days. Use the dedicated service to build the counter-attack plan.
    const currentPass = this._loadPassNumbers(profileId)[itemId] ?? passNumber;

    // Count prior frivolous events for this item to select the correct counter tier
    const allHistory = await DisputeHistoryService.getByItem(profileId, itemId);
    const priorFrivolousCount = allHistory.filter(
      e => e.type === 'bureau_response_received' && (e as { outcome?: string }).outcome === 'frivolous'
    ).length - 1; // subtract 1 because the current event is already logged

    // Build the counter-attack plan via dedicated GAP-G service
    // Need item data — create minimal NegativeItem shape from available context
    const fakeItem = { id: itemId, creditorName: bureau } as import('../types').NegativeItem;
    const challengePlan = buildFrivolousChallengePlan(
      fakeItem, bureau, currentPass,
      Math.max(0, priorFrivolousCount),
      new Date().toISOString()
    );

    // Frivolous determination → do NOT treat as verified; advance pass for counter-attack letter
    const nextPass = Math.min(6, currentPass + 1) as PassNumber;
    const updatedPasses = this._loadPassNumbers(profileId);
    updatedPasses[itemId] = nextPass;
    this._savePassNumbers(profileId, updatedPasses);

    // Place on a short hold while user obtains the required §611(a)(3)(B) written notice
    HoldQueue.addToHold({
      itemId,
      profileId,
      passNumber: nextPass,
      verificationBureau: bureau,
      responseDate: new Date().toISOString(),
      holdDaysOverride: 14,
    });

    await DisputeHistoryService.logEvent({
      profileId,
      type: 'user_note_added',
      title: `Frivolous Challenge Protocol Activated — ${bureau} [${challengePlan.tier}]`,
      detail:
        `GAP-G Counter: ${challengePlan.summary} ` +
        `Legal hook: ${challengePlan.primaryCitation}. ` +
        `Dispatch delay: ${challengePlan.dispatchDelayDays}d. ` +
        `Item on 14-day hold. Next letter escalated to Pass ${nextPass}.`,
      itemId,
      bureau,
      passNumber: nextPass,
    });

    return {
      nextAction: challengePlan.summary,
      escalatedToPass: nextPass,
      requiresFrivolousChallenge: true,
    };
  }

  // ─── Scheduler ────────────────────────────────────────────────────────────

  async scheduleNextCycle(settings: AutoPilotSettingsV2, profileId: string): Promise<void> {
    const nextDate = this._calculateNextCycleDate(settings);
    this.state.nextCycleDate = nextDate.toISOString();
    this.state.schedulerActive = true;
    this._persistState();

    // Notify Electron scheduler if available
    const api = (window as any).electronAPI;
    if (api?.autopilotSchedule) {
      await api.autopilotSchedule({
        profileId,
        nextCycleDate: nextDate.toISOString(),
        cycleIntervalDays: settings.cycleIntervalDays,
      });
    }
  }

  async cancelSchedule(): Promise<void> {
    this.state.schedulerActive = false;
    this.state.nextCycleDate = null;
    this._persistState();

    const api = (window as any).electronAPI;
    if (api?.autopilotCancel) {
      await api.autopilotCancel();
    }
  }

  // ─── Pass Number Management ───────────────────────────────────────────────

  getPassNumber(profileId: string, itemId: string): PassNumber {
    const passes = this._loadPassNumbers(profileId);
    return passes[itemId] ?? 1;
  }

  setPassNumber(profileId: string, itemId: string, pass: PassNumber): void {
    const passes = this._loadPassNumbers(profileId);
    passes[itemId] = pass;
    this._savePassNumbers(profileId, passes);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async _preFlightCheck(personalInfo: PersonalInfo, items: NegativeItem[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!personalInfo.firstName?.trim()) errors.push('FATAL: Consumer first name is required');
    if (!personalInfo.lastName?.trim()) errors.push('FATAL: Consumer last name is required');
    if (!personalInfo.address?.trim()) errors.push('FATAL: Consumer address is required');
    if (!personalInfo.city?.trim() || !personalInfo.state?.trim() || !personalInfo.zip?.trim()) {
      errors.push('FATAL: Consumer city, state, and ZIP are required for letter delivery');
    }
    if (items.length === 0) warnings.push('No negative items found — nothing to dispute');
    if (!personalInfo.phone?.trim()) warnings.push('Phone number missing — add to profile for letters');

    return { isValid: errors.length === 0, errors, warnings };
  }

  private async _checkDuplicateLetter(
    itemId: string,
    passNumber: PassNumber,
    profileId: string,
    bureau = 'Unknown',
    settings?: AutoPilotSettingsV2 | AutoPilotSettingsV3,
  ): Promise<boolean> {
    // Check if a letter for this item+pass was already generated or sent within 30 days.
    // Using both events keeps the cycle idempotent even before print/mail workflows complete.
    const events = await DisputeHistoryService.getByItem(profileId, itemId);
    const v3=settings as Partial<AutoPilotSettingsV3>|undefined;
    const expected:Record<string,number>={Equifax:28,Experian:25,TransUnion:30};
    let windowDays=v3?.adaptiveDuplicateWindow===false?30:Math.max(25,(expected[bureau]??30)+5);
    if(passNumber>=5)windowDays=Math.min(windowDays,20);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - windowDays);

    const recentLetterEvents = events.filter(e =>
      (e.type === 'pass_letter_sent' || e.type === 'pass_letter_generated') &&
      e.passNumber === passNumber &&
      new Date(e.timestamp) > thirtyDaysAgo
    );

    return recentLetterEvents.length > 0;
  }

  private async _backupBeforeCycle(profileId: string, items: NegativeItem[]): Promise<void> {
    try {
      const backup = {
        timestamp: new Date().toISOString(),
        profileId,
        itemCount: items.length,
        passNumbers: this._loadPassNumbers(profileId),
        holdQueue: HoldQueue.getAll(profileId),
      };
      const key = `dylandos_cycle_backup_${profileId}`;
      localStorage.setItem(key, JSON.stringify(backup));
    } catch (e) {
      console.error('[AutoPilotV2] Backup failed:', e);
    }
  }

  private _calculateNextCycleDate(settings: AutoPilotSettingsV2): Date {
    const next = new Date();
    next.setDate(next.getDate() + settings.cycleIntervalDays);
    return next;
  }

  private _persistState(): void {
    try {
      const payload = {
        lastCycleDate: this.state.lastCycleDate,
        lastCycleResult: this.state.lastCycleResult,
        nextCycleDate: this.state.nextCycleDate,
        schedulerActive: this.state.schedulerActive,
        totalCyclesRun: this.state.totalCyclesRun,
      };
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
      // BUG-08 FIX: Write-through to IndexedDB so engine state survives localStorage eviction
      idbSaveEngineState(payload).catch(() => { });
    } catch {
      // Non-critical
    }
  }

  private _loadPassNumbers(profileId: string): Record<string, PassNumber> {
    try {
      // Fast sync path: read from localStorage cache.
      // IndexedDB writes happen asynchronously on every save (_savePassNumbers).
      const key = `${PASS_STORAGE_KEY}_${profileId}`;
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  }

  private _savePassNumbers(profileId: string, passes: Record<string, PassNumber>): void {
    try {
      const key = `${PASS_STORAGE_KEY}_${profileId}`;
      localStorage.setItem(key, JSON.stringify(passes));
      // BUG-08 FIX: Write-through to IndexedDB for durable storage
      idbSavePassNumbers(profileId, passes).catch(() => { });
    } catch {
      // Non-critical
    }
  }
}

export const AutoPilotEngineV2 = new AutoPilotEngineV2Class();

function escapeLetterHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Pass 6 Prompt Builder (v5.1.0) ─────────────────────────────────────────

/**
 * Build the AI letter generation prompt for Pass 6 (Pre-Litigation Demand).
 * Cites statutory damages exposure, references all prior passes, and gives
 * the respondent a 15-day deadline before legal action referral.
 */
export function buildPass6Prompt(params: {
  item: NegativeItem;
  bureau: string;
  personalInfo: PersonalInfo;
  disputeHistory: string;
  priorPassCount: number;
}): string {
  const { item, bureau, personalInfo, disputeHistory, priorPassCount } = params;

  // Analyze all available signals for the strongest possible argument
  let chainSection = '';
  try {
    const custody = analyzeChainOfCustody(item);
    if (custody.isDebtBuyer) {
      chainSection = `
DEBT BUYER ATTACK: This account is owned by a third-party debt buyer. They have been unable to produce
a complete chain of assignment. Cite FCRA §623(a)(8) — failure to produce documentation mandates deletion.`;
    }
  } catch { /* non-blocking */ }

  let metro2Section = '';
  try {
    const metro2Input: Metro2AuditInput = {
      status: item.status ?? '',
      balance: item.balance ?? 0,
      paymentHistory: (item as any).paymentHistoryProfile ? (item as any).paymentHistoryProfile.split('') : [],
      dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null,
      dateOpened: item.dateOpened ?? item.originalOpeningDate ?? null,
      creditLimit: item.creditLimit ?? (item as any).highCredit ?? null,
      accountType: item.accountType ?? '',
      currentRating: (item as any).currentRating ?? '',
      portfolioType: (item as any).portfolioType ?? '',
      specialComment: (item as any).specialComment ?? null,
      complianceConditionCode: (item as any).complianceConditionCode ?? null,
      crossBureauDofds: [item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? null],
      crossBureauStatuses: [item.status ?? ''],
      crossBureauDateOpened: [item.dateOpened ?? item.originalOpeningDate ?? null]
    };
    const violations = auditMetro2(metro2Input);
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    if (criticalViolations.length > 0) {
      metro2Section = `
METRO 2 VIOLATIONS: ${criticalViolations.length} critical Metro 2 compliance violation(s) detected:
${criticalViolations.map(v => `- ${v.ruleId}: ${v.description}`).join('\n')}
Each Metro 2 violation is a separate FCRA §623(a)(1) accuracy violation with its own statutory damage exposure.`;
    }
  } catch { /* non-blocking */ }

  let expirationSection = '';
  try {
    const radar = runExpirationRadar([item]);
    if (radar.length > 0 && (radar[0].status === 'EXPIRED' || radar[0].status === 'IMMINENT')) {
      expirationSection = `
EXPIRATION STATUS: ${radar[0].status} — this account is ${radar[0].status === 'EXPIRED' ? 'past' : 'within 180 days of'} its FCRA 7-year reporting window. Continued reporting is a §623(a)(5) violation.`;
    }
  } catch { /* non-blocking */ }

  let goodwillSection = '';
  try {
    const eligibility = isGoodwillEligible(item);
    if (eligibility.eligible) {
      const strategy = autoSelectGoodwillStrategy(item);
      goodwillSection = `
GOODWILL NOTE: This creditor may respond to a goodwill appeal (${strategy}) in parallel. 
Include a brief goodwill paragraph as a secondary olive-branch angle, but keep the primary tone as a legal demand.`;
    }
  } catch { /* non-blocking */ }

  return `
Write a Pass 6 PRE-LITIGATION STATUTORY DEMAND letter for a consumer credit dispute.

IMPORTANT: This is Pass ${priorPassCount + 1} of a ${priorPassCount + 1}-pass escalation campaign.
All prior passes have been exhausted with no satisfactory resolution. This is the FINAL NOTICE before legal referral.

CONSUMER: ${personalInfo.firstName} ${personalInfo.lastName}
ADDRESS: ${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}
PHONE: ${personalInfo.phone}

RESPONDENT: ${bureau}
ACCOUNT: ${item.creditorName} — Account ending ${resolvePostProcessedAccountNumber(item).slice(-4) || 'on file'}
BALANCE: $${item.balance ?? 0}
ISSUE: ${item.typeOfNegative}

DISPUTE HISTORY (all prior passes):
${disputeHistory || `${priorPassCount} dispute letters sent over the past several months with no resolution`}

LEGAL CITATIONS TO INCLUDE (all mandatory):
- FCRA §611: Bureau failed to conduct a reasonable investigation within the statutory period
- FCRA §616: Willful non-compliance — statutory damages of $100 to $1,000 per violation
- FCRA §617: Negligent non-compliance — actual damages + attorney fees recoverable  
- FCRA §623(a)(1): Furnisher duty to report accurate information
- FCRA §623(a)(8): Furnisher duty to investigate direct disputes
- Reference that consumer is prepared to seek counsel under the FCRA's fee-shifting provision

STATUTORY DAMAGES LANGUAGE (include this):
"Pursuant to FCRA §616, willful non-compliance with the Act carries statutory damages of $100 to $1,000
per violation, plus punitive damages and attorney's fees. Pursuant to FCRA §617, negligent non-compliance
entitles the consumer to actual damages plus attorney's fees. Each day of continued inaccurate reporting
may constitute a separate violation."

DEADLINE: Give the respondent EXACTLY 15 days to resolve this matter before legal referral.

TONE: Firm, formal, legally precise. This is a demand letter, not a request. Use language that signals
imminent legal action without making specific lawsuit threats. Reference the consumer's legal counsel
consideration. Do not be emotional — be coldly precise and legally grounded.

LENGTH: 400-550 words.

STRUCTURE:
1. Opening: This is your final notice — all prior attempts at resolution have been exhausted.
2. Account details and what specifically is inaccurate/unverifiable.
3. History: Reference all prior dispute passes briefly.
4. Legal grounds: Cite all FCRA sections listed above.
5. Statutory damages exposure paragraph (use the language above).
6. Demand: Delete/correct within 15 days or consumer will pursue legal remedies.
7. Closing: Formal, no pleasantries.
${chainSection}
${metro2Section}
${expirationSection}
${goodwillSection}
  `.trim();
}

// ─── GAP-B Helper ─────────────────────────────────────────────────────────────

/**
 * Maps NegativeItem.typeOfNegative (free-form string) to a DisputeType for the
 * evidence gate. Falls back to 'general' for unrecognized types.
 */
function mapTypeToDisputeType(typeOfNegative: string): DisputeType {
  const t = (typeOfNegative ?? '').toLowerCase();
  if (t.includes('not mine') || t.includes('fraud') || t.includes('identity')) return 'identity_theft';
  if (t.includes('collection') || t.includes('collector')) return 'collection';
  if (t.includes('charge off') || t.includes('chargeoff') || t.includes('charge-off')) return 'charge_off';
  if (t.includes('late') || t.includes('delinquent')) return 'late_payment';
  if (t.includes('bankruptcy') || t.includes('bk')) return 'bankruptcy';
  if (t.includes('repossess') || t.includes('repo')) return 'repossession';
  if (t.includes('balance')) return 'balance_incorrect';
  if (t.includes('paid') || t.includes('satisfied') || t.includes('settled')) return 'paid_in_full';
  if (t.includes('date') || t.includes('age')) return 'dates_incorrect';
  return 'general';
}
