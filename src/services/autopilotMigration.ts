/**
 * autopilotMigration.ts — One-Time localStorage → IndexedDB Migration
 * BUG-08 FIX: AutoPilot state (pass numbers, hold queue, FCRA timeline) was
 * persisted to localStorage. This runs once on app init to migrate all data
 * to IndexedDB (version 4 stores), ensuring state survives storage quota pressure
 * and is consistent with all other app data.
 *
 * Migration is idempotent — re-running after the first pass is a no-op.
 */

import { openDB, idbSet, idbGetAll } from './indexedDB';
import type { PassNumber, HoldQueueEntry, FCRADeadline } from '../types/creditRepair';
import { v4 as uuidv4 } from 'uuid';

// localStorage keys used by legacy code
const LEGACY_KEYS = {
  holdQueue:   'dylandos_hold_queue_v1',
  timeline:    'dylandos_fcra_timeline_v1',
  passPrefix:  'dylandos_item_passes_v2',    // + `_${profileId}`
  engineState: 'dylandos_autopilot_v2_state',
};

// Migration completion sentinel — stored in IndexedDB to prevent re-runs
const MIGRATION_SENTINEL_KEY = 'autopilot_migration_v4_complete';

// ─── Main migration entry point ─────────────────────────────────────────────

/**
 * Call once on app startup, BEFORE any AutoPilot services initialize.
 * Safe to call multiple times — subsequent calls are instant no-ops.
 */
