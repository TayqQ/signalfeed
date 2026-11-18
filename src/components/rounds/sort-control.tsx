import Link from "next/link";
import type { FundingFilters, FundingSort } from "@/core/read-models";
import { fundingFiltersHref } from "@/lib/funding-filters";
import { effectiveSort } from "./round-row-parts";

interface SortOption {
  sort: FundingSort;
  label: string;
}

/**
 * The sort as a row of links, for Cards and phones where there are no column
 * headers. Each link keeps every filter and restarts at page 1. "Best match"
 * appears only for a name search, where it is the default.
 */
export function SortControl({ filters }: { filters: FundingFilters }) {
  const options: SortOption[] = [
    ...(filters.q ? [{ sort: "relevance" as const, label: "Best match" }] : []),
    { sort: "announced", label: "Newest" },
    { sort: "amount", label: "Largest" },
  ];
  const active = effectiveSort(filters);

  function href(sort: FundingSort): string {
    // The default sort is left out of the URL so the plain link stays canonical.
    const isDefault = filters.q ? sort === "relevance" : sort === "announced";
    return fundingFiltersHref(filters, {
      sort: isDefault ? undefined : sort,
      pageSize: filters.pageSize,
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-muted" aria-hidden="true">
        Sort
      </span>
      <div
        role="group"
        aria-label="Sort"
        className="inline-flex rounded-[var(--radius-sm)] border border-line-strong bg-surface-sunk p-0.5"
      >
        {options.map((option) => {
          const current = option.sort === active;
          return (
            <Link
              key={option.sort}
              href={href(option.sort)}
              aria-current={current ? "true" : undefined}
              className={`inline-flex h-7 items-center whitespace-nowrap rounded-[4px] px-2.5 text-[13px] font-medium transition-colors duration-[120ms] ease-out motion-reduce:transition-none ${
                current
                  ? "bg-surface text-ink shadow-[var(--shadow-1)]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
