# 056 Companies House linking, profiles and capital filings step

- **Tier:** 3 (it writes company numbers and founded years onto real companies). **Suggested model:** Claude Opus.
- **Depends on:** 051, 052, 053, 054. **Wave:** 3.

## Goal
Build the `registry` step: pick companies to search, call the Companies House client, apply the link rules, store profiles, SH01 filings and postcode counts, fill `uk_company_number` and an empty `founded_year`, and keep profiles fresh, all within a request limit.

## Why it matters
This is the most important part of Phase 3 for the paying user (spec-phase3 section 7). Every later Companies House feature (age, sector fallback, location, size, confirmation) reads what this step stores.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 6, 7.2, 7.3, 13.1)
- `docs/decisions.md` (D53, D57, D58)
- `src/pipeline/registry/link-rules.ts`, `link-store.ts`, `ch-client.ts`, `testing.ts` (from 051, 053, 054)
- `src/lib/registry/company-size.ts` (052)
- `src/db/schema.ts` (Phase 3 tables, `companies`, `company_aliases`, `company_locations`, `grant_participants`, `events`, `funding_rounds`)
- `src/pipeline/grants/collect-grants.ts` (step and limit pattern)

## Files you may create or change
- `src/pipeline/registry/store-registry.ts`, `src/pipeline/registry/store-registry.test.ts` (new)
- `src/pipeline/registry/shared-address.ts`, `src/pipeline/registry/shared-address.test.ts` (new)
- `src/pipeline/registry/link-companies.ts`, `src/pipeline/registry/link-companies.test.ts` (new)
- `src/pipeline/registry/refresh-profiles.ts`, `src/pipeline/registry/refresh-profiles.test.ts` (new)
- `src/pipeline/registry/registry-step.ts`, `src/pipeline/registry/registry-step.test.ts` (new)

## Steps
1. **`store-registry.ts`:** upsert `ch_companies` by number (update only when the `etag` changed; always set `fetched_at`), upsert `ch_filings` by `transaction_id`, and `fillFoundedYear(db, companyId, incorporatedOn)`: sets `founded_year` and `founded_year_source = companies_house` only when `founded_year` is null. Never touches `companies.status`, `city` or any other news field.
2. **`shared-address.ts`:** `isSharedAddress(db, client, postcode, now)`: reads `ch_address_counts` (fresh for 180 days) or asks `countActiveAtPostcode`, stores the count, and returns true at 20 or more. If the client says counting is unavailable (A37), use the fallback in spec section 7.3 (3 or more linked companies at the full postcode). Export `SHARED_ADDRESS_THRESHOLD`.
3. **`link-companies.ts`:** `linkCompanies({ db, client, now, maxRequests })`:
   - select eligible companies (spec section 7.2) for which `searchIsDue` is true, grant companies with a `uk_company_number` and no link first, then newest events first;
   - build each company's facts from the database (names and aliases, events, location, grant postcodes);
   - step 0 (trusted grant number), then search names, fetch profiles of exact and up to 3 prefix matches, mark shared office postcodes (so S2 ignores them), fetch capital filings only for the candidates `decideChLink` says need them (filings from 3 years before the earliest event);
   - apply the decision through `link-store` (`recordLink`, `recordCandidate`), store every fetched profile and filing, fill the founded year on link, `recordSearch` with the outcome and fingerprint;
   - stop before `maxRequests` would be exceeded, or on `RateLimitedError`, leaving the rest due for the next run.
4. **`refresh-profiles.ts`:** for linked companies, refresh the profile when older than 90 days, or weekly when the company has an equity round in the last 120 days with no confirmation (spec section 7.3), fetching new capital filings at the same time. After a refresh, re-run the conflict checks; if a conflict now applies to an automatic link, call `demoteAutoLink`. Shares the request limit.
5. **`registry-step.ts`:** `registryStep({ db, client | null, clock, maxRequests, log })` runs link then refresh, returns `RegistryStats`, and returns `{ skipped: true }` without a client (no key). Log lines never include the key or full postcodes.

## Tests and acceptance criteria
- `pnpm check` passes. Fake client from `testing.ts`; PGlite.
- Linking: the worked examples 1-6 of spec section 7.2 end in the same outcomes through the database; a grant `uk_company_number` with a matching name links by `grant_number`; a second run makes no request for companies whose fingerprint is unchanged.
- Founded year: filled when empty with source `companies_house`; a news founded year is left alone.
- Shared address: a postcode with 25 active companies is cached and stops S2; the cache is reused within 180 days.
- Limits: the step never exceeds `maxRequests`; a `RateLimitedError` ends the step with `rateLimited: true` and a successful run status.
- Refresh: a newly dissolved company with a round after its cessation date has its automatic link demoted; a manual link is never demoted.
- No request is made for any officers, PSC or charges path.

## Out of scope
- Confirmations (060), locations and sectors (061), the review CLI (062), wiring and workflows (065).
