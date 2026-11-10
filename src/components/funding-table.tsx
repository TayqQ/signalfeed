import Link from "next/link";
import type {
  FundingFilters,
  FundingRow,
  FundingSort,
  Page,
} from "@/core/read-models";
import { formatDate, formatRoundType } from "@/lib/format";
import { serialiseFundingFilters } from "@/lib/funding-filters";
import { formatLocation } from "@/lib/location";
import { RoundAmount } from "./round-amount";

function effectiveSort(filters: FundingFilters): FundingSort {
  return filters.sort ?? (filters.q ? "relevance" : "announced");
}

function SortHeader({
  label,
  sort,
  filters,
  numeric = false,
}: {
  label: string;
  sort: FundingSort;
  filters: FundingFilters;
  numeric?: boolean;
}) {
  const active = effectiveSort(filters) === sort;
  const direction = filters.direction ?? "desc";
  const next = active && direction === "desc" ? "asc" : "desc";
  const query = serialiseFundingFilters({
    ...filters,
    sort,
    direction: next,
    page: 1,
  });
  const ariaSort = active
    ? direction === "desc"
      ? "descending"
      : "ascending"
    : "none";
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-2 font-medium ${numeric ? "text-right" : ""}`}
    >
      <Link
        href={`/?${query}`}
        className={`underline-offset-4 hover:underline ${active ? "text-ink" : ""}`}
      >
        {label}
        {active ? (direction === "desc" ? " ↓" : " ↑") : ""}
      </Link>
    </th>
  );
}

export function FundingTable({
  page,
  filters,
}: {
  page: Page<FundingRow>;
  filters: FundingFilters;
}) {
  const filtered =
    serialiseFundingFilters({ ...filters, page: 1, pageSize: 25 }).length > 0;
  if (page.items.length === 0 && !filtered) {
    return (
      <div className="border-y border-rule py-12">
        <p className="text-lg font-medium">No funding rounds yet</p>
        <p className="mt-2 max-w-xl text-quiet">
          Rounds appear here once collected articles have been processed. The{" "}
          <Link
            href="/status"
            className="text-signal underline underline-offset-4"
          >
            status page
          </Link>{" "}
          shows how far that has got.
        </p>
      </div>
    );
  }

  if (page.items.length === 0) {
    return (
      <div className="border-y border-rule py-12">
        <p className="text-lg font-medium">No rounds match these filters</p>
        <p className="mt-2 text-quiet">
          Try fewer filters, or{" "}
          <Link href="/" className="text-signal underline underline-offset-4">
            reset them
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse text-left text-sm">
        <thead className="border-b-2 border-ink text-quiet">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Company
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Round
            </th>
            <SortHeader label="Amount" sort="amount" filters={filters} />
            <th scope="col" className="px-3 py-2 font-medium">
              Lead investors
            </th>
            <SortHeader label="Date" sort="announced" filters={filters} />
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Reports
            </th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((row) => {
            const location = formatLocation(row.city, row.countryCode);
            return (
              <tr key={row.eventId} className="border-b border-rule align-top">
                <td className="py-3 pr-3">
                  <Link
                    href={`/companies/${row.companySlug}`}
                    className="font-semibold text-ink underline-offset-4 hover:text-signal hover:underline"
                  >
                    {row.companyName}
                  </Link>
                  {location ? (
                    <div className="mt-0.5 text-xs text-quiet">{location}</div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  {row.roundLabel ?? formatRoundType(row.roundType)}
                </td>
                <td className="px-3 py-3">
                  <RoundAmount
                    amount={row.amount}
                    amountGbpMinor={row.amountGbpMinor}
                    roundType={row.roundType}
                  />
                </td>
                <td className="px-3 py-3">
                  {row.leadInvestors.length > 0 ? (
                    <ul>
                      {row.leadInvestors.map((investor) => (
                        <li key={investor.slug}>
                          <Link
                            href={`/investors/${investor.slug}`}
                            className="underline-offset-4 hover:text-signal hover:underline"
                          >
                            {investor.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-quiet">Not reported</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {formatDate(row.announcedOn)}
                </td>
                <td className="py-3 pl-3 text-right tabular-nums">
                  {row.sourceCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
