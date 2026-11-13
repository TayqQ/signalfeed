# 046 Hacker News Show HN and Launch HN collector (cuttable)

- **Tier:** 2 (a collector behind an existing port). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 043. **Wave:** 7. **Cuttable:** Phase 2 can ship without this task.

## Goal
Collect Launch HN stories and well-received Show HN stories as source items, snapshot their points and comments, and read YC batches from Launch HN titles.

## Why it matters
Launches with traction are a demand signal that moves before funding. HN supports backfill, so this can wait without losing data.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (section 11, A24)
- `docs/sources.md` (A4 and A24)
- `docs/decisions.md` (D19, D42)
- `src/core/ports.ts` (`Collector`), `src/pipeline/collect/rss.ts` (style), `src/pipeline/sources.ts`, `src/pipeline/wiring.ts`, `src/pipeline/run.ts`, `src/cli/pipeline.ts`
- `src/pipeline/extract/prefilter.ts`
- `src/db/schema.ts` (`source_items`, `launches`, `launch_metric_snapshots`, `companies.yc_batch`)

## Files you may create or change
- `src/pipeline/collect/hn-algolia.ts`, `src/pipeline/collect/hn-algolia.test.ts` (new)
- `src/pipeline/collect/hn-snapshots.ts`, `src/pipeline/collect/hn-snapshots.test.ts` (new)
- `src/pipeline/resolve/yc-batch.ts`, `src/pipeline/resolve/yc-batch.test.ts` (new)
- `src/pipeline/sources.ts`
- `src/pipeline/wiring.ts`
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`
- `src/cli/pipeline.ts`
- `fixtures/hn/search-show-hn.json`, `fixtures/hn/item.json` (new; trimmed, `author` removed, invented titles)
- `docs/sources.md` (the A24 section only)

## Steps
1. **Re-verify A4 and A24:** the endpoints, `numericFilters` on `points` and `created_at_i`, the rate limit, and the fields returned. Record them in `docs/sources.md`.
2. **Sources.** Add two sources of kind `hn_algolia`: `hn-launch` (priority 6) and `hn-show` (priority 5).
3. **Collector.** `createHnCollector(http, clock)` implements `Collector`:
   - `hn-launch`: `search_by_date?query="Launch HN"&tags=story` for the last 72 hours, keeping titles that start with "Launch HN:";
   - `hn-show`: `search_by_date?tags=show_hn&numericFilters=points>=50,created_at_i>{now-72h},created_at_i<{now-24h}`;
   - each hit becomes a `CollectedItem` with `externalId` = the HN object id, `url` = the story URL or the HN item URL when there is none, `title`, `summary = null`, `publishedAt`.
   - `author`, `story_text` and comment text are never read into the item.
4. **Dispatch by kind** in `wiring.ts`, so RSS and HN sources each reach their own collector.
5. **Snapshots.** `snapshotHnStep` runs inside `runAll` after resolve: for launch events linked to an `hn_algolia` item less than 7 days old and not snapshotted in the last 6 hours, fetch `items/{id}` and insert `points` and `comments` rows into `launch_metric_snapshots`.
6. **YC batch.** `applyYcBatches` parses `(YC W23)`, `(YC S24)` and similar from Launch HN titles linked to a company's launch event, and fills `companies.yc_batch` only when it is empty.
7. **Backfill.** `pnpm ingest hn-backfill --since YYYY-MM-DD [--limit N]` walks back in 7-day windows with the same rules, inserting items only. Extraction then follows the normal cap.

## Tests and acceptance criteria
- `pnpm check` passes. Fixtures through a fake `HttpFetcher`; no network.
- The collector builds the documented URLs, maps hits to items without `author`, and dedupes by external id.
- The prefilter passes the collected titles (existing `show hn` and `launch hn` patterns).
- Snapshots: at most one per 6 hours per event, none after 7 days.
- YC batch: "Launch HN: Example (YC W23) – …" gives `W23`; an existing batch is never overwritten; "YC-backed" without a batch gives nothing.
- `run.test.ts` covers an hourly run with an HN source.

## Out of scope
- GitHub stars (047), YC directory data (not built, D42), storing HN usernames or comments.
