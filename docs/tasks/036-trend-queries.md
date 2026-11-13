# 036 Trend read queries and seed data

- **Tier:** 2 (fixed queries against fixed tables). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 027, 028. **Wave:** 3.

## Goal
Write the read queries behind `/trends`, `/themes`, `/themes/[slug]`, `/acquisitions` and `/investors`, and extend the seed data so pages can be built and checked locally.

## Why it matters
Pages stay thin and testable when the queries return finished read models. Seed data lets page tasks and reviewers see realistic output without real extraction.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 8, 12)
- `src/core/read-models.ts`, `src/core/sectors.ts`
- `src/db/schema.ts`, `src/db/queries/funding.ts` (style), `src/db/seed-data.ts`, `src/db/seed.ts`
- `src/lib/weeks.ts`, `src/lib/rising-score.ts`, `src/lib/trend-stats.ts`

## Files you may create or change
- `src/db/queries/themes.ts`, `src/db/queries/themes.test.ts` (new)
- `src/db/queries/trends.ts`, `src/db/queries/trends.test.ts` (new)
- `src/db/queries/acquisitions.ts`, `src/db/queries/acquisitions.test.ts` (new)
- `src/db/queries/investor-activity.ts`, `src/db/queries/investor-activity.test.ts` (new)
- `src/db/seed-data.ts`, `src/db/seed.ts`

## Steps
1. **`themes.ts`:** `listThemes(db, { sector? })` (active themes with company and tag counts, A-Z within sector), `getThemeDetail(db, slug, { now })` (summary, top tags, 52 weekly points with zero weeks filled in, stage mix, `redirectToSlug` for merged themes), and `resolveThemeSlugs(db, slugs)`.
2. **`trends.ts`:** `listRisingThemes(db, { now })` reads `theme_weekly_stats` and `weekly_totals` for the windows from `windows()`, computes scores with `risingScore`, and returns ranked rows with a 26-week sparkline. `listEarlyMomentum(db, { now })` does the same for early rounds and late share. Both return `{ rows, notEnoughHistory: boolean, firstWeek }`. Themes with fewer than 3 companies are excluded.
3. **`acquisitions.ts`:** `listAcquisitions(db, { theme?, sector?, from?, to?, page })` with target age via `targetAge`; `acquirersByTheme(db, { theme?, sector? })` with counts, median age and age coverage.
4. **`investor-activity.ts`:** `listInvestorActivity(db, { theme?, sector?, months = 12, now })`, following spec section 8.5: early rounds only, `led` and `joined` counts, median round size of known amounts, at least 2 rounds, ordered as specified.
5. **Seed data:** add 6 themes across 4 sectors with tags and links, 30 weeks of events (so the rising score has history), an early-momentum theme, acquisitions with and without founded years, a merged theme, 5 grant events with `evidence = confirmed`, and locations for 10 companies (UK towns, a region-only company, and a non-UK city). Insert the derived rows (`company_themes`, `theme_weekly_stats`, `weekly_totals`, `funding_round_momentum`, `company_locations`) directly, with values that follow the rules in spec section 8. Task 033 runs in the same wave, so `seed.ts` must not import it. A comment notes that Task 043 can later switch the seed to the real rebuild.

## Tests and acceptance criteria
- `pnpm check` passes.
- PGlite tests on seeded data:
  - rising rows match `risingScore` computed by hand for two themes;
  - `notEnoughHistory` is true with only 10 weeks of data;
  - zero weeks appear in weekly points;
  - a merged theme slug returns `redirectToSlug`;
  - target age is null without a founded year, and coverage counts are right;
  - investor activity excludes Series A rounds and investors with one round, and the median ignores unknown amounts;
  - grants never count as rounds in any trend query.
- `pnpm db:seed` still works against a local Postgres.

## Out of scope
- Funding-table and company queries (037), status queries (044), pages (040, 041).
