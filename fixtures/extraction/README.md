# Extraction eval fixtures

`cases.json` holds real headline + URL pairs from Phase 1 RSS sources, with human-checked expected extraction outputs. Task 014 scores live or recorded model runs against these cases.

Task 024 added six invented UK cases (ids starting `syn-`, URLs on `example.com`). They test city and region wording ("Scottish", "Welsh", "Yorkshire-based", "Belfast-based") that the real cases lack. Their company and investor names are made up.

## File format

Each entry in `cases.json` is an object with:

| Field                 | Meaning                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`                  | Stable slug, unique across the file                                                                     |
| `sourceSlug`          | Ingest source id from `docs/sources.md` (`techcrunch-venture`, `tech-eu`, `eu-startups`, `uktech-news`) |
| `url`                 | Canonical article URL                                                                                   |
| `headline`            | Verbatim RSS / page title                                                                               |
| `summary`             | **1–3 sentences in our own words** — facts only, never copied publisher text                            |
| `publishedAt`         | ISO 8601 datetime **with timezone offset** (e.g. `2026-10-08T12:00:00+00:00`)                           |
| `expected.isRelevant` | Whether the item reports a completed funding round, acquisition, or startup launch                      |
| `expected.events`     | Zero or more expected events (see `src/core/eval-fixture.ts`)                                           |

Event fields mirror the eval schema: `type`, `companyName`, `countryCode` (two-letter ISO or `null`), `roundType`, `amountText` (verbatim amount phrase from the headline or summary), `leadInvestors` and `investors` (organisations only), and `acquirerName` for acquisitions.

Two fields are optional: `city` and `regionText`. Set them only when the headline or summary states them. Leave them out (or `null`) otherwise, and the event is not scored on them.

- `city` is the town or city name alone, such as `"Leeds"` for "Leeds-based". The scorer ignores case, accents and extra spaces.
- `regionText` is the region, nation or county as written, such as `"Scottish"` or `"Yorkshire"`. Never fill it from the city: "Belfast-based" gives a city and no region. The scorer maps both sides to an ITL1 region with a small lookup in `src/eval/score.ts`. Add any new region word to that lookup, or `src/eval/score.test.ts` fails.

Summaries are paraphrased on purpose ([D20](../../docs/decisions.md)): the eval is slightly easier than production RSS because we do not store publisher descriptions in the repo.

## Adding a case

1. Pick a **real** headline and URL from an enabled feed in `docs/sources.md`. Do not use Sifted or Crunchbase News. Invent a case only to cover wording the real cases lack, and mark it as above.
2. Write the `summary` yourself in 1–3 sentences; do not paste article body or feed `<description>` text.
3. Fill `expected` after reading the full article and confirming facts. Do not add facts the headline or summary does not support. `amountText` must match how the amount appears in the headline or your summary. Label only what the headline or summary states, because that is all the model sees: if neither names the round (seed, Series A, and so on), `roundType` is `unknown`, even when the article or the amount suggests a stage.
4. Run `pnpm test src/eval/fixtures.test.ts src/eval/score.test.ts` and fix schema or mix errors.
5. Old recordings do not contain the new case. `pnpm eval --replay` leaves it out of their scores. Run `pnpm eval --live` to score it.
6. Open a PR and tick **“All expected outputs verified by hand”** only after a maintainer has checked every field against the source article.
