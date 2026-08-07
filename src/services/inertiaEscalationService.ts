/**
 * inertiaEscalationService.ts — GAP-A: 3-Tier Inertia Escalation Engine
 *
 * When a letter was sent but NO bureau response (or outcome) has been logged
 * after N days, the system assumes the bureau is stalling and automatically
 * advances the dispute to the next pass.
 *
 * Three tiers:
 *   Tier 1 — Day 30+: NUDGE   → surface a warning to the user, do NOT advance pass
 *   Tier 2 — Day 45+: ADVANCE → assume bureau "verified" without evidence, go to next pass
 *   Tier 3 — Day 60+: FORCE   → force-escalate regardless of any prior outcome flag
 *
 * This module is a pure service — it reads DisputeHistory events and mutates the
 * passNumbers map, then returns a structured result. The caller (autoPilotEngineV2)
 * is responsible for persisting the updated pass numbers.
 *
 * Exported interfaces are designed for UI consumption (AutoPilotDashboard, DisputeTimeline).
 */

import { NegativeItem } from '../types';
import { PassNumber } from '../types/creditRepair';
import { DisputeHistoryService } from './disputeHistoryService';

// ─── Constants ────────────────────────────────────────────────────────────────

export const INERTIA_NUDGE_DAYS    = 30;
export const INERTIA_ADVANCE_DAYS  = 45;
export const INERTIA_FORCE_DAYS    = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The escalation action taken for a single item.
 *  nudge         — Day 30+, warning only, pass unchanged
 *  advance       — Day 45+, pass bumped (bureau assumed verified, no evidence provided)
 *  force_escalate — Day 60+, pass forced to next tier (no outcome whatsoever)
 *  none          — Item has a recent response, no inertia action taken
 */
export type InertiaAction = 'nudge' | 'advance' | 'force_escalate' | 'none';

/** Per-item inertia evaluation result, exported for UI badges / timeline display. */
export interface InertiaItemResult {
  itemId: string;
  creditorName: string;
  /** Days elapsed since the last letter event (sent or generated) */
  daysSinceLetter: number;
  /** Action determined by the tier thresholds */
  action: InertiaAction;
  /** Pass number before any escalation */
  previousPass: PassNumber;
  /** Pass number after escalation (same as previousPass for nudge/none) */
  newPass: PassNumber;
  /** Human-readable explanation for UI tooltip */
  reason: string;
}

/** Aggregate result returned from `evaluateInertia()`. */
export interface InertiaEvaluationResult {
  /** Timestamp of this evaluation */
  evaluatedAt: string;
  /** Profile the evaluation was run for */
  profileId: string;
  /** Per-item detail */
  items: InertiaItemResult[];
  /** Number of items where pass was advanced (Tier 2 or 3) */
  escalatedCount: number;
  /** Number of items where a nudge warning was raised (Tier 1 only) */
  nudgeCount: number;
  /** Updated pass numbers map — callers MUST persist this */
  updatedPasses: Record<string, PassNumber>;
}

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate inertia status for all items in a profile and apply escalations.
 *
 * @param profileId     Profile to evaluate
 * @param items         Current negative items being tracked
 * @param passNumbers   Current pass number map (itemId → PassNumber)
 * @param onProgress    Optional progress callback (forwarded from engine)
 * @returns             Immutable evaluation result + updated pass numbers
 */
