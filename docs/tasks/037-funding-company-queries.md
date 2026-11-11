# 037 Funding table targeting filters and company momentum queries

- **Tier:** 2 (extending tested queries with specified filters). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 027, 029. **Wave:** 3.

## Goal
Apply the Phase 2 filters in `listFundingRounds`, add momentum to funding rows, and add themes, sectors, location and momentum to company detail.

## Why it matters
This is where the targeting groundwork becomes real results. Filters must match exactly what the URL says, and grants must stay hidden unless asked for.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 8.3, 9)
- `docs/decisions.md` (D24, D39, D41, D44)
- `src/db/queries/funding.ts`, `src/db/queries/companies.ts`, `src/db/queries/queries.test.ts`
- `src/core/read-models.ts`, `src/lib/funding-filters.ts`
- `src/lib/geo/uk-places.ts`, `src/lib/geo/distance.ts`, `src/lib/geo/uk-regions.ts`
- `src/lib/company-momentum.ts`

## Files you may create or change
- `src/db/queries/funding.ts`, `src/db/queries/funding.test.ts` (new)
- `src/db/queries/companies.ts`, `src/db/queries/companies.test.ts` (new)

## Steps
1. **Round types:** use `effectiveRoundTypes(filters)`, so grants are excluded unless selected.
2. **`theme`:** `exists` on `company_themes`, after resolving merged slugs to survivors in one query.
3. **`sector`:** `exists` on `company_themes` joined to `themes.sector`.
4. **`ukregion`:** `company_locations.itl1_code` in the codes for the slugs.
5. **`city`:** for each value, a known UK place slug matches `place_slug`; anything else matches a normalised `companies.city` (lower case, no diacritics; add a small SQL expression mirroring `normalisePlaceName`).
6. **`near`:** look up the place in `uk-places`, prefilter with `boundingBox`, then a haversine expression in SQL ≤ `km`. Only rows with coordinates match.
7. **`momentum`:** `first` means `funding_round_momentum.equity_round_number = 1`; `repeat` means it is above 1 and `months_since_previous` ≤ 24.
8. **Rows:** add `momentum` (left join `funding_round_momentum`, with the basis round's date) and `evidence` to `FundingRow`.
9. **Company detail:** add `themes` (with sector), `sectors` (distinct), `location` from `company_locations` with the place name, `roundsInLast24Months` (counted against `now`, which is passed in, equity rounds only), and `momentum` on each funding event.
10. Keep every Phase 1 behaviour, including relevance sort (D24).

## Tests and acceptance criteria
- `pnpm check` passes, including the existing `queries.test.ts`.
- New PGlite tests:
  - each new filter alone and combined (AND across parameters, OR within one);
  - a grant appears only with `round=grant`;
  - `near=leeds&km=25` includes a Bradford company and excludes a York one (about 35 km), and excludes region-only companies;
  - an unknown city string matches a non-UK company by its normalised city;
  - a merged theme slug still filters;
  - `momentum=first` and `repeat` match the spec's example company correctly;
  - company detail returns themes, location and `roundsInLast24Months = 3` for the spec's example as of 2026-11-11.
- Query count per page stays at two (count and rows); new data comes from joins or subqueries, not extra round trips.

## Out of scope
- The form and table UI (042), trend queries (036).
