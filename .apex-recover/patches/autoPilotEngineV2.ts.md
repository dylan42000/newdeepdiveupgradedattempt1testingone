# Patches for autoPilotEngineV2.ts (27)

## Patch 1 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (610)
```
import { findCrossBureauDeletions } from './crossBureauAnalyzer';
// QUEUE FIX: Import concurrency-capped queue manager to prevent Groq 429 crashes
import { apiQueueManager } from './apiQueueManager';
import { HealedAccount, normalizeCreditorName, isAccountNumberMasked, computeConfidenceScore } from './accountHealingEngine';
import { Metro2AuditEngine } from './metro2AuditEngine';
import { DisputeClockEngine } from './disputeClockEngine';
// Phase 2: Dead Account Economics Scorer — skip Pass 1 for low-balance charge-offs/collections
import { evaluateDeadAccountEconomics } from './autoPilotStateMachine';
```
### NEW (913)
```
import { findCrossBureauDeletions } from './crossBureauAnalyzer';
// QUEUE FIX: Import concurrency-capped queue manager to prevent Groq 429 crashes
import { apiQueueManager } from './apiQueueManager';
import { HealedAccount, normalizeCreditorName, isAccountNumberMasked, computeConfidenceScore } from './accountHealingEngine';
import { Metro2AuditEngine } from './metro2AuditEngine';
import { DisputeClockEngine } from './disputeClockEngine';
// Phase 2: Dead Account Economics Scorer — skip Pass 1 for low-balance charge-offs/collections
import { evaluateDeadAccountEconomics } from './autoPilotStateMachine';
// v5.1: Unified tradeline merge + Phase 2 campaign planner
import {
  applySmartMerge,
  pickGroupRepresentatives,
  expandGroupSiblings,
} from './unifiedTradelineResolver';
import { planTradelineCampaign } from './tradelineAutoPilotOrchestrator';
import { auditMetro2Static } from './metro2Auditor';
```

