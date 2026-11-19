# 073 Website link and favicon on company pages (with the UX overhaul)

- **Tier:** 1. **Suggested model:** Claude Sonnet.
- **Depends on:** 071, and the overhaul's design system. **Wave:** the overhaul.

## Goal
Show the verified website link on company pages and the favicon wherever the company name appears, using the overhaul's components.

## Files you may create or change
- `src/db/queries/**` (add `websiteDomain` and the favicon to company read models)
- `src/app/**`, `src/components/**` (as the overhaul's page tasks allow)
- `src/app/api/favicon/[companyId]/route.ts` (new, only if decision 12.2 is a cached copy)

## Steps
1. Show the link as `rel="noopener nofollow"` with the bare domain as text. Show nothing for candidate or rejected rows.
2. Favicons follow maintainer decision 12.2. With no favicon, use the overhaul's monogram fallback.

## Tests and acceptance criteria
- Query tests cover linked, candidate and none.
- Checked in the browser at 375 px and on desktop.
