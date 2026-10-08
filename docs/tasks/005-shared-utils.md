# 005 Shared utilities

- **Tier:** 2 (clearly specified pure functions with tests). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 003. **Wave:** 3.

## Goal
Write the deterministic helpers that the pipeline and the web share: name and URL normalisation, money parsing and formatting, regions, hashing, and the real HTTP fetcher.

## Why it matters
Entity resolution, deduplication and the "LLM finds, code computes" rule all rely on these functions being exact and well tested.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 6, 7 "Entity resolution rules", 9)
- `docs/decisions.md` (D8, D16)
- `src/core/domain.ts`, `src/core/ports.ts`

## Files you may create or change
- `src/lib/normalise.ts`, `src/lib/normalise.test.ts`
- `src/lib/money.ts`, `src/lib/money.test.ts`
- `src/lib/format.ts`, `src/lib/format.test.ts`
- `src/lib/regions.ts`, `src/lib/regions.test.ts`
- `src/lib/http.ts`, `src/lib/http.test.ts`

## Requirements
- **`normalise.ts`:**
  - `normaliseCompanyName` (rules in spec section 7) and `normaliseInvestorName` (the same rules, but keep words like "capital" and "ventures");
  - `slugify(name)`: ASCII, kebab-case, at most 60 characters;
  - `canonicaliseUrl(url)`: lowercase host, drop `utm_*`, `ref`, `fbclid`, `gclid`, the fragment and any trailing slash; keep other query parameters, sorted;
  - `extractDomain(urlOrDomain)`: registrable host without `www.`;
  - `normaliseTag(tag)`: lowercase, trimmed, collapsed whitespace, at most 40 characters, `&` becomes `and`;
  - `domainAppearsIn(domain, texts: string[])`.
- **`money.ts`:**
  - `parseAmountText(text, currencyHint)` returns `Money | null`. It handles `$12.5M`, `US$12.5 million`, `€3m`, `£750k`, `£1.2bn`, `EUR 3 million`, `12,5 Mio. €`, `$12.5 million Series A`, and ranges (takes the lower value). A bare `$` means USD unless `currencyHint` says otherwise. Unparseable input returns `null`.
  - `toMinorUnits` and `fromMinorUnits` (2 decimal places for every supported currency; document this).
  - `convertMinor(amountMinor, from, to, perEur)`: cross rates through EUR, rounded half-up to minor units.
- **`format.ts`:** `formatMoneyCompact(minor, currency)` (en-GB, e.g. "£8.2M", "US$10M", "€950K"), `formatDate(isoDate)` ("8 Oct 2026"), `formatRoundType(roundType)` ("Series A", "Pre-seed").
- **`regions.ts`:** `regionForCountry(code)` returns one of `'UK' | 'Europe' | 'North America' | 'Latin America' | 'Asia' | 'Middle East & Africa' | 'Oceania' | 'Unknown'`, and `REGIONS` (a const array). The UK (`GB`) is its own region. Cover every ISO alpha-2 code with a static map.
- **`http.ts`:** `createHttpFetcher({ userAgent })` implements `HttpFetcher` with native `fetch`:
  - sends `If-None-Match` / `If-Modified-Since`;
  - timeout via `AbortSignal.timeout` (default 15 s);
  - 2 retries with exponential backoff on 5xx or network errors, none on 4xx;
  - a 304 response is returned as `status: 304` with an empty body;
  - `buildUserAgent(contact)` returns `SignalFeed/<version> (+<contact>)`.

  Tests inject a fake `fetch` through a constructor option. Never use the global.

## Acceptance criteria
- `pnpm check` passes.
- Tests include at least:
  - 15 `parseAmountText` cases (each format above, plus a null case);
  - 10 company-name normalisation cases, including "Acme.ai", "ACME Ltd", "Acmé GmbH", and "Acme AI" staying distinct from "Acme";
  - 6 URL canonicalisation cases;
  - conversion GBP to USD via EUR, with a hand-calculated expected value;
  - fetcher retry, no retry on 404, and 304 behaviour.

## Out of scope
- Database access, collectors, entity matching logic.
