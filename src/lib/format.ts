import type { CurrencyCode } from "@/core/domain";
import type { RoundType } from "@/core/enums";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  EUR: "€",
  GBP: "£",
  USD: "US$",
};

/**
 * Money in the Raisory house style (docs/design/brand/brand.md): "£850k",
 * "£4.2m", "£12.0m", "£2.3bn", "£950". Lower-case unit with no space; millions
 * and billions always carry one decimal, thousands none.
 * `amountMinor` is an integer in 2-decimal minor units.
 */
export function formatMoneyShort(
  amountMinor: number,
  currency: CurrencyCode,
): string {
  if (!Number.isFinite(amountMinor)) {
    throw new Error("amountMinor must be a finite number");
  }
  const code = currency.trim().toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const sign = amountMinor < 0 ? "-" : "";
  const major = Math.abs(amountMinor) / 100;
  const tenthsOf = (unit: number) => Math.round(major / (unit / 10));
  let body: string;
  if (tenthsOf(1e9) >= 10) {
    body = `${(tenthsOf(1e9) / 10).toFixed(1)}bn`;
  } else if (tenthsOf(1e6) >= 10) {
    const tenths = tenthsOf(1e6);
    body = tenths >= 10_000 ? "1.0bn" : `${(tenths / 10).toFixed(1)}m`;
  } else if (Math.round(major) >= 1_000) {
    const thousands = Math.round(major / 1e3);
    body = thousands >= 1_000 ? "1.0m" : `${thousands}k`;
  } else {
    body = `${Math.round(major)}`;
  }
  return `${sign}${symbol}${body}`;
}

/** Calendar date as "8 Oct 2026". The date portion is read in UTC. */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) throw new Error(`Invalid date: ${isoDate}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = MONTHS[month - 1];
  if (!monthLabel || day < 1 || day > 31) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  return `${day} ${monthLabel} ${year}`;
}

/**
 * Company age from a founded year, as "under 1 year", "1 year" or "5 years".
 * Only the year is known, so this is the calendar-year difference: an
 * approximation that is never more than a year out. Returns null when the
 * founded year is unknown or later than the given date.
 */
export function formatCompanyAge(
  foundedYear: number | null,
  onIsoDate: string,
): string | null {
  if (foundedYear === null) return null;
  const match = /^(\d{4})/.exec(onIsoDate.trim());
  if (!match) return null;
  const years = Number(match[1]) - foundedYear;
  if (years < 0) return null;
  if (years === 0) return "under 1 year";
  return years === 1 ? "1 year" : `${years} years`;
}

/** "series_a" becomes "Series A", and "pre_seed" becomes "Pre-seed". */
export function formatRoundType(roundType: RoundType): string {
  switch (roundType) {
    case "pre_seed":
      return "Pre-seed";
    case "seed":
      return "Seed";
    case "series_a":
      return "Series A";
    case "series_b":
      return "Series B";
    case "series_c":
      return "Series C";
    case "series_d_plus":
      return "Series D+";
    case "growth":
      return "Growth";
    case "debt":
      return "Debt";
    case "grant":
      return "Grant";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustive: never = roundType;
      return exhaustive;
    }
  }
}
