/**
 * cycleAuditService.ts — AutoPilot Cycle Audit Trail
 * GAP-H FIX: Persists complete cycle results to IndexedDB so the full history
 * survives page refresh, app restarts, and storage quota events.
 *
 * Every time AutoPilotEngineV2.runCycle() completes, a CycleAuditRecord is
 * written to the cycleAudit IndexedDB store. The AutoPilotDashboard reads from
 * here to render the persistent cycle history panel.
 */

import { v4 as uuidv4 } from 'uuid';
import { idbSet, idbGet, idbGetAll } from './indexedDB';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CycleItemResult {
  itemId: string;
  creditorName: string;
  bureau: string;
  passNumber: number;
  action: 'letter_generated' | 'skipped_hold' | 'skipped_duplicate' | 'escalated' | 'inertia_nudge' | 'inertia_advance' | 'inertia_force_escalate' | 'evidence_blocked' | 'removed';
  reason?: string;
  letterId?: string;
  letterType?: string;
  strategyCardId?: string;
  explainWhy?: string[];
}

export interface CycleValidationSummary {
  totalChecked: number;
  passedValidation: number;
  failedValidation: number;
  failureReasons: string[];
}

export interface CycleAuditRecord {
  /** Unique cycle identifier */
  cycleId: string;
  /** Profile the cycle ran for */
  profileId: string;
  /** ISO timestamp when the cycle was run */
  runAt: string;
  /** Engine version that ran */
  engineVersion: 'v1' | 'v2';
  /** Duration in milliseconds */
  durationMs: number;
  /** Total items evaluated */
  itemsProcessed: number;
  /** Letters generated this cycle */
  lettersGenerated: number;
  /** Items skipped (hold, duplicate, etc.) */
  skippedItems: number;
  /** Items escalated to next pass */
  escalationsTriggered: number;
  /** Inertia escalations triggered (auto-advance items with no logged outcome) */
  inertiaEscalations: number;
  /** Per-item action log */
  itemResults: CycleItemResult[];
  /** Letter quality validation summary */
  validationResults: CycleValidationSummary;
  /** AI provider that handled letter generation */
  aiProviderUsed: string;
  /** Was cycle run due to scheduler or manual trigger? */
  trigger: 'manual' | 'scheduled';
  /** Any warnings surfaced during the cycle */
  warnings: string[];
  /** Any fatal errors */
  errors: string[];
  /** Full raw result blob (for debugging) */
  rawResultSummary?: Record<string, unknown>;
  /** Durable strategy cards for this cycle (explainability export) */
  strategyCards?: import('./itemStrategyPlanner').ItemStrategyCard[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Persist a completed cycle audit record to IndexedDB.
 * Called at the end of every runCycle() execution.
 */
export async function saveCycleAuditRecord(record: Omit<CycleAuditRecord, 'cycleId'> & { cycleId?: string }): Promise<CycleAuditRecord> {
  const full: CycleAuditRecord = {
    ...record,
    cycleId: record.cycleId ?? uuidv4(),
  };
  try {
    await idbSet('cycleAudit', full);
  } catch (e) {
    console.error('[CycleAuditService] Failed to save cycle audit record:', e);
  }
  return full;
}

/**
 * Load all cycle audit records for a profile, sorted newest first.
 */
export async function getCycleHistory(profileId: string): Promise<CycleAuditRecord[]> {
  try {
    const all = await idbGetAll<CycleAuditRecord>('cycleAudit');
    return all
      .filter(r => r.profileId === profileId)
      .sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime());
  } catch (e) {
    console.error('[CycleAuditService] Failed to load cycle history:', e);
    return [];
  }
}

/**
 * Load a single cycle audit record by its ID.
 */
export async function getCycleById(cycleId: string): Promise<CycleAuditRecord | undefined> {
  try {
    return await idbGet<CycleAuditRecord>('cycleAudit', cycleId);
  } catch (e) {
    console.error('[CycleAuditService] Failed to load cycle by ID:', e);
    return undefined;
  }
}

/**
 * Get summary statistics across all cycles for a profile.
 * Used for the dashboard stats panel.
 */
export async function getCycleStats(profileId: string): Promise<{
  totalCycles: number;
  totalLetters: number;
  totalEscalations: number;
  totalInertiaEscalations: number;
  lastCycleAt: string | null;
  averageDurationMs: number;
}> {
  const history = await getCycleHistory(profileId);
  if (history.length === 0) {
    return { totalCycles: 0, totalLetters: 0, totalEscalations: 0, totalInertiaEscalations: 0, lastCycleAt: null, averageDurationMs: 0 };
  }
  return {
    totalCycles: history.length,
    totalLetters: history.reduce((sum, r) => sum + r.lettersGenerated, 0),
    totalEscalations: history.reduce((sum, r) => sum + r.escalationsTriggered, 0),
    totalInertiaEscalations: history.reduce((sum, r) => sum + (r.inertiaEscalations ?? 0), 0),
    lastCycleAt: history[0]?.runAt ?? null,
    averageDurationMs: Math.round(history.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / history.length),
  };
}
