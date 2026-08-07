/**
 * Dispute Timing Configuration
 * All date math for the 6-round autopilot engine.
 * Accounts for federal holidays and weekends (FCRA deadlines shift to next business day).
 */

// ─── Core timing constants (days) ─────────────────────────────────────────────

export const DISPUTE_TIMING = {
  /** FCRA §611 mandates bureaus investigate within 30 days.
   *  We track 35 days (30 + 5 buffer) before escalating. */
  BUREAU_RESPONSE_DEADLINE: 35,

  /** Rounds 2–6 wait this many days before auto-trigging next round. */
  ROUND_TRIGGER_DELAY: 35,

  /** If consumer provides additional evidence, bureau gets 15 extra days. */
  EXTENDED_INVESTIGATION_DAYS: 45,

  /** Round 3 (direct furnisher) — 30-day FCRA dispute window + 5 days. */
  FURNISHER_RESPONSE_DEADLINE: 35,

  /** Round 4 CFPB complaint — no statutory deadline, but typically 60 days. */
  CFPB_RESPONSE_TARGET: 60,

  /** Round 5 state AG — target 30 days. */
  AG_RESPONSE_TARGET: 30,

  /** Round 6 CMRRR — if no deletion after sending final demand, 30 days. */
  LEGAL_DEMAND_RESPONSE: 30,

  /** Stagger bureau dispute sends to avoid identical dispute flags.
   *  Day offsets from the campaign start date. */
  BUREAU_STAGGER: {
    Equifax:    0,
    Experian:   5,
    TransUnion: 10,
  } as Record<string, number>,

  /** Minimum days between two rounds to the same bureau. */
  MIN_DAYS_BETWEEN_ROUNDS: 7,

  /** Days before a deadline to send the "upcoming deadline" notification. */
  DEADLINE_ALERT_LEAD: 5,

  /** Grace period after deadline before marking NO_RESPONSE state. */
  DEADLINE_GRACE_PERIOD: 2,
} as const;

// ─── Federal holidays (approximate static list — updated yearly) ──────────────

const FEDERAL_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-01-20', // MLK Jr. Day
  '2025-02-17', // Presidents' Day
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-10-13', // Columbus Day
  '2025-11-11', // Veterans Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas
];

const FEDERAL_HOLIDAYS_2026 = [
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-05-25',
  '2026-06-19',
  '2026-07-04',
  '2026-09-07',
  '2026-10-12',
  '2026-11-11',
  '2026-11-26',
  '2026-12-25',
];

const ALL_HOLIDAYS = new Set([...FEDERAL_HOLIDAYS_2025, ...FEDERAL_HOLIDAYS_2026]);

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isNonBusinessDay(date: Date): boolean {
  return isWeekend(date) || ALL_HOLIDAYS.has(toDateString(date));
}

/**
 * Adds `days` business days to `startDate`.
 * Skips weekends and federal holidays.
 */
export function addBusinessDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (!isNonBusinessDay(result)) {
      added++;
    }
  }
  return result;
}

/**
 * Calculates the deadline date for a dispute round.
 * @param sentDate    The date the dispute/letter was sent
 * @param deadlineDays Number of calendar days (deadline shifts to next business day if it falls on non-business day)
 */
export function calculateDeadlineDate(sentDate: Date, deadlineDays: number): Date {
  const raw = new Date(sentDate);
  raw.setDate(raw.getDate() + deadlineDays);
  // Shift to next business day if deadline lands on weekend/holiday
  while (isNonBusinessDay(raw)) {
    raw.setDate(raw.getDate() + 1);
  }
  return raw;
}

/**
 * How many calendar days remain until the deadline (can be negative if overdue).
 */
export function daysUntilDeadline(deadline: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(deadline);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Is this deadline overdue by more than the grace period?
 */
export function isDeadlineOverdue(deadline: Date): boolean {
  return daysUntilDeadline(deadline) < -DISPUTE_TIMING.DEADLINE_GRACE_PERIOD;
}

/**
 * Should we send a reminder notification for this deadline?
 */
export function isDeadlineApproaching(deadline: Date): boolean {
  const days = daysUntilDeadline(deadline);
  return days >= 0 && days <= DISPUTE_TIMING.DEADLINE_ALERT_LEAD;
}

/**
 * Returns the staggered send date for a given bureau, offset from the campaign start date.
 */
export function getBureauSendDate(bureauName: string, campaignStartDate: Date): Date {
  const offset = DISPUTE_TIMING.BUREAU_STAGGER[bureauName] ?? 0;
  const result = new Date(campaignStartDate);
  result.setDate(result.getDate() + offset);
  // Push to next business day if staggered date falls on non-business day
  while (isNonBusinessDay(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/**
 * The next round trigger date for a bureau, given the last round's sent date.
 */
export function getNextRoundTriggerDate(lastRoundSentDate: Date): Date {
  return calculateDeadlineDate(lastRoundSentDate, DISPUTE_TIMING.ROUND_TRIGGER_DELAY);
}
