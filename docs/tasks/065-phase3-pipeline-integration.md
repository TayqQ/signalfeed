# 065 Phase 3 pipeline integration, CLI and workflows

- **Tier:** 2 (wiring tested steps together). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 056, 057, 058, 060, 061, 062. **Wave:** 5.

## Goal
Wire the Phase 3 steps into `pnpm ingest`, the hourly run and the daily workflow, add the new settings and secrets, and document the deployment steps.

## Why it matters
Each step is built and tested alone. This task makes them run in the right order, under the run lock and request limits, with the Companies House key only where it is needed.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 4, 6, 13.1)
- `docs/deployment.md`
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts`
- `.github/workflows/daily.yml`, `.github/workflows/ingest.yml`, `.env.example`
- The step entry points: `registry-step.ts` (056), `collect-form-d.ts` and `link-form-d.ts` (057), `relink-grants.ts` (058), `confirm-events.ts` (060), `company-sectors.ts` (061)

## Files you may create or change
- `src/pipeline/run.ts`, `src/pipeline/run.test.ts`
- `src/pipeline/wiring.ts`
- `src/cli/pipeline.ts`
- `.github/workflows/daily.yml`
- `docs/deployment.md`
- `.env.example`
- `package.json` (only if a script is missing; `registry` comes from 062)

## Steps
1. **Wiring.** `createPipelineDeps` builds a Companies House client only when `COMPANIES_HOUSE_API_KEY` is set, and an EDGAR client with `HTTP_CONTACT`. Both use the shared `HttpFetcher`. Neither client is ever built in web code.
2. **`run` (hourly).** After the Phase 2 steps: `confirm`, then `sectors` (spec section 6). Both are local and skip when nothing changed. The locations step now includes the registered-office rule (061). Add their stats to `IngestStats`. `run` makes no Companies House or EDGAR request.
3. **New commands** in `src/cli/pipeline.ts`, each recorded as a run under the lock:
   - `registry [--max-requests <n>]`: the Companies House step, then `confirm`, `locations` and `sectors`, so new links show in the same run. Without a key it records `skipped` and exits 0.
   - `formd [--since YYYY-MM-DD] [--max-days <n>] [--max-requests <n>]`: collect, link, then `confirm`. Refuses with a clear message if `HTTP_CONTACT` has no email address.
   - `relink-grants [--dry-run]`: the one-off grant relink (058).
   - Update the usage text.
4. **Daily workflow.** After grants, two steps: `pnpm ingest registry --trigger "$TRIGGER"` and `pnpm ingest formd --trigger "$TRIGGER"`, each writing a step summary like the grants step. Add `COMPANIES_HOUSE_API_KEY: ${{ secrets.COMPANIES_HOUSE_API_KEY }}` to that job's environment only. A failure in one step must not skip the other (`if: always()` with the lock still respected). Keep the job inside its 60-minute timeout: at 2,000 requests and about 1.6 a second, the registry step takes about 21 minutes; Form D at 3,000 requests and 5 a second about 10.
5. **`.env.example`** gains the four new settings with comments.
6. **`docs/deployment.md`:** a "Phase 3" section: **[maintainer]** add the `COMPANIES_HOUSE_API_KEY` secret (never to Vercel), set `HTTP_CONTACT` to an email address, apply the migration with the migrate workflow, re-run `scripts/sql/roles.sql`, backfill steps (spec section 13.1), and how to pause each step.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass.
- `run.test.ts`: `run` calls confirm and sectors after the Phase 2 steps, and never calls either external client; `registry` without a key records `skipped`; `formd` refuses a contact with no email; stats are recorded for each new step; a second `run` with no changes skips confirm and sectors.
- The workflow YAML is valid (`actionlint` if available, otherwise a careful read), and the key appears only in the daily job's environment.

## Out of scope
- Running the backfills (066).
