# 041 Acquisitions and investor activity pages

- **Tier:** 2 (pages on fixed queries and components). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 030, 036. **Wave:** 4.

## Goal
Build `/acquisitions` and the investor activity index at `/investors`.

## Why it matters
They answer "who buys young startups, and how old were they?" and "who leads first cheques in this theme?"

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 8.4, 8.5, 12)
- `src/core/read-models.ts`, `src/core/sectors.ts`
- `src/db/queries/acquisitions.ts`, `src/db/queries/investor-activity.ts`, `src/db/queries/themes.ts`
- `src/components/charts/bar-chart.tsx`, `src/components/pagination.tsx`, `src/lib/format.ts`, `src/lib/cached.ts`

## Files you may create or change
- `src/app/acquisitions/page.tsx` (new)
- `src/app/investors/page.tsx` (new; `src/app/investors/[slug]/page.tsx` is unchanged)
- `src/components/acquisitions-table.tsx`, `src/components/acquisitions-table.test.tsx` (new)
- `src/components/investor-activity-table.tsx`, `src/components/investor-activity-table.test.tsx` (new)
- `src/components/theme-select.tsx` (new; a plain GET form with theme and sector selects)

## Steps
1. **`/acquisitions`:** filters `theme`, `sector`, `from`, `to`, `page` in the URL (validated with Zod in the page; invalid values dropped). A table of target (linked), acquirer (linked when resolved, raw name otherwise), price in GBP if known, date (with "Around" for month precision), and target age or "unknown". Above it, a bar chart of top acquirers by count and a line such as "Median target age 6 years (age known for 4 of 19)". With fewer than 3 known ages, say so instead of a median.
2. **`/investors`:** theme or sector select (default all themes), window of 12 months. Table: investor (linked to `/investors/[slug]`), led, joined, median round size and coverage ("3 of 4 with amounts"). A note says individual cheque sizes are rarely reported, so round size is shown.
3. Empty states for both, with a link to reset filters. Every input has a label; the forms work without JavaScript.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL`.
- Component tests: "Around" for month precision; unknown age text; the raw acquirer name when unresolved; median and coverage text; empty states.
- Manual check on seed data at 360 px and with the keyboard.

## Out of scope
- Theme and trends pages (040), the existing investor detail page.
