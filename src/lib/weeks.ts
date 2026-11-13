/**
 * ISO weeks for trend maths (docs/spec-phase2.md section 8).
 * A week starts on Monday, UTC, and is named by that Monday as `YYYY-MM-DD`.
 * Everything here is UTC; local time zones never apply.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `Date` at midnight UTC for a `YYYY-MM-DD` string, or for the UTC day of
 * a `Date` or ISO timestamp. Throws a `RangeError` for anything invalid.
 */
export function toUtcDay(date: Date | string): Date {
  if (typeof date === "string") {
    const match = DATE_ONLY.exec(date);
    if (match) {
      const [, y, m, d] = match;
      const day = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      if (day.toISOString().slice(0, 10) !== date) {
        throw new RangeError(`Invalid date: ${date}`);
      }
      return day;
    }
  }
  const parsed = typeof date === "string" ? new Date(date) : date;
  const ms = parsed.getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid date: ${String(date)}`);
  }
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS);
}

/** `YYYY-MM-DD` for the UTC day of a date. */
export function toIsoDate(date: Date | string): string {
  return toUtcDay(date).toISOString().slice(0, 10);
}

/** The Monday (UTC) of the week containing `date`, as `YYYY-MM-DD`. */
export function weekStart(date: Date | string): string {
  const day = toUtcDay(date);
  // getUTCDay: Sunday is 0, Monday is 1. Days since Monday: 0 to 6.
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The week start `weeks` weeks after the week containing `week` (negative goes back). */
export function addWeeks(week: Date | string, weeks: number): string {
  if (!Number.isInteger(weeks)) {
    throw new RangeError(`Weeks must be a whole number: ${weeks}`);
  }
  const start = toUtcDay(weekStart(week));
  return new Date(start.getTime() + weeks * WEEK_MS).toISOString().slice(0, 10);
}

/** Whole weeks from the week of `from` to the week of `to` (negative when `to` is earlier). */
export function weeksBetween(from: Date | string, to: Date | string): number {
  const a = toUtcDay(weekStart(from)).getTime();
  const b = toUtcDay(weekStart(to)).getTime();
  return Math.round((b - a) / WEEK_MS);
}

/**
 * The start of the last complete week before `now`. The current week is
 * never complete, even at 00:00 on a Monday, so it is never used.
 */
export function lastCompleteWeek(now: Date): string {
  return addWeeks(weekStart(now), -1);
}

/**
 * Every week start from the week of `from` to the week of `to`, inclusive,
 * oldest first. Empty when `to` is before `from`.
 */
export function weekRange(from: Date | string, to: Date | string): string[] {
  const count = weeksBetween(from, to) + 1;
  const first = weekStart(from);
  const weeks: string[] = [];
  for (let i = 0; i < count; i++) weeks.push(addWeeks(first, i));
  return weeks;
}
