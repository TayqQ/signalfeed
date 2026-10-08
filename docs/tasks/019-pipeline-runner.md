# 019 Pipeline runner and CLI

- **Tier:** 2 (wiring existing, tested parts together against a clear sequence). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 006, 007, 010, 011, 015. **Wave:** 6.

## Goal
Wire collect, prefilter, extract, resolve and FX into one locked, idempotent run, and expose it as `pnpm pipeline <command>`.

## Why it matters
This is what the scheduled job executes. It must never double-run, never reprocess finished work, and must stop cleanly when the budget runs out.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 7 and 8)
- `docs/decisions.md` (D4, D5, D9, D10)
- `src/core/env.ts`, `src/core/ports.ts`, `src/core/domain.ts`, `src/core/errors.ts`
- `src/db/client.ts`, `src/db/testing.ts`
- `src/lib/http.ts`
- `src/pipeline/sources.ts`, `src/pipeline/collect/rss.ts`
- `src/pipeline/extract/prefilter.ts`, `src/pipeline/extract/extract-item.ts`, `src/pipeline/extract/openai-client.ts`, `src/pipeline/extract/prompt.ts`
- `src/pipeline/budget/budget-guard.ts`
- `src/pipeline/fx/frankfurter.ts`
- `src/pipeline/store/sources.ts`, `src/pipeline/store/source-items.ts`, `src/pipeline/store/extractions.ts`, `src/pipeline/store/fx-rates.ts`, `src/pipeline/store/ingest-runs.ts`
- `src/pipeline/resolve/resolve-extraction.ts`, `src/pipeline/resolve/canonicalise.ts`

## Files you may create or change
- `src/pipeline/lock.ts`
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`
- `src/pipeline/wiring.ts`
- `src/cli/pipeline.ts`

## Requirements
- **`lock.ts`:** `withIngestLock(db, fn)` uses `pg_try_advisory_lock(<constant bigint key>)`. It returns `{ ran: false }` if the lock is held and always unlocks in `finally`.
- **`run.ts`:** step functions `collectStep`, `prefilterStep`, `extractStep`, `resolveStep`, `fxStep`, each taking a `PipelineDeps` object (db, collector, llm, budget, fx, clock, config, runId) and returning counts. Then `runAll(deps, trigger)`:
  - takes the lock;
  - `startRun`, then `upsertSources(SOURCES)`;
  - runs the steps in order;
  - `finishRun` with `IngestStats`.

  Error handling:
  - one feed failing is logged in the stats and the run continues;
  - an item failing extraction calls `recordFailure` and the run continues;
  - `BudgetExceededError` stops `extractStep`, sets status `budget_paused`, and resolve and FX still run;
  - any other unexpected error marks the run `failed` and is rethrown.

  `extractStep` processes at most `MAX_EXTRACTIONS_PER_RUN` items. `fxStep` fetches missing rates for dates of events with null USD/GBP columns, then recomputes those events.
- **`reextractStep({ promptVersion, limit, dryRun, yes })`:**
  - a dry run prints the item count and estimated cost, and calls nothing;
  - without `yes`, it refuses;
  - otherwise it extracts and then resolves each item.
- **`wiring.ts`:** `createPipelineDeps(env)` builds the real implementations from `parsePipelineEnv(process.env)`: the HTTP fetcher with a User-Agent from `HTTP_CONTACT`, the RSS collector, the OpenAI client, the budget guard, Frankfurter and the system clock.
- **`src/cli/pipeline.ts`:**
  - uses `node:util` `parseArgs`;
  - commands `run`, `collect`, `extract`, `resolve`, `fx`, `reextract`, plus `--trigger schedule|manual` (default `manual`);
  - loads `.env` when present;
  - prints a one-line JSON summary;
  - exits 0 on success, `budget_paused` or lock held, and 1 on failure;
  - never prints secrets.

## Acceptance criteria
- `pnpm check` passes.
- `run.test.ts` (PGlite, a fake collector serving fixture items, a fake LLM returning canned extractions, the real budget guard, a fake FX provider) proves:
  - a full run creates events and an `ingest_runs` row with correct stats;
  - **a second run with the same feed makes zero LLM calls**;
  - a lock already held means no work and `ran: false`;
  - a budget cap reached mid-run gives status `budget_paused`, leaves the remaining items `pending`, and still resolves what was extracted;
  - one failing feed doesn't stop the others;
  - a reextract dry run makes zero LLM calls;
  - nothing in `src/app` imports from `src/pipeline` (lint covers this).
- `pnpm pipeline --help` prints usage.

## Out of scope
- The GitHub Actions workflow (022), deployment (021), new pipeline steps such as embeddings or other collectors (Phase 2).
