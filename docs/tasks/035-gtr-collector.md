# 035 UKRI Gateway to Research grants collector

- **Tier:** 2 (an API client with clear rules). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 025, 027. **Wave:** 3.

## Goal
Collect Innovate UK projects and their participating organisations from the GtR API into `grant_projects`, `grant_project_texts` and `grant_participants`, storing organisations only.

## Why it matters
Innovate UK grants reach small UK companies that startup news never covers, with an amount, a date and a postcode. These are the companies the targeting user most wants (spec-phase2 section 10).

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (section 10, A16-A19, A29, A30)
- `docs/decisions.md` (D19, D40)
- `docs/sources.md` ("A16-A19 — UKRI Gateway to Research")
- `src/core/ports.ts` (`HttpFetcher`), `src/lib/http.ts`
- `src/db/schema.ts` (grant tables, `sources`)
- `src/lib/geo/postcode.ts`, `src/lib/geo/uk-regions.ts`

## Files you may create or change
- `src/pipeline/grants/gtr-schemas.ts` (new; Zod)
- `src/pipeline/grants/gtr-client.ts`, `src/pipeline/grants/gtr-client.test.ts` (new)
- `src/pipeline/grants/organisation-rule.ts`, `src/pipeline/grants/organisation-rule.test.ts` (new)
- `src/pipeline/grants/store-grants.ts`, `src/pipeline/grants/store-grants.test.ts` (new)
- `src/pipeline/grants/collect-grants.ts`, `src/pipeline/grants/collect-grants.test.ts` (new)
- `fixtures/gtr/projects-page.json`, `fixtures/gtr/organisation.json`, `fixtures/gtr/README.md` (new)
- `docs/sources.md` (the "A16-A19 — UKRI Gateway to Research" section only, including A29 and A30 results)

## Steps
1. **Re-verify A16-A19** with a few manual requests. Check whether the beta `/api/content/` API now works and whether the legacy API is marked for retirement. Record the result and the date in `docs/sources.md`. If the legacy API is gone, stop and report.
2. **Fixtures.** Save one trimmed projects page (3 projects) and one organisation. Replace every organisation name with an invented one, keep the structure, and delete any person links, abstracts or `potentialImpact` text longer than a sentence (rewrite it in your own words).
3. **`gtr-schemas.ts`:** Zod schemas for the fields used: project id, title, status, `grantCategory`, `leadFunder`, `abstractText`, `participantValues.participant[]` (`organisationId`, `organisationName`, `role`, `grantOffer`, `projectCost`), the `FUND` link `start` and `end` (milliseconds), and organisation `regNumber`, `website` and `addresses.address[]` (`postCode`, `region`, `type`). Unknown keys are allowed and ignored.
4. **`gtr-client.ts`:** an adapter over `HttpFetcher` with `listInnovateUkProjects(page)` (`q=Innovate UK`, `f=pro.lf`, `sf=pro.sd`, `so=D`, `s=100`) and `getOrganisation(id)`. It waits at least 1 second between requests (injectable sleep for tests), sends `Accept: application/json`, and retries once on 429 or 5xx after 10 seconds. The base URL is a constant in this file only, so a move to the new API touches one file.
5. **`organisation-rule.ts`:** `isOrganisation(name, regNumber)` from spec section 10.3. Tested with invented names: "Acme Robotics Ltd", "ACME ROBOTICS LIMITED", "Acme Co-op CIC", "Acme LLP" pass; "University of Example", "Example City Council", "Jane Example" (a made-up person) and "J Example T/A Example Design" fail.
6. **`store-grants.ts`:** upsert the source row (`ukri-gtr`, kind `ukri_gtr`), projects (by `gtr_project_id`), abstracts (cut to 1,500 characters), and participants (by project and organisation). Participants failing the rule are not stored; they are counted. `start_on` and `end_on` come from the fund link. `grant_offer_minor` is pounds × 100, rounded. Update rows when GtR values change; never delete.
7. **`collect-grants.ts`:** `collectGrantsStep({ db, gtr, since?, maxPages = 30, maxOrgFetches = 1500 })` walks pages newest first and stops after 3 pages with no unseen project, at `maxPages`, or once project start dates fall before `since`. Then it fetches organisations for participants with `org_fetched_at IS NULL`, stores `reg_number`, the main address's postcode, outcode (via `parseUkPostcode`) and region text, and sets `org_fetched_at`. Returns `GrantCollectStats`.
8. **Measure A29 and A30** with one real run against a local database (`--since 2026-06-01`, `--max-pages 5`) and record counts in `docs/sources.md`: projects, participants kept, participants skipped, share with a postcode.

## Tests and acceptance criteria
- `pnpm check` passes. Tests use the fixtures through a fake `HttpFetcher`; no network.
- Parsing accepts the fixtures and rejects a page without `project`.
- Collect (PGlite):
  - inserts projects, texts and organisation participants;
  - skips non-organisations and counts them;
  - a second run inserts nothing;
  - stops after 3 pages of seen projects;
  - respects `maxOrgFetches`;
  - fetches each organisation once.
- The client waits between requests (fake sleep records the calls) and retries once on 429.
- No person endpoint is ever requested (asserted on the fake fetcher's URLs).

## Out of scope
- Turning participants into companies and events, and tagging (038), wiring and the daily workflow (043).
