import type { FundingRow } from "@/core/read-models";
import { Amount } from "@/components/ui/amount";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { Monogram } from "@/components/ui/monogram";
import { NewMark } from "@/components/ui/new-mark";
import { PlaceBadge } from "@/components/ui/place-badge";
import { RelativeDate } from "@/components/ui/relative-date";
import { SectorLabel } from "@/components/ui/sector-label";
import { StageChip } from "@/components/ui/stage-chip";
import {
  NO_DESCRIPTION,
  RoundName,
  chipLabel,
  leadsLabel,
} from "./round-row-parts";

/**
 * The Cards view (from direction B): one card per round in a 1, 2 or 3 column
 * grid. Identity and place on top, a two-line description, a facts row
 * (amount, stage, sector) and a footer with the date and the leads. The whole
 * card is the company link.
 */
export function RoundCards({
  rows,
  now,
}: {
  rows: readonly FundingRow[];
  now?: Date;
}) {
  return (
    <ul
      aria-label="Funding rounds"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5"
    >
      {rows.map((row) => (
        <li key={row.eventId} className="min-w-0">
          <RoundCard row={row} now={now} />
        </li>
      ))}
    </ul>
  );
}

function RoundCard({ row, now }: { row: FundingRow; now?: Date }) {
  const description = row.companyDescription?.trim() || null;
  const leads = leadsLabel(row);
  return (
    <article className="relative flex h-full flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface p-4 transition-colors duration-[120ms] ease-out hover:border-line-strong motion-reduce:transition-none">
      <div className="flex min-w-0 items-start gap-3">
        <Monogram name={row.companyName} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 text-[15px] leading-snug">
            <RoundName row={row} />
          </h3>
          <div className="mt-1 text-xs">
            <PlaceBadge countryCode={row.countryCode} city={row.city} />
          </div>
        </div>
        <NewMark date={row.announcedOn} now={now} />
      </div>

      <p
        className={`line-clamp-2 min-h-[2lh] text-[13px] leading-snug ${
          description ? "text-muted" : "text-faint"
        }`}
      >
        {description ?? NO_DESCRIPTION}
      </p>

      <div className="mt-auto flex min-w-0 items-end justify-between gap-3 border-t border-line pt-3">
        <div className="shrink-0">
          <Amount amount={row.amount} amountGbpMinor={row.amountGbpMinor} />
          {row.confirmation ? (
            <span className="relative z-[1] mt-1 block">
              <ConfirmedMark text={row.confirmation.text} />
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-1 text-right">
          <StageChip
            roundType={row.roundType}
            label={chipLabel(row.roundLabel)}
          />
          <span className="max-w-full truncate text-xs">
            <SectorLabel sector={row.mainSector} />
          </span>
        </div>
      </div>

      <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
        <span className="relative z-[1] shrink-0">
          <RelativeDate date={row.announcedOn} now={now} />
        </span>
        <span
          className={`min-w-0 truncate ${leads ? "text-ink" : "text-muted"}`}
        >
          {leads ?? "Investors not reported"}
        </span>
      </div>
    </article>
  );
}