export async function runAutopilotMigration(profileIds: string[]): Promise<void> {
  try {
    await openDB(); // ensure DB v4 is open + stores exist

    // Check if already migrated
    const db = await import('./indexedDB');
    const sentinel = await db.idbGet<{ key: string; done: boolean }>('autopilotState', MIGRATION_SENTINEL_KEY);
    if (sentinel?.done) return; // Already done — fast exit

    let migratedAnything = false;

    // ── Migrate hold queue ────────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(LEGACY_KEYS.holdQueue);
      if (raw) {
        const entries: HoldQueueEntry[] = JSON.parse(raw);
        // Assign IDs if missing (legacy entries may not have them)
        for (const entry of entries) {
          const keyed = { ...(entry as HoldQueueEntry & { id?: string }), id: (entry as HoldQueueEntry & { id?: string }).id ?? uuidv4() };
          await db.idbSet('holdQueue', keyed);
        }
        console.log(`[AutoPilotMigration] Migrated ${entries.length} hold queue entries to IndexedDB`);
        migratedAnything = true;
      }
    } catch (e) {
      console.warn('[AutoPilotMigration] Hold queue migration failed (non-fatal):', e);
    }

    // ── Migrate FCRA timeline ─────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(LEGACY_KEYS.timeline);
      if (raw) {
        const deadlines: FCRADeadline[] = JSON.parse(raw);
        for (const deadline of deadlines) {
          await db.idbSet('fcraTimeline', deadline);
        }
        console.log(`[AutoPilotMigration] Migrated ${deadlines.length} FCRA timeline entries to IndexedDB`);
        migratedAnything = true;
      }
    } catch (e) {
      console.warn('[AutoPilotMigration] FCRA timeline migration failed (non-fatal):', e);
    }

    // ── Migrate pass numbers (per profile) ────────────────────────────────
    for (const profileId of profileIds) {
      try {
        const key = `${LEGACY_KEYS.passPrefix}_${profileId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const passes: Record<string, PassNumber> = JSON.parse(raw);
          if (Object.keys(passes).length > 0) {
            await db.idbSet('autopilotState', { key: `passes_${profileId}`, passes });
            console.log(`[AutoPilotMigration] Migrated ${Object.keys(passes).length} pass numbers for profile ${profileId}`);
            migratedAnything = true;
          }
        }
      } catch (e) {
        console.warn(`[AutoPilotMigration] Pass number migration failed for ${profileId} (non-fatal):`, e);
      }
    }

    // ── Migrate engine state ──────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(LEGACY_KEYS.engineState);
      if (raw) {
        const state = JSON.parse(raw);
        await db.idbSet('autopilotState', { key: 'engineState', ...state });
        console.log('[AutoPilotMigration] Migrated AutoPilot engine state to IndexedDB');
        migratedAnything = true;
      }
    } catch (e) {
      console.warn('[AutoPilotMigration] Engine state migration failed (non-fatal):', e);
    }

    // ── Mark migration complete ───────────────────────────────────────────
    await db.idbSet('autopilotState', { key: MIGRATION_SENTINEL_KEY, done: true, migratedAt: new Date().toISOString() });

    if (migratedAnything) {
      console.log('[AutoPilotMigration] ✅ BUG-08 migration complete — AutoPilot state now in IndexedDB v4');
    }

  } catch (e) {
    // Migration failure must NEVER crash the app — AutoPilot will fall back to localStorage
    console.error('[AutoPilotMigration] Migration failed (non-fatal, using localStorage fallback):', e);
  }
}

// ─── IDB pass number accessors (used by autoPilotEngineV2 after migration) ──

export async function idbSavePassNumbers(
  profileId: string,
  passes: Record<string, PassNumber>
): Promise<void> {
  try {
    const db = await import('./indexedDB');
    await db.idbSet('autopilotState', { key: `passes_${profileId}`, passes });
  } catch (e) {
    console.error('[AutoPilotMigration] idbSavePassNumbers failed:', e);
  }
}

export async function idbLoadPassNumbers(
  profileId: string
): Promise<Record<string, PassNumber>> {
  try {
    const db = await import('./indexedDB');
    const record = await db.idbGet<{ key: string; passes: Record<string, PassNumber> }>(
      'autopilotState', `passes_${profileId}`
    );
    return record?.passes ?? {};
  } catch {
    return {};
  }
}

export async function idbSaveHoldQueue(entries: (HoldQueueEntry & { id: string })[]): Promise<void> {
  try {
    const db = await import('./indexedDB');
    for (const entry of entries) {
      await db.idbSet('holdQueue', entry);
    }
  } catch (e) {
    console.error('[AutoPilotMigration] idbSaveHoldQueue failed:', e);
  }
}

/** Clear holdQueue store then write the provided entries (prevents zombie resurrection). */
export async function idbReplaceHoldQueue(entries: (HoldQueueEntry & { id: string })[]): Promise<void> {
  try {
    const db = await import('./indexedDB');
    await db.idbClear('holdQueue');
    if (entries.length > 0) {
      await db.idbBulkAdd('holdQueue', entries);
    }
  } catch (e) {
    console.error('[AutoPilotMigration] idbReplaceHoldQueue failed:', e);
  }
}

export async function idbLoadHoldQueue(profileId: string): Promise<HoldQueueEntry[]> {
  try {
    const db = await import('./indexedDB');
    const all = await db.idbGetAll<HoldQueueEntry & { id: string }>('holdQueue');
    return all.filter(e => e.profileId === profileId);
  } catch {
    return [];
  }
}

export async function idbDeleteHoldEntry(entryId: string): Promise<void> {
  try {
    const db = await import('./indexedDB');
    await db.idbDelete('holdQueue', entryId);
  } catch (e) {
    console.error('[AutoPilotMigration] idbDeleteHoldEntry failed:', e);
  }
}

export async function idbSaveFCRADeadlines(deadlines: FCRADeadline[]): Promise<void> {
  try {
    const db = await import('./indexedDB');
    for (const d of deadlines) {
      await db.idbSet('fcraTimeline', d);
    }
  } catch (e) {
    console.error('[AutoPilotMigration] idbSaveFCRADeadlines failed:', e);
  }
}

export async function idbLoadFCRADeadlines(profileId: string): Promise<FCRADeadline[]> {
  try {
    const db = await import('./indexedDB');
    const all = await db.idbGetAll<FCRADeadline>('fcraTimeline');
    return all.filter(d => d.profileId === profileId);
  } catch {
    return [];
  }
}

export async function idbUpdateFCRADeadline(deadline: FCRADeadline): Promise<void> {
  try {
    const db = await import('./indexedDB');
    await db.idbSet('fcraTimeline', deadline);
  } catch (e) {
    console.error('[AutoPilotMigration] idbUpdateFCRADeadline failed:', e);
  }
}

// ─── IDB → localStorage restore (reverse of migration: IDB is authoritative) ─────────────────

/**
 * BUG-08 / BUG-09 FIX: After a browser refresh, localStorage may be empty but
 * IndexedDB always survives (it is never cleared by the browser under normal conditions).
 * This function reads the authoritative state from IndexedDB and re-populates the
 * synchronous localStorage caches that the engine, TimelineTracker, and HoldQueue use.
 *
 * Call this on app startup AFTER `runAutopilotMigration()` completes.
 * Safe to call multiple times — it is purely additive (only writes to localStorage
 * when the IDB value is non-empty and the localStorage slot is currently empty).
 */
export async function restoreFromIDB(profileIds: string[]): Promise<void> {
  try {
    const db = await import('./indexedDB');

    // ── 1. Restore engine state ────────────────────────────────────────────
    const PASS_STORAGE_KEY = 'dylandos_item_passes_v2';
    const STATE_STORAGE_KEY = 'dylandos_autopilot_v2_state';
    const HOLD_STORAGE_KEY  = 'dylandos_hold_queue_v1';
    const TIMELINE_KEY       = 'dylandos_fcra_timeline_v1';

    const engineStateRec = await db.idbGet<{ key: string; [k: string]: unknown }>(
      'autopilotState', 'engineState'
    );
    if (engineStateRec && !localStorage.getItem(STATE_STORAGE_KEY)) {
      const { key: _k, ...state } = engineStateRec;
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
      console.log('[AutoPilotRestore] Restored engine state from IndexedDB');
    }

    // ── 2. Restore pass numbers per profile ────────────────────────────────
    for (const profileId of profileIds) {
      const passKey = `${PASS_STORAGE_KEY}_${profileId}`;
      if (!localStorage.getItem(passKey)) {
        const rec = await db.idbGet<{ key: string; passes: Record<string, PassNumber> }>(
          'autopilotState', `passes_${profileId}`
        );
        if (rec?.passes && Object.keys(rec.passes).length > 0) {
          localStorage.setItem(passKey, JSON.stringify(rec.passes));
          console.log(
            `[AutoPilotRestore] Restored ${Object.keys(rec.passes).length} pass numbers` +
            ` for profile ${profileId} from IndexedDB`
          );
        }
      }
    }

    // ── 3. Restore FCRA timeline ───────────────────────────────────────────
    if (!localStorage.getItem(TIMELINE_KEY)) {
      const all = await db.idbGetAll<FCRADeadline>('fcraTimeline');
      // Filter to only profiles we care about; exclude the migration sentinel
      const relevant = all.filter(
        d => d.id && d.profileId && profileIds.includes(d.profileId)
      );
      if (relevant.length > 0) {
        localStorage.setItem(TIMELINE_KEY, JSON.stringify(relevant));
        console.log(`[AutoPilotRestore] Restored ${relevant.length} FCRA deadlines from IndexedDB`);
      }
    }

    // ── 4. Restore hold queue ──────────────────────────────────────────────
    if (!localStorage.getItem(HOLD_STORAGE_KEY)) {
      const all = await db.idbGetAll<HoldQueueEntry & { id: string }>('holdQueue');
      const relevant = all.filter(e => e.profileId && profileIds.includes(e.profileId));
      if (relevant.length > 0) {
        localStorage.setItem(HOLD_STORAGE_KEY, JSON.stringify(relevant));
        console.log(`[AutoPilotRestore] Restored ${relevant.length} hold queue entries from IndexedDB`);
      }
    }

    console.log('[AutoPilotRestore] ✅ BUG-08/09 state restore complete — caches warm from IDB');

  } catch (e) {
    // Non-fatal: engine will start fresh from IDB next cycle
    console.warn('[AutoPilotRestore] Restore from IDB failed (non-fatal):', e);
  }
}

// ─── IDB write-through for engine state (called by autoPilotEngineV2._persistState) ───────────

/**
 * BUG-08 FIX: Write-through for the engine's top-level state (cycle dates, scheduler flag).
 * Mirrors `_persistState()` → localStorage by also writing the same payload to IDB
 * so it survives localStorage eviction.
 */
export async function idbSaveEngineState(state: {
  lastCycleDate: string | null;
  lastCycleResult: unknown;
  nextCycleDate: string | null;
  schedulerActive: boolean;
  totalCyclesRun: number;
}): Promise<void> {
  try {
    const db = await import('./indexedDB');
    await db.idbSet('autopilotState', { key: 'engineState', ...state });
  } catch (e) {
    console.error('[AutoPilotMigration] idbSaveEngineState failed:', e);
  }
}
