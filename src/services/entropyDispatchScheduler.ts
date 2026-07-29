/**
 * entropyDispatchScheduler.ts — Anti-Automation Entropy Scheduler
 * GAP-J FIX: Stagger letter dispatch dates to avoid triggering bureau
 * anti-automation systems that flag batches of identical-day submissions.
 *
 * Rules:
 *   - Max 2 letters per bureau per calendar day
 *   - After hitting the daily limit: add a 2-day gap before next slot
 *   - Random 0–1 day jitter per letter (except Pass 5 escalations)
 *   - Pass 5 CFPB/AG letters are never delayed — they dispatch on baseDate
 *   - Output is a per-item dispatch schedule, NOT actual mail sending
 */

import { NegativeItem } from '../types';
import { PassNumber } from '../types/creditRepair';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DispatchScheduleItem {
  /** NegativeItem ID */
  itemId: string;
  /** Creditor name for display */
  creditorName: string;
  /** Target bureau or furnisher name */
  bureau: string;
  /** Target type: bureau or furnisher */
  targetType: 'bureau' | 'furnisher';
  /** Pass number for this letter */
  passNumber: PassNumber;
  /** Scheduled send date (YYYY-MM-DD) */
  scheduledDate: string;
  /** Days from baseDate */
  daysFromBase: number;
  /** Rationale for this scheduling decision */
  rationale: string;
}

export interface EntropyDispatchSchedule {
  /** Base date the schedule was built from */
  baseDate: string;
  /** Total letters scheduled */
  totalItems: number;
  /** Per-item schedule */
  items: DispatchScheduleItem[];
  /** Maximum scheduled date in this batch */
  lastDispatchDate: string;
  /** Summary of staggering applied */
  summary: string;
}

interface PlanInput {
  item: NegativeItem;
  passNumber: PassNumber;
  bureau: string;
  targetType: 'bureau' | 'furnisher';
}

// ─── Deterministic but randomized jitter (seeded by itemId for reproducibility) ──

function stableJitter(itemId: string, bureau: string): 0 | 1 {
  // Deterministic 0 or 1 based on item+bureau hash — avoids true random so
  // re-running the scheduler for the same batch produces the same schedule.
  let hash = 0;
  const seed = `${itemId}${bureau}`;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2) === 0 ? 0 : 1;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

// ─── Core scheduler ───────────────────────────────────────────────────────────

/**
 * Build a staggered dispatch schedule for a batch of letters.
 *
 * @param items - Array of items with their planned pass numbers and targets
 * @param baseDate - The date from which scheduling starts (usually today)
 * @returns EntropyDispatchSchedule with per-letter scheduled dates
 */
