import Link from "next/link";
import type { FundingCriteria, FundingFilters } from "@/core/read-models";
import {
  fundingFiltersHref,
  serialiseFundingCriteria,
} from "@/lib/funding-filters";

export interface QuickView {
  id: string;
  label: string;
  /** The filter values the tab writes. Nothing else: a tab is not a separate concept. */
  criteria: FundingCriteria;
}

/** £10m in pence. */
const TEN_MILLION_GBP_MINOR = 1_000_000_000;

/** The quick-view tabs (from direction C), in order. */
export const QUICK_VIEWS: readonly QuickView[] = [
  { id: "all", label: "All", criteria: {} },
  { id: "uk", label: "UK", criteria: { countryCodes: ["GB"] } },
  { id: "confirmed", label: "Confirmed", criteria: { evidence: "confirmed" } },
  {
    id: "seed-series-a",
    label: "Seed and Series A",
    criteria: { roundTypes: ["pre_seed", "seed", "series_a"] },
  },
  {
    id: "10m-plus",
    label: "£10m+",
    criteria: { minGbpMinor: TEN_MILLION_GBP_MINOR },
  },
];

/** The tab's whole criteria: the base filters plus its own values. */
export function quickViewCriteria(
  base: FundingCriteria,
  view: QuickView,
): FundingCriteria {
  return { ...base, ...view.criteria };
}

/** The tab whose filters exactly match the current ones, if any. */
export function activeQuickView(
  filters: FundingCriteria,
  base: FundingCriteria,
  views: readonly QuickView[] = QUICK_VIEWS,
): QuickView | undefined {
  const current = serialiseFundingCriteria(filters);
  return views.find(
    (view) =>
      serialiseFundingCriteria(quickViewCriteria(base, view)) === current,
  );
}

/**
 * Tabs that set filters, each a plain link with the number of rounds it would
 * list. `base` is the current filters without the tabs' own keys, so a tab
 * keeps every other filter; the active tab is the one that matches exactly.
 * The page draws the line under the tabs, so the toolbar row can hold
 * "Show summary" at its right.
 */
export function QuickViews({
  filters,
  base,
  counts,
  views = QUICK_VIEWS,
}: {
  filters: FundingFilters;
  base: FundingCriteria;
  counts: Readonly<Record<string, number>>;
  views?: readonly QuickView[];
}) {
  const active = activeQuickView(filters, base, views);
  return (
    <nav aria-label="Quick views" className="min-w-0">
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {views.map((view) => {
          const current = view.id === active?.id;
          const count = counts[view.id];
          return (
            <li key={view.id} className="shrink-0">
              <Link
                href={fundingFiltersHref(
                  quickViewCriteria(base, view),
                  filters,
                )}
                aria-current={current ? "page" : undefined}
                className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-medium transition-colors duration-[120ms] ease-out motion-reduce:transition-none ${
                  current
                    ? "border-brand text-ink"
                    : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {view.label}
                {count !== undefined ? (
                  <span
                    className={`rounded-[var(--radius-pill)] px-1.5 text-xs tabular-nums ${
                      current
                        ? "bg-brand-soft text-brand"
                        : "bg-surface-sunk text-muted"
                    }`}
                  >
                    {count.toLocaleString("en-GB")}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