## Patch 2 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (4935)
```
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

      // ── Phase 2: Dead Account Economics Scorer ────────────────────────
      // Charge-offs / collections under $2,500 are the tradelines furnishers most
      // often decline to re-verify within the §623(b) window. For these, skip the
      // Pass 1 accuracy challenge and enter directly at Pass 2 (dual-fire) for the
      // highest deletion probability. Only applies to brand-new items (no stored
      // pass) so in-flight escalations are never overridden.
      let deadAccountSkips = 0;
      for (const item of items) {
        if (passNumbers[item.id] != null) continue;
        const statusText = `${item.status ?? ''} ${item.typeOfNegative ?? ''} ${item.accountStatus ?? ''}`;
        const dead = evaluateDeadAccountEconomics({ statusText, balance: item.balance ?? null });
        if (dead.skipPass1) {
          passNumbers[item.id] = 2;
          deadAccountSkips++;
          progress(`[DEAD-ACCOUNT] ${item.creditorName}: ${dead.reasons.join('; ')} → entering at Pass 2 (Pass 1 skipped)`);
        }
      }
      if (deadAccountSkips > 0) {
        this._savePassNumbers(profileId, passNumbers);
        progress(`[DEAD-ACCOUNT] ${deadAccountSkips} low-balance derogatory item(s) fast-tracked to Pass 2`);
      }

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
        passNumbers[holdEntry.itemId] = Math.min(5, currentPass + 1) as PassNumber;
      }

      // ── Pre-filter items with recent letters (prevents batch selecting all-duplicate items) ──
      const recentlyGeneratedItemIds = new Set<string>();
      for (const item of items) {
        const passForItem = passNumbers[item.id] ?? 1;
        const isDup = await this._checkDuplicateLetter(item.id, passForItem, profileId);
        if (isDup) recentlyGeneratedItemIds.add(item.id);
      }
      const freshItems = items.filter(i => !recentlyGeneratedItemIds.has(i.id));
      if (recentlyGeneratedItemIds.size > 0) {
        progress(`Pre-filter: ${recentlyGeneratedItemIds.size} item(s) already have Pass letters — excluded from batch`);
      }

      // ── Batch selection ───────────────────────────────────────────────
      progress('Selecting optimal batch...');
      const batchResult = BatchSelector.selectBatch(freshItems, profileId, settings, passNumbers);
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(`Batch: ${batchResult.selected.length} selected, ${batchResult.skippedOnHold.length} on hold`);
      progress(`Rationale: ${batchResult.batchRationale}`);
```
### NEW (7023)
```
      await DisputeHistoryService.init();
      await DisputeHistoryService.logEvent({
        profileId,
        type: 'cycle_started',
        title: 'AutoPilot Cycle V2 Started',
        detail: `Processing ${items.length} items with ${Math.round(settings.batchFraction * 100)}% batch fraction`,
        cycleId,
      });

      // ── v5.1: Unified tradeline merge (suffix-aligned digits, no collapse) ──
      progress('Resolving cross-bureau tradelines...');
      const linkedItems = applySmartMerge(items);
      const eq = linkedItems.filter((i) => /equifax/i.test(i.creditBureau?.[0] ?? ''));
      const ex = linkedItems.filter((i) => /experian/i.test(i.creditBureau?.[0] ?? ''));
      const tu = linkedItems.filter((i) => /transunion/i.test(i.creditBureau?.[0] ?? ''));
      let machineStates: Record<string, import('./autoPilotStateMachine').AutoPilotMachineState> = {};
      try {
        machineStates = JSON.parse(
          localStorage.getItem(`dylandos_tradeline_machines_${profileId}`) || '{}',
        );
      } catch {
        machineStates = {};
      }
      const campaignPlan = planTradelineCampaign(eq, ex, tu, {
        consumerName: `${personalInfo.firstName} ${personalInfo.lastName}`.trim(),
        todayDate: new Date().toISOString().slice(0, 10),
        detectMetro2Violations: auditMetro2Static,
        machineStates,
        includeSingletons: true,
      });
      try {
        localStorage.setItem(
          `dylandos_tradeline_machines_${profileId}`,
          JSON.stringify(campaignPlan.machineStates),
        );
      } catch {
        /* ignore quota */
      }
      progress(
        `[TRADELINE] ${campaignPlan.summary.crossBureauMerges} cross-bureau merges · ` +
          `${campaignPlan.summary.activeCampaigns} active campaigns · ` +
          `${campaignPlan.summary.deadAccounts} dead-account fast-tracks`,
      );

      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

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

      // ── Phase 2: Dead Account Economics Scorer ────────────────────────
      // Charge-offs / collections under $2,500 are the tradelines furnishers most
      // often decline to re-verify within the §623(b) window. For these, skip the
      // Pass 1 accuracy challenge and enter directly at Pass 2 (dual-fire) for the
      // highest deletion probability. Only applies to brand-new items (no stored
      // pass) so in-flight escalations are never overridden.
      let deadAccountSkips = 0;
      for (const item of workingItems) {
        if (passNumbers[item.id] != null) continue;
        const statusText = `${item.status ?? ''} ${item.typeOfNegative ?? ''} ${item.accountStatus ?? ''}`;
        const dead = evaluateDeadAccountEconomics({ statusText, balance: item.balance ?? null });
        if (dead.skipPass1) {
          passNumbers[item.id] = 2;
          deadAccountSkips++;
          progress(`[DEAD-ACCOUNT] ${item.creditorName}: ${dead.reasons.join('; ')} → entering at Pass 2 (Pass 1 skipped)`);
        }
      }
      if (deadAccountSkips > 0) {
        this._savePassNumbers(profileId, passNumbers);
        progress(`[DEAD-ACCOUNT] ${deadAccountSkips} low-balance derogatory item(s) fast-tracked to Pass 2`);
      }

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
      const inertiaResult = await evaluateInertia(profileId, workingItems, passNumbers, progress);
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
        passNumbers[holdEntry.itemId] = Math.min(5, currentPass + 1) as PassNumber;
      }

      // ── Pre-filter items with recent letters (prevents batch selecting all-duplicate items) ──
      const recentlyGeneratedItemIds = new Set<string>();
      for (const item of workingItems) {
        const passForItem = passNumbers[item.id] ?? 1;
        const isDup = await this._checkDuplicateLetter(item.id, passForItem, profileId);
        if (isDup) recentlyGeneratedItemIds.add(item.id);
      }
      const freshItems = workingItems.filter(i => !recentlyGeneratedItemIds.has(i.id));
      if (recentlyGeneratedItemIds.size > 0) {
        progress(`Pre-filter: ${recentlyGeneratedItemIds.size} item(s) already have Pass letters — excluded from batch`);
      }

      // ── Batch selection (group-aware: one debt, all sibling bureaus) ──
      progress('Selecting optimal batch...');
      const batchResult = BatchSelector.selectBatch(freshItems, profileId, settings, passNumbers);
      // Collapse to one rep per cross-bureau group, then expand siblings so
      // Autopilot attacks the full tradeline across EQ/EX/TU in one cycle.
      const reps = pickGroupRepresentatives(batchResult.selected);
      const expanded = expandGroupSiblings(reps, workingItems);
      batchResult.selected = expanded;
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(
        `Batch: ${reps.length} tradeline(s) → ${batchResult.selected.length} bureau target(s), ` +
          `${batchResult.skippedOnHold.length} on hold`,
      );
      progress(`Rationale: ${batchResult.batchRationale}`);
```

