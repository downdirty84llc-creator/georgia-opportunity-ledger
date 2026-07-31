/**
 * Deadline lifecycle: expiry, closing-soon, and reverification.
 *
 * The same thresholds are compiled into the database (migration 0017) so that
 * a row written directly by a job carries the right flags. The daily job
 * re-evaluates every published record because the passage of time alone flips
 * these — nothing writes to a row on the day its deadline passes.
 */

export const CLOSING_SOON_DAYS = 14;
export const REVERIFICATION_DAYS = 30;

/** Deadline reminders are offered at these intervals (spec 16). */
export const DEADLINE_REMINDER_DAYS = [14, 7, 2, 0] as const;

export type OpportunityStatus =
  | 'open'
  | 'upcoming'
  | 'closing_soon'
  | 'under_review'
  | 'updated'
  | 'closed'
  | 'expired'
  | 'withdrawn'
  | 'information_only';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysUntil(date: Date, now: Date = new Date()): number {
  return (date.getTime() - now.getTime()) / MS_PER_DAY;
}

export function isExpired(
  closingDate: Date | null,
  now: Date = new Date(),
): boolean {
  if (!closingDate) return false;
  return closingDate.getTime() < now.getTime();
}

export function isClosingSoon(
  closingDate: Date | null,
  now: Date = new Date(),
  status: OpportunityStatus = 'open',
): boolean {
  if (!closingDate) return false;
  // An information-only record carries no deadline semantics even when it has
  // a date attached (a program's next review date, say).
  if (status === 'information_only') return false;
  if (isExpired(closingDate, now)) return false;
  return daysUntil(closingDate, now) <= CLOSING_SOON_DAYS;
}

export interface LifecycleFlags {
  isExpired: boolean;
  isClosingSoon: boolean;
  status: OpportunityStatus;
}

/**
 * Recomputes the derived flags and, where it is unambiguous, the status.
 *
 * Statuses an administrator set deliberately — withdrawn, under review,
 * information only, upcoming — are never overwritten: only the machine-derived
 * transitions between open, closing soon and expired are automated.
 */
export function evaluateLifecycle(
  input: {
    closingDate: Date | null;
    openingDate?: Date | null;
    status: OpportunityStatus;
  },
  now: Date = new Date(),
): LifecycleFlags {
  const { closingDate, openingDate, status } = input;

  const expired = isExpired(closingDate, now);
  const closingSoon = isClosingSoon(closingDate, now, status);

  const administratorControlled: OpportunityStatus[] = [
    'withdrawn',
    'under_review',
    'information_only',
    'closed',
  ];

  if (administratorControlled.includes(status)) {
    return { isExpired: expired, isClosingSoon: false, status };
  }

  let nextStatus: OpportunityStatus = status;
  if (expired) {
    nextStatus = 'expired';
  } else if (openingDate && openingDate.getTime() > now.getTime()) {
    nextStatus = 'upcoming';
  } else if (closingSoon) {
    nextStatus = 'closing_soon';
  } else if (
    status === 'expired' ||
    status === 'closing_soon' ||
    status === 'upcoming'
  ) {
    // The deadline moved outward again — a reopened or extended record.
    nextStatus = 'open';
  }

  return { isExpired: expired, isClosingSoon: closingSoon, status: nextStatus };
}

export function reverificationDueAt(dateVerified: Date): Date {
  return new Date(dateVerified.getTime() + REVERIFICATION_DAYS * MS_PER_DAY);
}

export function needsReverification(
  dateVerified: Date,
  now: Date = new Date(),
): boolean {
  return reverificationDueAt(dateVerified).getTime() <= now.getTime();
}

/**
 * Which reminder interval a deadline falls into right now, or null when no
 * reminder is due. Used by the daily deadline job together with the
 * notification dedupe key so a member gets each interval at most once.
 */
export function dueReminderInterval(
  closingDate: Date,
  now: Date = new Date(),
): (typeof DEADLINE_REMINDER_DAYS)[number] | null {
  const remaining = daysUntil(closingDate, now);
  if (remaining < 0) return null;

  // Pick the tightest interval the deadline has entered, so a member who
  // subscribes late still gets one useful reminder rather than none. The
  // 0-day interval means "closes today": anything under a day out.
  for (const interval of [...DEADLINE_REMINDER_DAYS].sort((a, b) => a - b)) {
    if (interval === 0 ? remaining < 1 : remaining <= interval) return interval;
  }
  return null;
}

/**
 * Stable key for a deadline reminder. Includes the deadline itself so that a
 * rescheduled deadline reconciles cleanly: the new date produces a new key and
 * the member is reminded again, while an unchanged date never re-fires
 * (spec 16, "Do not send duplicate reminders...").
 */
export function reminderDedupeKey(
  opportunityId: string,
  closingDate: Date,
  interval: number,
): string {
  return `deadline:${opportunityId}:${closingDate.toISOString().slice(0, 10)}:${interval}`;
}