export function buildEntropyDispatchSchedule(
  items: PlanInput[],
  baseDate: Date = new Date()
): EntropyDispatchSchedule {
  if (items.length === 0) {
    return {
      baseDate: toDateString(baseDate),
      totalItems: 0,
      items: [],
      lastDispatchDate: toDateString(baseDate),
      summary: 'No items to schedule.',
    };
  }

  // Track dispatch count per bureau per date: Map<bureau, Map<dateStr, count>>
  const bureauDayCount = new Map<string, Map<string, number>>();
  const MAX_PER_BUREAU_PER_DAY = 2;
  const GAP_AFTER_LIMIT_DAYS = 2;

  const schedule: DispatchScheduleItem[] = [];

  for (const planItem of items) {
    const { item, passNumber, bureau, targetType } = planItem;

    // Pass 5 CFPB/regulatory letters → never delayed, always baseDate
    if (passNumber === 5) {
      const dateStr = toDateString(baseDate);
      schedule.push({
        itemId: item.id,
        creditorName: item.creditorName,
        bureau,
        targetType,
        passNumber,
        scheduledDate: dateStr,
        daysFromBase: 0,
        rationale: `Pass 5 regulatory escalation — dispatched immediately on ${dateStr} (no delay applied).`,
      });
      continue;
    }

    // For all other passes: find the earliest date within limits
    const bureauMap = bureauDayCount.get(bureau) ?? new Map<string, number>();

    // Determine starting slot (baseDate + small jitter)
    const jitter = stableJitter(item.id, bureau);
    let candidateDate = addDays(baseDate, jitter);

    // Advance until we find a day with capacity for this bureau
    let attempts = 0;
    while (attempts < 30) { // hard cap to prevent infinite loop
      const dateStr = toDateString(candidateDate);
      const currentCount = bureauMap.get(dateStr) ?? 0;

      if (currentCount < MAX_PER_BUREAU_PER_DAY) {
        // Slot available
        bureauMap.set(dateStr, currentCount + 1);
        bureauDayCount.set(bureau, bureauMap);

        const daysFromBase = Math.round(
          (candidateDate.getTime() - baseDate.getTime()) / 86_400_000
        );

        let rationale = '';
        if (daysFromBase === 0) {
          rationale = `Scheduled for today (${dateStr}). No staggering needed — bureau slot available.`;
        } else if (jitter > 0 && daysFromBase === jitter) {
          rationale = `Staggered by ${jitter}d (entropy jitter) to ${dateStr}.`;
        } else {
          rationale = `Staggered to ${dateStr} (+${daysFromBase}d) — ${bureau} daily limit hit on earlier dates.`;
        }

        schedule.push({
          itemId: item.id,
          creditorName: item.creditorName,
          bureau,
          targetType,
          passNumber,
          scheduledDate: dateStr,
          daysFromBase,
          rationale,
        });
        break;
      } else {
        // Hit limit — jump forward by gap
        candidateDate = addDays(candidateDate, GAP_AFTER_LIMIT_DAYS);
        attempts++;
      }
    }

    if (attempts >= 30) {
      // Fallback: schedule at +30d to not block the pipeline
      const fallbackDate = addDays(baseDate, 30);
      const dateStr = toDateString(fallbackDate);
      schedule.push({
        itemId: item.id,
        creditorName: item.creditorName,
        bureau,
        targetType,
        passNumber,
        scheduledDate: dateStr,
        daysFromBase: 30,
        rationale: `Fallback schedule: could not find bureau slot within 30 attempts. Assigned ${dateStr}.`,
      });
    }
  }

  // Sort by scheduled date
  schedule.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

  const lastDate = schedule[schedule.length - 1]?.scheduledDate ?? toDateString(baseDate);
  const totalSpreadDays = Math.round(
    (new Date(lastDate).getTime() - baseDate.getTime()) / 86_400_000
  );

  const pass5Count = schedule.filter(s => s.passNumber === 5).length;
  const staggeredCount = schedule.filter(s => s.daysFromBase > 0).length;

  const summary =
    `Scheduled ${schedule.length} letter(s) over ${totalSpreadDays + 1} day(s). ` +
    `${pass5Count} Pass-5 regulatory letter(s) dispatched immediately. ` +
    `${staggeredCount} letter(s) staggered to prevent anti-automation flags. ` +
    `Max 2 per bureau/day rule enforced.`;

  return {
    baseDate: toDateString(baseDate),
    totalItems: schedule.length,
    items: schedule,
    lastDispatchDate: lastDate,
    summary,
  };
}

/**
 * Get the scheduled date for a specific item+bureau combination.
 * Returns baseDate as fallback if item is not found in the schedule.
 */
export function getScheduledDateForItem(
  schedule: EntropyDispatchSchedule,
  itemId: string,
  bureau: string
): string {
  return schedule.items.find(s => s.itemId === itemId && s.bureau === bureau)?.scheduledDate
    ?? schedule.baseDate;
}

// ─── FULL PRODUCTION ENTROPY SCHEDULER (v5.1.0) ───────────────────────────

export interface EntropyScheduleEntry {
  itemId: string;
  targetBureau: string;
  targetType: 'bureau' | 'furnisher';
  passNumber: PassNumber;
  scheduledSendDate: Date;
  scheduledSendTime: string;   // HH:MM — randomized business hours
  rationale: string;
  entropyGroup: number;        // Which stagger group (1, 2, 3...)
}

export interface EntropyScheduleConfig {
  baseDate: Date;
  maxPerBureauPerDay: number;          // Default: 2
  minDaysBetweenSameBureau: number;    // Default: 2
  businessHoursOnly: boolean;          // Default: true (9am-4:30pm)
  jitterRangeDays: number;             // Default: 3 (random 0-3 day offset)
  weekdaysOnly: boolean;               // Default: true
}

