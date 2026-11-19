import type { FundingFilters, FundingRow } from "@/core/read-models";
import { Amount } from "@/components/ui/amount";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { Monogram } from "@/components/ui/monogram";
import { NewMark } from "@/components/ui/new-mark";
import { PlaceBadge } from "@/components/ui/place-badge";
import { RelativeDate } from "@/components/ui/relative-date";
import { SectorLabel } from "@/components/ui/sector-label";
import { StageChip } from "@/components/ui/stage-chip";
import {
  chipLabel,
  NO_DESCRIPTION,
  RoundName,
  SortHeader,
  leadsLabel,
} from "./round-row-parts";
import { ListRowKeys } from "./row-keys";

const HEAD = "px-3 py-2 text-left text-xs font-medium text-muted";

/*
 * Phones (under 768 px) turn each row into a four-line stack on a grid of
 * [monogram | stage | rest | amount] columns:
 *   1. name ............ amount   (the amount cell spans lines 1-2, so the
 *   2. stage  sector               Confirmed mark sits under the figure)
 *   3. description
 *   4. place ........... date
 * Every grid item has min-w-0 so a long value truncates rather than widening
 * the page. The identity cell is `display: contents` there, so its parts are
 * grid items of the row.
 */
const ROW =
  "group relative border-b border-line align-top transition-colors duration-[120ms] ease-out hover:bg-surface-sunk motion-reduce:transition-none max-md:grid max-md:grid-cols-[auto_auto_minmax(0,1fr)_auto] max-md:gap-x-2 max-md:gap-y-1 max-md:py-3";
const CELL = "px-3 py-3 max-md:min-w-0 max-md:p-0";

/**
 * The List view (from direction A): a dense table of rounds on desktop and a
 * stack per row on phones. Hovering or focusing a row shows its lead
 * investors. The Amount and Date headers sort, keeping every filter. j/k (and
 * the arrow keys inside the list) move focus between rows; Enter opens one.
 */
export function RoundList({
  rows,
  filters,
  now,
}: {
  rows: readonly FundingRow[];
  /** For the sort headers. Without it the headers are plain text. */
  filters?: FundingFilters;
  now?: Date;
}) {
  return (
    <ListRowKeys>
      <table className="w-full table-fixed border-collapse text-[13px] max-md:block max-md:border-t max-md:border-line">
        <caption className="sr-only">Funding rounds</caption>
        <thead className="border-b border-line-strong max-md:hidden">
          <tr>
            <th scope="col" className={`${HEAD} pl-0`}>
              Company
            </th>
            <th scope="col" className={`${HEAD} w-[8.5rem]`}>
              Stage
            </th>
            <th scope="col" className={`${HEAD} w-[10rem]`}>
              Sector
            </th>
            <th scope="col" className={`${HEAD} hidden w-[9rem] lg:table-cell`}>
              Place
            </th>
            {filters ? (
              <SortHeader
                label="Amount"
                sort="amount"
                filters={filters}
                className={`${HEAD} w-[7.5rem] text-right [&>a]:justify-end`}
              />
            ) : (
              <th scope="col" className={`${HEAD} w-[7.5rem] text-right`}>
                Amount
              </th>
            )}
            {filters ? (
              <SortHeader
                label="Date"
                sort="announced"
                filters={filters}
                className={`${HEAD} w-[7.5rem] pr-0`}
              />
            ) : (
              <th scope="col" className={`${HEAD} w-[7.5rem] pr-0`}>
                Date
              </th>
            )}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {rows.map((row) => (
            <RoundListRow key={row.eventId} row={row} now={now} />
          ))}
        </tbody>
      </table>
    </ListRowKeys>
  );
}

function RoundListRow({ row, now }: { row: FundingRow; now?: Date }) {
  const leads = leadsLabel(row);
  const description = row.companyDescription?.trim() || null;
  return (
    <tr className={ROW}>
      <td className={`${CELL} pl-0 max-md:contents`}>
        <div className="flex min-w-0 items-start gap-2.5 max-md:contents">
          <span className="pt-px max-md:col-start-1 max-md:row-start-1">
            <Monogram name={row.companyName} size={28} />
          </span>
          <div className="min-w-0 flex-1 max-md:contents">
            <div className="flex min-w-0 items-baseline gap-2 leading-snug max-md:col-span-2 max-md:col-start-2 max-md:row-start-1 max-md:self-center">
              <RoundName row={row} className="text-[15px]" rowLink />
              {leads ? (
                <span
                  data-testid="row-leads"
                  className="min-w-0 shrink-[100] truncate text-xs text-muted opacity-0 transition-opacity duration-[120ms] ease-out group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none max-md:hidden"
                >
                  {leads}
                </span>
              ) : null}
            </div>
            <p
              className={`mt-0.5 truncate leading-snug max-md:col-span-3 max-md:col-start-2 max-md:row-start-3 max-md:mt-0 max-md:line-clamp-2 max-md:whitespace-normal ${
                description ? "text-muted" : "text-faint max-md:hidden"
              }`}
            >
              {description ?? NO_DESCRIPTION}
            </p>
          </div>
        </div>
      </td>
      <td className={`${CELL} max-md:col-start-2 max-md:row-start-2`}>
        <StageChip
          roundType={row.roundType}
          label={chipLabel(row.roundLabel)}
        />
      </td>
      <td
        className={`${CELL} truncate pt-3.5 max-md:col-start-3 max-md:row-start-2 max-md:self-center max-md:pt-0`}
      >
        <SectorLabel sector={row.mainSector} />
        {/* Between 768 and 1024 px the Place column folds in here. */}
        <span className="mt-1 hidden text-xs md:max-lg:block">
          <PlaceBadge countryCode={row.countryCode} city={row.city} />
        </span>
      </td>
      <td
        className={`${CELL} truncate pt-3.5 text-xs md:max-lg:hidden max-md:col-span-2 max-md:col-start-2 max-md:row-start-4 max-md:pt-0`}
      >
        <PlaceBadge countryCode={row.countryCode} city={row.city} />
      </td>
      <td
        className={`${CELL} text-right max-md:col-start-4 max-md:row-span-2 max-md:row-start-1`}
      >
        <Amount amount={row.amount} amountGbpMinor={row.amountGbpMinor} />
        {row.confirmation ? (
          <span className="relative z-[1] mt-1 block">
            <ConfirmedMark text={row.confirmation.text} />
          </span>
        ) : null}
      </td>
      <td
        className={`${CELL} pr-0 pt-3.5 text-xs max-md:col-start-4 max-md:row-start-4 max-md:pt-0 max-md:text-right`}
      >
        <span className="relative z-[1] inline-flex flex-col gap-0.5 max-md:flex-row-reverse max-md:items-center max-md:gap-2">
          <RelativeDate date={row.announcedOn} now={now} />
          <NewMark date={row.announcedOn} now={now} />
        </span>
      </td>
    </tr>
  );
}
