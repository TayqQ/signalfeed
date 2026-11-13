import type { FundingFilters } from "@/core/read-models";
import {
  FundingFiltersForm,
  PlaceSuggestions,
} from "@/components/funding-filters-form";
import { FundingTable } from "@/components/funding-table";
import { Pagination } from "@/components/pagination";
import {
  countUnlocatedCompanies,
  listFundingRounds,
} from "@/db/queries/funding";
import { listThemes } from "@/db/queries/themes";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { describeFundingCriteria } from "@/lib/filter-summary";
import {
  parseFundingFilters,
  serialiseFundingCriteria,
  serialiseFundingFilters,
  unresolvedNearName,
} from "@/lib/funding-filters";

export const dynamic = "force-dynamic";

function hasActiveFilters(filters: FundingFilters): boolean {
  return serialiseFundingFilters({ ...filters, page: 1 }).length > 0;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFundingFilters(params);
  const unknownNear = unresolvedNearName(params);
  const key = serialiseFundingFilters(filters);
  const [page, themes, unlocated] = await Promise.all([
    cached(() => listFundingRounds(getWebDb(), filters), ["funding", key]),
    cached(() => listThemes(getWebDb()), ["themes", "active"]),
    filters.near
      ? cached(
          () => countUnlocatedCompanies(getWebDb(), filters),
          ["funding-unlocated", key],
        )
      : Promise.resolve(0),
  ]);
  const hasCriteria = serialiseFundingCriteria(filters).length > 0;
  const summary = hasCriteria
    ? describeFundingCriteria(filters, {
        themes: Object.fromEntries(
          themes.map((theme) => [theme.slug, theme.name]),
        ),
      })
    : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        Who just raised, how much, and from whom
      </h1>
      <p className="mt-3 max-w-2xl text-quiet">
        Funding rounds pulled from startup news and merged across outlets, so
        one raise is one row. Every figure links back to the articles it came
        from.
      </p>

      <PlaceSuggestions />

      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside>
          <details className="lg:hidden" open={hasActiveFilters(filters)}>
            <summary className="cursor-pointer text-sm font-semibold">
              Filter rounds
            </summary>
            <div className="mt-4">
              <FundingFiltersForm filters={filters} themes={themes} />
            </div>
          </details>
          <div className="hidden lg:block">
            <FundingFiltersForm filters={filters} themes={themes} />
          </div>
        </aside>

        <section aria-label="Funding rounds">
          {summary ? (
            <h2 className="mb-1 text-lg font-semibold leading-snug">
              {summary}
            </h2>
          ) : null}
          <p className="mb-3 text-sm tabular-nums text-quiet" role="status">
            {page.total === 1 ? "1 round" : `${page.total} rounds`}
          </p>
          {unknownNear ? (
            <p className="mb-3 max-w-2xl text-sm" role="alert">
              We couldn&apos;t find a UK town called &lsquo;{unknownNear}
              &rsquo;. The distance filter was not applied.
            </p>
          ) : null}
          {filters.near ? (
            <p className="mb-3 max-w-2xl text-sm text-quiet">
              {unlocated === 1
                ? "1 company in these results has"
                : `${unlocated} companies in these results have`}{" "}
              no known town, so {unlocated === 1 ? "it is" : "they are"} not
              included in distance searches.
            </p>
          ) : null}
          <FundingTable page={page} filters={filters} />
          <Pagination
            filters={filters}
            total={page.total}
            page={page.page}
            pageSize={page.pageSize}
          />
        </section>
      </div>
    </main>
  );
}