## Patch 3 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (654)
```
            const healedAccount: HealedAccount = {
              id: item.id,
              creditorName: normalizeCreditorName(item.creditorName),
              reconstructedAccountNumber: item.accountNumber, // Basic fallback
              balance: item.balance ?? 0,
              status: item.status ?? '',
              dateOpened: item.dateOpened ?? item.originalOpeningDate ?? undefined,
              dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? undefined,
              confidenceScore: confidence.total,
              healingFlags: [],
              requiresDisclosureRequest: isMasked
            };
```
### NEW (731)
```
            const healedAccount: HealedAccount = {
              id: item.id,
              creditorName: normalizeCreditorName(item.creditorName),
              reconstructedAccountNumber: item.fullAccountNumber || item.accountNumber || undefined,
              balance: item.balance ?? 0,
              status: item.status ?? '',
              dateOpened: item.dateOpened ?? item.originalOpeningDate ?? undefined,
              dateOfFirstDelinquency: item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? undefined,
              confidenceScore: confidence.total,
              healingFlags: item.fullAccountNumber ? ['unified_tradeline_digits'] : [],
              requiresDisclosureRequest: isMasked
            };
```

## Patch 4 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (412)
```
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
```
### NEW (479)
```
export const DEFAULT_SETTINGS_V2: AutoPilotSettingsV2 = {
  enabled: false,
  batchFraction: 0.33,
  maxItemsPerBatch: 8,
  dualTargetMode: true,
  holdDaysByPass: { 1: 60, 2: 60, 3: 45, 4: 30, 5: 14, 6: 15 },
  cycleIntervalDays: 32,
  letterAutoApprove: false,
  autonomyLevel: 'approve_once_per_cycle',
  cycleApproved: false,
  aiModel: 'groq',
  noResponseThresholdDays: 35,
  autoGenerateCFPBOnPass5: true,
  autoGenerateStateAGOnPass5: false,
  backupBeforeCycle: true,
};
```

## Patch 5 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (126)
```
import { planTradelineCampaign } from './tradelineAutoPilotOrchestrator';
import { auditMetro2Static } from './metro2Auditor';
```
### NEW (377)
```
import { planTradelineCampaign } from './tradelineAutoPilotOrchestrator';
import { auditMetro2Static } from './metro2Auditor';
import { OutcomeLearningStore } from './outcomeLearningStore';
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
```

## Patch 6 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (378)
```
      progress(
        `[TRADELINE] ${campaignPlan.summary.crossBureauMerges} cross-bureau merges · ` +
          `${campaignPlan.summary.activeCampaigns} active campaigns · ` +
          `${campaignPlan.summary.deadAccounts} dead-account fast-tracks`,
      );

      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;
```
### NEW (2188)
```
      progress(
        `[TRADELINE] ${campaignPlan.summary.crossBureauMerges} cross-bureau merges · ` +
          `${campaignPlan.summary.activeCampaigns} active campaigns · ` +
          `${campaignPlan.summary.deadAccounts} dead-account fast-tracks`,
      );

      // Autonomy gate — draft_only still generates; mail/legal blocked later
      const autonomy = settings.autonomyLevel ?? 'approve_once_per_cycle';
      const draftGate = autonomyAllowsAction(autonomy, 'draft', settings.cycleApproved);
      if (!draftGate.allowed) {
        throw new Error(`Autonomy blocked cycle: ${draftGate.reason}`);
      }
      progress(`[AUTONOMY] ${autonomy} — ${draftGate.reason}`);

      // Persist event-sourced campaigns for each unified tradeline
      const resolved = resolveAllTradelines(linkedItems);
      for (const r of resolved.resolved) {
        const camp = ensureCampaignForTradeline({
          profileId,
          tradelineId: r.unified.id,
          displayCreditorName: r.unified.displayCreditorName,
          memberItemIds: r.unified.memberItemIds,
          autonomyLevel: autonomy,
        });
        appendCampaignEvent(profileId, {
          type: 'TRADELINE_MERGED',
          campaignId: camp.id,
          tradelineId: r.unified.id,
          payload: {
            displayCreditorName: r.unified.displayCreditorName,
            memberItemIds: r.unified.memberItemIds,
            matchScore: r.matchScore,
            reconstructedAccountNumber: r.reconstructedAccountNumber,
          },
        });
      }

      // Seed pass numbers from outcome learning for brand-new items
      for (const item of linkedItems) {
        if (passNumbers[item.id] != null) continue;
        const learned = OutcomeLearningStore.recommendStartingPass(
          item.creditorName,
          item.creditBureau[0] ?? 'Unknown',
        );
        if (learned > 1) {
          passNumbers[item.id] = Math.min(5, learned) as PassNumber;
          progress(`[LEARNING] ${item.creditorName}: starting Pass ${learned} from outcome history`);
        }
      }

      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;
```

