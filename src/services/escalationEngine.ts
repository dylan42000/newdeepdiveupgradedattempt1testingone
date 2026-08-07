/**
 * escalationEngine.ts — BUG-09 No-Response Escalation Engine
 *
 * Standalone service that drives the FCRA no-response escalation loop.
 * Called on AutoPilot dashboard mount and at the start of every cycle
 * (in addition to the inline check inside autoPilotEngineV2.runCycle).
 *
 * Two responsibility modes:
 *  1. AUDIT  — checkEscalations(profileId): returns what would be escalated (read-only)
 *  2. COMMIT — applyEscalations(profileId): writes pass number bumps + FCRA status updates
 *
 * The inline engine calls applyEscalations via runCycle. The dashboard calls
 * checkEscalations for UI indicators without mutating state.
 */

import { PassNumber, FCRADeadline } from '../types/creditRepair';
import { TimelineTracker } from './timelineTracker';
import { idbUpdateFCRADeadline } from './autopilotMigration';

// ─── Constants ────────────────────────────────────────────────────────────────

/** FCRA §611 response window for credit bureaus (calendar days). */
export const FCRA_BUREAU_DAYS = 30;

/** FCRA §611(a)(2) furnisher investigation window (calendar days). */
export const FCRA_FURNISHER_DAYS = 45;

/**
 * Days past deadline before we treat a non-response as Tier-1 escalation.
 * Adds 5 grace days for mail processing (same as TimelineTracker.MAIL_GRACE_DAYS).
 */
export const ESCALATION_GRACE_DAYS = 5;

/**
 * Days past deadline for Tier-2 double-escalation (egregious non-response).
 * After TIER2_THRESHOLD days, pass number jumps two tiers instead of one.
 */
export const TIER2_THRESHOLD_DAYS = 36;

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface EscalationCandidate {
  /** The FCRA deadline record driving this escalation. */
  deadline: FCRADeadline;
  /** Current pass number before escalation. */
  currentPass: PassNumber;
  /** Pass number after escalation (1–5 max). */
  newPass: PassNumber;
  /** Escalation tier (1 = +1 pass, 2 = +2 passes). */
  tier: 1 | 2;
  /** Calendar days past the FCRA deadline. */
  daysPast: number;
  /** Human-readable reason for escalation. */
  reason: string;
}

export interface EscalationAuditResult {
  profileId: string;
  auditedAt: string;
  candidates: EscalationCandidate[];
  overdueCount: number;
  tier2Count: number;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

function daysPastDeadline(deadline: FCRADeadline): number {
  const deadlineMs = new Date(deadline.deadlineDate).getTime();
  return Math.floor((Date.now() - deadlineMs) / 86_400_000);
}

function clampPass(n: number): PassNumber {
  return Math.min(6, Math.max(1, Math.round(n))) as PassNumber;
}

function buildReason(tier: 1 | 2, daysPast: number, deadline: FCRADeadline): string {
  const bureau = deadline.bureau;
  const section = deadline.fcraSection;
  if (tier === 2) {
    return (
      `${bureau} failed to respond within ${FCRA_BUREAU_DAYS + ESCALATION_GRACE_DAYS}d ` +
      `(${daysPast}d past deadline) — ${section} Tier-2 double-escalation`
    );
  }
  return (
    `${bureau} failed to respond within ${FCRA_BUREAU_DAYS}d ` +
    `(${daysPast}d past deadline) — ${section} failure-to-investigate escalation`
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * AUDIT mode: compute escalation candidates without mutating any state.
 * Safe to call from UI components at any time.
 */
export function checkEscalations(
  profileId: string,
  currentPasses: Record<string, PassNumber>,
): EscalationAuditResult {
  // TimelineTracker.getOverdue() refreshes status from localStorage cache
  const overdue = TimelineTracker.getOverdue(profileId);

  const candidates: EscalationCandidate[] = [];

  for (const deadline of overdue) {
    const daysPast = daysPastDeadline(deadline);
    if (daysPast <= 0) continue; // clock skew guard

    const currentPass = currentPasses[deadline.itemId] ?? 1;
    const tier = daysPast >= TIER2_THRESHOLD_DAYS ? 2 : 1;
    const newPass = clampPass(currentPass + tier);

    if (newPass === currentPass) continue; // already at max pass

    candidates.push({
      deadline,
      currentPass,
      newPass,
      tier,
      daysPast,
      reason: buildReason(tier, daysPast, deadline),
    });
  }

  return {
    profileId,
    auditedAt: new Date().toISOString(),
    candidates,
    overdueCount: overdue.length,
    tier2Count: candidates.filter(c => c.tier === 2).length,
  };
}

/**
 * COMMIT mode: write escalated pass numbers back to the passes map and mark
 * the FCRA deadline records as overdue in IndexedDB.
 *
 * Returns the mutated passes map so the caller can persist it.
 * Called from `autoPilotEngineV2.runCycle()` on every cycle start.
 */
export async function applyEscalations(
  profileId: string,
  currentPasses: Record<string, PassNumber>,
  onProgress?: (msg: string) => void,
): Promise<{ passes: Record<string, PassNumber>; escalatedCount: number }> {
  const audit = checkEscalations(profileId, currentPasses);

  if (audit.candidates.length === 0) {
    return { passes: currentPasses, escalatedCount: 0 };
  }

  const updatedPasses = { ...currentPasses };
  let escalatedCount = 0;

  for (const candidate of audit.candidates) {
    updatedPasses[candidate.deadline.itemId] = candidate.newPass;
    escalatedCount++;

    onProgress?.(
      `[ESCALATION] ${candidate.deadline.itemId}: Pass ${candidate.currentPass}→${candidate.newPass}` +
      ` (${candidate.daysPast}d overdue, ${candidate.tier === 2 ? 'Tier-2 double' : 'Tier-1'} escalation)`
    );

    // Mark the FCRA deadline record as overdue in IndexedDB
    const updated: FCRADeadline = {
      ...candidate.deadline,
      status: 'overdue',
      overdueByDays: candidate.daysPast,
    };
    await idbUpdateFCRADeadline(updated).catch(() => {});
    TimelineTracker.resolveDeadline(candidate.deadline.id); // mark active tracking resolved
  }

  return { passes: updatedPasses, escalatedCount };
}

/**
 * Convenience wrapper: returns true if ANY overdue items exist for this profile.
 * Used for dashboard badge / notification indicator.
 */
export function hasOverdueItems(profileId: string): boolean {
  return TimelineTracker.getOverdue(profileId).length > 0;
}
