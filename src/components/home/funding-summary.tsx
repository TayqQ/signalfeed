import type {
  FundingFilters,
  FundingSummary as FundingSummaryData,
} from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import { Amount } from "@/components/ui/amount";
import { Monogram } from "@/components/ui/monogram";
import { Stat } from "@/components/ui/stat";
import { RoundName } from "@/components/rounds/round-row-parts";
import { formatDate, formatMoneyShort, formatRoundType } from "@/lib/format";
import {
  DATE_PRESET_LABELS,
  fundingFiltersHref,
  matchDatePreset,
  serialiseFundingCriteria,
} from "@/lib/funding-filters";
import { SectorBars, type SectorBar } from "./sector-bars";
import { SummaryControls } from "./summary-state";
import { chipLabel } from "@/components/rounds/round-row-parts";

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / DAY_MS;
}

/** "1 Sep to 30 Sep 2026", or with both years when they differ. */
export function dateRange(from: string, to: string): string {
  const start = formatDate(from);
  const end = formatDate(to);
  if (from === to) return end;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? start.replace(/ \d{4}$/, "") : start} to ${end}`;
}

/**
 * The window the summary covers, in words, and the window it compares with.
 * Without a date filter it covers every round the other filters match and
 * makes no comparison. A start with no end runs to `today`, matching
 * `previousWindow` in `src/db/queries/summary.ts`.
 */
export function summaryWindow(
  filters: Pick<FundingFilters, "from" | "to">,
  today: string,
): {
  label: string;
  previous: { from: string; to: string; label: string } | null;
} {
  const { from, to } = filters;
  if (!from && !to) return { label: "All rounds we hold", previous: null };
  if (!from && to) return { label: `Up to ${formatDate(to)}`, previous: null };
  const start = from as string;
  const end = to ?? today;
  const length = dayNumber(end) - dayNumber(start) + 1;
  const range = dateRange(start, end);
  const preset = matchDatePreset(filters, today);
  const label = preset ? `${DATE_PRESET_LABELS[preset]}, ${range}` : range;
  if (!Number.isFinite(length) || length < 1) return { label, previous: null };
  const prevTo = new Date((dayNumber(start) - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const prevFrom = new Date((dayNumber(start) - length) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return {
    label,
    previous: {
      from: prevFrom,
      to: prevTo,
      label: dateRange(prevFrom, prevTo),
    },
  };
}

export interface Change {
  direction: "up" | "down" | "level" | "none";
  text: string;
}

/**
 * A figure against the same figure for the previous window, in words ("Up
 * 24%"), so the arrow and colour are never the only cue.
 */
export function describeChange(
  current: number | null,
  previous: number | null,
): Change {
  if (current === null || previous === null) {
    return { direction: "none", text: "Nothing to compare" };
  }
  if (current === previous) return { direction: "level", text: "Level" };
  if (previous === 0) return { direction: "up", text: "Up from none" };
  const percent = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(percent));
  const amount = rounded === 0 ? "less than 1%" : `${rounded}%`;
  return percent > 0
    ? { direction: "up", text: `Up ${amount}` }
    : { direction: "down", text: `Down ${amount}` };
}

function ChangeLine({ change }: { change: Change }) {
  const tone =
    change.direction === "up"
      ? "text-up"
      : change.direction === "down"
        ? "text-down"
        : "text-muted";
  const arrow =
    change.direction === "up" ? "↑" : change.direction === "down" ? "↓" : null;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${tone}`}>
      {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      {change.text}
    </span>
  );
}

function money(amount: number | null): string | null {
  return amount === null ? null : formatMoneyShort(amount, "GBP");
}

function roundsText(count: number): string {
  return count === 1 ? "1 round" : `${count.toLocaleString("en-GB")} rounds`;
}

/** The light panel around each block inside the summary. */
const PANEL =
  "min-w-0 rounded-[var(--radius-lg)] border border-line bg-surface";

/**
 * The "What's happening" summary (from direction B) for the same filters as
 * the list: £ raised, rounds and the median against the previous window of the
 * same length; sectors ranked by £ (or rounds), each a link that filters the
 * list; and the three biggest rounds. A section of the page, not a card; its
 * header has the close control (see `summary-state.tsx`).
 *
 * Layout, with no dead space:
 * - phones: the stat tiles in a row, then sectors, then biggest rounds;
 * - `md` to `xl`: the tiles, then sectors and biggest rounds side by side;
 * - from `xl`: two columns, the tiles over biggest rounds on the left and
 *   sectors on the right, both ending at the same height.
 */
