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

const COMPACT_SCALES: ReadonlyArray<{ divisor: bigint; suffix: string }> = [
  { divisor: BigInt("100000000000"), suffix: "B" },
  { divisor: BigInt("100000000"), suffix: "M" },
  { divisor: BigInt("100000"), suffix: "K" },
];

const NEXT_SCALE: Readonly<Record<string, string>> = {
  K: "M",
  M: "B",
};

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function formatTenths(tenths: bigint): string {
  const whole = tenths / BigInt(10);
  const fraction = tenths % BigInt(10);
  if (fraction === BigInt(0)) return whole.toString();
  return `${whole.toString()}.${fraction.toString()}`;
}

function formatSmallMajor(minor: bigint): string {
  const whole = minor / BigInt(100);
  const fraction = minor % BigInt(100);
  if (fraction === BigInt(0)) return whole.toString();
  if (fraction % BigInt(10) === BigInt(0)) {
    return `${whole.toString()}.${(fraction / BigInt(10)).toString()}`;
  }
  return `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function compactMinor(amountMinor: bigint): string {
  for (const scale of COMPACT_SCALES) {
    if (amountMinor < scale.divisor) continue;
    let tenths = divHalfUp(amountMinor * BigInt(10), scale.divisor);
    let suffix = scale.suffix;
    const promoted = NEXT_SCALE[suffix];
    if (promoted && tenths >= BigInt(10_000)) {
      tenths = divHalfUp(tenths, BigInt(1_000));
      suffix = promoted;
    }
    return `${formatTenths(tenths)}${suffix}`;
  }
  return formatSmallMajor(amountMinor);
}

/**
 * Compact en-GB money, such as "£8.2M", "US$10M" or "€950K".
 * `amountMinor` is an integer in 2-decimal minor units.
 */
export function formatMoneyCompact(
  amountMinor: number,
  currency: CurrencyCode,
): string {
  if (!Number.isFinite(amountMinor)) {
    throw new Error("amountMinor must be a finite number");
  }
  const code = currency.trim().toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const negative = amountMinor < 0;
  const rounded = BigInt(Math.round(Math.abs(amountMinor)));
  return `${negative ? "-" : ""}${symbol}${compactMinor(rounded)}`;
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
