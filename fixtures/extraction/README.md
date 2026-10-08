# Extraction eval fixtures

`cases.json` holds real headline + URL pairs from Phase 1 RSS sources, with human-checked expected extraction outputs. Task 014 scores live or recorded model runs against these cases.

## File format

Each entry in `cases.json` is an object with:

| Field | Meaning |
| --- | --- |
| `id` | Stable slug, unique across the file |
| `sourceSlug` | Ingest source id from `docs/sources.md` (`techcrunch-venture`, `tech-eu`, `eu-startups`, `uktech-news`) |
| `url` | Canonical article URL |
| `headline` | Verbatim RSS / page title |
| `summary` | **1–3 sentences in our own words** — facts only, never copied publisher text |
| `publishedAt` | ISO 8601 datetime **with timezone offset** (e.g. `2026-10-08T12:00:00+00:00`) |
| `expected.isRelevant` | Whether the item reports a completed funding round, acquisition, or startup launch |
| `expected.events` | Zero or more expected events (see `src/core/eval-fixture.ts`) |

Event fields mirror the eval schema: `type`, `companyName`, `countryCode` (two-letter ISO or `null`), `roundType`, `amountText` (verbatim amount phrase from the headline or summary), `leadInvestors` and `investors` (organisations only), and `acquirerName` for acquisitions.

Summaries are paraphrased on purpose ([D20](../../docs/decisions.md)): the eval is slightly easier than production RSS because we do not store publisher descriptions in the repo.

## Adding a case

1. Pick a **real** headline and URL from an enabled feed in `docs/sources.md`. Do not use Sifted or Crunchbase News.
2. Write the `summary` yourself in 1–3 sentences; do not paste article body or feed `<description>` text.
3. Fill `expected` after reading the full article and confirming facts. `amountText` must match how the amount appears in the headline or your summary.
4. Run `pnpm test src/eval/fixtures.test.ts` and fix schema or mix errors.
5. Open a PR and tick **“All expected outputs verified by hand”** only after a maintainer has checked every field against the source article.
