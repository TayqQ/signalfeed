# 068 Registry step: time limit, clearer errors, news companies first

- **Tier:** 2 (clearly specified; touches the scheduled job). **Suggested model:** Claude Sonnet.
- **Depends on:** 065 (merged). **Wave:** fix, after Phase 3.

## Goal
Make `pnpm ingest registry` finish inside its workflow step every day, say why a company failed, stop treating "no results" as an error, and search news companies before the grant-recipient backlog.

## Why it matters (found 17 November 2026)
- The grants backfill (PR #19) created about 2,280 grant-recipient companies, all GB, so the Companies House queue grew from about 10 to about 1,425 companies (about 1,228 due).
- With 2,000 requests a run at the 500-per-5-minutes limiter, linking alone takes at least 20 minutes. Then the step rebuilds confirmations, locations and sectors. On 15 and 16 November the step was killed by its 25-minute `timeout-minutes`, the daily job failed, and the summary had no registry result.
- Form D then printed `{"ran":false}`: the killed step's Postgres session still held the ingest advisory lock when Form D started a second later. So Form D has not run for two days.
- About 100 companies fail every run with the log line `registry: company N not linked: Error`. `describeError` prints only `error.name` for anything that is not a `ChApiError`, so the cause is hidden. Likely candidates are `DrizzleQueryError` (its name is plain `Error`) or a wrapped network error from `ch-client.ts` `send`. These companies stay due and are retried on every run.
- Two companies failed with `Companies House advanced search failed: HTTP 404`. The advanced search endpoint answers 404 when nothing matches. That is zero hits, not an error.
- Within tier 1, the grant-only backlog is sorted with news companies by newest event, so newly reported UK startups can wait days behind grant recipients.
- The D62 hint queue itself works. Of 26 never-searched news companies with no country, none has a GBP round, a UK-only source or a UK place, so none is queued. That is correct and is not changed here.

## Read first
- `AGENTS.md`
- `docs/decisions.md` (D53, D61, D62)
- `src/pipeline/registry/link-companies.ts` (`describeError`, `RequestBudget`, `eligibleCompanies`, `linkCompanies`)
- `src/pipeline/registry/registry-step.ts`, `src/pipeline/registry/refresh-profiles.ts`
- `src/pipeline/registry/ch-client.ts` (`send`, `getJson`, advanced search)
- `.github/workflows/daily.yml` (registry step and the summary script)

## Files you may create or change
- `src/pipeline/registry/link-companies.ts`, `src/pipeline/registry/link-companies.test.ts`
- `src/pipeline/registry/registry-step.ts`, `src/pipeline/registry/registry-step.test.ts`
- `src/pipeline/registry/refresh-profiles.ts`, `src/pipeline/registry/refresh-profiles.test.ts` (only to honour the shared time limit)
- `src/pipeline/registry/ch-client.ts`, `src/pipeline/registry/ch-client.test.ts`
- `src/pipeline/registry/search-hints.ts`, `src/pipeline/registry/search-hints.test.ts` (ordering only)
- `src/pipeline/wiring.ts`, `src/pipeline/run.ts` (pass the new option only)
- `src/core/env.ts`, `src/core/env.test.ts` (the new variable only)
- `.env.example`, `.github/workflows/daily.yml`
- `docs/decisions.md` (add D63), `docs/deployment.md` (registry step and optional variables), `docs/tasks/README.md` (one row for 068)

## Steps
1. **Time limit.** Add `MAX_CH_MINUTES_PER_RUN` (default 17, integer 1-60), parsed like `MAX_CH_REQUESTS_PER_RUN`. The link pass and the refresh pass share one deadline (for example on `RequestBudget`, or a sibling passed with it). Check it only **between companies** (and between profiles in refresh): never stop part way through a company. On reaching it, stop like the request limit does: the rest stays due, the step still rebuilds confirmations, locations and sectors, and the stats say `stoppedAtTime: true`. The rate-limit wait inside `ch-client` (a whole 5-minute window) must not start when less than 5 minutes remain: stop instead. Pass the variable through `daily.yml` like the others (empty means the default). In the step summary, "Stopped early" shows `time limit` for this case. Keep `timeout-minutes: 25` as the backstop.
2. **Say why it failed.** `describeError` returns `name: message` for any `Error`. For an error with a `cause` (Drizzle wraps the driver error), add the cause's `code` and `message`. Drop any text after `params:` and cap the result at 300 characters. The API key must never appear: route the result through the same scrubbing `ch-client` uses, or prove with a test that no path can carry it. Keep `ChApiError` messages as they are.
3. **Advanced search 404.** In `ch-client.ts`, a 404 from the advanced search endpoint returns zero hits. A 404 from basic search or a profile keeps its current behaviour. Test both.
4. **News companies first.** In `eligibleCompanies`, within the same tier, companies with at least one event that has an `event_sources` row (a news report) come before companies whose events all come from grants. Then newest event, then id, as now. Tiers and hints are unchanged. Add a test with a grant-only company and a news company in tier 1.
5. **D63** in `docs/decisions.md`: the time limit and why (the arithmetic above, plus the lock that the killed step left behind), the error-message change, the 404 rule and the ordering. Update `docs/deployment.md`: the registry step now stops at `MAX_CH_MINUTES_PER_RUN` (17), and the optional variables line.

## Tests and acceptance criteria
- `pnpm check` passes, and `pnpm test` stays green (about 1,519 tests plus the new ones). Fakes only in tests, no network.
- A fake clock test shows the link pass stops between companies at the deadline, leaves the rest due, and that the step still runs the rebuilds and reports `stoppedAtTime`.
- A test shows the rate-limit window wait is skipped when it would pass the deadline.
- A test shows `describeError` on a wrapped query error gives the cause's code and message, without `params`, under 300 characters, and never the API key.
- No change to link rules, link eval cases or what is stored for a link.

## Out of scope
- Recording failed attempts so they back off (consider after reading the new error messages from one live run).
- The `X-RateLimit-Reset` header and 5xx retry pacing (section 4 known issues).
- Releasing the advisory lock on kill, or retrying the lock in Form D. The time limit removes the cause.
- Any commit, push or PR. The maintainer commits outside working hours.
