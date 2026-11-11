# 043 Pipeline integration, CLIs and workflows

- **Tier:** 2 (wiring tested steps together). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 031, 032, 033, 034, 035, 038. **Wave:** 5.

## Goal
Add the Phase 2 steps to `pnpm ingest run`, add the `grants` command and the `pnpm themes` CLI, add a daily workflow, and update the deployment guide.

## Why it matters
Steps only help once they run on a schedule, in the right order, under the run lock and the spend cap.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 6, 7.3, 10.2)
- `docs/decisions.md` (D4, D9, D10, D27, D30, D37)
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`, `src/pipeline/wiring.ts`, `src/pipeline/store/sources.ts`
- `src/cli/pipeline.ts`, `src/cli/entities.ts` (CLI style)
- The step modules from Tasks 031-035 and 038
- `.github/workflows/ingest.yml`, `docs/deployment.md`, `package.json`

## Files you may create or change
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`
- `src/pipeline/wiring.ts`
- `src/pipeline/store/sources.ts`, `src/pipeline/store/sources.test.ts`
- `src/cli/pipeline.ts`
- `src/cli/themes.ts` (new)
- `package.json` (the `themes` script only)
- `.github/workflows/ingest.yml` (summary rows only)
- `.github/workflows/daily.yml` (new)
- `docs/deployment.md`

## Steps
1. **Collect only what has a collector.** `listEnabledSources` (or `collectStep`) handles only kinds with a registered collector (`rss` now), so the `ukri-gtr` source row is never sent to the RSS collector. Add a test.
2. **Wiring.** Create the `EmbeddingClient` when `OPENAI_API_KEY` is set (null otherwise), and the GtR client with the shared `HttpFetcher`.
3. **`runAll`** after FX, in this order: grant tagging and resolution, embed, assign themes, name themes, locations, stats (spec section 6). Each step's stats go into `IngestStats`. A budget pause in any step stops the paid steps that follow, but locations and stats still run. A failure in one Phase 2 step is logged and recorded, and does not fail Phase 1 steps that already ran.
4. **CLI commands:** `pnpm ingest grants [--since YYYY-MM-DD] [--max-pages N] [--max-orgs N]`, `pnpm ingest embed`, `pnpm ingest themes`, `pnpm ingest stats [--force]`, each under the run lock.
5. **`src/cli/themes.ts`:** `pnpm themes list [--unreviewed]`, `rename`, `sector`, `merge`, `move`, `suggest-merges`, calling Task 032's admin functions, with clear errors for unknown slugs. Add the `themes` script to `package.json`.
6. **`daily.yml`:** daily at a quiet minute (for example `41 5 * * *`) and `workflow_dispatch`; same secrets and `INGEST_ENABLED` switch as `ingest.yml`; shares the `ingest` concurrency group so it never overlaps an hourly run; runs `pnpm ingest grants`; timeout 60 minutes; writes a step summary.
7. **`ingest.yml`:** add summary rows for tags embedded, themes created and named, grants resolved, and stats rebuilt or skipped.
8. **`docs/deployment.md`:** the new workflow, the grants backfill command (run by hand in chunks), the `pnpm themes` commands, and that extraction, embedding and naming all need `OPENAI_API_KEY`.

## Tests and acceptance criteria
- `pnpm check` passes.
- `run.test.ts` (fakes for every port):
  - a full run calls the steps in order;
  - a run without a key collects, resolves grants and rebuilds stats, and skips embed, naming and tagging;
  - a budget pause in embedding skips naming and tagging but not locations and stats;
  - a second identical run creates nothing new and skips stats;
  - a thrown error in the themes step leaves Phase 1 results recorded.
- The workflows pass `actionlint` if available, or are checked by eye against `ingest.yml`.

## Out of scope
- Hacker News and GitHub collectors (046, 047).
