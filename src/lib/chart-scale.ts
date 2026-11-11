import type { CurrencyCode } from "@/core/domain";
import { formatMoneyCompact } from "@/lib/format";

/** Maps a value from a domain onto a range. A flat domain maps to the range start. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0 || !Number.isFinite(span)) return () => r0;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

const NICE_STEPS = [1, 2, 5, 10] as const;

/**
 * Axis ticks from 0 up to at least `max`, in steps of 1, 2 or 5 times a power
 * of ten. `count` is the wanted number of gaps, and the result may have one more.
 * A max of zero (or less, or not a number) gives [0, 1] so nothing divides by zero.
 */
export function niceTicks(max: number, count: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const gaps = Math.max(1, Math.floor(count));
  const magnitude = 10 ** Math.floor(Math.log10(max / gaps));
  let step = magnitude * 10;
  for (const factor of NICE_STEPS) {
    const candidate = factor * magnitude;
    if (Math.ceil(max / candidate - 1e-9) <= gaps + 1) {
      step = candidate;
      break;
    }
  }
  const last = Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  for (let i = 0; i <= last; i += 1) {
    // Round to remove floating point noise such as 0.30000000000000004.
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return ticks;
}

export interface Band {
  x: number;
  width: number;
}

/** Evenly spaced bands across `width`, with `gap` between them. */
export function bandLayout(n: number, width: number, gap: number): Band[] {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];
  const safeGap = Math.max(0, gap);
  const bandWidth = Math.max(0, (width - safeGap * (count - 1)) / count);
  return Array.from({ length: count }, (_, i) => ({
    x: i * (bandWidth + safeGap),
    width: bandWidth,
  }));
}

export interface StackInput {
  key: string;
  values: readonly number[];
}

export interface StackSegment {
  start: number;
  end: number;
}

export interface StackLayer {
  key: string;
  segments: StackSegment[];
}

export interface StackResult {
  layers: StackLayer[];
  totals: number[];
}

function cleanValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Stacks series on top of each other, first series at the bottom. Negative,
 * missing and non-finite values count as zero. `totals[i]` is the sum of the
 * series at position i.
 */
export function stack(series: readonly StackInput[]): StackResult {
  const length = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const totals = new Array<number>(length).fill(0);
  const layers = series.map((s) => {
    const segments: StackSegment[] = [];
    for (let i = 0; i < length; i += 1) {
      const start = totals[i] ?? 0;
      const end = start + cleanValue(s.values[i]);
      totals[i] = end;
      segments.push({ start, end });
    }
    return { key: s.key, segments };
  });
  return { layers, totals };
}

const COMPACT_SUFFIXES: ReadonlyArray<{ limit: number; suffix: string }> = [
  { limit: 1e9, suffix: "B" },
  { limit: 1e6, suffix: "M" },
  { limit: 1e3, suffix: "K" },
];

/**
 * Compact axis label: 950, 1.2K, 3M. With `currency`, the value is in minor
 * units and goes through the shared money formatter, such as "£8.2M".
 */
export function formatAxisValue(
  value: number,
  options: { currency?: CurrencyCode } = {},
): string {
  if (options.currency) return formatMoneyCompact(value, options.currency);
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  for (const { limit, suffix } of COMPACT_SUFFIXES) {
    if (abs >= limit) {
      const scaled = Math.round((value / limit) * 10) / 10;
      return `${scaled}${suffix}`;
    }
  }
  return String(Math.round(value * 10) / 10);
}
