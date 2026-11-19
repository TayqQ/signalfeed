import Link from "next/link";
import type { CompanyEvent, FundingRoundEvent } from "@/core/read-models";
import { Amount } from "@/components/ui/amount";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { StageChip } from "@/components/ui/stage-chip";
import { formatCompanyAge, formatDate, formatMoneyShort } from "@/lib/format";
import { describeRoundMomentumLong } from "./company-momentum";

/** The company's funding rounds, newest first (ties: the higher event id). */
export function fundingRoundsOf(
  events: readonly CompanyEvent[],
): FundingRoundEvent[] {
  return events
    .flatMap((event) => (event.type === "funding_round" ? [event] : []))
    .sort((a, b) => b.announcedOn.localeCompare(a.announcedOn) || b.id - a.id);
}

/** "8 Oct 2026", or "Around Oct 2026" / "Around 2026" for a rougher date. */
export function eventDateLabel(
  event: Pick<CompanyEvent, "announcedOn" | "datePrecision">,
): string {
  if (event.datePrecision === "day") return formatDate(event.announcedOn);
  const parts = formatDate(event.announcedOn).split(" ");
  const approximate =
    event.datePrecision === "month" ? parts.slice(1).join(" ") : parts[2];
  return `Around ${approximate ?? event.announcedOn}`;
}

/** Confirmed when an official record backs it, or it is a confirmed grant. */
export function isConfirmed(event: CompanyEvent): boolean {
  return (
    (event.confirmations ?? []).length > 0 || event.evidence === "confirmed"
  );
}

/** The marker text: the closest record's wording, else a plain statement. */
export function confirmationText(event: CompanyEvent): string {
  const first = event.confirmations?.[0];
  if (first) return first.text;
  if (event.type === "funding_round" && event.roundType === "grant") {
    return "Confirmed: UKRI grant record (Gateway to Research)";
  }
  return "Confirmed by an official record";
}

/** Bar width against the company's biggest round: linear, at least 4%. */
export function amountBarWidth(gbpMinor: number, maxGbpMinor: number): number {
  if (maxGbpMinor <= 0) return 4;
  return Math.max(4, Math.round((gbpMinor / maxGbpMinor) * 100));
}

const LINK = "text-brand underline underline-offset-4 hover:text-brand-hover";

function RoundBody({
  event,
  maxGbpMinor,
}: {
  event: FundingRoundEvent;
  maxGbpMinor: number;
}) {
  const momentum = describeRoundMomentumLong(event.momentum);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StageChip
          roundType={event.roundType}
          label={event.roundLabel ?? undefined}
        />
        {isConfirmed(event) ? (
          <ConfirmedMark text={confirmationText(event)} />
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div
          aria-hidden="true"
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunk"
        >
          {event.amountGbpMinor !== null ? (
            <div
              data-testid="amount-bar"
              className="h-full rounded-full bg-data-1"
              style={{
                width: `${amountBarWidth(event.amountGbpMinor, maxGbpMinor)}%`,
              }}
            />
          ) : null}
        </div>
        <div className="w-20 shrink-0 text-right">
          <Amount amount={event.amount} amountGbpMinor={event.amountGbpMinor} />
        </div>
      </div>
      {momentum ? (
        <p className="mt-1.5 text-[13px] text-muted">{momentum}</p>
      ) : null}
      {event.roundType === "grant" ? (
        <p className="mt-1 text-[13px] text-muted">
          Source: UKRI Gateway to Research
        </p>
      ) : null}
      {event.includesIndividualAngels ? (
        <p className="mt-1 text-[13px] text-muted">
          Individual angels also took part.
        </p>
      ) : null}
    </>
  );
}

function acquisitionPrice(
  event: Extract<CompanyEvent, { type: "acquisition" }>,
): string {
  if (event.priceGbpMinor !== null) {
    return `Price: ${formatMoneyShort(event.priceGbpMinor, "GBP")}`;
  }
  if (event.price) {
    return `Price: ${formatMoneyShort(event.price.amountMinor, event.price.currency)}`;
  }
  return "Price not reported";
}

function EventBody({
  event,
  maxGbpMinor,
}: {
  event: CompanyEvent;
  maxGbpMinor: number;
}) {
  switch (event.type) {
    case "funding_round":
      return <RoundBody event={event} maxGbpMinor={maxGbpMinor} />;
    case "acquisition":
      return (
        <>
          <h3 className="text-[15px] font-semibold text-ink">
            Acquired by{" "}
            {event.acquirer ? (
              <Link href={`/companies/${event.acquirer.slug}`} className={LINK}>
                {event.acquirer.name}
              </Link>
            ) : (
              event.acquirerName
            )}
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            {acquisitionPrice(event)}
          </p>
        </>
      );
    case "launch":
      return (
        <h3 className="text-[15px] font-semibold text-ink">
          Launched{" "}
          {event.url ? (
            <a href={event.url} rel="noopener" className={LINK}>
              {event.productName ?? "a product"}
            </a>
          ) : (
            (event.productName ?? "a product")
          )}
        </h3>
      );
  }
}

/**
 * The company's history, newest first: funding rounds with an amount bar
 * scaled to the biggest round, plus acquisitions and launches. Investors and
 * sources have their own sections on the company page.
 */
export function EventTimeline({
  events,
  foundedYear = null,
}: {
  events: CompanyEvent[];
  /** When known, each event shows roughly how old the company was. */
  foundedYear?: number | null;
}) {
  if (events.length === 0) {
    return <p className="text-[13px] text-muted">No events recorded yet.</p>;
  }
  const ordered = [...events].sort(
    (a, b) => b.announcedOn.localeCompare(a.announcedOn) || b.id - a.id,
  );
  const maxGbpMinor = Math.max(
    0,
    ...fundingRoundsOf(events).map((round) => round.amountGbpMinor ?? 0),
  );
  return (
    <ol className="divide-y divide-line">
      {ordered.map((event) => {
        const age = formatCompanyAge(foundedYear, event.announcedOn);
        return (
          <li
            key={event.id}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)]"
          >
            <div className="text-[13px] tabular-nums text-muted">
              <time dateTime={event.announcedOn.slice(0, 10)}>
                {eventDateLabel(event)}
              </time>
              {age ? (
                <span className="mt-0.5 block text-xs">Company age {age}</span>
              ) : null}
            </div>
            <div className="min-w-0">
              <EventBody event={event} maxGbpMinor={maxGbpMinor} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
