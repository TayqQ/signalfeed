import type { CompanyEvent, RoundMomentum } from "@/core/read-models";

/** When SignalFeed started collecting. "First round" only means first recorded. */
export const HISTORY_STARTS = "November 2026";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2025-03-10" as "March 2025". Returns null for anything else. */
function monthYear(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  const month = MONTH_NAMES[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function monthsAfter(months: number): string {
  if (months <= 0) return "in the same month as the last";
  return `${months} ${plural(months, "month", "months")} after the last`;
}

function stepUp(ratio: number): string {
  return `${ratio.toFixed(1)}×`;
}

/**
 * One line for a table cell: "First recorded round", or
 * "Round 3 · 7 months after the last · 5.3×". Parts that are not known are
 * left out. Null means the round is not an equity round.
 */
export function describeRoundMomentum(
  momentum: RoundMomentum | null | undefined,
): string | null {
  if (!momentum) return null;
  if (momentum.equityRoundNumber <= 1) return "First recorded round";
  const parts = [`Round ${momentum.equityRoundNumber}`];
  if (momentum.monthsSincePrevious != null) {
    parts.push(monthsAfter(momentum.monthsSincePrevious));
  }
  if (momentum.stepUpRatio != null) parts.push(stepUp(momentum.stepUpRatio));
  return parts.join(" · ");
}

/** A longer sentence for the company page and the timeline. */
export function describeRoundMomentumLong(
  momentum: RoundMomentum | null | undefined,
): string | null {
  if (!momentum) return null;
  if (momentum.equityRoundNumber <= 1) {
    return `First round we have recorded. History starts in ${HISTORY_STARTS}.`;
  }
  const parts = [`Equity round ${momentum.equityRoundNumber} we have recorded`];
  if (momentum.monthsSincePrevious != null) {
    const months = momentum.monthsSincePrevious;
    parts.push(
      months <= 0
        ? "in the same month as the previous one"
        : `${months} ${plural(months, "month", "months")} after the previous one`,
    );
  }
  if (momentum.stepUpRatio != null) {
    const basis = momentum.stepUpBasisOn
      ? monthYear(momentum.stepUpBasisOn)
      : null;
    parts.push(
      basis
        ? `${stepUp(momentum.stepUpRatio)} the ${basis} round`
        : `${stepUp(momentum.stepUpRatio)} the earlier round`,
    );
  }
  return `${parts.join(", ")}.`;
}

/**
 * Company-level momentum: how many equity rounds in the last 24 months, and
 * how the latest compares with the one before. Says plainly when history is
 * short. Renders nothing when there is no equity round.
 */
export function CompanyMomentum({
  events,
  roundsInLast24Months,
}: {
  events: CompanyEvent[];
  roundsInLast24Months?: number;
}) {
  const equity = events
    .filter((event) => event.type === "funding_round" && event.momentum != null)
    .sort((a, b) => b.announcedOn.localeCompare(a.announcedOn));
  const latest = equity[0];
  if (!latest || latest.type !== "funding_round" || !latest.momentum) {
    return null;
  }
  const momentum = latest.momentum;

  const sentences: string[] = [];
  if (roundsInLast24Months != null) {
    sentences.push(
      `${roundsInLast24Months} ${plural(roundsInLast24Months, "round", "rounds")} in the last 24 months`,
    );
  }
  const latestParts: string[] = [];
  if (momentum.stepUpRatio != null) {
    const basis = momentum.stepUpBasisOn
      ? monthYear(momentum.stepUpBasisOn)
      : null;
    latestParts.push(
      basis
        ? `the latest was ${stepUp(momentum.stepUpRatio)} the ${basis} round`
        : `the latest was ${stepUp(momentum.stepUpRatio)} the earlier round`,
    );
  }
  if (momentum.monthsSincePrevious != null) {
    const months = momentum.monthsSincePrevious;
    const gap =
      months <= 0
        ? "in the same month as the previous one"
        : `${months} ${plural(months, "month", "months")} after the previous one`;
    latestParts.push(latestParts.length > 0 ? gap : `the latest was ${gap}`);
  }
  if (latestParts.length > 0) sentences.push(latestParts.join(", "));

  const isFirst = momentum.equityRoundNumber <= 1;
  return (
    <section className="mt-6" aria-labelledby="momentum-heading">
      <h2 id="momentum-heading" className="text-sm font-semibold">
        Momentum
      </h2>
      {sentences.length > 0 ? (
        <p className="mt-1">{sentences.join("; ")}.</p>
      ) : null}
      {isFirst ? (
        <p className="mt-1 text-sm text-quiet">
          First round we have recorded. History starts in {HISTORY_STARTS}, so
          the company may have raised before.
        </p>
      ) : null}
    </section>
  );
}
