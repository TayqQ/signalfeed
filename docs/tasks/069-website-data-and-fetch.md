# 069 Website data model, candidate sources and polite fetcher

- **Tier:** 3 (schema and migration). **Suggested model:** Claude Opus.
- **Depends on:** 068 merged. **Wave:** 3.5-1.

## Goal
Add the Phase 3.5 tables and enums, store the UKRI organisation website, produce candidate domains for a company, and fetch a homepage politely into an in-memory page summary. No decisions yet.

## Read first
- `AGENTS.md`, `docs/spec-phase3.5.md` (sections 4, 5 except search, 6.1, 6.2, 8, A50)
- `src/db/schema.ts`, `drizzle/0003_phase3.sql`, `src/core/enums.ts`
- `src/pipeline/grants/gtr-schemas.ts`, `src/pipeline/grants/` (organisation fetch), `src/lib/http.ts`

## Files you may create or change
- `src/core/enums.ts` (`website_number`, `WEBSITE_RULES`, `WEBSITE_SOURCES` only), `src/core/env.ts`, `src/core/env.test.ts` (`MAX_WEBSITE_FETCHES_PER_RUN` only)
- `src/db/schema.ts`, `drizzle/0004_websites.sql`, `drizzle/meta/**`
- `src/pipeline/grants/` organisation fetch and its test (store `website`; the capped re-fetch of fetched organisations)
- `src/pipeline/websites/candidates.ts`, `src/pipeline/websites/fetch-page.ts`, `src/pipeline/websites/robots.ts`, `src/pipeline/websites/registrable-domain.ts`, plus `.test.ts` for each (new)
- `.env.example`

## Steps
1. Migration 0004, as in spec section 8. Grant the ingest role the same privileges as the Phase 3 tables, and the web role read access.
2. Store `grant_participants.website`, normalised to a registrable domain. Add the one-off re-fetch to the grants step, inside the existing per-run cap, for organisations fetched before this field was stored.
3. `candidates.ts`: sources 1-4 from section 5, deduplicated by registrable domain, in source order, with the source on each.
4. `fetch-page.ts` and `robots.ts`, as in 6.1 and 6.2. Return `{ finalDomain, title, siteName, metaDescription, text, companyNumbers[], parked, faviconUrl, legalPageChecked }`. Nothing is written to the database.
5. A50: a read-only script result in the PR description. Of 100 random fetched UKRI organisations, how many have a website?

## Tests and acceptance criteria
- `pnpm check` and `pnpm test` pass, with fakes only.
- Company number extraction is tested on at least 10 footer variants, including SC and NI numbers and a number not near a cue (ignored).
- A robots disallow means no page fetch.
- The body cap, timeout and redirect cap are each tested.

## Out of scope
- Rules, LLM, search, the pipeline step, UI.