const DEFAULT_ENTROPY_CONFIG: EntropyScheduleConfig = {
  baseDate: new Date(),
  maxPerBureauPerDay: 2,
  minDaysBetweenSameBureau: 2,
  businessHoursOnly: true,
  jitterRangeDays: 3,
  weekdaysOnly: true,
};

export interface FullDispatchTarget {
  itemId: string;
  bureau?: string;
  name: string;
  type: 'bureau' | 'furnisher';
  passNumber: PassNumber;
}

/**
 * Full production entropy scheduler with weekday detection, business hours,
 * configurable jitter, and per-bureau daily limits. Returns entries sorted
 * chronologically with randomized send times.
 */
export function buildEntropySchedule(
  targets: FullDispatchTarget[],
  config: EntropyScheduleConfig = DEFAULT_ENTROPY_CONFIG
): EntropyScheduleEntry[] {
  const schedule: EntropyScheduleEntry[] = [];
  // bureau → dateKey → count
  const bureauDayTracker = new Map<string, Map<string, number>>();

  // Bureau letters before furnisher letters (establishes paper trail first)
  const sorted = [...targets].sort((a, b) => {
    if (a.type === 'bureau' && b.type === 'furnisher') return -1;
    if (a.type === 'furnisher' && b.type === 'bureau') return 1;
    return 0;
  });

  let currentDayOffset = 0;

  for (const target of sorted) {
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < 30) {
      attempts++;

      const jitter = Math.floor(Math.random() * (config.jitterRangeDays + 1));
      let candidateDate = _addDaysEnt(config.baseDate, currentDayOffset + jitter);

      if (config.weekdaysOnly && _isWeekendEnt(candidateDate)) {
        // Skip to next Monday
        while (_isWeekendEnt(candidateDate)) {
          candidateDate = _addDaysEnt(candidateDate, 1);
        }
      }

      const dateKey = _formatDateKeyEnt(candidateDate);
      const bureauKey = target.bureau ?? target.name;

      if (!bureauDayTracker.has(bureauKey)) {
        bureauDayTracker.set(bureauKey, new Map());
      }
      const bureauDays = bureauDayTracker.get(bureauKey)!;
      const countOnDay = bureauDays.get(dateKey) ?? 0;

      if (countOnDay >= config.maxPerBureauPerDay) {
        currentDayOffset++;
        continue;
      }

      const lastSend = _getLastSendDayEnt(bureauDays, dateKey);
      if (lastSend && _daysBetweenEnt(lastSend, candidateDate) < config.minDaysBetweenSameBureau) {
        currentDayOffset++;
        continue;
      }

      const sendTime = config.businessHoursOnly
        ? _generateBusinessHourTime()
        : '09:00';

      schedule.push({
        itemId: target.itemId,
        targetBureau: bureauKey,
        targetType: target.type,
        passNumber: target.passNumber,
        scheduledSendDate: candidateDate,
        scheduledSendTime: sendTime,
        rationale: `Entropy group ${Math.floor(currentDayOffset / 2) + 1} — ${bureauKey} slot ${countOnDay + 1}/${config.maxPerBureauPerDay}`,
        entropyGroup: Math.floor(currentDayOffset / 2) + 1,
      });

      bureauDays.set(dateKey, countOnDay + 1);
      placed = true;
    }
  }

  return schedule.sort((a, b) =>
    a.scheduledSendDate.getTime() - b.scheduledSendDate.getTime()
  );
}

// ─── Private helpers (prefixed to avoid collision with existing helpers) ─────

function _generateBusinessHourTime(): string {
  const hour = 9 + Math.floor(Math.random() * 7);  // 9-15
  const minute = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function _isWeekendEnt(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function _addDaysEnt(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function _formatDateKeyEnt(date: Date): string {
  return date.toISOString().split('T')[0];
}

function _getLastSendDayEnt(
  bureauDays: Map<string, number>,
  currentDateKey: string
): Date | null {
  const dates = [...bureauDays.keys()].sort();
  const before = dates.filter(d => d < currentDateKey);
  if (before.length === 0) return null;
  return new Date(before[before.length - 1]);
}

function _daysBetweenEnt(a: Date, b: Date): number {
  return Math.abs(Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}