export async function evaluateInertia(
  profileId: string,
  items: NegativeItem[],
  passNumbers: Record<string, PassNumber>,
  onProgress?: (msg: string) => void,
): Promise<InertiaEvaluationResult> {
  const allEvents = await DisputeHistoryService.getByProfile(profileId);
  const updatedPasses: Record<string, PassNumber> = { ...passNumbers };
  const itemResults: InertiaItemResult[] = [];
  let escalatedCount = 0;
  let nudgeCount = 0;

  for (const item of items) {
    const itemId = item.id;

    // Find the most recent letter-sent / letter-generated event
    const letterEvents = allEvents.filter(
      e => e.itemId === itemId &&
        (e.type === 'pass_letter_sent' || e.type === 'pass_letter_generated'),
    );
    if (letterEvents.length === 0) continue; // Item has never had a letter → no inertia

    // Find the most recent bureau_response_received event
    const outcomeEvents = allEvents.filter(
      e => e.itemId === itemId && e.type === 'bureau_response_received',
    );

    const lastLetterEvent = letterEvents.reduce((a, b) =>
      new Date(a.timestamp) > new Date(b.timestamp) ? a : b
    );
    const lastOutcomeEvent = outcomeEvents.length > 0
      ? outcomeEvents.reduce((a, b) =>
          new Date(a.timestamp) > new Date(b.timestamp) ? a : b
        )
      : null;

    // If the most recent outcome is AFTER the most recent letter → no inertia
    if (
      lastOutcomeEvent &&
      new Date(lastOutcomeEvent.timestamp) > new Date(lastLetterEvent.timestamp)
    ) {
      continue;
    }

    const daysSinceLetter = Math.floor(
      (Date.now() - new Date(lastLetterEvent.timestamp).getTime()) / 86_400_000,
    );

    const currentPass: PassNumber = updatedPasses[itemId] ?? 1;
    let action: InertiaAction = 'none';
    let newPass = currentPass;
    let reason = '';

    if (daysSinceLetter >= INERTIA_FORCE_DAYS) {
      // ── Tier 3: Force-escalate — 60+ days with zero outcome ──────────────
      newPass = Math.min(6, currentPass + 1) as PassNumber;
      if (newPass !== currentPass) {
        action = 'force_escalate';
        escalatedCount++;
        reason =
          `No outcome logged for ${daysSinceLetter} days — force-escalating ` +
          `from Pass ${currentPass} to Pass ${newPass} per 60-day inertia rule.`;
        onProgress?.(
          `[INERTIA-FORCE] ${item.creditorName} (${itemId}) → Pass ${newPass}` +
          ` (${daysSinceLetter}d since last letter, no response)`
        );
      } else {
        action = 'none'; // already at Pass 5
        reason = `Already at Pass 5 — no further escalation possible.`;
      }
    } else if (daysSinceLetter >= INERTIA_ADVANCE_DAYS) {
      // ── Tier 2: Advance — 45+ days, assume bureau "verified" without evidence ──
      newPass = Math.min(6, currentPass + 1) as PassNumber;
      if (newPass !== currentPass) {
        action = 'advance';
        escalatedCount++;
        reason =
          `${daysSinceLetter} days since letter — treating as unsubstantiated ` +
          `"verified" response and advancing to Pass ${newPass}.`;
        onProgress?.(
          `[INERTIA-ADVANCE] ${item.creditorName} (${itemId}) → Pass ${newPass}` +
          ` (${daysSinceLetter}d, assumed verified per 45-day rule)`
        );
      } else {
        action = 'none'; // already at Pass 5
        reason = `Already at Pass 5 — no further escalation possible.`;
      }
    } else if (daysSinceLetter >= INERTIA_NUDGE_DAYS) {
      // ── Tier 1: Nudge — 30+ days, surface warning, do NOT advance pass ──
      action = 'nudge';
      nudgeCount++;
      reason =
        `${daysSinceLetter} days since letter — no outcome logged. ` +
        `Check your mailbox and log the bureau response to unlock the next pass.`;
      onProgress?.(
        `[INERTIA-NUDGE] ${item.creditorName}: ${daysSinceLetter}d since last letter, ` +
        `no outcome logged. Log bureau response to continue.`
      );
    }

    if (action !== 'none') {
      if (action !== 'nudge') {
        updatedPasses[itemId] = newPass;
      }
      itemResults.push({
        itemId,
        creditorName: item.creditorName,
        daysSinceLetter,
        action,
        previousPass: currentPass,
        newPass: action === 'nudge' ? currentPass : newPass,
        reason,
      });
    }
  }

  if (escalatedCount > 0) {
    onProgress?.(
      `[INERTIA] ${escalatedCount} item(s) auto-advanced due to stalled outcomes`
    );
  }

  return {
    evaluatedAt: new Date().toISOString(),
    profileId,
    items: itemResults,
    escalatedCount,
    nudgeCount,
    updatedPasses,
  };
}

/**
 * Lightweight read-only check — returns items that currently have inertia issues
 * without mutating any pass numbers. Safe to call from UI components at any time.
 */
export async function getInertiaStatus(
  profileId: string,
  items: NegativeItem[],
  passNumbers: Record<string, PassNumber>,
): Promise<InertiaItemResult[]> {
  const result = await evaluateInertia(profileId, items, passNumbers);
  return result.items;
}
