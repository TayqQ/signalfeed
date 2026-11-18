# 076 Row fields, funding summary and company preview queries

- **Tier:** 2 (query changes on the live read path). **Suggested model:** Claude Sonnet.
- **Depends on:** 074. **Wave:** UX 1 (parallel with 075).

## Goal
Give every list view the facts it needs on one row (description, main sector, stage bucket, website domain). Add the two queries the new pages need: the "What's happening" summary and the split-view company preview (`docs/design/design-system.md` section 5).

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 2 and 5
- `docs/design/research.md` section 5 (how a company's main sector is chosen)
- `src/core/read-models.ts` (`FundingRow`, the company detail types)
- `src/core/sectors.ts`
- `src/db/queries/funding.ts` (`fundingColumns`, `toFundingRow`, `listFundingRounds`) and `src/db/queries/companies.ts` (`getCompanyDetail`)
- `src/lib/funding-filters.ts` (how filters become SQL)
- `src/lib/cached.ts`

## Files you may create or change
- `src/core/read-models.ts`: add fields to `FundingRow`, and the new `FundingSummary` and `CompanyPreview` types.
- `src/db/queries/funding.ts`, `src/db/queries/funding.test.ts`
- `src/db/queries/companies.ts`, `src/db/queries/companies.test.ts`
- `src/db/queries/summary.ts`, `src/db/queries/summary.test.ts` (new)
- `src/lib/main-sector.ts`, `src/lib/main-sector.test.ts` (new: choosing the main sector, as a pure function)
- `src/lib/cached.ts`: cache wrappers for the new queries only.
- `src/db/seed-data.ts`: only if the seed lacks a description or sector needed by the tests.
- `docs/tasks/README.md` (the 076 row only)

## Steps
1. **Row fields.** Add these to `FundingRow`:
   - `companyDescription: string | null`;
   - `mainSector: SectorKey | null`;
   - `websiteDomain: string | null`.

   The stage colour bucket is not a row field. Task 075 owns `stageBucket(roundType)` in `src/lib/stage.ts`, and views call it at render time.

   Fill the fields in `fundingColumns` and `toFundingRow` without adding a query per row. Join or aggregate in the same statement, and check the query plan stays index-friendly.
2. **Main sector.** As a pure, tested function:
   - first, the sector of the company's strongest theme (the most events tagged with it, ties broken by theme id);
   - otherwise, the Companies House SIC sector;
   - otherwise null.

   Never `other` by default: null displays as "Sector pending".
3. **`getFundingSummary(filters)`.** Compute it from the same filtered set as `listFundingRounds`, ignoring paging:
   - `totalGbpMinor`, `count` and `medianGbpMinor`, ignoring nulls for money;
   - the same three figures for the previous window of equal length (null when the filter has no date window);
   - `sectors`: `{ sector | null, gbpMinor, count }[]` sorted by GBP;
   - `biggest`: the top 3 rows by GBP.

   Use one or two SQL statements with `percentile_cont` for the median.
4. **`getCompanyPreview(slug)`.** Return the header facts, the key facts, the latest round with its leads and confirmation, the registry summary (number, status, size, incorporation date) and the inputs for the signals: confirmed, days since the last round, first recorded round, number of sources. Reuse `getCompanyDetail` parts where you can, but keep the preview light: no full history, no sources list.
5. **Caching.** Wrap both new queries the same way the existing page queries are wrapped in `cached.ts`.

## Tests and acceptance criteria
- The unit tests for `main-sector` cover: a theme, no theme but SIC, neither, and a tie.
- The query tests run against the test database setup the repo already uses:
  - the new row fields;
  - the summary over a seeded window, including the median with an odd and an even count, nulls ignored, the previous window, and the sector order;
  - the preview for a confirmed company and for a company with no registry link.
- The existing funding and company tests stay green. `pnpm check` and `pnpm build` pass.

## Out of scope
- Any UI change.
- Filling `websiteDomain` (Phase 3.5).
- Any commit.
