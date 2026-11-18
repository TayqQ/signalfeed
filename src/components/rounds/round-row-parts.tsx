import Link from "next/link";
import type {
  FundingFilters,
  FundingRow,
  FundingSort,
} from "@/core/read-models";
import { fundingFiltersHref } from "@/lib/funding-filters";

/** The sort in force: the chosen one, else best match for a search, else newest. */
export function effectiveSort(filters: FundingFilters): FundingSort {
  return filters.sort ?? (filters.q ? "relevance" : "announced");
}

export function companyHref(row: Pick<FundingRow, "companySlug">): string {
  return `/companies/${row.companySlug}`;
}

/**
 * "Led by A", "Led by A and B", "Led by A, B +2". Without named leads it says
 * how many investors took part, or null when none are known.
 */
export function leadsLabel(
  row: Pick<FundingRow, "leadInvestors" | "investorCount">,
): string | null {
  const names = row.leadInvestors.map((investor) => investor.name);
  if (names.length === 0) {
    if (row.investorCount <= 0) return null;
    return row.investorCount === 1
      ? "1 investor, lead not named"
      : `${row.investorCount} investors, lead not named`;
  }
  if (names.length === 1) return `Led by ${names[0]}`;
  if (names.length === 2) return `Led by ${names[0]} and ${names[1]}`;
  return `Led by ${names[0]}, ${names[1]} +${names.length - 2}`;
}

/**
 * The stage chip's text in a list or card. A clean series label from the
 * article ("Series F", which our types file under D+) is kept; anything wordier
 * ("Series C financing round", "seed funding") gives way to the normalised
 * stage so chips stay one short line. The full wording stays on the company page.
 */
export function chipLabel(roundLabel: string | null): string | undefined {
  const label = roundLabel?.trim();
  if (!label) return undefined;
  const series = /^series ([a-z])(\+?)$/i.exec(label);
  return series ? `Series ${series[1]!.toUpperCase()}${series[2]}` : undefined;
}

/** Shown where a row has no one-line description. */
export const NO_DESCRIPTION = "No description yet";

/**
 * The company name as a link that covers its whole row or card (the parent
 * must be `relative`), so the row is one big target with one tab stop.
 */
export function RoundName({
  row,
  className = "",
  rowLink = false,
}: {
  row: Pick<FundingRow, "companySlug" | "companyName">;
  className?: string;
  /** Marks the link as its row's, for j/k movement (`row-keys`). */
  rowLink?: boolean;
}) {
  return (
    <Link
      href={companyHref(row)}
      data-row-link={rowLink ? "" : undefined}
      className={`min-w-0 truncate font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand ${className}`}
    >
      {row.companyName}
    </Link>
  );
}

/**
 * A sortable column header. It keeps every filter and toggles the direction
 * when it is already the active sort, like the old table (D24).
 */
export function SortHeader({
  label,
  sort,
  filters,
  className = "",
}: {
  label: string;
  sort: FundingSort;
  filters: FundingFilters;
  className?: string;
}) {
  const active = effectiveSort(filters) === sort;
  const direction = filters.direction ?? "desc";
  const next = active && direction === "desc" ? "asc" : "desc";
  const href = fundingFiltersHref(filters, {
    sort,
    direction: next,
    pageSize: filters.pageSize,
  });
  const ariaSort = active
    ? direction === "desc"
      ? "descending"
      : "ascending"
    : "none";
  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
      >
        {label}
        {active ? (
          <span aria-hidden="true">{direction === "desc" ? "↓" : "↑"}</span>
        ) : null}
      </Link>
    </th>
  );
}
