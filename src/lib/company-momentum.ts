import type { DatePrecision, RoundType } from "@/core/enums";
import type { RoundMomentum } from "@/core/read-models";
import { toIsoDate, toUtcDay } from "./weeks";

/**
 * Company momentum (docs/spec-phase2.md section 8.3, D43).
 *
 * Worked out per company from its own equity rounds: funding rounds whose
 * type is not `debt` or `grant`, ordered by `announcedOn`, then event id.
 * Round number 1 means the first round SignalFeed has recorded, not the
 * company's first ever.
 */

/** How far back a step-up basis round may be. */
export const STEP_UP_MAX_MONTHS = 36;
/** The window for "rounds in the last 24 months". */
export const RECENT_ROUNDS_MONTHS = 24;

const NON_EQUITY: readonly RoundType[] = ["debt", "grant"];

export interface MomentumRoundInput {
  eventId: number;
  /** YYYY-MM-DD. Month precision dates use any day; the day is ignored. */
  announcedOn: string;
  datePrecision: DatePrecision;
  roundType: RoundType;
  /** Null when the amount is unknown. Zero counts as unknown. */
  amountGbpMinor: number | null;
}

export interface RoundMomentumResult extends RoundMomentum {
  eventId: number;
  /** The previous equity round, or null for the first recorded one. */
  previousEventId: number | null;
  /** The round the step-up is measured against, or null. */
  stepUpBasisEventId: number | null;
  /** Equity rounds in the 24 months up to and including this round. */
  roundsIn24mToDate: number;
}

/** Whether a round counts in momentum: every funding round but `debt` and `grant`. */
export function isEquityRound(roundType: RoundType): boolean {
  return !NON_EQUITY.includes(roundType);
}

function hasAmount(round: MomentumRoundInput): round is MomentumRoundInput & {
  amountGbpMinor: number;
} {
  return (
    round.amountGbpMinor !== null &&
    Number.isFinite(round.amountGbpMinor) &&
    round.amountGbpMinor > 0
  );
}

function compareRounds(a: MomentumRoundInput, b: MomentumRoundInput): number {
  if (a.announcedOn !== b.announcedOn) {
    return a.announcedOn < b.announcedOn ? -1 : 1;
  }
  return a.eventId - b.eventId;
}

function parts(date: string): { year: number; month: number; day: number } {
  const day = toUtcDay(date);
  return {
    year: day.getUTCFullYear(),
    month: day.getUTCMonth() + 1,
    day: day.getUTCDate(),
  };
}

/**
 * Whole calendar months from `previous` to `current`. With day precision on
 * both, one month less when the current day of the month is earlier. Month
 * precision on either ignores the day. Year precision on either gives null.
 */
export function monthsBetween(
  previous: Pick<MomentumRoundInput, "announcedOn" | "datePrecision">,
  current: Pick<MomentumRoundInput, "announcedOn" | "datePrecision">,
): number | null {
  if (previous.datePrecision === "year" || current.datePrecision === "year") {
    return null;
  }
  const a = parts(previous.announcedOn);
  const b = parts(current.announcedOn);
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  const bothDays =
    previous.datePrecision === "day" && current.datePrecision === "day";
  if (bothDays && b.day < a.day) months -= 1;
  return months;
}

/**
 * The date `months` calendar months before `date`, as `YYYY-MM-DD`. The day
 * is clamped to the end of a shorter month (31 March less 1 month is 28 or
 * 29 February).
 */
export function subtractMonths(date: Date | string, months: number): string {
  const { year, month, day } = parts(toIsoDate(date));
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/**
 * One result per equity round, in round order (by date, then event id).
 * Debt and grant rounds are skipped. The output does not depend on the
 * order of `rounds`.
 */
export function computeRoundMomentum(
  rounds: readonly MomentumRoundInput[],
): RoundMomentumResult[] {
  const equity = rounds
    .filter((round) => isEquityRound(round.roundType))
    .sort(compareRounds);

  return equity.map((round, index) => {
    const previous = index > 0 ? equity[index - 1] : undefined;

    // The latest earlier equity round with an amount, if within 36 months.
    let basis: MomentumRoundInput | undefined;
    for (let i = index - 1; i >= 0; i--) {
      const candidate = equity[i];
      if (candidate && hasAmount(candidate)) {
        basis = candidate;
        break;
      }
    }
    const basisCutoff = subtractMonths(round.announcedOn, STEP_UP_MAX_MONTHS);
    if (basis && basis.announcedOn < basisCutoff) basis = undefined;

    let stepUpRatio: number | null = null;
    if (basis && hasAmount(basis) && hasAmount(round)) {
      stepUpRatio = round.amountGbpMinor / basis.amountGbpMinor;
    }

    const windowStart = subtractMonths(round.announcedOn, RECENT_ROUNDS_MONTHS);
    let roundsIn24mToDate = 0;
    for (let i = 0; i <= index; i++) {
      const earlier = equity[i];
      if (earlier && earlier.announcedOn >= windowStart) roundsIn24mToDate++;
    }

    return {
      eventId: round.eventId,
      equityRoundNumber: index + 1,
      previousEventId: previous?.eventId ?? null,
      monthsSincePrevious: previous ? monthsBetween(previous, round) : null,
      stepUpRatio,
      stepUpBasisEventId:
        stepUpRatio === null ? null : (basis?.eventId ?? null),
      stepUpBasisOn: stepUpRatio === null ? null : (basis?.announcedOn ?? null),
      roundsIn24mToDate,
    };
  });
}

/**
 * Equity rounds announced in the `months` months up to and including `asOf`.
 * Counted at read time against today, so it never goes stale.
 */
export function roundsInLastMonths(
  rounds: ReadonlyArray<Pick<MomentumRoundInput, "announcedOn" | "roundType">>,
  asOf: Date | string,
  months: number = RECENT_ROUNDS_MONTHS,
): number {
  const end = toIsoDate(asOf);
  const start = subtractMonths(end, months);
  return rounds.filter(
    (round) =>
      isEquityRound(round.roundType) &&
      round.announcedOn >= start &&
      round.announcedOn <= end,
  ).length;
}
