# 087 Respect robots.txt for news feeds and publisher pages

- **Tier:** 2 (changes what we fetch from third parties). **Suggested model:** Claude Sonnet.
- **Depends on:** 085 (same branch). **Wave:** fix.

## Why (found 20 November 2026)
- The RSS collector never reads `robots.txt`.
- Tech.eu's robots.txt has `User-agent: *` / `Disallow: /feed/`, and UKTN's has `User-agent: *` / `Disallow: /feed`. We have been fetching both feeds hourly against those rules.
- The maintainer is writing to both sites to ask permission. Until a site allows us, the reader must not fetch disallowed paths.
- The Phase 3.5 spec (section 6.1) already requires robots checks for company websites. This brings the news side in line.

## Goal
Before any request to a publisher host (feed URLs, and any article or page fetch the news pipeline makes), check that host's robots.txt for our user agent, and skip disallowed URLs. Skipped sources show clearly in the run stats and the log, and they don't count as feed failures.

## Read first
- `AGENTS.md`
- `src/lib/http.ts` (the HTTP client, `buildUserAgent`)
- `src/pipeline/collect/rss.ts`, `src/pipeline/collect/parse-feed.ts`, `src/pipeline/sources.ts`
- `src/pipeline/wiring.ts`, `src/pipeline/run.ts` (`collectStep` and its stats)
- Every other place the news pipeline fetches a publisher URL (search for the HTTP client's use)
- `docs/spec-phase3.5.md` section 6.1, which the shared module should be able to serve later

## Files you may create or change
- `src/lib/robots.ts`, `src/lib/robots.test.ts` (new: fetch, parse and decide; cache)
- `src/pipeline/collect/rss.ts` and its test
- `src/pipeline/run.ts` and its test (collect stats only)
- `src/pipeline/wiring.ts` (wiring only)
- `src/lib/http.ts` and its test, only if the robots fetch needs a small hook
- `src/pipeline/sources.ts`: a comment per source noting its robots status. Do not remove sources.
- `docs/decisions.md` (add D68), `docs/deployment.md` (one paragraph)
- Do not edit `docs/tasks/README.md`.

## Steps
1. **Parser** (`src/lib/robots.ts`), following RFC 9309:
   - Groups are matched by user-agent product token, case-insensitively. Our tokens are `SignalFeed` and `Raisory` (for a future rename). Fall back to `*`.
   - `Allow` and `Disallow` use the longest match, with `Allow` winning a tie. Support the `*` and `$` wildcards.
   - Read `Crawl-delay` and expose it.
   - Unit-test it against the real Tech.eu, UKTN and EU-Startups rules as fixtures (copy the relevant lines into the test).
2. **Fetching:**
   - `GET https://<host>/robots.txt` with our user agent, cached per host for 24 hours in memory for the run. Persist to the `sources` row only if that's trivial without a migration; otherwise in-memory per run is fine, which is one extra request per host per run.
   - Status rules, per RFC 9309: 2xx parses the file. 4xx means "no rules" (allowed). 5xx, a network error or a timeout means treat the whole host as disallowed for this run (skip, retry next run).
3. **Collector:**
   - Before fetching a feed, check the feed URL. If it's disallowed, skip it with outcome `robots_disallowed` and log `Feed tech-eu skipped: disallowed by robots.txt`.
   - Count it in a new `sourcesSkippedRobots` stat. It does not count in `sourcesFailed`.
   - Any article or page fetch in the news pipeline gets the same check.
   - Respect `Crawl-delay` between requests to the same host when it's greater than the current per-host spacing.
4. **Workflow summary:** add "Feeds skipped (robots.txt)" to the `ingest.yml` summary rows. `.github/workflows/ingest.yml` is added to your file list for this one line.
5. **D68** in `docs/decisions.md`: we honour robots.txt for every publisher fetch; Tech.eu and UKTN disallow their feeds; we have asked them for permission; and the status rules above.

## Tests and acceptance criteria
- Parser tests:
  - Tech.eu's rules disallow `/feed/` for SignalFeed;
  - UKTN's rules disallow `/feed`;
  - EU-Startups' rules allow it;
  - a specific `SignalFeed` group with `Allow: /feed/` overrides `*`;
  - wildcards work;
  - a tie goes to `Allow`.
- Collector tests: a disallowed feed is skipped, never fetched, and counted in `sourcesSkippedRobots`; robots 404 means allowed; robots 503 means skipped this run.
- `pnpm check` and `pnpm build` pass. Fakes only, no network in tests.

## Out of scope
- Adding new sources (a later task).
- Company website fetching (Phase 3.5 reuses `src/lib/robots.ts` later).
- Any commit, push or PR.
