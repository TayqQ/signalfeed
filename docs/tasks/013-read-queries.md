# 013 Read queries and seed data

- **Tier:** 2 (query functions against a fixed schema and read models). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 004, 005. **Wave:** 4.

## Goal
Implement the read-only queries behind every page, URL filter parsing, the cached data wrapper, and a seed script with fictional data for local development and screenshots.

## Why it matters
Pages in Wave 5 build only against these functions. Correct sorting matters especially: a previous version sorted by date first, so relevance had no effect.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 5 and 9)
- `docs/decisions.md` (D16, D18, D24)
- `src/core/read-models.ts`, `src/core/enums.ts`, `src/core/env.ts`
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`
- `src/lib/regions.ts`

## Files you may create or change
- `src/db/queries/funding.ts`
- `src/db/queries/companies.ts`
- `src/db/queries/investors.ts`
- `src/db/queries/status.ts`
- `src/db/queries/queries.test.ts`
- `src/db/web.ts`
- `src/lib/cached.ts`
- `src/lib/funding-filters.ts`, `src/lib/funding-filters.test.ts`
- `src/db/seed.ts`, `src/db/seed-data.ts`

## Requirements
- **`funding.ts`:** `listFundingRounds(db, filters: FundingFilters): Promise<Page<FundingRow>>`.
  - Excludes merged companies.
  - Supports every filter in `FundingFilters`. Region filters map to country lists via `regions.ts`.
  - Default sort: `announced` descending.
  - If `q` is set and `sort` is unset, order by `greatest(similarity(normalised_name, q), similarity over aliases)` descending, then `announced_on` descending. Require similarity ≥ 0.2 or an `ILIKE` substring match.
  - `amount` sort uses `amount_gbp_minor` with nulls last.
  - Stable tie-breaker: `events.id`.
  - Page size 25, capped at 100.
- **`companies.ts`:** `getCompanyDetail(db, slug): Promise<CompanyDetail | null>`. For a merged company it returns `redirectToSlug`. Events are newest first, each with its sources (title, url, source name, published date). It never selects `source_item_texts`.
- **`investors.ts`:** `getInvestorDetail(db, slug)`.
- **`status.ts`:** `getStatusSummary(db)`. `capGbp` comes from the latest run's `stats`.
- **`web.ts`:** `import 'server-only'`, then `getWebDb()`, a lazy singleton built from `parseWebEnv(process.env)`.
- **`cached.ts`:** `cached(fn, keyParts, { revalidateSeconds = 600 })`, wrapping the installed Next.js data-cache API (`unstable_cache` or `"use cache"`; follow the installed version's docs). Pages call `cached(...)` around query functions.
- **`funding-filters.ts`:** `parseFundingFilters(searchParams)` uses Zod to validate and coerce, dropping invalid values silently and converting `min`/`max` from GBP to minor units. `serialiseFundingFilters(filters)` builds a query string.
- **`seed.ts` / `seed-data.ts`:** `pnpm db:seed` inserts about 40 **fictional** companies (names like "Northwind Robotics"), about 60 funding rounds across regions, currencies and round types, plus 5 acquisitions, 5 launches, about 15 investors, source items with example.com URLs, 3 ingest runs and some `llm_usage` rows. It refuses to run unless `DATABASE_URL` contains `localhost` or `--force` is passed. Export `seedDatabase(db)` so tests can reuse it.

## Acceptance criteria
- `pnpm check` passes.
- `queries.test.ts` (PGlite plus `seedDatabase`) proves:
  - each filter narrows results;
  - **relevance sort puts the closest name first even when it is the oldest round**;
  - an explicit `sort=announced` ignores relevance;
  - amount sort puts nulls last;
  - pagination totals are right;
  - merged companies are excluded and their detail returns `redirectToSlug`;
  - company detail returns events with sources;
  - the status summary sums the current month's spend.
- `funding-filters.test.ts` round-trips filters and drops invalid values.

## Out of scope
- Page components (016-018), write paths.
