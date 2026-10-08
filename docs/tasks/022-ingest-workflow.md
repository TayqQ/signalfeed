# 022 Scheduled ingest workflow

- **Tier:** 1 (one workflow file following a clear spec). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 019. **Wave:** 7 (the maintainer enables it after 021 is live).

## Goal
Run `pnpm pipeline run --trigger schedule` every 3 hours on GitHub Actions, with a kill switch, a concurrency guard and a timeout.

## Why it matters
Ingestion runs outside web requests, on a schedule, with its own secrets. That is the fix for visitors being able to trigger paid AI calls. It also starts the history that Phase 2 trends need.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 7, 8, 11)
- `docs/decisions.md` (D4, D5)
- `docs/sources.md` (A3 and A13 results: the polling interval and schedule caveats)
- `src/cli/pipeline.ts`, `.github/workflows/ci.yml`

## Files you may create or change
- `.github/workflows/ingest.yml`

## Requirements
- Triggers: `schedule` with cron `17 */3 * * *` (off the hour to avoid GitHub's peak; use the interval from `docs/sources.md` if it differs), and `workflow_dispatch`.
- The job runs only if `vars.INGEST_ENABLED == 'true'`.
- `concurrency: { group: ingest, cancel-in-progress: false }`, `timeout-minutes: 20`, `permissions: contents: read`.
- Steps: checkout, pnpm setup with cache, Node from `.nvmrc`, `pnpm install --frozen-lockfile`, then `pnpm pipeline run --trigger schedule`. Env comes from secrets (`DATABASE_URL`, `OPENAI_API_KEY`) and variables (`EXTRACTION_MODEL`, `LLM_MONTHLY_CAP_GBP`, `HTTP_CONTACT`). Never echo the env.
- Write the CLI's JSON summary to `$GITHUB_STEP_SUMMARY` as a small markdown table.
- A comment at the top explains the 60-day inactivity rule (A13) and how to re-enable the schedule.

## Acceptance criteria
- `pnpm check` passes. The workflow validates with `actionlint` or `pnpm dlx @action-validator/cli .github/workflows/ingest.yml`.
- **Maintainer:** after Task 021, trigger it manually once. The run succeeds, the step summary shows counts, and `/status` shows the run within 10 minutes (the cache window).

## Out of scope
- Alerts and notifications beyond GitHub's default emails for failed workflows, other collectors.
