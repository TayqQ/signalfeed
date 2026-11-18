import type { RecordKind } from "@/core/enums";
import type { CompanyEvent } from "@/core/read-models";
import { HISTORY_STARTS } from "@/components/company-momentum";
import { fundingRoundsOf, isConfirmed } from "@/components/event-timeline";
import { daysSince, relativeDateLabel } from "@/components/ui/relative-date";
import { Icon, type IconName } from "./icons";
import { CompanyPanel } from "./panel";

/** A round within this many days counts as recent. */
export const RECENT_ROUND_DAYS = 30;
/** "Raised again" means the previous equity round was at most this many months before. */
export const RAISED_AGAIN_MONTHS = 24;

export type SignalId = "confirmed" | "recent" | "first" | "again" | "sources";

export interface Signal {
  id: SignalId;
  text: string;
  /** A short supporting line, for example the record or the date. */
  detail: string | null;
}

const CONFIRMED_BY: Readonly<Record<RecordKind, string>> = {
  ch_allotment: "Confirmed by a Companies House filing",
  sec_form_d: "Confirmed by an SEC Form D filing",
  ukri_grant: "Confirmed by a UKRI grant record",
};

const ICONS: Readonly<Record<SignalId, IconName>> = {
  confirmed: "check",
  recent: "clock",
  first: "flag",
  again: "repeat",
  sources: "doc",
};

/** "Confirmed: shares allotted on ..." as "Shares allotted on ...". */
function recordDetail(text: string): string {
  const body = text.replace(/^Confirmed:\s*/, "");
  return body.charAt(0).toUpperCase() + body.slice(1);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Plain-words signals about the latest funding round, built only from stored
 * facts. Nothing is guessed or scored: each signal is a rule over the data,
 * and a signal whose fact is missing is left out.
 *
 * - "Confirmed by a Companies House filing" (or the SEC / UKRI record that
 *   confirms it): the latest round has an official record.
 * - "Raised in the last 30 days": the latest round has an exact day within
 *   30 days of `now`. Month or year dates never count.
 * - "First round we have recorded": exactly one funding round is stored.
 * - "Raised again within 24 months": the latest round is an equity round
 *   that came at most 24 months after the previous one.
 * - "Reported by N sources": the latest round has two or more sources.
 */
export function companySignals(
  events: readonly CompanyEvent[],
  now: Date,
): Signal[] {
  const rounds = fundingRoundsOf(events);
  const latest = rounds[0];
  if (!latest) return [];
  const signals: Signal[] = [];

  if (isConfirmed(latest)) {
    const kind: RecordKind | null =
      latest.confirmations?.[0]?.kind ??
      (latest.roundType === "grant" ? "ukri_grant" : null);
    const first = latest.confirmations?.[0];
    signals.push({
      id: "confirmed",
      text: kind ? CONFIRMED_BY[kind] : "Confirmed by an official record",
      detail: first ? recordDetail(first.text) : null,
    });
  }

  if (latest.datePrecision === "day") {
    const days = daysSince(latest.announcedOn, now);
    if (days >= 0 && days <= RECENT_ROUND_DAYS) {
      signals.push({
        id: "recent",
        text: `Raised in the last ${RECENT_ROUND_DAYS} days`,
        detail: relativeDateLabel(latest.announcedOn, now),
      });
    }
  }

  if (rounds.length === 1) {
    signals.push({
      id: "first",
      text: "First round we have recorded",
      detail: `History starts in ${HISTORY_STARTS}`,
    });
  }

  const momentum = latest.momentum;
  if (
    momentum &&
    momentum.equityRoundNumber > 1 &&
    momentum.monthsSincePrevious !== null &&
    momentum.monthsSincePrevious <= RAISED_AGAIN_MONTHS
  ) {
    const months = momentum.monthsSincePrevious;
    signals.push({
      id: "again",
      text: `Raised again within ${RAISED_AGAIN_MONTHS} months`,
      detail:
        months <= 0
          ? "In the same month as the previous round"
          : `${months} ${plural(months, "month", "months")} after the previous round`,
    });
  }

  if (latest.sourceCount >= 2) {
    signals.push({
      id: "sources",
      text: `Reported by ${latest.sourceCount} sources`,
      detail: null,
    });
  }

  return signals;
}

export function CompanySignals({
  events,
  now,
  headingId,
}: {
  events: readonly CompanyEvent[];
  now: Date;
  headingId: string;
}) {
  const signals = companySignals(events, now);
  return (
    <CompanyPanel title="Signals" headingId={headingId}>
      {signals.length > 0 ? (
        <ul className="divide-y divide-line">
          {signals.map((signal) => (
            <li
              key={signal.id}
              data-signal={signal.id}
              className="flex gap-2.5 py-2 text-[13px] first:pt-0 last:pb-0"
            >
              <Icon
                name={ICONS[signal.id]}
                className={`mt-0.5 ${signal.id === "confirmed" ? "text-up" : "text-muted"}`}
              />
              <span className="min-w-0">
                <span className="font-medium text-ink">{signal.text}</span>
                {signal.detail ? (
                  <span className="block text-xs text-muted">
                    {signal.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">
          No signals yet. They appear once we hold a funding round for this
          company.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Facts from the rounds and filings we hold. Nothing here is a score.
      </p>
    </CompanyPanel>
  );
}
