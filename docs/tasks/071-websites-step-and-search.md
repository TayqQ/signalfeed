# 071 Websites pipeline step, daily workflow and optional search

- **Tier:** 2. **Suggested model:** Claude Sonnet.
- **Depends on:** 070. **Wave:** 3.5-3 (parallel with 072).

## Goal
Run website finding daily within a time limit, and add Brave search as an optional, capped source.

## Read first
- `AGENTS.md`, `docs/spec-phase3.5.md` (sections 4, 5.5, 9, 11, A51)
- `src/pipeline/registry/registry-step.ts` (the time limit pattern from 068), `src/pipeline/run.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts`
- `.github/workflows/daily.yml`

## Files you may create or change
- `src/pipeline/websites/websites-step.ts`, `src/pipeline/websites/search-client.ts`, plus tests (new)
- `src/pipeline/run.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts` (the `websites` command only)
- `src/core/env.ts`, `src/core/env.test.ts` (`MAX_WEBSITE_MINUTES_PER_RUN`, `MAX_WEBSITE_SEARCHES_PER_MONTH`, optional `BRAVE_SEARCH_API_KEY`)
- `.env.example`, `.github/workflows/daily.yml`, `docs/deployment.md`
- `src/app/about/**` (the short "How we find websites" note, plus attribution only when search is on)

## Steps
1. Queue as in section 4. Fingerprint and a 180-day re-check, like `registry_searches`.
2. Use a time limit and a fetch cap, and stop only between companies. Report stats as JSON for the step summary.
3. `search-client.ts` is used only when the key is set and the month's count is under the cap. The count is kept in the database, not in memory. Store only verified domains (A51). **Confirm A51 against Brave's live terms and record the result in the PR before writing this file.** If the terms forbid our use, skip this step and say so.
4. In `daily.yml`, add the step after grants and before the registry step: `timeout-minutes: 12`, job limit 85.

## Tests and acceptance criteria
- `pnpm check` and `pnpm test` pass.
- Without a key the step runs with no search, and the summary says "search off".
- The monthly cap is tested across a month boundary.

## Out of scope
- Companies House linking from numbers (072), UI (073).
