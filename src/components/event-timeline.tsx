import Link from "next/link";
import type { CompanyEvent } from "@/core/read-models";
import { formatDate, formatMoneyCompact, formatRoundType } from "@/lib/format";
import { InvestorList } from "./investor-list";
import { RoundAmount } from "./round-amount";
import { SourceList } from "./source-list";

function eventDate(event: CompanyEvent): string {
  if (event.datePrecision === "day") return formatDate(event.announcedOn);
  const parts = formatDate(event.announcedOn).split(" ");
  const approximate =
    event.datePrecision === "month" ? parts.slice(1).join(" ") : parts[2];
  return `Around ${approximate ?? event.announcedOn}`;
}

function EventBody({ event }: { event: CompanyEvent }) {
  switch (event.type) {
    case "funding_round":
      return (
        <>
          <h3 className="font-semibold">
            {event.roundLabel ?? formatRoundType(event.roundType)}
          </h3>
          <div className="mt-1 max-w-xs">
            <RoundAmount
              amount={event.amount}
              amountGbpMinor={event.amountGbpMinor}
              roundType={event.roundType}
            />
          </div>
          <InvestorList investors={event.investors} />
          {event.includesIndividualAngels ? (
            <p className="mt-1 text-sm text-quiet">
              Individual angels also took part.
            </p>
          ) : null}
        </>
      );
    case "acquisition":
      return (
        <>
          <h3 className="font-semibold">
            Acquired by{" "}
            {event.acquirer ? (
              <Link
                href={`/companies/${event.acquirer.slug}`}
                className="underline underline-offset-4 hover:text-signal"
              >
                {event.acquirer.name}
              </Link>
            ) : (
              event.acquirerName
            )}
          </h3>
          <p className="mt-1 text-sm text-quiet">
            {event.price
              ? `Price: ${formatMoneyCompact(event.price.amountMinor, event.price.currency)}`
              : "Price not reported"}
          </p>
        </>
      );
    case "launch":
      return (
        <h3 className="font-semibold">
          Launched{" "}
          {event.url ? (
            <a
              href={event.url}
              rel="noopener"
              className="underline underline-offset-4 hover:text-signal"
            >
              {event.productName ?? "a product"}
            </a>
          ) : (
            (event.productName ?? "a product")
          )}
        </h3>
      );
  }
}

export function EventTimeline({ events }: { events: CompanyEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-4 text-quiet">No events recorded yet.</p>;
  }
  const ordered = [...events].sort((a, b) =>
    b.announcedOn.localeCompare(a.announcedOn),
  );
  return (
    <ol className="mt-4 border-l-2 border-ink">
      {ordered.map((event) => (
        <li key={event.id} className="relative pb-8 pl-5 last:pb-0">
          <span
            className="absolute -left-[5px] top-1.5 h-2 w-2 bg-ink"
            aria-hidden="true"
          />
          <p className="text-sm tabular-nums text-quiet">{eventDate(event)}</p>
          <div className="mt-1">
            <EventBody event={event} />
          </div>
          <SourceList sources={event.sources} />
        </li>
      ))}
    </ol>
  );
}
