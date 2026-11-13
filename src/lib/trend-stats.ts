import { toUtcDay } from "./weeks";

/**
 * Small statistics for trend pages (docs/spec-phase2.md sections 8.4 and 8.5).
 */

/** The earliest founded year that counts as known. */
export const MIN_FOUNDED_YEAR = 1900;

const COUNT_FORMAT = new Intl.NumberFormat("en-GB");

/**
 * The median of whole numbers such as pence or years, or null for an empty
 * list. For an even count, the mean of the middle two, rounded down so the
 * result stays a whole number.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1] as number;
  return Math.floor((lower + upper) / 2);
}

/**
 * Target age in years: the year of `announcedOn` less `foundedYear`. Null
 * when the founded year is unknown, before 1900 or after the announcement.
 */
export function targetAge(
  foundedYear: number | null,
  announcedOn: string,
): number | null {
  if (foundedYear === null || !Number.isInteger(foundedYear)) return null;
  const year = toUtcDay(announcedOn).getUTCFullYear();
  if (foundedYear < MIN_FOUNDED_YEAR || foundedYear > year) return null;
  return year - foundedYear;
}

/** A coverage label such as "4 of 19". */
export function coverage(known: number, total: number): string {
  return `${COUNT_FORMAT.format(known)} of ${COUNT_FORMAT.format(total)}`;
}
