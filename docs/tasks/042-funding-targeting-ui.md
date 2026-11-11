# 042 Funding page targeting filters and company momentum

- **Tier:** 2 (extending existing pages with specified filters). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 029, 030, 037. **Wave:** 4.

## Goal
Add the targeting filters and a momentum column to the funding table, and show themes, location and momentum on company pages.

## Why it matters
This is the page a future paying user would live on. It must make small, local, recent, sector-specific searches easy, and say plainly what it cannot know.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 8.3, 9, 12)
- `src/app/page.tsx`, `src/components/funding-filters-form.tsx`, `src/components/funding-table.tsx`, `src/components/funding-table.test.tsx`
- `src/app/companies/[slug]/page.tsx`, `src/components/event-timeline.tsx`
- `src/lib/funding-filters.ts`, `src/lib/filter-summary.ts`, `src/lib/geo/uk-regions.ts`, `src/lib/geo/uk-places.ts`, `src/core/sectors.ts`

## Files you may create or change
- `src/app/page.tsx`
- `src/components/funding-filters-form.tsx`
- `src/components/funding-table.tsx`, `src/components/funding-table.test.tsx`
- `src/app/companies/[slug]/page.tsx`
- `src/components/company-momentum.tsx`, `src/components/company-momentum.test.tsx` (new)
- `src/components/company-location.tsx` (new)

## Steps
1. **Filters form** (still a plain GET form): a "Where" group (UK region checkboxes, a town text field with a `<datalist>` of UK place names, a "Near" place select with radius 10/25/50/100 km); a "What" group (sector checkboxes, theme select); round types with "Grant" unchecked by default and a hint "Grants come from UKRI Gateway to Research"; size bands; "First recorded round only" and "Raised again within 24 months" (the `momentum` values). Every control is labelled.
2. **Heading:** when any criteria are set, show `describeFundingCriteria` as the results heading. Also show "N companies in these results have no known town, so they are not included in distance searches" when `near` is set (count from the query or a small extra count query, at most one).
3. **Table:** a "Momentum" column: "First recorded round", or "Round 3 · 7 months after the last · 5.3×". Grant rows show a "Grant" badge and "Source: UKRI". Sort links keep every new parameter.
4. **Company page:** themes (linked) with sectors; location ("Leeds, Yorkshire and The Humber", or "Scotland" for region only, or "Postcode district L35" for grants); a momentum summary ("3 rounds in the last 24 months; the latest was 5.3× the March 2025 round, 7 months after the previous one"); per round in the timeline, the same facts; and "First round we have recorded. History starts in November 2026" where relevant.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL`.
- Table tests: the momentum text for first, repeat and null step-up; the grant badge; sort links carrying `near`, `km`, `sector` and `theme`.
- Momentum component tests use the spec's example company.
- Manual check on seed data: `/?near=leeds&km=25&round=grant&round=seed` returns the expected seeded rows; the form round-trips every value; usable at 360 px without JavaScript.

## Out of scope
- New query logic (037), saved searches (Phase 4).
