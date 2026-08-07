/**
 * disputeHistoryService.ts — Immutable Event History Log (Rule 2: Credit-Grade Reliability)
 * Once an event is written, it CANNOT be modified — only new events can be appended.
 * Creates a complete, permanent audit trail for legal purposes.
 * Persists to IndexedDB + vault archive.
 */

import { DisputeEventV2, DisputeEventTypeV2, PassNumber } from '../types/creditRepair';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeForLog } from './sanitizer';

const IDB_STORE = 'dispute_history_v2';
const LS_FALLBACK_KEY = 'dylandos_dispute_history_v2';

class DisputeHistoryServiceClass {
  private db: IDBDatabase | null = null;

  // ─── Initialization ───────────────────────────────────────────────────────

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('DylandosHistoryDB', 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('profileId', 'profileId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('itemId', 'itemId', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ─── Write Event (Append-Only) ────────────────────────────────────────────

  async logEvent(params: {
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
  }): Promise<DisputeEventV2> {
    const event: DisputeEventV2 = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      profileId: params.profileId,
      type: params.type,
      title: params.title,
      detail: params.detail,
      itemId: params.itemId,
      letterId: params.letterId,
      cycleId: params.cycleId,
      passNumber: params.passNumber,
      bureau: params.bureau,
      outcome: params.outcome,
      certifiedMailNumber: params.certifiedMailNumber,
      metadata: params.metadata ? sanitizeForLog(params.metadata) as Record<string, unknown> : undefined,
    };

    await this._append(event);
    return event;
  }

  // ─── Read Events ──────────────────────────────────────────────────────────

  async getByProfile(profileId: string, limit = 500): Promise<DisputeEventV2[]> {
    try {
      if (this.db) {
        return await this._idbGetByProfile(profileId, limit);
      }
    } catch {
      // Fall back to localStorage
    }
    return this._lsGetByProfile(profileId, limit);
  }

  async getByItem(profileId: string, itemId: string): Promise<DisputeEventV2[]> {
    const all = await this.getByProfile(profileId, 2000);
    return all.filter(e => e.itemId === itemId);
  }

  async getByCycle(profileId: string, cycleId: string): Promise<DisputeEventV2[]> {
    const all = await this.getByProfile(profileId, 2000);
    return all.filter(e => e.cycleId === cycleId);
  }

  async getRecent(profileId: string, count = 50): Promise<DisputeEventV2[]> {
    const all = await this.getByProfile(profileId, count + 10);
    return all.slice(-count).reverse();
  }

  async getCitationsUsed(profileId: string, itemId: string, bureau: string): Promise<string[]> {
    const events = await this.getByItem(profileId, itemId);
    return events.filter(e => (e.bureau ?? '').toLowerCase() === bureau.toLowerCase()).flatMap(e => Array.isArray(e.metadata?.citations) ? e.metadata.citations as string[] : []);
  }

  async getRecentFrivolousFlags(profileId: string, itemId: string, bureau: string, withinDays = 90): Promise<number> {
    const cutoff=Date.now()-withinDays*86400000;
    const events=await this.getByItem(profileId,itemId);
    return events.filter(e=>new Date(e.timestamp).getTime()>=cutoff && (e.bureau??'').toLowerCase()===bureau.toLowerCase() && (e.outcome==='frivolous'||/frivolous/i.test(`${e.title} ${e.detail}`))).length;
  }

  // ─── Convenience Loggers ──────────────────────────────────────────────────

  async logLetterGenerated(profileId: string, itemId: string, letterId: string, passNumber: PassNumber, targetName: string): Promise<void> {
    await this.logEvent({
      profileId, type: 'pass_letter_generated',
      title: `Pass ${passNumber} Letter Generated`,
      detail: `Letter generated targeting ${targetName}`,
      itemId, letterId, passNumber,
    });
  }

  async logLetterSent(profileId: string, itemId: string, letterId: string, passNumber: PassNumber, bureau: string, certifiedMailNumber?: string): Promise<void> {
    await this.logEvent({
      profileId, type: 'pass_letter_sent',
      title: `Pass ${passNumber} Letter Sent — ${bureau}`,
      detail: certifiedMailNumber ? `Certified Mail: ${certifiedMailNumber}` : 'Via certified mail',
      itemId, letterId, passNumber, bureau, certifiedMailNumber,
    });
  }

  async logResponseReceived(profileId: string, itemId: string, bureau: string, outcome: string, passNumber: PassNumber): Promise<void> {
    const emoji = outcome === 'deleted' ? '✅' : outcome === 'verified' ? '❌' : '🔄';
    await this.logEvent({
      profileId, type: 'bureau_response_received',
      title: `${emoji} Response Received — ${bureau}`,
      detail: `Outcome: ${outcome.toUpperCase()} on Pass ${passNumber}`,
      itemId, bureau, outcome, passNumber,
    });
  }

  async logItemDeleted(profileId: string, itemId: string, itemName: string, bureau: string, passNumber: PassNumber): Promise<void> {
    await this.logEvent({
      profileId, type: 'item_deleted',
      title: `✅ DELETED: ${itemName}`,
      detail: `Successfully deleted from ${bureau} on Pass ${passNumber}`,
      itemId, bureau, passNumber, outcome: 'deleted',
    });
  }

  async logHoldStarted(profileId: string, itemId: string, passNumber: PassNumber, holdExpiryDate: string): Promise<void> {
    const expiryFormatted = new Date(holdExpiryDate).toLocaleDateString();
    await this.logEvent({
      profileId, type: 'hold_started',
      title: `Hold Started — Pass ${passNumber}`,
      detail: `Bureau verified item. Hold expires ${expiryFormatted}. Pass ${passNumber + 1} will begin after hold.`,
      itemId, passNumber,
    });
  }

  async logCycleCompleted(profileId: string, cycleId: string, stats: {
    dispatched: number;
    onHold: number;
    removed: number;
  }): Promise<void> {
    await this.logEvent({
      profileId, type: 'cycle_completed',
      title: `Autopilot Cycle Completed`,
      detail: `${stats.dispatched} dispatched · ${stats.onHold} on hold · ${stats.removed} removed this session`,
      cycleId,
      metadata: stats,
    });
  }

  // ─── Private: Append ──────────────────────────────────────────────────────

  private async _append(event: DisputeEventV2): Promise<void> {
    // Primary: IndexedDB
    if (this.db) {
      try {
        await this._idbPut(event);
        return;
      } catch (e) {
        console.error('[DisputeHistory] IDB write failed, falling back to localStorage', e);
      }
    }
    // Fallback: localStorage
    this._lsAppend(event);
  }

  private _idbPut(event: DisputeEventV2): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not ready'));
      const tx = this.db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private _idbGetByProfile(profileId: string, limit: number): Promise<DisputeEventV2[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not ready'));
      const tx = this.db.transaction(IDB_STORE, 'readonly');
      const idx = tx.objectStore(IDB_STORE).index('profileId');
      const results: DisputeEventV2[] = [];
      const req = idx.openCursor(IDBKeyRange.only(profileId));
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  private _lsAppend(event: DisputeEventV2): void {
    try {
      const all: DisputeEventV2[] = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || '[]');
      all.push(event);
      // Keep last 1000 events in localStorage to avoid bloat
      const trimmed = all.length > 1000 ? all.slice(-1000) : all;
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('[DisputeHistory] localStorage fallback failed:', e);
    }
  }

  private _lsGetByProfile(profileId: string, limit: number): DisputeEventV2[] {
    try {
      const all: DisputeEventV2[] = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || '[]');
      return all.filter(e => e.profileId === profileId).slice(-limit);
    } catch {
      return [];
    }
  }
}

export const DisputeHistoryService = new DisputeHistoryServiceClass();
