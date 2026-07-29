/**
 * timelineTracker.ts — FCRA Deadline Tracker
 * Tracks all 30-day (bureau) and 45-day (furnisher) FCRA response deadlines.
 * Flags overdue items for immediate escalation.
 *
 * BUG-08 FIX: Write-through to IndexedDB for durable storage.
 * localStorage retained as synchronous read cache.
 * All mutations also persist to IDB via autopilotMigration helpers.
 */

import { FCRADeadline, PassNumber } from '../types/creditRepair';
import { v4 as uuidv4 } from 'uuid';
import { idbSaveFCRADeadlines, idbUpdateFCRADeadline } from './autopilotMigration';

const STORAGE_KEY = 'dylandos_fcra_timeline_v1';

// FCRA response deadline days by target
const FCRA_DAYS: Record<'bureau' | 'furnisher', number> = {
  bureau: 30,
  furnisher: 45,
};

// Grace period for mail transit (days)
const MAIL_GRACE_DAYS = 5;

const PASS_FCRA_SECTIONS: Record<PassNumber, string> = {
  1: '§611(a)',
  2: '§611(a)(7)',
  3: '§611(a)(1)',
  4: '§616',
  5: '§616 + §617',
  6: '§616 + §617 + §623',
};

export const TimelineTracker = {
  // ─── Add Deadline ───────────────────────────────────────────────────────

  addDeadline(params: {
    profileId: string;
    itemId: string;
    itemName: string;
    bureau: string;
    passNumber: PassNumber;
    letterSentDate: string;
    targetType?: 'bureau' | 'furnisher';
    sourceEventId?: string;
    deliveryProof?: string;
  }): FCRADeadline {
    const targetType = params.targetType ?? 'bureau';
    const fcraBaseDays = FCRA_DAYS[targetType];
    const totalDays = fcraBaseDays + MAIL_GRACE_DAYS;

    const sentDate = new Date(params.letterSentDate);
    const deadlineDate = new Date(sentDate);
    deadlineDate.setDate(deadlineDate.getDate() + totalDays);

    const deadline: FCRADeadline = {
      id: uuidv4(),
      profileId: params.profileId,
      itemId: params.itemId,
      itemName: params.itemName,
      bureau: params.bureau,
      passNumber: params.passNumber,
      letterSentDate: params.letterSentDate,
      deadlineDate: deadlineDate.toISOString(),
      status: 'active',
      fcraSection: PASS_FCRA_SECTIONS[params.passNumber],
      overdueByDays: 0,
      sourceEventId: params.sourceEventId,
      targetType,
      deliveryProof: params.deliveryProof,
      calculationRule: `${targetType}:${fcraBaseDays}+${MAIL_GRACE_DAYS} calendar days`,
    };

    const all = this.loadAll();
    const duplicate = all.find(d =>
      d.profileId === params.profileId &&
      d.itemId === params.itemId &&
      d.bureau === params.bureau &&
      d.passNumber === params.passNumber &&
      d.letterSentDate === params.letterSentDate
    );
    if (duplicate) return duplicate;
    all.push(deadline);
    this._persist(all);
    // BUG-08 FIX: Write to IndexedDB for durability
    idbUpdateFCRADeadline(deadline).catch(() => {});
    return deadline;
  },

  // ─── Resolve Deadline ───────────────────────────────────────────────────

  resolveDeadline(deadlineId: string): void {
    const all = this.loadAll();
    const idx = all.findIndex(d => d.id === deadlineId);
    if (idx !== -1) {
      all[idx].status = 'resolved';
      this._persist(all);
      idbUpdateFCRADeadline(all[idx]).catch(() => {});
    }
  },

  resolveByItem(profileId: string, itemId: string, bureau: string): void {
    const all = this.loadAll();
    const updated = all.map(d => {
      if (d.profileId === profileId && d.itemId === itemId && d.bureau === bureau && d.status === 'active') {
        return { ...d, status: 'resolved' as const };
      }
      return d;
    });
    this._persist(updated);
    for (const d of updated) {
      if (d.profileId === profileId && d.itemId === itemId && d.bureau === bureau) {
        idbUpdateFCRADeadline(d).catch(() => {});
      }
    }
  },

  // ─── Check & Flag Overdue ───────────────────────────────────────────────

  refreshOverdueStatus(): FCRADeadline[] {
    const all = this.loadAll();
    const today = new Date();
    let changed = false;

    const updated = all.map(d => {
      if (d.status !== 'active') return d;
      const deadline = new Date(d.deadlineDate);
      if (today > deadline) {
        const overdueByDays = Math.floor((today.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
        changed = true;
        return { ...d, status: 'overdue' as const, overdueByDays };
      }
      return d;
    });

    if (changed) {
      this._persist(updated);
      for (const d of updated.filter(x => x.status === 'overdue')) {
        idbUpdateFCRADeadline(d).catch(() => {});
      }
    }
    return updated.filter(d => d.status === 'overdue');
  },

  // ─── Get Deadlines ──────────────────────────────────────────────────────

  getByProfile(profileId: string): FCRADeadline[] {
    return this.loadAll().filter(d => d.profileId === profileId);
  },

  getOverdue(profileId: string): FCRADeadline[] {
    this.refreshOverdueStatus();
    return this.loadAll().filter(d => d.profileId === profileId && d.status === 'overdue');
  },

  getUpcoming(profileId: string, withinDays = 7): FCRADeadline[] {
    const all = this.loadAll().filter(d => d.profileId === profileId && d.status === 'active');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    return all.filter(d => new Date(d.deadlineDate) <= cutoff);
  },

  getDaysRemaining(deadline: FCRADeadline): number {
    const today = new Date();
    const due = new Date(deadline.deadlineDate);
    return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  },

  // ─── Persistence ────────────────────────────────────────────────────────

  loadAll(): FCRADeadline[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  _persist(deadlines: FCRADeadline[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deadlines));
      // BUG-08 FIX: Also write all to IndexedDB as a batch backup
      idbSaveFCRADeadlines(deadlines).catch(() => {});
    } catch (e) {
      console.error('[TimelineTracker] Failed to persist:', e);
    }
  },

  clearProfile(profileId: string): void {
    const all = this.loadAll().filter(d => d.profileId !== profileId);
    this._persist(all);
  },
};