export function FundingSummary({
  summary,
  filters,
  today,
}: {
  summary: FundingSummaryData;
  filters: FundingFilters;
  /** YYYY-MM-DD (UTC). */
  today: string;
}) {
  const span = summaryWindow(filters, today);
  const narrowed =
    serialiseFundingCriteria({ ...filters, from: undefined, to: undefined })
      .length > 0;
  const subtitle = narrowed
    ? `${span.label} · rounds matching your filters`
    : span.label;
  const previous = span.previous ? summary.previous : null;

  return (
    <section aria-labelledby="summary-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2
            id="summary-heading"
            className="font-display text-[20px] font-semibold text-ink"
          >
            What&apos;s happening
          </h2>
          <p className="text-[13px] text-muted">{subtitle}</p>
        </div>
        <SummaryControls />
      </div>
      <div className="mt-3">
        {summary.count === 0 ? (
          <EmptyWindow
            summary={summary}
            dated={Boolean(filters.from || filters.to)}
            previousLabel={span.previous?.label}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-rows-[auto_1fr]">
            <div className="min-w-0 md:col-span-2 xl:col-span-1 xl:col-start-1 xl:row-start-1">
              <Headline
                summary={summary}
                previous={previous}
                previousLabel={span.previous?.label ?? null}
              />
            </div>
            <div
              className={`${PANEL} px-4 py-3 xl:col-start-2 xl:row-span-2 xl:row-start-1`}
            >
              <SectorBars
                headingId="summary-sectors"
                sectors={sectorBars(summary, filters)}
              />
            </div>
            <div className={`${PANEL} px-4 py-3 xl:col-start-1 xl:row-start-2`}>
              <BiggestRounds summary={summary} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyWindow({
  summary,
  dated,
  previousLabel,
}: {
  summary: FundingSummaryData;
  dated: boolean;
  previousLabel: string | undefined;
}) {
  return (
    <div>
      <p className="font-display text-[17px] font-semibold text-ink">
        {dated ? "No rounds in this window" : "No rounds to summarise"}
      </p>
      <p className="mt-1 text-[13px] text-muted">
        {dated
          ? "Nothing matches these filters between these dates."
          : "Nothing matches these filters yet."}
        {summary.previous && previousLabel
          ? ` ${roundsText(summary.previous.count)} in the window before (${previousLabel}).`
          : ""}
      </p>
    </div>
  );
}

function Headline({
  summary,
  previous,
  previousLabel,
}: {
  summary: FundingSummaryData;
  previous: FundingSummaryData["previous"];
  previousLabel: string | null;
}) {
  const total = summary.totalGbpMinor > 0 ? summary.totalGbpMinor : null;
  const change = (current: number | null, before: number | null) =>
    previous ? <ChangeLine change={describeChange(current, before)} /> : null;
  const tile = `${PANEL} px-2.5 py-2.5 sm:px-4 sm:py-3`;
  return (
    <div>
      <div className="grid grid-cols-3 items-stretch gap-2 sm:gap-3">
        <div className={tile}>
          <Stat
            label="Raised, in GBP"
            size="lg"
            value={money(total)}
            sub={change(
              summary.totalGbpMinor,
              previous ? previous.totalGbpMinor : null,
            )}
          />
        </div>
        <div className={tile}>
          <Stat
            label="Rounds"
            size="lg"
            value={summary.count.toLocaleString("en-GB")}
            sub={change(summary.count, previous ? previous.count : null)}
          />
        </div>
        <div className={tile}>
          <Stat
            label="Median round"
            size="lg"
            value={money(summary.medianGbpMinor)}
            sub={change(
              summary.medianGbpMinor,
              previous ? previous.medianGbpMinor : null,
            )}
          />
        </div>
      </div>
      {previous && previousLabel ? (
        <p className="mt-2 text-xs text-muted">
          Changes compare with {previousLabel}, the window of the same length
          before.
        </p>
      ) : null}
    </div>
  );
}

/** The summary's sectors as bars; a click sets that one sector filter. */
export function sectorBars(
  summary: FundingSummaryData,
  filters: FundingFilters,
): SectorBar[] {
  return summary.sectors.map((sector) => {
    if (sector.sector === null) {
      return {
        key: "pending",
        label: "Sector pending",
        gbpMinor: sector.gbpMinor,
        count: sector.count,
      };
    }
    return {
      key: sector.sector,
      label: SECTOR_LABELS[sector.sector],
      gbpMinor: sector.gbpMinor,
      count: sector.count,
      // Themes belong to a sector, so they are cleared with the switch.
      href: fundingFiltersHref(
        { ...filters, sectors: [sector.sector], themes: undefined },
        filters,
      ),
    };
  });
}

function BiggestRounds({ summary }: { summary: FundingSummaryData }) {
  return (
    <div>
      <h3 className="font-display text-[17px] font-semibold text-ink">
        Biggest rounds
      </h3>
      {summary.biggest.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          No round in this window has a disclosed amount.
        </p>
      ) : (
        <ol className="mt-2">
          {summary.biggest.map((row, index) => (
            <li
              key={row.eventId}
              className="relative flex min-w-0 items-center gap-3 border-t border-line py-2.5 first:border-t-0"
            >
              <span
                aria-hidden="true"
                className="w-3 shrink-0 font-display text-[13px] font-semibold text-muted"
              >
                {index + 1}
              </span>
              <Monogram name={row.companyName} size={28} />
              <span className="flex min-w-0 flex-1 flex-col">
                <RoundName row={row} className="text-[15px]" />
                <span className="truncate text-xs text-muted">
                  {chipLabel(row.roundLabel) ?? formatRoundType(row.roundType)}{" "}
                  ·{" "}
                  {row.mainSector
                    ? SECTOR_LABELS[row.mainSector]
                    : "Sector pending"}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <Amount
                  amount={row.amount}
                  amountGbpMinor={row.amountGbpMinor}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
