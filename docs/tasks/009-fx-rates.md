# 009 FX rates provider

- **Tier:** 1 (a small HTTP client with a fully specified shape). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 003. **Wave:** 3.

## Goal
Implement an `FxProvider` that fetches ECB reference rates for a date from Frankfurter, and returns them EUR-based in the `FxRates` shape.

## Why it matters
Funding amounts arrive in many currencies. Converting at the rate for the announcement date makes USD/GBP comparisons fair and reproducible.

## Read first
- `AGENTS.md`
- `docs/sources.md` (A9 result)
- `docs/spec.md` (section 7 step 6)
- `docs/decisions.md` (D16)
- `src/core/ports.ts`, `src/core/domain.ts`

## Files you may create or change
- `src/pipeline/fx/frankfurter.ts`, `src/pipeline/fx/frankfurter.test.ts`
- `fixtures/fx/*.json` (responses written by hand in the documented format)

## Requirements
- `createFrankfurterProvider({ fetcher: HttpFetcher, baseUrl? })` implements `FxProvider`. `getRates('YYYY-MM-DD')` requests rates with base EUR for that date and returns `{ date: <date the API actually returned>, perEur: { EUR: 1, GBP: ..., USD: ..., ... } }`.
- The API returns the previous business day for weekends and holidays. Keep that returned date.
- Validate the response with Zod. A non-2xx response or a malformed body throws a descriptive error.
- Reject dates in the future and dates before 1999-01-04.

## Acceptance criteria
- `pnpm check` passes.
- Tests, using a fake `HttpFetcher` and the fixtures, prove: a normal day, a weekend returning the Friday date, `EUR: 1` always present, a malformed body throwing, and a future date being rejected without calling the fetcher.

## Out of scope
- Storing rates (010), conversion maths (`convertMinor` lives in Task 005), applying conversions to events (015).
