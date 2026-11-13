import type { RoundType } from "@/core/enums";
import { addWeeks, weekStart, weeksBetween } from "./weeks";

/**
 * Rising score and early momentum (docs/spec-phase2.md sections 8.1 and 8.2, D36).
 *
 * With the last complete week as week 0, the recent window R is weeks −7 to 0
 * and the baseline B is up to 26 weeks just before R. For a theme:
 *
 *   e = b × N_R / N_B         expected recent rounds from the baseline share
 *   s = ln((r + α) / (e + α)) with α = 3
 *
 * r and b are the theme's rounds in R and B; N_R and N_B are all rounds in R
 * and B. Comparing shares, not raw counts, stops growth in overall coverage
 * from making every theme look like it is rising.
 *
 * Why α = 3: it acts as three imaginary rounds added to both sides. Small
 * counts are pulled towards 0, so one round cannot top the chart, while large
 * counts barely move. s = 0 means "as expected", above 0 rising, below 0 falling.
 *
 * Counts, not money: round sizes are heavy-tailed. Grants never count (D44).
 */

/** Weeks in the recent window R. */
export const RECENT_WEEKS = 8;
/** Most weeks in the baseline window B. */
export const BASELINE_WEEKS = 26;
/** Fewest collected baseline weeks before a score is shown. */
export const MIN_BASELINE_WEEKS = 8;
/** Pseudo-count added to both sides of the ratio. */
export const SHRINKAGE_ALPHA = 3;
/** Fewest recent rounds for a theme to be listed. */
export const MIN_RECENT_ROUNDS = 3;
/** Fewest companies with a known round type before late share is shown. */
export const MIN_LATE_SHARE_COMPANIES = 5;
/** Highest late share for the early-momentum list. */
export const MAX_EARLY_LATE_SHARE = 0.25;

/** Round types that count as early rounds. */
export const EARLY_ROUND_TYPES: readonly RoundType[] = ["pre_seed", "seed"];
/** Round types that count as Series A or later. */
export const LATE_ROUND_TYPES: readonly RoundType[] = [
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "growth",
];

/** Inclusive range of week starts (`YYYY-MM-DD` Mondays). */
export interface WeekWindow {
  from: string;
  to: string;
  weeks: number;
}

export interface TrendWindows {
  recent: WeekWindow;
  baseline: WeekWindow;
}

/**
 * The recent and baseline windows for a last complete week, or null when the
 * baseline would hold fewer than 8 weeks of collected history. The baseline
 * never starts before the week of `firstCollectedWeek`.
 */
export function windows(
  lastCompleteWeek: string,
  firstCollectedWeek: string,
): TrendWindows | null {
  const recentTo = weekStart(lastCompleteWeek);
  const recentFrom = addWeeks(recentTo, -(RECENT_WEEKS - 1));
  const baselineTo = addWeeks(recentFrom, -1);
  const earliest = addWeeks(baselineTo, -(BASELINE_WEEKS - 1));
  const firstWeek = weekStart(firstCollectedWeek);
  const baselineFrom = firstWeek > earliest ? firstWeek : earliest;
  const baselineWeeks = weeksBetween(baselineFrom, baselineTo) + 1;
  if (baselineWeeks < MIN_BASELINE_WEEKS) return null;
  return {
    recent: { from: recentFrom, to: recentTo, weeks: RECENT_WEEKS },
    baseline: { from: baselineFrom, to: baselineTo, weeks: baselineWeeks },
  };
}

export interface RisingScoreInput {
  /** r: the theme's rounds in the recent window. */
  recent: number;
  /** b: the theme's rounds in the baseline window. */
  baseline: number;
  /** N_R: all rounds in the recent window. */
  totalRecent: number;
  /** N_B: all rounds in the baseline window. */
  totalBaseline: number;
}

export interface RisingScoreResult {
  /** e = b × N_R / N_B. 0 when N_B is 0. */
  expected: number;
  /** ln((r + 3) / (e + 3)). Null when N_B is 0. */
  score: number | null;
}

function assertCount(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number: ${value}`);
  }
}

/** The rising score for one theme (section 8.1). */
export function risingScore(input: RisingScoreInput): RisingScoreResult {
  const { recent, baseline, totalRecent, totalBaseline } = input;
  assertCount("recent", recent);
  assertCount("baseline", baseline);
  assertCount("totalRecent", totalRecent);
  assertCount("totalBaseline", totalBaseline);
  if (totalBaseline === 0) return { expected: 0, score: null };
  const expected = (baseline * totalRecent) / totalBaseline;
  const score = Math.log(
    (recent + SHRINKAGE_ALPHA) / (expected + SHRINKAGE_ALPHA),
  );
  return { expected, score };
}

/** The fields `rankRising` and `rankEarlyMomentum` need from a row. */
export interface RankableTheme {
  slug: string;
  /** Recent rounds (r, or r_early for early momentum). */
  recent: number;
  score: number | null;
}

function compareRanked(a: RankableTheme, b: RankableTheme): number {
  // A null score (not enough history) sorts after every real score.
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  if (a.recent !== b.recent) return b.recent - a.recent;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * The rising list: themes with at least 3 recent rounds, by score descending,
 * then recent rounds descending, then slug. Rows without a score come last.
 * Returns a new array.
 */
export function rankRising<T extends RankableTheme>(rows: readonly T[]): T[] {
  return rows
    .filter((row) => row.recent >= MIN_RECENT_ROUNDS)
    .sort(compareRanked);
}

/**
 * Late share L (section 8.2). Each entry is one company's round types over
 * all recorded history. Of the companies with at least one equity round of
 * known type, the share with any Series A or later round. `unknown`, `debt`
 * and `grant` do not count as known. Null below 5 such companies.
 */
export function lateShare(
  companies: ReadonlyArray<readonly RoundType[]>,
): number | null {
  let known = 0;
  let late = 0;
  for (const roundTypes of companies) {
    const hasLate = roundTypes.some((type) => LATE_ROUND_TYPES.includes(type));
    const hasKnown =
      hasLate || roundTypes.some((type) => EARLY_ROUND_TYPES.includes(type));
    if (!hasKnown) continue;
    known++;
    if (hasLate) late++;
  }
  if (known < MIN_LATE_SHARE_COMPANIES) return null;
  return late / known;
}

export interface EarlyMomentumCandidate {
  /** r_early: early rounds in the recent window. */
  recent: number;
  /** s_early: the rising score on early rounds only. */
  score: number | null;
  lateShare: number | null;
}

/**
 * Whether a theme belongs on the early-momentum list: r_early ≥ 3,
 * s_early > 0 and L ≤ 0.25. A null score or late share is not listed.
 */
export function isEarlyMomentum(row: EarlyMomentumCandidate): boolean {
  return (
    row.recent >= MIN_RECENT_ROUNDS &&
    row.score !== null &&
    row.score > 0 &&
    row.lateShare !== null &&
    row.lateShare <= MAX_EARLY_LATE_SHARE
  );
}

/**
 * The early-momentum list: rows that pass `isEarlyMomentum`, by s_early
 * descending, then recent early rounds descending, then slug.
 */
export function rankEarlyMomentum<
  T extends EarlyMomentumCandidate & RankableTheme,
>(rows: readonly T[]): T[] {
  return rows.filter(isEarlyMomentum).sort(compareRanked);
}

/** "about 2.0× its usual share", from exp(s) to one decimal. */
export function describeScore(score: number | null): string {
  if (score === null || !Number.isFinite(score)) {
    return "not enough history yet";
  }
  return `about ${Math.exp(score).toFixed(1)}× its usual share`;
}
