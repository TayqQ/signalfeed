import type { FundingFilters } from "@/core/read-models";
import { FundingFiltersForm } from "@/components/funding-filters-form";
import { FundingTable } from "@/components/funding-table";
import { Pagination } from "@/components/pagination";
import { listFundingRounds } from "@/db/queries/funding";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import {
  parseFundingFilters,
  serialiseFundingFilters,
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
  const filters = parseFundingFilters(await searchParams);
  const key = serialiseFundingFilters(filters);
  const page = await cached(
    () => listFundingRounds(getWebDb(), filters),
    ["funding", key],
  );

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

      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside>
          <details className="lg:hidden" open={hasActiveFilters(filters)}>
            <summary className="cursor-pointer text-sm font-semibold">
              Filter rounds
            </summary>
            <div className="mt-4">
              <FundingFiltersForm filters={filters} />
            </div>
          </details>
          <div className="hidden lg:block">
            <FundingFiltersForm filters={filters} />
          </div>
        </aside>

        <section aria-label="Funding rounds">
          <p className="mb-3 text-sm tabular-nums text-quiet" role="status">
            {page.total === 1 ? "1 round" : `${page.total} rounds`}
          </p>
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
