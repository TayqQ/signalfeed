# 054 Companies House API client

- **Tier:** 2 (an API client with clear rules and a rate limiter). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 048, 049. **Wave:** 2.

## Goal
A typed Companies House client over `HttpFetcher` that searches companies, fetches profiles, capital filings and postcode counts, keeps under the rate limit, and returns the normalised types from `src/core/registry.ts`.

## Why it matters
The API allows 600 requests in five minutes, and Companies House may ban applications that keep exceeding it (A31). One careful client keeps every caller inside the limit and turns raw JSON into the facts the link rules use.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 6, 7.1, 7.3, A31-A38)
- `docs/sources.md` ("Phase 3 sources", as updated by 049)
- `fixtures/companies-house/README.md` and its fixtures
- `src/core/ports.ts` (`HttpFetcher`, `Clock`), `src/lib/http.ts`
- `src/core/registry.ts` (from 048)
- `src/pipeline/grants/gtr-client.ts` (the adapter pattern)

## Files you may create or change
- `src/pipeline/registry/ch-schemas.ts` (new; Zod)
- `src/pipeline/registry/ch-client.ts`, `src/pipeline/registry/ch-client.test.ts` (new)
- `src/pipeline/registry/rate-limit.ts`, `src/pipeline/registry/rate-limit.test.ts` (new)
- `src/pipeline/registry/testing.ts` (new: a fake `ChClient` built from fixtures, for 056 and 062)

## Steps
1. **Schemas.** Zod schemas for the fields used, from the 049 fixtures. Unknown keys are allowed and ignored. Officer, PSC and person links are never read.
2. **`rate-limit.ts`:** a sliding-window limiter, `createWindowLimiter({ max: 500, windowMs: 300_000, clock, sleep })`, whose `take()` waits until a request fits. Injectable clock and sleep.
3. **`ch-client.ts`:** `createChClient({ http, apiKey, limiter, sleep })` with:
   - `searchCompanies(name)`: `/search/companies?q=...&items_per_page=50`;
   - `getCompany(number)`: `/company/{number}`, returning `RegistryCompanyFacts` (office outcode via `parseUkPostcode`) or null on 404;
   - `getCapitalFilings(number, { since })`: `/company/{number}/filing-history?category=capital&items_per_page=100`, SH01 only, newest first, stopping at `since`. If 049 found that allotment dates are only on single items, fetch each SH01 item, and say so in the code comment;
   - `countActiveAtPostcode(postcode)`: the advanced search count (A37), or null if 049 found it unusable;
   - every request sends `Authorization: Basic base64(key + ":")` and `Accept: application/json`, and calls `limiter.take()` first;
   - **429:** wait until the current five-minute window ends, then retry once; a second 429 throws `RateLimitedError`, so the step stops cleanly;
   - 5xx: the fetcher already retries; then throw;
   - a request counter (`requestsMade()`) for the step's request limit.
   - The base URL is one constant. The key never appears in logs, errors or thrown messages.

## Tests and acceptance criteria
- `pnpm check` passes. Fixtures through a fake `HttpFetcher`; no network.
- Parsing accepts every 049 fixture, ignores unknown fields, and maps profile, filings and search items to the core types; dates stay `YYYY-MM-DD`.
- The limiter never allows more than 500 requests in any five-minute window (fake clock, 1,200 calls).
- A 429 waits for the window and retries once; two in a row throw `RateLimitedError`.
- The `Authorization` header is correct, and a thrown error's message does not contain the key.
- No request path contains `officers`, `persons-with-significant-control` or `charges` (asserted on the fake fetcher's URLs).

## Out of scope
- Deciding links (053) and storing anything (056).
