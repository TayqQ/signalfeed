# 010 Pipeline store

- **Tier:** 2 (repository functions with integration tests). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 004, 005. **Wave:** 4.

## Goal
Write the database functions the pipeline uses to save and select its own working data: sources, items, extractions, FX rates and ingest runs.

## Why it matters
Idempotency lives here. Inserts that ignore duplicates and selects that return only pending work are what stop the pipeline paying twice for the same item.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 5 and 7)
- `docs/decisions.md` (D9, D15)
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`
- `src/core/domain.ts`, `src/core/extraction-schema.ts`
- `src/lib/normalise.ts`

## Files you may create or change
- `src/pipeline/store/sources.ts`, `src/pipeline/store/sources.test.ts`
- `src/pipeline/store/source-items.ts`, `src/pipeline/store/source-items.test.ts`
- `src/pipeline/store/extractions.ts`, `src/pipeline/store/extractions.test.ts`
- `src/pipeline/store/fx-rates.ts`, `src/pipeline/store/fx-rates.test.ts`
- `src/pipeline/store/ingest-runs.ts`, `src/pipeline/store/ingest-runs.test.ts`

All functions take `db: Db` as their first argument.

## Requirements
- **`sources.ts`:**
  - `upsertSources(db, configs)` (by slug; updates name, url, priority, enabled);
  - `listEnabledSources(db)`, returning id, config, etag and lastModified;
  - `updateFetchState(db, sourceId, { etag, lastModified, fetchedAt })`.
- **`source-items.ts`:**
  - `insertCollectedItems(db, sourceId, items)`: canonicalises URLs, inserts items and texts with `ON CONFLICT DO NOTHING`, returns `{ inserted, skipped }`;
  - `listPendingItems(db, limit)`: oldest first, status `pending`, attempts < 3, joined with summary and source name;
  - `markFilteredOut(db, ids)`, `markExtracted(db, id)`;
  - `recordFailure(db, id, error)`: increments attempts and sets `failed` at 3;
  - `listItemsForReextract(db, { promptVersion, limit })`.
- **`extractions.ts`:**
  - `insertExtraction(db, {...})`: in one transaction, clears `is_current` on the item's previous extraction and inserts the new one as current. If the same (item, prompt version, model) already exists, it returns the existing row and does nothing else.
  - `listUnresolvedExtractions(db, limit)`: current extractions with `resolved_at IS NULL`, joined with item title, url, published date, summary, and source priority and name.
  - `markResolved(db, id)`.
  - `listSupersededExtractionIds(db, sourceItemId)`.
- **`fx-rates.ts`:**
  - `upsertRates(db, rates: FxRates)`;
  - `getRatesOnOrBefore(db, date, maxDaysBack = 7)` returns `FxRates | null`;
  - `latestRate(db, currency)`;
  - `missingRateDates(db, dates)`.
- **`ingest-runs.ts`:** `startRun(db, trigger)`, `finishRun(db, id, { status, stats, error })`, `latestRuns(db, n)`.

## Acceptance criteria
- `pnpm check` passes. Every function has at least one PGlite integration test via `createTestDb()`.
- Tests prove:
  - inserting the same feed twice inserts nothing the second time;
  - two URLs differing only by `utm_source` dedupe;
  - pending selection skips `filtered_out`, `extracted` and 3-attempt items;
  - a re-inserted identical extraction is a no-op;
  - a new prompt version flips `is_current`;
  - FX lookup falls back to an earlier date within 7 days and returns `null` beyond that.

## Out of scope
- Budget accounting (011), entity tables (012/015), orchestration (019).