## Patch 7 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (2388)
```
      // Persist event-sourced campaigns for each unified tradeline
      const resolved = resolveAllTradelines(linkedItems);
      for (const r of resolved.resolved) {
        const camp = ensureCampaignForTradeline({
          profileId,
          tradelineId: r.unified.id,
          displayCreditorName: r.unified.displayCreditorName,
          memberItemIds: r.unified.memberItemIds,
          autonomyLevel: autonomy,
        });
        appendCampaignEvent(profileId, {
          type: 'TRADELINE_MERGED',
          campaignId: camp.id,
          tradelineId: r.unified.id,
          payload: {
            displayCreditorName: r.unified.displayCreditorName,
            memberItemIds: r.unified.memberItemIds,
            matchScore: r.matchScore,
            reconstructedAccountNumber: r.reconstructedAccountNumber,
          },
        });
      }

      // Seed pass numbers from outcome learning for brand-new items
      for (const item of linkedItems) {
        if (passNumbers[item.id] != null) continue;
        const learned = OutcomeLearningStore.recommendStartingPass(
          item.creditorName,
          item.creditBureau[0] ?? 'Unknown',
        );
        if (learned > 1) {
          passNumbers[item.id] = Math.min(5, learned) as PassNumber;
          progress(`[LEARNING] ${item.creditorName}: starting Pass ${learned} from outcome history`);
        }
      }

      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

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
```
### NEW (2389)
```
      // Persist event-sourced campaigns for each unified tradeline
      const resolved = resolveAllTradelines(linkedItems);
      for (const r of resolved.resolved) {
        const camp = ensureCampaignForTradeline({
          profileId,
          tradelineId: r.unified.id,
          displayCreditorName: r.unified.displayCreditorName,
          memberItemIds: r.unified.memberItemIds,
          autonomyLevel: autonomy,
        });
        appendCampaignEvent(profileId, {
          type: 'TRADELINE_MERGED',
          campaignId: camp.id,
          tradelineId: r.unified.id,
          payload: {
            displayCreditorName: r.unified.displayCreditorName,
            memberItemIds: r.unified.memberItemIds,
            matchScore: r.matchScore,
            reconstructedAccountNumber: r.reconstructedAccountNumber,
          },
        });
      }

      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

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

      // Seed pass numbers from outcome learning for brand-new items
      for (const item of workingItems) {
        if (passNumbers[item.id] != null) continue;
        const learned = OutcomeLearningStore.recommendStartingPass(
          item.creditorName,
          item.creditBureau[0] ?? 'Unknown',
        );
        if (learned > 1) {
          passNumbers[item.id] = Math.min(5, learned) as PassNumber;
          progress(`[LEARNING] ${item.creditorName}: starting Pass ${learned} from outcome history`);
        }
      }
```

## Patch 8 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (226)
```
    // Wire DeletionOutcomeEngine
    try {
      DeletionOutcomeEngine.captureOutcome(bureau, itemId, mappedOutcome as any);
    } catch (e) {
      console.warn('[AutoPilotV2] DeletionOutcomeEngine capture failed', e);
    }
```
### NEW (1438)
```
    // Wire DeletionOutcomeEngine
    try {
      DeletionOutcomeEngine.captureOutcome(bureau, itemId, mappedOutcome as any);
    } catch (e) {
      console.warn('[AutoPilotV2] DeletionOutcomeEngine capture failed', e);
    }

    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: itemId,
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });

    // Event-sourced campaign update
    try {
      const campaigns = (await import('./tradelineCampaignStore')).listCampaigns(profileId);
      const camp = campaigns.find((c) => c.memberItemIds.includes(itemId));
      if (camp) {
        appendCampaignEvent(profileId, {
          type: 'RESPONSE_RECEIVED',
          campaignId: camp.id,
          tradelineId: camp.tradelineId,
          payload: { outcome, bureau, passNumber, letterId },
        });
        appendCampaignEvent(profileId, {
          type: 'OUTCOME_CLASSIFIED',
          campaignId: camp.id,
          tradelineId: camp.tradelineId,
          payload: { outcome },
        });
      }
    } catch {
      /* non-fatal */
    }
```

## Patch 9 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (187)
```
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
```
### NEW (204)
```
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
  listCampaigns,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
```

## Patch 10 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (372)
```
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
```
### NEW (413)
```
  async handleResponse(params: {
    profileId: string;
    itemId: string;
    bureau: string;
    outcome: 'deleted' | 'verified' | 'updated' | 'no_response' | 'frivolous';
    passNumber: PassNumber;
    letterId: string;
    settings: AutoPilotSettingsV2;
    creditorName?: string;
  }): Promise<void> {
    const { profileId, itemId, bureau, outcome, passNumber, letterId, settings, creditorName } = params;
```

