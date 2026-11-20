# 085 Unstick the hourly ingest: split slow steps to daily, time each step

- **Tier:** 2 (changes the scheduled pipeline; no data model change). **Suggested model:** Claude Sonnet.
- **Depends on:** 068 (merged). **Wave:** fix.

## Why (found 20 November 2026)
- Every hourly `ingest.yml` run since 14 November has been cancelled at its 20-minute `timeout-minutes`. The log shows the feeds fetched at about 21:29:47, then nothing until the cancel at 21:49:38.
- The database confirms that collection, prefilter and extraction finish: all 149 items are `extracted` or `filtered_out`, and none is pending. The hang is after `fxStep`, in `phase2Steps` (grant tagging and resolution, embeddings, themes, locations, stats) or `phase3LocalSteps` (confirmations, sectors).
- The last successful hourly run was on 14 November, the day the grants backfill (#19) added about 2,280 grant companies and their projects. The grant tagging (up to `MAX_GRANT_TAGGINGS_PER_RUN` = 200 LLM calls), grant resolution, embedding and theme steps now face a large backlog every hour.
- Cancelled runs leave their `ingest_runs` row with status `running` forever (rows 41, 42, 46, 47, 48, 52 and others).
- The pipeline logs nothing per step, so the exact slow step isn't known.

## Goal
The hourly run only does what must be fresh every hour (news), finishes in a few minutes, and says how long each step took. The slow, paid grant and theme work moves to the daily workflow, which has its own time limit. Abandoned runs get closed.

## Read first
- `AGENTS.md`
- `src/pipeline/run.ts` (`runAll`, `phase2Steps`, `phase3LocalSteps`, `runGrants`, the registry run, `withIngestLock`, `startRun`)
- `src/cli/pipeline.ts` (commands `run`, `grants`, `registry`, `formd`)
- `.github/workflows/ingest.yml`, `.github/workflows/daily.yml` (steps, `timeout-minutes`, summary scripts)
- `src/core/env.ts` (how `MAX_CH_MINUTES_PER_RUN` was added in 068; follow the same pattern)
- `docs/decisions.md` (D63), `docs/deployment.md`

## Files you may create or change
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`
- `src/pipeline/step-timing.ts`, `src/pipeline/step-timing.test.ts` (new, if useful)
- `src/cli/pipeline.ts` (a new `enrich` command)
- `src/pipeline/wiring.ts` (wiring only)
- `src/core/env.ts`, `src/core/env.test.ts` (new variables only)
- `.github/workflows/ingest.yml`, `.github/workflows/daily.yml`, `.env.example`
- `src/db/queries/status.ts` and its test, only if the status page needs to show `abandoned` runs correctly
- `docs/decisions.md` (add D67), `docs/deployment.md`
- Do **not** edit `docs/tasks/README.md`. The maintainer adds the row.

## Steps
1. **Split the work.**
   - `runAll` (the hourly `pnpm ingest run`) keeps: collect, prefilter, extract, resolve, fx, then the cheap DB-local steps (locations, stats, confirmations, sectors), which keep a new round correctly labelled within the hour.
   - Move grant tagging, grant resolution, tag embedding and themes into a new `runEnrich` and a CLI command `pnpm ingest enrich`. It takes the ingest lock and records its own `ingest_runs` row, like `grants` and `registry` do.
2. **Time limits.**
   - Add `MAX_INGEST_MINUTES_PER_RUN` (default 12, integer 1-60) for the hourly run, and `MAX_ENRICH_MINUTES_PER_RUN` (default 15) for enrich, parsed like `MAX_CH_MINUTES_PER_RUN`.
   - Check the limit between steps, and between items in loops that iterate over many rows (extraction items, grant projects to tag, participants to resolve, tags to embed). On reaching it, stop cleanly and leave the rest for the next run.
   - Record `stoppedAtTime: true` in the stats.
   - Never stop part way through a database write or an LLM call.
3. **Per-step timing.** Each step logs one line when it ends, for example `step extract: 4.2s (6 items)`, and its duration goes into the run stats (`stepMs: { collect: 1234, ... }`). The workflow summaries show the durations.
4. **Abandoned runs.** When a run starts, mark any `ingest_runs` row still `running` and started more than 60 minutes ago as `failed`, with `error = 'abandoned: the job was stopped before it finished'` and `finished_at = now()`. Do this inside the lock, so a live run is never touched. Add a test.
5. **Workflows.**
   - `ingest.yml`: keep `timeout-minutes: 20` as the backstop and pass `MAX_INGEST_MINUTES_PER_RUN` (empty means the default).
   - `daily.yml`: add an "Enrich" step after "Grants" and before "Registry", with its own `timeout-minutes: 18`, `MAX_ENRICH_MINUTES_PER_RUN` and a summary row. Raise the job's total `timeout-minutes` by 18.
   - Keep `INGEST_ENABLED` gating as it is.
6. **D67** in `docs/decisions.md`: the stall, what moved and why, the two limits, and abandoned-run clean-up. Update `docs/deployment.md` (the steps and the optional variables).

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass. Tests use fakes only.
- `runAll` no longer calls grant tagging, grant resolution, embedding or themes. `runEnrich` calls them in the same order as before.
- A fake-clock test shows the hourly run stops between items at the limit, still runs the cheap rebuild steps, and reports `stoppedAtTime`.
- A test shows abandoned runs older than 60 minutes are closed and a recent `running` row is not.
- Step durations appear in the stats and in the log lines.

## Out of scope
- Feed 403s (Tech.eu and EU-Startups block GitHub runner IPs); that's being handled separately.
- Companies House response-shape errors from the registry step.
- Any commit, push or PR.
