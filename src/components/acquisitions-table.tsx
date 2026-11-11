import Link from "next/link";
import type { AcquisitionRow } from "@/core/read-models";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import { median } from "@/lib/trend-stats";
import { BarChart } from "./charts/bar-chart";

/** Fewest known ages before a median is shown (spec section 8.4). */
const MIN_AGES_FOR_MEDIAN = 3;
const TOP_ACQUIRERS = 5;

export function formatYears(years: number): string {
  return years === 1 ? "1 year" : `${years} years`;
}

/** "8 Oct 2026", "Around Mar 2026" for month precision, "Around 2026" for year. */
export function formatAnnounced(row: {
  announcedOn: string;
  datePrecision: AcquisitionRow["datePrecision"];
}): string {
  if (row.datePrecision === "day") return formatDate(row.announcedOn);
  const full = formatDate(row.announcedOn);
  const parts = full.split(" ");
  return row.datePrecision === "month"
    ? `Around ${parts.slice(1).join(" ")}`
    : `Around ${parts[2]}`;
}

export interface AcquisitionSummary {
  total: number;
  agesKnown: number;
  /** Null unless at least 3 ages are known. */
  medianAgeYears: number | null;
  pricesKnown: number;
  topAcquirers: Array<{ name: string; count: number }>;
}

/** Totals, coverage and top acquirers over every matching acquisition. */
export function summariseAcquisitions(
  rows: readonly AcquisitionRow[],
): AcquisitionSummary {
  const ages = rows
    .map((row) => row.targetAgeYears)
    .filter((age): age is number => age !== null);
  const counts = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const name = row.acquirer ? row.acquirer.name : row.acquirerName;
    const key = row.acquirer
      ? `company:${row.acquirer.slug}`
      : `name:${row.acquirerName.trim().toLowerCase()}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  return {
    total: rows.length,
    agesKnown: ages.length,
    medianAgeYears: ages.length >= MIN_AGES_FOR_MEDIAN ? median(ages) : null,
    pricesKnown: rows.filter(
      (row) => row.priceGbpMinor !== null || row.price !== null,
    ).length,
    topAcquirers: [...counts.values()]
      .sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name, "en-GB"),
      )
      .slice(0, TOP_ACQUIRERS),
  };
}

/** The coverage line, such as "Median target age 6 years (age known for 4 of 19)". */
export function describeTargetAge(summary: AcquisitionSummary): string {
  const coverage = `age known for ${summary.agesKnown} of ${summary.total}`;
  if (summary.medianAgeYears === null) {
    return `Too few known ages for a median (${coverage})`;
  }
  return `Median target age ${formatYears(summary.medianAgeYears)} (${coverage})`;
}

/** Top acquirers chart and the age and price coverage lines. */
export function AcquisitionsSummary({
  summary,
}: {
  summary: AcquisitionSummary;
}) {
  if (summary.total === 0) return null;
  const top = summary.topAcquirers[0];
  return (
    <section aria-label="Summary" className="space-y-3">
      <p className="text-lg font-semibold leading-snug">
        {describeTargetAge(summary)}
      </p>
      <p className="text-sm text-quiet">
        Price known for {summary.pricesKnown} of {summary.total}. Target age
        needs a founded year, which many companies do not have yet.
      </p>
      <div className="max-w-xl pt-2">
        <h2 className="mb-2 text-sm font-semibold">
          Top acquirers by number of deals
        </h2>
        <BarChart
          title="Top acquirers by number of deals"
          summary={
            top
              ? `${top.name} made the most acquisitions, with ${top.count}.`
              : "No acquirers."
          }
          items={summary.topAcquirers.map((item) => ({
            label: item.name,
            value: item.count,
          }))}
          valueLabel="Acquisitions"
        />
      </div>
    </section>
  );
}

function Price({ row }: { row: AcquisitionRow }) {
  if (row.priceGbpMinor !== null) {
    return (
      <>
        {formatMoneyCompact(row.priceGbpMinor, "GBP")}
        {row.price && row.price.currency !== "GBP" ? (
          <div className="text-xs text-quiet">
            {formatMoneyCompact(row.price.amountMinor, row.price.currency)}
          </div>
        ) : null}
      </>
    );
  }
  if (row.price) {
    return (
      <>
        {formatMoneyCompact(row.price.amountMinor, row.price.currency)}
        <div className="text-xs text-quiet">Not converted to GBP</div>
      </>
    );
  }
  return <span className="text-quiet">Not disclosed</span>;
}

export function AcquisitionsTable({
  rows,
  filtered,
}: {
  rows: readonly AcquisitionRow[];
  /** True when any filter is set, which changes the empty message. */
  filtered: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="border-y border-rule py-12">
        <p className="text-lg font-medium">
          {filtered
            ? "No acquisitions match these filters"
            : "No acquisitions yet"}
        </p>
        <p className="mt-2 max-w-xl text-quiet">
          {filtered ? (
            <>
              Try fewer filters, or{" "}
              <Link
                href="/acquisitions"
                className="text-signal underline underline-offset-4"
              >
                reset them
              </Link>
              .
            </>
          ) : (
            "Acquisitions appear here once collected articles have been processed."
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">Acquisitions, newest first</caption>
        <thead className="border-b-2 border-ink text-quiet">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Target
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Acquirer
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Price
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Target age
            </th>
            <th scope="col" className="py-2 pl-3 font-medium">
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.eventId} className="border-b border-rule align-top">
              <td className="py-3 pr-3">
                <Link
                  href={`/companies/${row.target.slug}`}
                  className="font-semibold text-ink underline-offset-4 hover:text-signal hover:underline"
                >
                  {row.target.name}
                </Link>
              </td>
              <td className="px-3 py-3">
                {row.acquirer ? (
                  <Link
                    href={`/companies/${row.acquirer.slug}`}
                    className="underline-offset-4 hover:text-signal hover:underline"
                  >
                    {row.acquirer.name}
                  </Link>
                ) : (
                  row.acquirerName
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                <Price row={row} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                {row.targetAgeYears === null ? (
                  <span className="text-quiet">Unknown</span>
                ) : (
                  formatYears(row.targetAgeYears)
                )}
              </td>
              <td className="whitespace-nowrap py-3 pl-3 tabular-nums">
                {formatAnnounced(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Previous and next links that keep the other filters. */
export function AcquisitionsPager({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const linkClass = "underline underline-offset-4 hover:text-signal";
  return (
    <nav
      aria-label="Pages"
      className="mt-4 flex items-center justify-between text-sm text-quiet"
    >
      {page > 1 ? (
        <Link rel="prev" href={hrefFor(page - 1)} className={linkClass}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link rel="next" href={hrefFor(page + 1)} className={linkClass}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