## Patch 11 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (1210)
```
    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: itemId,
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });

    // Event-sourced campaign update
    try {
      const campaigns = (await import('./tradelineCampaignStore')).listCampaigns(profileId);
      const camp = campaigns.find((c) => c.memberItemIds.includes(itemId));
      if (camp) {
        appendCampaignEvent(profileId, {
          type: 'RESPONSE_RECEIVED',
          campaignId: camp.id,
          tradelineId: camp.tradelineId,
          payload: { outcome, bureau, passNumber, letterId },
        });
        appendCampaignEvent(profileId, {
          type: 'OUTCOME_CLASSIFIED',
          campaignId: camp.id,
          tradelineId: camp.tradelineId,
          payload: { outcome },
        });
      }
    } catch {
      /* non-fatal */
    }
```
### NEW (1186)
```
    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: creditorName || 'Unknown',
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });

    // Event-sourced campaign update
    try {
      const campaigns = listCampaigns(profileId);
      const camp = campaigns.find((c) => c.memberItemIds.includes(itemId));
      if (camp) {
        appendCampaignEvent(profileId, {
          type: 'RESPONSE_RECEIVED',
          campaignId: camp.id,
          tradelineId: camp.tradelineId,
          payload: { outcome, bureau, passNumber, letterId },
        });
        appendCampaignEvent(profileId, {
          type: 'OUTCOME_CLASSIFIED',
          campaignId: camp.id,
          tradelineId: camp.tradelineId,
          payload: { outcome },
        });
      }
    } catch {
      /* non-fatal */
    }
```

## Patch 12 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (304)
```
import { OutcomeLearningStore } from './outcomeLearningStore';
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
  listCampaigns,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
import { v4 as uuidv4 } from 'uuid';
```
### NEW (807)
```
import { OutcomeLearningStore } from './outcomeLearningStore';
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
  listCampaigns,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
import { planStrategiesForBatch } from './itemStrategyPlanner';
import { isInquiryItem } from './inquiryDisputeEngine';
import { buildAccountIdentityGraph } from './accountIdentityGraph';
import { guardLetterAgainstFabrication } from './antiFabricationGuard';
import { AbStrategyTracker } from './abStrategyTracker';
import { planFurnisherDirect } from './furnisherDirectEngine';
import { classifyDebtType } from './debtTypeStrategyLibrary';
import { scanReportForFraud } from './fraudDetectionEngine';
import { v4 as uuidv4 } from 'uuid';
```

## Patch 13 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (92)
```
import { resolveAllTradelines } from './unifiedTradelineResolver';

interface PersonalInfo {
```
### NEW (595)
```
import { resolveAllTradelines } from './unifiedTradelineResolver';
import { planStrategiesForBatch } from './itemStrategyPlanner';
import { isInquiryItem } from './inquiryDisputeEngine';
import { buildAccountIdentityGraph } from './accountIdentityGraph';
import { guardLetterAgainstFabrication } from './antiFabricationGuard';
import { AbStrategyTracker } from './abStrategyTracker';
import { planFurnisherDirect } from './furnisherDirectEngine';
import { classifyDebtType } from './debtTypeStrategyLibrary';
import { scanReportForFraud } from './fraudDetectionEngine';

interface PersonalInfo {
```

## Patch 14 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (191)
```
      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

      // ── Process hold queue ────────────────────────────────────────────
```
### NEW (1223)
```
      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

      // Apex — Account Identity Graph (OC/CA link groups + triadic refuse audit)
      const identityGraph = buildAccountIdentityGraph(workingItems);
      if (identityGraph.linkGroups.length > 0) {
        for (const group of identityGraph.linkGroups) {
          const campaignGroupId = `link_${group.slice().sort().join('_').slice(0, 48)}`;
          for (const id of group) {
            const item = workingItems.find((i) => i.id === id);
            if (item && !item.crossBureauGroupId) {
              item.crossBureauGroupId = campaignGroupId;
            }
          }
        }
        progress(
          `[AIG] ${identityGraph.linkGroups.length} link-only campaign group(s), ` +
            `${identityGraph.conflicted.length} conflict pair(s)`,
        );
      }

      const fraudFlags = scanReportForFraud(workingItems, personalInfo);
      result.fraudAlertCount = fraudFlags.length;
      if (fraudFlags.length > 0) {
        progress(`[FRAUD] ${fraudFlags.length} fraud/mixed-file signal(s) on file`);
      }

      // ── Process hold queue ────────────────────────────────────────────
```

