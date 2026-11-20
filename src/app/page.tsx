import { cookies } from "next/headers";
import { FilterBar, SECTOR_RANK_DAYS } from "@/components/filters/filter-bar";
import { FundingSummary } from "@/components/home/funding-summary";
import { QUICK_VIEWS, QuickViews } from "@/components/home/quick-views";
import {
  ShowSummaryButton,
  SummaryFrame,
  SummaryProvider,
} from "@/components/home/summary-state";
import { Pagination } from "@/components/pagination";
import { RoundViews } from "@/components/rounds/round-views";
import { SortControl } from "@/components/rounds/sort-control";
import { ViewSwitch } from "@/components/rounds/view-switch";
import {
  countUnlocatedCompanies,
  listFundingRounds,
} from "@/db/queries/funding";
import { quickViewBase } from "@/db/queries/summary";
import { listThemes } from "@/db/queries/themes";
import { getWebDb } from "@/db/web";
import {
  cached,
  cachedCompanyPreview,
  cachedFundingSummary,
  cachedQuickViewCounts,
  cachedSectorCounts,
} from "@/lib/cached";
import { describeFundingCriteria } from "@/lib/filter-summary";
import {
  describeAppliedFilters,
  fundingFiltersHref,
  parseFundingFilters,
  serialiseFundingCriteria,
  serialiseFundingFilters,
  unresolvedNearName,
} from "@/lib/funding-filters";
import {
  OPEN_PARAM,
  SUMMARY_COOKIE,
  VIEW_COOKIE,
  VIEW_PARAM,
  parseOpenSlug,
  parseSummaryState,
  resolveListView,
  resolveOpenSlug,
  withViewParam,
} from "@/lib/view-preference";

export const dynamic = "force-dynamic";

/** The list's default page size. The summary ignores paging. */
const SUMMARY_PAGE_SIZE = 25;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const filters = parseFundingFilters(params);
  const unknownNear = unresolvedNearName(params);
  const key = serialiseFundingFilters(filters);
  const today = new Date().toISOString().slice(0, 10);
  const view = resolveListView({
    param: params[VIEW_PARAM],
    cookie: cookieStore.get(VIEW_COOKIE)?.value,
  });
  // Read on the server, so the summary paints open or hidden with no flash.
  const summaryState = parseSummaryState(
    cookieStore.get(SUMMARY_COOKIE)?.value,
  );
  // Sort and paging do not change the summary, so they stay out of its key.
  const summaryFilters = {
    ...filters,
    sort: undefined,
    direction: undefined,
    page: 1,
    pageSize: SUMMARY_PAGE_SIZE,
  };

  // The summary is rendered even when hidden, so "Show summary" opens it at
  // once without another request.
  const [page, themes, unlocated, summaryData, quickCounts, sectorCounts] =
    await Promise.all([
      cached(() => listFundingRounds(getWebDb(), filters), ["funding", key]),
      cached(() => listThemes(getWebDb()), ["themes", "active"]),
      filters.near
        ? cached(
            () => countUnlocatedCompanies(getWebDb(), filters),
            ["funding-unlocated", key],
          )
        : Promise.resolve(0),
      cachedFundingSummary(summaryFilters),
      cachedQuickViewCounts(summaryFilters, QUICK_VIEWS),
      cachedSectorCounts(SECTOR_RANK_DAYS),
    ]);

  // Split renders the selected company's preview on the server: `?open=` when
  // that company is on this page, else the first row. A failed read leaves it
  // to the client, which fetches it.
  const previewSlug =
    view === "split"
      ? resolveOpenSlug(
          page.items.map((row) => row.companySlug),
          parseOpenSlug(params[OPEN_PARAM]),
        )
      : null;
  const preview = previewSlug
    ? await cachedCompanyPreview(previewSlug).catch(() => undefined)
    : undefined;

  const themeNames = Object.fromEntries(
    themes.map((theme) => [theme.slug, theme.name]),
  );
  const hasCriteria = serialiseFundingCriteria(filters).length > 0;
  const heading = hasCriteria
    ? describeFundingCriteria(filters, { themes: themeNames })
    : null;
  const appliedLabels = describeAppliedFilters(filters, {
    themes: themeNames,
    today,
  }).map((chip) => chip.label);
  const currentHref = withViewParam(key ? `/?${key}` : "/", view);

  return (
    <main>
      <h1 className="sr-only">Funding</h1>

      <SummaryProvider initial={summaryState}>
        <div className="space-y-6">
          <SummaryFrame>
            <FundingSummary
              summary={summaryData}
              filters={filters}
              today={today}
            />
          </SummaryFrame>

          <section aria-labelledby="rounds-heading" className="min-w-0">
            <h2 id="rounds-heading" className="sr-only">
              Funding rounds
            </h2>
            <div className="flex items-center gap-2 border-b border-line">
              <div className="min-w-0 flex-1">
                <QuickViews
                  filters={filters}
                  base={quickViewBase(filters, QUICK_VIEWS)}
                  counts={quickCounts}
                />
              </div>
              <ShowSummaryButton />
            </div>
            <div className="mt-4">
              <FilterBar
                filters={filters}
                themes={themes}
                total={page.total}
                sectorCounts={sectorCounts}
                today={today}
              />
            </div>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-3">
              <div className="min-w-0">
                {heading ? (
                  <p className="font-display text-[17px] font-semibold leading-snug text-ink">
                    {heading}
                  </p>
                ) : null}
                <p
                  className="text-[13px] tabular-nums text-muted"
                  role="status"
                >
                  {page.total === 1
                    ? "1 round"
                    : `${page.total.toLocaleString("en-GB")} rounds`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <SortControl filters={filters} />
                <ViewSwitch view={view} href={currentHref} />
              </div>
            </div>

            {unknownNear ? (
              <p className="mb-3 text-[13px] text-ink" role="alert">
                We couldn&apos;t find a UK town called &lsquo;{unknownNear}
                &rsquo;. The distance filter was not applied.
              </p>
            ) : null}
            {filters.near ? (
              <p className="mb-3 text-[13px] text-muted">
                {unlocated === 1
                  ? "1 company in these results has"
                  : `${unlocated} companies in these results have`}{" "}
                no known town, so {unlocated === 1 ? "it is" : "they are"} not
                included in distance searches.
              </p>
            ) : null}

            <RoundViews
              rows={page.items}
              view={view}
              filters={filters}
              appliedLabels={appliedLabels}
              clearHref={fundingFiltersHref({}, filters)}
              href={currentHref}
              preview={preview}
              previewSlug={preview === undefined ? null : previewSlug}
            />
            <Pagination
              filters={filters}
              total={page.total}
              page={page.page}
              pageSize={page.pageSize}
            />
          </section>
        </div>
      </SummaryProvider>
    </main>
  );
}
