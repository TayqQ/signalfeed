# 017 Company and investor pages

- **Tier:** 2 (pages with logic against fixed queries). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 013. **Wave:** 5.

## Goal
Build `/companies/[slug]` and `/investors/[slug]`, with event timelines, tags, investors and source attribution.

## Why it matters
Company pages show the result of entity merging: one company, one timeline, many sources. Each fact links back to its original article, which is how users can trust the data.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 9)
- `docs/decisions.md` (D19)
- `src/core/read-models.ts`, `src/core/enums.ts`
- `src/db/queries/companies.ts`, `src/db/queries/investors.ts`, `src/db/web.ts`
- `src/lib/cached.ts`, `src/lib/format.ts`, `src/lib/regions.ts`

## Files you may create or change
- `src/app/companies/[slug]/page.tsx`
- `src/app/investors/[slug]/page.tsx`
- `src/components/event-timeline.tsx`, `src/components/event-timeline.test.tsx`
- `src/components/source-list.tsx`
- `src/components/tag-list.tsx`
- `src/components/investor-list.tsx`

## Requirements
- **Company page:**
  - `notFound()` for unknown slugs; `permanentRedirect` to `redirectToSlug` for merged companies;
  - header with name, location (city, country, region), founded year, status badge, description and website domain (as a link, if known);
  - tags link to `/?tag=<slug>`;
  - the timeline shows funding rounds (round, amount in GBP plus the original, investors with lead marked), acquisitions (acquirer linked if resolved, price) and launches (product name, link);
  - each event lists its sources as "Headline — Source name, date", linking to the article with `rel="noopener"`;
  - `generateMetadata` gives the title "<Company> funding history | SignalFeed" and a description.
- **Investor page:** name, kind, a count by round type, and a funding table of the rounds it joined (lead or participant). Reuse a simple table here; don't import `funding-table.tsx`, which Task 016 owns.
- Never render summaries or article text. Only titles and links are available, and only those should appear.
- Pages are dynamic and use `cached(...)`. The build doesn't touch the database.

## Acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL`.
- `event-timeline.test.tsx` covers: a funding event with a lead marked and two sources, an acquisition with a linked acquirer, a launch, and events in date order.
- Manual check with seed data: a merged company's slug redirects; an unknown slug returns 404.

## Out of scope
- Site layout and nav (016), editing data, charts.
