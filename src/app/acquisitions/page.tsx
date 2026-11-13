import type { Metadata } from "next";
import { z } from "zod";
import {
  AcquisitionsPager,
  AcquisitionsSummary,
  AcquisitionsTable,
  summariseAcquisitions,
} from "@/components/acquisitions-table";
import { ThemeSelect } from "@/components/theme-select";
import type { AcquisitionRow } from "@/core/read-models";
import { SECTORS, type Sector } from "@/core/sectors";
import { listAcquisitions } from "@/db/queries/acquisitions";
import { listThemes } from "@/db/queries/themes";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acquisitions | SignalFeed",
  description:
    "Who buys young startups, in which themes, and how old the targets were.",
};

const PAGE_SIZE = 25;
/** Rows read per query, and the most pages read for one view. */
const FETCH_SIZE = 100;
const MAX_FETCHES = 20;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

interface Filters {
  theme?: string;
  sector?: Sector;
  from?: string;
  to?: string;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Each value is checked on its own, and an invalid one is dropped. */
function parseFilters(
  params: Record<string, string | string[] | undefined>,
): Filters {
  const theme = z
    .string()
    .regex(/^[a-z0-9-]{1,120}$/)
    .safeParse(first(params.theme));
  const sector = z.enum(SECTORS).safeParse(first(params.sector));
  const from = isoDate.safeParse(first(params.from));
  const to = isoDate.safeParse(first(params.to));
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .safeParse(first(params.page));
  return {
    theme: theme.success ? theme.data : undefined,
    sector: sector.success ? sector.data : undefined,
    from: from.success ? from.data : undefined,
    to: to.success ? to.data : undefined,
    page: page.success ? page.data : 1,
  };
}

function query(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.theme) params.set("theme", filters.theme);
  if (filters.sector) params.set("sector", filters.sector);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

/** Every matching acquisition, so the summary covers the whole filter. */
async function loadAll(filters: Filters): Promise<AcquisitionRow[]> {
  const db = getWebDb();
  const rows: AcquisitionRow[] = [];
  for (let page = 1; page <= MAX_FETCHES; page += 1) {
    const result = await listAcquisitions(db, {
      theme: filters.theme,
      sector: filters.sector,
      from: filters.from,
      to: filters.to,
      page,
      pageSize: FETCH_SIZE,
    });
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) break;
  }
  return rows;
}

const inputClass =
  "mt-1 w-full border border-zinc-300 bg-white px-2 py-2 text-sm text-ink";

export default async function AcquisitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const key = query(filters, 1);
  const [all, themes] = await Promise.all([
    cached(() => loadAll(filters), ["acquisitions", key]),
    cached(() => listThemes(getWebDb()), ["themes", "active"]),
  ]);
  const summary = summariseAcquisitions(all);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtered = key.length > 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        Who buys young startups, and how old were they
      </h1>
      <p className="mt-3 max-w-2xl text-quiet">
        Acquisitions of startups, with the buyer and the age of the company when
        it was bought. Many founded years are unknown, so each figure shows how
        many deals it rests on.
      </p>

      <div className="mt-8">
        <ThemeSelect
          action="/acquisitions"
          themes={themes}
          theme={filters.theme}
          sector={filters.sector}
        >
          <div>
            <label htmlFor="from" className="block text-sm font-medium">
              Announced from
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="to" className="block text-sm font-medium">
              Announced to
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={filters.to}
              className={inputClass}
            />
          </div>
        </ThemeSelect>
      </div>

      <div className="mt-8 space-y-8">
        <AcquisitionsSummary summary={summary} />
        <section aria-label="Acquisitions">
          <p className="mb-3 text-sm tabular-nums text-quiet" role="status">
            {all.length === 1 ? "1 acquisition" : `${all.length} acquisitions`}
          </p>
          <AcquisitionsTable rows={rows} filtered={filtered} />
          <AcquisitionsPager
            page={page}
            pageSize={PAGE_SIZE}
            total={all.length}
            hrefFor={(target) => {
              const q = query(filters, target);
              return q ? `/acquisitions?${q}` : "/acquisitions";
            }}
          />
        </section>
      </div>
    </main>
  );
}