## Patch 15 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (548)
```
      const reps = pickGroupRepresentatives(batchResult.selected);
      const expanded = expandGroupSiblings(reps, workingItems);
      batchResult.selected = expanded;
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(
        `Batch: ${reps.length} tradeline(s) → ${batchResult.selected.length} bureau target(s), ` +
          `${batchResult.skippedOnHold.length} on hold`,
      );
      progress(`Rationale: ${batchResult.batchRationale}`);

      // ── Task 1: Per-item Pre-Flight Gate ──────────────────────────────
```
### NEW (2021)
```
      const reps = pickGroupRepresentatives(batchResult.selected);
      const expanded = expandGroupSiblings(reps, workingItems);
      batchResult.selected = expanded;
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(
        `Batch: ${reps.length} tradeline(s) → ${batchResult.selected.length} bureau target(s), ` +
          `${batchResult.skippedOnHold.length} on hold`,
      );
      progress(`Rationale: ${batchResult.batchRationale}`);

      // Apex — Inquiry items stay on separate campaign track (never mix with tradeline batch)
      const inquirySeparated = batchResult.selected.filter((i) => isInquiryItem(i));
      if (inquirySeparated.length > 0) {
        batchResult.selected = batchResult.selected.filter((i) => !isInquiryItem(i));
        progress(`[INQUIRY] ${inquirySeparated.length} hard-inquiry item(s) deferred to inquiry dispute track`);
      }

      // Apex — Strategy Cards for selected batch (Why bullets + campaign type)
      const strategyCards = planStrategiesForBatch({
        items: batchResult.selected,
        passNumbers,
        personalInfo,
        profileId,
      });
      result.strategyCards = strategyCards;
      for (const card of strategyCards) {
        progress(
          `[STRATEGY] ${card.creditorName}: ${card.campaignType}/${card.primaryAngle} ` +
            `(${card.strategyConfidence}) — ${card.explainWhy[0]?.headline ?? 'planned'}`,
        );
        if (card.campaignType === 'fraud_block') {
          // Keep in batch for user-visible Why cards but mark action required
          result.itemsRequiringAction = [...(result.itemsRequiringAction ?? []), card.itemId];
        }
        const furnisherPlan = planFurnisherDirect(
          batchResult.selected.find((i) => i.id === card.itemId)!,
        );
        if (furnisherPlan?.recommended) {
          progress(`[FURNISHER] ${card.creditorName}: ${furnisherPlan.reason}`);
        }
      }

      // ── Task 1: Per-item Pre-Flight Gate ──────────────────────────────
```

## Patch 16 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (269)
```
        const furnisherPlan = planFurnisherDirect(
          batchResult.selected.find((i) => i.id === card.itemId)!,
        );
        if (furnisherPlan?.recommended) {
          progress(`[FURNISHER] ${card.creditorName}: ${furnisherPlan.reason}`);
        }
      }
```
### NEW (332)
```
        const matchedItem = batchResult.selected.find((i) => i.id === card.itemId);
        if (matchedItem) {
          const furnisherPlan = planFurnisherDirect(matchedItem);
          if (furnisherPlan.recommended) {
            progress(`[FURNISHER] ${card.creditorName}: ${furnisherPlan.reason}`);
          }
        }
      }
```

## Patch 17 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (264)
```
            if (letter.htmlContent) {
              letter.htmlContent = AntiSpamDisputeEngine.generateUniqueSyntacticStructure(letter.htmlContent, letter.id);
            }

            // Archive
            await ArchiveService.archiveLetter(letter, profileId);
```
### NEW (890)
```
            if (letter.htmlContent) {
              letter.htmlContent = AntiSpamDisputeEngine.generateUniqueSyntacticStructure(letter.htmlContent, letter.id);
            }

            // Apex — Anti-fabrication + UPL hard gate
            const fab = guardLetterAgainstFabrication({
              letterText: `${letter.letterContent || ''}\n${letter.htmlContent || ''}`,
              item,
              personalInfo,
            });
            if (!fab.ok) {
              const msgs = fab.findings.filter((f) => f.severity === 'block').map((f) => f.message);
              result.errors.push(`Anti-fabrication blocked ${item.creditorName}: ${msgs.join('; ')}`);
              progress(`[FABRICATION] Blocked letter for ${item.creditorName}: ${msgs[0]}`);
              continue;
            }

            // Archive
            await ArchiveService.archiveLetter(letter, profileId);
```

## Patch 18 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (525)
```
    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: creditorName || 'Unknown',
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });
```
### NEW (1102)
```
    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: creditorName || 'Unknown',
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });

    // Apex A/B tracker — closed-loop win rates by bureau/debt type
    AbStrategyTracker.recordOutcome({
      itemId,
      angle: 'cycle_response',
      bureau,
      debtType: 'unknown',
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'corrected'
              : outcome === 'frivolous'
                ? 'frivolous_rejection'
                : 'no_response',
      pass: passNumber,
      creditorClass: creditorName || 'unknown',
    });
```

