import { unstable_cache } from "next/cache";
import type { FundingFilters } from "@/core/read-models";
import { getCompanyPreview } from "@/db/queries/companies";
import {
  getFundingSummary,
  getQuickViewCounts,
  getSectorCounts,
  quickViewBase,
  type QuickViewCriteria,
} from "@/db/queries/summary";
import { getWebDb } from "@/db/web";
import {
  serialiseFundingCriteria,
  serialiseFundingFilters,
} from "@/lib/funding-filters";

/** Ten minutes, matching the read cache in D18. */
const DEFAULT_REVALIDATE_SECONDS = 600;

/**
 * Cache a server read. `keyParts` must include every input the callback closes
 * over: Next.js keys `unstable_cache` from these parts, not from the closure.
 * Pages call this around query functions.
 */
export async function cached<T>(
  fn: () => Promise<T>,
  keyParts: readonly string[],
  options?: { revalidateSeconds?: number },
): Promise<T> {
  const revalidate = options?.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS;
  const read = unstable_cache(async () => fn(), [...keyParts], { revalidate });
  return read();
}

/** The "What's happening" summary, cached per filter set like the list. */
export function cachedFundingSummary(filters: FundingFilters) {
  return cached(
    () => getFundingSummary(getWebDb(), filters),
    ["funding-summary", serialiseFundingFilters(filters)],
  );
}

/**
 * Quick-view tab counts, cached per base filter set (the filters without the
 * tabs' own keys), so every tab of one search shares one entry.
 */
export function cachedQuickViewCounts(
  filters: FundingFilters,
  views: readonly QuickViewCriteria[],
) {
  const base = quickViewBase(filters, views);
  return cached(
    () => getQuickViewCounts(getWebDb(), base, views),
    [
      "quick-view-counts",
      serialiseFundingCriteria(base),
      ...views.map(
        (view) => `${view.id}:${serialiseFundingCriteria(view.criteria)}`,
      ),
    ],
  );
}

/**
 * Rounds per sector over the last `days` days, for the sector filter's order.
 * It ignores the other filters, so one entry per day serves every page.
 */
export function cachedSectorCounts(days: number) {
  const today = new Date().toISOString().slice(0, 10);
  return cached(
    () => getSectorCounts(getWebDb(), { days, today }),
    ["sector-counts", String(days), today],
  );
}

/** The split-view company preview, cached per company and day like the company page. */
export function cachedCompanyPreview(slug: string) {
  const day = new Date().toISOString().slice(0, 10);
  return cached(
    () => getCompanyPreview(getWebDb(), slug),
    ["company-preview", slug, day],
  );
}
