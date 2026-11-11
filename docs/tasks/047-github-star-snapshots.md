# 047 GitHub star snapshots (cuttable)

- **Tier:** 2 (a small scheduled collector). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 046. **Wave:** 8. **Cuttable:** Phase 2 can ship without this task.

## Goal
Take a daily snapshot of stars and forks for launches that point at a GitHub repository.

## Why it matters
Star growth is an early demand signal for developer tools. Unlike HN, it cannot be backfilled cheaply, so snapshots start when this task ships.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (section 11)
- `docs/sources.md` (A6)
- `src/core/env.ts` (`GITHUB_TOKEN`), `src/lib/http.ts`
- `src/db/schema.ts` (`launches`, `launch_metric_snapshots`)
- `src/cli/pipeline.ts`, `.github/workflows/daily.yml`

## Files you may create or change
- `src/pipeline/github/repo-snapshots.ts`, `src/pipeline/github/repo-snapshots.test.ts` (new)
- `fixtures/github/repo.json` (new; trimmed)
- `src/cli/pipeline.ts` (the `github` command)
- `.github/workflows/daily.yml` (one extra step)
- `docs/sources.md` (the A6 section only)

## Steps
1. Re-check A6 (`GITHUB_TOKEN` limits in Actions) and record it.
2. `parseGithubRepo(url)` accepts `https://github.com/<owner>/<repo>` (with optional `.git`, trailing slash or sub-path) and rejects users, orgs, gists and other hosts.
3. `snapshotGithubStep({ db, http, token, clock, maxRepos = 500 })`: for launch events with a GitHub repo URL and no `stars` snapshot today, `GET https://api.github.com/repos/{owner}/{repo}` with the token and `X-GitHub-Api-Version`, and insert `stars` and `forks` rows. A 404 or 451 is logged once and skipped; a 403 or 429 for rate limits stops the step cleanly.
4. `pnpm ingest github` runs it under the lock, and `daily.yml` gains the step with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `permissions: contents: read`.

## Tests and acceptance criteria
- `pnpm check` passes. Fake fetcher; no network.
- URL parsing table test; one snapshot per repo per UTC day; a rate-limit response stops the step; nothing is stored about repository owners beyond the `owner/repo` already in the launch URL.

## Out of scope
- Discovering repositories from anything other than launch URLs; contributor or user data.
