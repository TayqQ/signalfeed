# 078 Filter bar

- **Tier:** 3 (replaces a 400-line form behind URLs people may have saved; mistakes show up as wrong results). **Suggested model:** Claude Opus.
- **Depends on:** 075. **Wave:** UX 2 (parallel with 077).

## Goal
Replace the checkbox sidebar with the short filter bar from `docs/design/research.md` section 2 and `docs/design/design-system.md` section 2:
- search;
- the sector chip row, with themes as a second level;
- Stage;
- amount presets;
- date presets;
- one place box;
- "Confirmed only";
- "More filters";
- removable chips for every applied value.

Every existing URL keeps its meaning.

## Read first
- `AGENTS.md`
- `docs/design/research.md` section 2 (the audit table is the spec for each control)
- `docs/design/design-system.md` sections 2 and 6
- `src/lib/funding-filters.ts` and its tests (parsing, defaults, D44 grants rule)
- `src/lib/filter-summary.ts`
- `src/components/funding-filters-form.tsx` and its test
- `src/components/theme-select.tsx`
- `src/lib/regions.ts`, `src/lib/location.ts`, `src/lib/size-bands.ts`

## Files you may create or change
- `src/components/filters/*.tsx` and tests (new: `FilterBar`, `SectorChips`, `PlaceBox`, `MoreFilters`, `AppliedChips`)
- `src/components/funding-filters-form.tsx` and its test (retire it once `FilterBar` replaces it; delete it when nothing imports it)
- `src/components/theme-select.tsx` and its test
- `src/lib/funding-filters.ts` and its test: **additive only**. New preset helpers, chip descriptions, and `country` as a visible filter. No change to how existing parameters parse.
- `src/lib/filter-summary.ts` and its test
- `src/app/page.tsx`: only to swap the form for `FilterBar` in the existing layout. 079 does the page layout.
- `docs/tasks/README.md` (the 078 row only)

## Steps
1. **One control per parameter**, as in the audit table:
   - Sector: chips, multi-select. Theme: a searchable list of the chosen sector's themes, with counts.
   - Stage: a segmented control with Pre-seed/Seed, Series A, Series B+, Debt, and grants behind "More".
   - Amount: presets from the size bands; a custom range in "More".
   - Date: presets for 7, 30 and 90 days and this year; a custom range in "More".
   - Place: one combobox for UK region, town and country, plus "Within N km of" inside it.
   - "Confirmed only": a toggle.
   - In "More": company size (plain-word labels from the table), momentum (renamed per the table), investor (typeahead) and custom ranges.
2. **Applied chips.** Every applied value shows as a chip, including ones that only arrive by URL (`region`, `country`, `tag`, `investor`). Each chip is a link that removes its value. Show "Clear all" when two or more are applied.
3. **No-JavaScript first.** Everything is a GET form that works with JavaScript off. With JavaScript, apply on change (debounce search by 300 ms) and keep the URL in sync with `router.replace`, without adding history entries for each keystroke.
4. **Phones (under 768 px).** The bar collapses to search plus "Filters (n)", which opens a `Sheet` holding every control, with "Clear" and "Show N results".
5. **Old links.** A test lists at least 15 real-looking old URLs (every parameter, plus combinations) and checks they parse to the same filters as before and show as the right chips.

## Tests and acceptance criteria
- The old-URL equivalence test (step 5).
- The chip removal links give the expected URL.
- Keyboard: `/` focuses search; the segmented control works with arrow keys; the sheet traps focus and closes on Escape.
- With JavaScript disabled, the form submits and filters (tested with the rendered HTML).
- `pnpm check` and `pnpm build` pass. Screenshots at 375 and 1280 px, light and dark.

## Out of scope
- The summary, quick views and list views (079).
- Changing what any filter means in SQL.
- Any commit.
