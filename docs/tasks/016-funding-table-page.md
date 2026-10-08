# 016 Funding table page and site layout

- **Tier:** 2 (a page with filter logic against fixed queries). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 013. **Wave:** 5.

## Goal
Build the site layout (header, footer, navigation) and the home page: a filterable, sortable, paginated funding table driven entirely by URL search parameters.

## Why it matters
This is the main view, and the first thing employers and users see. Filters held in the URL make every view shareable and keep the page server-rendered.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 9)
- `docs/decisions.md` (D16, D18, D24)
- `src/core/read-models.ts`, `src/core/enums.ts`
- `src/db/queries/funding.ts`, `src/db/web.ts`, `src/db/seed-data.ts`
- `src/lib/cached.ts`, `src/lib/funding-filters.ts`, `src/lib/format.ts`, `src/lib/regions.ts`
- `src/app/layout.tsx`, `src/app/globals.css`

## Files you may create or change
- `src/app/layout.tsx`, `src/app/globals.css`
- `src/app/page.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`
- `src/components/site-header.tsx`, `src/components/site-footer.tsx`
- `src/components/funding-table.tsx`, `src/components/funding-table.test.tsx`
- `src/components/funding-filters-form.tsx`
- `src/components/pagination.tsx`

## Requirements
- **Header:** the site name links to `/`, plus nav links Funding (`/`), About (`/about`) and Status (`/status`). **Footer:** "Data from public news feeds; headlines link to original articles", an AGPL-3.0 link and a GitHub repo link (placeholder constant).
- **`page.tsx`:** a server component that reads `searchParams`, then calls `parseFundingFilters`, then `cached(() => listFundingRounds(getWebDb(), filters), ...)`. Set `export const dynamic = 'force-dynamic'` (or the installed version's equivalent) so the build doesn't touch the database.
- **Table:** shows company (linked to `/companies/[slug]`), location (city and country), round, amount (GBP compact, with the original currency underneath when it differs), lead investors (linked to `/investors/[slug]`), date and number of sources. Sortable column headers are links that toggle `sort`/`dir`.
- **Filters form:** a plain HTML `<form method="get">` so it works without JavaScript. Fields: search, round type (multi-select checkboxes), region select, tag text, from/to dates, min/max GBP. Include a reset link. Every input has a label.
- **Pagination:** previous/next links and "Page X of Y".
- **Empty state:** "No rounds match these filters" plus the reset link.
- Use Tailwind with a simple, accessible design: readable at 360 px width (the table scrolls horizontally), visible focus states, semantic `<table>` with `<th scope>`.
- **`error.tsx`:** a friendly message with no stack traces.

## Acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL` set.
- `funding-table.test.tsx` renders rows from seed-like props and asserts: GBP shown with the original when it differs, links to company and investor pages, the empty state, and sort links carrying the current filters.
- Manual check: `pnpm db:seed` against a local Postgres, then `pnpm dev`. Filtering by region and round type works, and search results are ordered by relevance.

## Out of scope
- Company/investor pages (017), about/status pages (018), charts (Phase 2), client-side JavaScript filtering.
