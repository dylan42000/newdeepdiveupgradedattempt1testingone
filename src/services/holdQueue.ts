/**
 * holdQueue.ts — Pass-Aware Hold Queue Manager
 * Manages the hold queue for disputed items awaiting bureau response.
 * Hold periods: Pass 1→60d, Pass 2→60d, Pass 3→45d, Pass 4→30d, Pass 5→14d.
 * Items in hold cannot be re-dispatched until the hold expires.
 *
 * Write-through to IndexedDB for durability.
 * localStorage is retained as a fast synchronous read cache only.
 * Every mutation assigns stable IDs and fully replaces the IDB store.
 */

import { HoldQueueEntry, PassNumber } from '../types/creditRepair';
import { v4 as uuidv4 } from 'uuid';
import { idbReplaceHoldQueue, idbDeleteHoldEntry } from './autopilotMigration';

const STORAGE_KEY = 'dylandos_hold_queue_v1';

export const DEFAULT_HOLD_DAYS: Record<PassNumber, number> = {
  1: 60,
  2: 60,
  3: 45,
  4: 30,
  5: 14,
  6: 15,
};

function withStableId(entry: HoldQueueEntry): HoldQueueEntry {
  return entry.id ? entry : { ...entry, id: uuidv4() };
}

export const HoldQueue = {
  addToHold(params: {
    itemId: string;
    profileId: string;
    passNumber: PassNumber;
    verificationBureau: string;
    responseDate: string;
    holdDaysOverride?: number;
    notes?: string;
  }): HoldQueueEntry {
    const holdDays = params.holdDaysOverride ?? DEFAULT_HOLD_DAYS[params.passNumber];
    const holdStartDate = new Date().toISOString();
    const holdExpiryDate = new Date();
    holdExpiryDate.setDate(holdExpiryDate.getDate() + holdDays);

    const entry: HoldQueueEntry = {
      id: uuidv4(),
      itemId: params.itemId,
      profileId: params.profileId,
      passNumber: params.passNumber,
      holdStartDate,
      holdExpiryDate: holdExpiryDate.toISOString(),
      verificationBureau: params.verificationBureau,
      responseDate: params.responseDate,
      notes: params.notes ?? '',
    };

    const all = this.loadAll();
    const filtered = all.filter(e => !(e.itemId === params.itemId && e.profileId === params.profileId));
    filtered.push(entry);
    this._persist(filtered);
    return entry;
  },

  releaseFromHold(profileId: string, itemId: string): void {
    const all = this.loadAll();
    const toDelete = all.filter(e => e.itemId === itemId && e.profileId === profileId);
    const filtered = all.filter(e => !(e.itemId === itemId && e.profileId === profileId));
    this._persist(filtered);
    for (const entry of toDelete) {
      if (entry.id) idbDeleteHoldEntry(entry.id).catch(() => {});
    }
  },

  isOnHold(profileId: string, itemId: string): boolean {
    const entry = this.getEntry(profileId, itemId);
    if (!entry) return false;
    return new Date() < new Date(entry.holdExpiryDate);
  },

  getEntry(profileId: string, itemId: string): HoldQueueEntry | null {
    const all = this.loadAll();
    return all.find(e => e.itemId === itemId && e.profileId === profileId) ?? null;
  },

  getDaysRemainingOnHold(profileId: string, itemId: string): number {
    const entry = this.getEntry(profileId, itemId);
    if (!entry) return 0;
    const today = new Date();
    const expiry = new Date(entry.holdExpiryDate);
    return Math.max(0, Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  },

  processQueue(
    profileId: string,
    today: Date = new Date()
  ): { nowEligible: HoldQueueEntry[]; stillHeld: HoldQueueEntry[] } {
    const all = this.loadAll().filter(e => e.profileId === profileId);
    const nowEligible: HoldQueueEntry[] = [];
    const stillHeld: HoldQueueEntry[] = [];

    for (const entry of all) {
      if (today >= new Date(entry.holdExpiryDate)) {
        nowEligible.push(entry);
      } else {
        stillHeld.push(entry);
      }
    }

    if (nowEligible.length > 0) {
      const allEntries = this.loadAll();
      const eligibleIds = new Set(nowEligible.map(e => `${e.profileId}_${e.itemId}`));
      const remaining = allEntries.filter(e => !eligibleIds.has(`${e.profileId}_${e.itemId}`));
      this._persist(remaining);
      for (const entry of nowEligible) {
        if (entry.id) idbDeleteHoldEntry(entry.id).catch(() => {});
      }
    }

    return { nowEligible, stillHeld };
  },

  getAll(profileId: string): HoldQueueEntry[] {
    return this.loadAll().filter(e => e.profileId === profileId);
  },

  loadAll(): HoldQueueEntry[] {
    try {
      const raw: HoldQueueEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // Backfill stable IDs for legacy entries (migrate once into LS)
      let changed = false;
      const migrated = raw.map((e) => {
        if (e.id) return e;
        changed = true;
        return withStableId(e);
      });
      if (changed) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        } catch { /* ignore */ }
      }
      return migrated;
    } catch {
      return [];
    }
  },

  _persist(entries: HoldQueueEntry[]): void {
    const withIds = entries.map(withStableId);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withIds));
    } catch (e) {
      console.error('[HoldQueue] Failed to persist:', e);
    }
    // Full replace in IDB so released/expired entries cannot resurrect
    idbReplaceHoldQueue(withIds.map(e => ({ ...e, id: e.id! }))).catch(() => {});
  },

  clearProfile(profileId: string): void {
    const all = this.loadAll().filter(e => e.profileId !== profileId);
    this._persist(all);
  },
};