## Patch 19 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (185)
```
import { planFurnisherDirect } from './furnisherDirectEngine';
import { classifyDebtType } from './debtTypeStrategyLibrary';
import { scanReportForFraud } from './fraudDetectionEngine';
```
### NEW (123)
```
import { planFurnisherDirect } from './furnisherDirectEngine';
import { scanReportForFraud } from './fraudDetectionEngine';
```

## Patch 20 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (304)
```
import { OutcomeLearningStore } from './outcomeLearningStore';
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
  listCampaigns,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
import { v4 as uuidv4 } from 'uuid';
```
### NEW (807)
```
import { OutcomeLearningStore } from './outcomeLearningStore';
import {
  ensureCampaignForTradeline,
  appendCampaignEvent,
  autonomyAllowsAction,
  listCampaigns,
} from './tradelineCampaignStore';
import { resolveAllTradelines } from './unifiedTradelineResolver';
import { planStrategiesForBatch } from './itemStrategyPlanner';
import { isInquiryItem } from './inquiryDisputeEngine';
import { buildAccountIdentityGraph } from './accountIdentityGraph';
import { guardLetterAgainstFabrication } from './antiFabricationGuard';
import { AbStrategyTracker } from './abStrategyTracker';
import { planFurnisherDirect } from './furnisherDirectEngine';
import { classifyDebtType } from './debtTypeStrategyLibrary';
import { scanReportForFraud } from './fraudDetectionEngine';
import { v4 as uuidv4 } from 'uuid';
```

## Patch 21 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (92)
```
import { resolveAllTradelines } from './unifiedTradelineResolver';

interface PersonalInfo {
```
### NEW (595)
```
import { resolveAllTradelines } from './unifiedTradelineResolver';
import { planStrategiesForBatch } from './itemStrategyPlanner';
import { isInquiryItem } from './inquiryDisputeEngine';
import { buildAccountIdentityGraph } from './accountIdentityGraph';
import { guardLetterAgainstFabrication } from './antiFabricationGuard';
import { AbStrategyTracker } from './abStrategyTracker';
import { planFurnisherDirect } from './furnisherDirectEngine';
import { classifyDebtType } from './debtTypeStrategyLibrary';
import { scanReportForFraud } from './fraudDetectionEngine';

interface PersonalInfo {
```

## Patch 22 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (191)
```
      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

      // ── Process hold queue ────────────────────────────────────────────
```
### NEW (1223)
```
      // Prefer working set with group IDs + reconstructed account numbers
      const workingItems = linkedItems;

      // Apex — Account Identity Graph (OC/CA link groups + triadic refuse audit)
      const identityGraph = buildAccountIdentityGraph(workingItems);
      if (identityGraph.linkGroups.length > 0) {
        for (const group of identityGraph.linkGroups) {
          const campaignGroupId = `link_${group.slice().sort().join('_').slice(0, 48)}`;
          for (const id of group) {
            const item = workingItems.find((i) => i.id === id);
            if (item && !item.crossBureauGroupId) {
              item.crossBureauGroupId = campaignGroupId;
            }
          }
        }
        progress(
          `[AIG] ${identityGraph.linkGroups.length} link-only campaign group(s), ` +
            `${identityGraph.conflicted.length} conflict pair(s)`,
        );
      }

      const fraudFlags = scanReportForFraud(workingItems, personalInfo);
      result.fraudAlertCount = fraudFlags.length;
      if (fraudFlags.length > 0) {
        progress(`[FRAUD] ${fraudFlags.length} fraud/mixed-file signal(s) on file`);
      }

      // ── Process hold queue ────────────────────────────────────────────
```

