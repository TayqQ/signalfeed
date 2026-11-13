# 029 Targeting filter model

- **Tier:** 2 (a clear extension of an existing, tested module). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 025, 026. **Wave:** 2.

## Goal
Extend `src/lib/funding-filters.ts` with the Phase 2 parameters and make it a stable, versioned, canonical filter model that Phase 4 saved searches and alerts can reuse unchanged.

## Why it matters
Paid users will save searches and get alerts. If the same search can serialise in two ways, or an old URL changes meaning, alerts break. Fixing that now costs little.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 9.2 and 9.3)
- `docs/decisions.md` (D24, D41)
- `src/lib/funding-filters.ts`, `src/lib/funding-filters.test.ts`
- `src/core/read-models.ts`, `src/core/sectors.ts`
- `src/lib/geo/uk-regions.ts`, `src/lib/geo/uk-places.ts`, `src/lib/size-bands.ts`, `src/lib/format.ts`

## Files you may create or change
- `src/lib/funding-filters.ts`, `src/lib/funding-filters.test.ts`
- `src/lib/filter-summary.ts`, `src/lib/filter-summary.test.ts` (new)

## Steps
1. **Parse** the new parameters in spec section 9.2: `theme`, `sector`, `ukregion`, `city` (lower-cased, trimmed, at most 80 characters, at most 10 values), `near` (must be a known UK place slug), `km` (one of `NEAR_RADII_KM`, otherwise the default; ignored without `near`), `momentum`. Invalid values are dropped, as in Phase 1.
2. **Split** into `parseFundingCriteria(params)` and `parseFundingView(params)`. `parseFundingFilters` returns both merged, so Phase 1 callers keep working.
3. **Canonical serialisation.** `serialiseFundingCriteria(criteria)` uses a fixed key order (`q`, `round`, `size`, `min`, `max`, `from`, `to`, `region`, `country`, `ukregion`, `city`, `near`, `km`, `sector`, `theme`, `tag`, `investor`, `momentum`), sorts and de-duplicates multi values, and omits defaults. `serialiseFundingFilters` is criteria then view.
4. **Version.** Export `FUNDING_CRITERIA_VERSION = 2`, with a comment on what each version changed (2: grants excluded by default, targeting parameters).
5. **Grants default.** Add `effectiveRoundTypes(criteria)`: the selected round types, or every type except `grant` when none are selected. Queries (Task 037) use it.
6. **`filter-summary.ts`:** `describeFundingCriteria(criteria, names)` produces one plain-English sentence, where `names` resolves theme and place slugs to names. Examples:
   - "Seed and grant rounds under £1M, within 25 km of Leeds, in health and life sciences, since 1 June 2026";
   - "All funding rounds, excluding grants" when nothing is set.

## Tests and acceptance criteria
- `pnpm check` passes.
- Round-trip: for a table of at least 15 criteria objects, `parseFundingCriteria(serialiseFundingCriteria(c))` deep-equals `c`.
- Idempotence: serialising, parsing and serialising again gives the same string. The same criteria with values in a different order give the same string.
- Every Phase 1 test URL still parses to the same criteria.
- `km` without `near` is dropped; `near=unknown-place` is dropped; `km=30` falls back to 25.
- `effectiveRoundTypes({})` excludes `grant`; with `round=grant` it is exactly `["grant"]`.
- `describeFundingCriteria` matches the examples above.

## Out of scope
- SQL (037), the filter form (042), saving searches (Phase 4).
