# 040 Trends and theme pages

- **Tier:** 2 (pages on fixed queries and components). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 030, 036, 037. **Wave:** 4.

## Goal
Build `/trends`, `/themes` and `/themes/[slug]`, and add the new sections to the site navigation.

## Why it matters
These pages answer the founder's main questions: which themes are rising, where early momentum is, and what a theme looks like over time.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 7.2, 8.1, 8.2, 12)
- `src/core/read-models.ts`
- `src/db/queries/themes.ts`, `src/db/queries/trends.ts`, `src/db/queries/funding.ts`, `src/db/queries/investor-activity.ts`, `src/db/queries/acquisitions.ts`
- `src/components/charts/*.tsx`, `src/components/funding-table.tsx`
- `src/lib/cached.ts`, `src/lib/rising-score.ts`, `src/app/page.tsx` (patterns)

## Files you may create or change
- `src/app/trends/page.tsx` (new)
- `src/app/themes/page.tsx`, `src/app/themes/[slug]/page.tsx` (new)
- `src/components/rising-themes-table.tsx`, `src/components/rising-themes-table.test.tsx` (new)
- `src/components/early-momentum-table.tsx` (new)
- `src/components/theme-header.tsx`, `src/components/theme-header.test.tsx` (new)
- `src/components/theme-leaders.tsx` (new)
- `src/components/site-header.tsx`

## Steps
1. **Nav:** Funding, Trends, Acquisitions, Investors, About, Status.
2. **`/trends`:** the rising table (theme link, sector, recent rounds, score with `describeScore`, recent GBP, sparkline), then the early-momentum table (recent early rounds, score, late share as a percentage). When `notEnoughHistory`, show "Trends need at least 16 weeks of data. Collection started on …" in place of scores, and still show recent counts. A short "How the score works" paragraph links to `/about#rising-score`.
3. **`/themes`:** active themes grouped by sector, each with company count; themes with fewer than 3 companies are listed but marked "few companies".
4. **`/themes/[slug]`:** name (with "Suggested name" if not reviewed), sector, tags; a 52-week stacked column chart (early, later, unknown stage) with a caption stating the main change; stage mix; the 10 most recent rounds (reuse `FundingTable` with a `theme` filter and a link to the full filtered table on `/`); the top 5 first-cheque leaders and the 5 latest acquisitions, each linking to `/investors?theme=…` and `/acquisitions?theme=…`. Merged slugs redirect with `permanentRedirect`; unknown slugs give a 404.
5. All reads go through `cached` with every input in the key. `dynamic = 'force-dynamic'` (or the installed equivalent), so the build needs no database.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL`.
- Component tests:
  - the rising table orders rows as given and shows the "not enough history" state;
  - scores have a text label, not only colour;
  - the theme header shows "Suggested name" for unreviewed themes.
- Manual check on seed data (`pnpm db:seed`, `pnpm dev`): every page renders, charts have captions and data tables, keyboard focus is visible, and the pages are usable at 360 px.

## Out of scope
- `/acquisitions` and `/investors` (041), filters on `/` (042).