## Patch 23 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (548)
```
      const reps = pickGroupRepresentatives(batchResult.selected);
      const expanded = expandGroupSiblings(reps, workingItems);
      batchResult.selected = expanded;
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(
        `Batch: ${reps.length} tradeline(s) → ${batchResult.selected.length} bureau target(s), ` +
          `${batchResult.skippedOnHold.length} on hold`,
      );
      progress(`Rationale: ${batchResult.batchRationale}`);

      // ── Task 1: Per-item Pre-Flight Gate ──────────────────────────────
```
### NEW (2021)
```
      const reps = pickGroupRepresentatives(batchResult.selected);
      const expanded = expandGroupSiblings(reps, workingItems);
      batchResult.selected = expanded;
      result.itemsOnHold = batchResult.skippedOnHold.length;
      progress(
        `Batch: ${reps.length} tradeline(s) → ${batchResult.selected.length} bureau target(s), ` +
          `${batchResult.skippedOnHold.length} on hold`,
      );
      progress(`Rationale: ${batchResult.batchRationale}`);

      // Apex — Inquiry items stay on separate campaign track (never mix with tradeline batch)
      const inquirySeparated = batchResult.selected.filter((i) => isInquiryItem(i));
      if (inquirySeparated.length > 0) {
        batchResult.selected = batchResult.selected.filter((i) => !isInquiryItem(i));
        progress(`[INQUIRY] ${inquirySeparated.length} hard-inquiry item(s) deferred to inquiry dispute track`);
      }

      // Apex — Strategy Cards for selected batch (Why bullets + campaign type)
      const strategyCards = planStrategiesForBatch({
        items: batchResult.selected,
        passNumbers,
        personalInfo,
        profileId,
      });
      result.strategyCards = strategyCards;
      for (const card of strategyCards) {
        progress(
          `[STRATEGY] ${card.creditorName}: ${card.campaignType}/${card.primaryAngle} ` +
            `(${card.strategyConfidence}) — ${card.explainWhy[0]?.headline ?? 'planned'}`,
        );
        if (card.campaignType === 'fraud_block') {
          // Keep in batch for user-visible Why cards but mark action required
          result.itemsRequiringAction = [...(result.itemsRequiringAction ?? []), card.itemId];
        }
        const furnisherPlan = planFurnisherDirect(
          batchResult.selected.find((i) => i.id === card.itemId)!,
        );
        if (furnisherPlan?.recommended) {
          progress(`[FURNISHER] ${card.creditorName}: ${furnisherPlan.reason}`);
        }
      }

      // ── Task 1: Per-item Pre-Flight Gate ──────────────────────────────
```

## Patch 24 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (269)
```
        const furnisherPlan = planFurnisherDirect(
          batchResult.selected.find((i) => i.id === card.itemId)!,
        );
        if (furnisherPlan?.recommended) {
          progress(`[FURNISHER] ${card.creditorName}: ${furnisherPlan.reason}`);
        }
      }
```
### NEW (332)
```
        const matchedItem = batchResult.selected.find((i) => i.id === card.itemId);
        if (matchedItem) {
          const furnisherPlan = planFurnisherDirect(matchedItem);
          if (furnisherPlan.recommended) {
            progress(`[FURNISHER] ${card.creditorName}: ${furnisherPlan.reason}`);
          }
        }
      }
```

## Patch 25 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (264)
```
            if (letter.htmlContent) {
              letter.htmlContent = AntiSpamDisputeEngine.generateUniqueSyntacticStructure(letter.htmlContent, letter.id);
            }

            // Archive
            await ArchiveService.archiveLetter(letter, profileId);
```
### NEW (890)
```
            if (letter.htmlContent) {
              letter.htmlContent = AntiSpamDisputeEngine.generateUniqueSyntacticStructure(letter.htmlContent, letter.id);
            }

            // Apex — Anti-fabrication + UPL hard gate
            const fab = guardLetterAgainstFabrication({
              letterText: `${letter.letterContent || ''}\n${letter.htmlContent || ''}`,
              item,
              personalInfo,
            });
            if (!fab.ok) {
              const msgs = fab.findings.filter((f) => f.severity === 'block').map((f) => f.message);
              result.errors.push(`Anti-fabrication blocked ${item.creditorName}: ${msgs.join('; ')}`);
              progress(`[FABRICATION] Blocked letter for ${item.creditorName}: ${msgs[0]}`);
              continue;
            }

            // Archive
            await ArchiveService.archiveLetter(letter, profileId);
```

## Patch 26 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (525)
```
    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: creditorName || 'Unknown',
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });
```
### NEW (1102)
```
    // Single outcome learning store — feeds BatchSelector / pass recommendations
    OutcomeLearningStore.record({
      profileId,
      itemId,
      creditorName: creditorName || 'Unknown',
      bureau,
      passNumber,
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'updated'
              : outcome === 'frivolous'
                ? 'frivolous'
                : 'no_response',
    });

    // Apex A/B tracker — closed-loop win rates by bureau/debt type
    AbStrategyTracker.recordOutcome({
      itemId,
      angle: 'cycle_response',
      bureau,
      debtType: 'unknown',
      outcome:
        outcome === 'deleted'
          ? 'deleted'
          : outcome === 'verified'
            ? 'verified'
            : outcome === 'updated'
              ? 'corrected'
              : outcome === 'frivolous'
                ? 'frivolous_rejection'
                : 'no_response',
      pass: passNumber,
      creditorClass: creditorName || 'unknown',
    });
```

## Patch 27 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\autoPilotEngineV2.ts`
### OLD (185)
```
import { planFurnisherDirect } from './furnisherDirectEngine';
import { classifyDebtType } from './debtTypeStrategyLibrary';
import { scanReportForFraud } from './fraudDetectionEngine';
```
### NEW (123)
```
import { planFurnisherDirect } from './furnisherDirectEngine';
import { scanReportForFraud } from './fraudDetectionEngine';
```
