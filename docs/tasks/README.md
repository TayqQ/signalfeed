# Phase 1 tasks

All code tasks are now written. Steps that need accounts, keys or spending are still open: the live extraction eval in 014, the account steps in 021, and turning on the schedule in 022. These task files are the original plan, so they still say `pnpm pipeline`, which is now `pnpm ingest` (D31).

Each task is designed for one fresh agent chat in its own git worktree. Tasks in the same wave can run in parallel: they never touch the same file. Start a wave only when every task it depends on has been merged to `main`.

**Tiers:**
- Tier 1 is routine work (suggested model: Composer 2.5 or Claude Sonnet).
- Tier 2 is a clearly specified feature (Grok 4.7 or Claude Sonnet).
- Tier 3 is work where mistakes are expensive (Claude Opus).

Tasks marked **[maintainer]** need a person to create accounts, review data, or approve steps.

## How to run a task
1. Create a worktree: `git worktree add ../signalfeed-NNN -b task/NNN-short-name`.
2. Run `pnpm install` (from Task 002 onwards).
3. Start a fresh chat with: "Read `AGENTS.md` and `docs/tasks/NNN-short-name.md`, then complete the task."
4. Review the diff, check that only the listed files changed, then merge to `main`. CI must be green.

## Waves

| Wave | Task | Tier | Depends on |
|---|---|---|---|
| 1 | [001 Verify data sources](001-verify-sources.md) | 1 | none |
| 1 | [002 Project scaffold and CI](002-scaffold.md) | 1 | none |
| 2 | [003 Core contracts and types](003-core-contracts.md) | 3 | 002 |
| 3 | [004 Database schema and migrations](004-database-schema.md) | 3 | 003 |
| 3 | [005 Shared utilities](005-shared-utils.md) | 2 | 003 |
| 3 | [006 RSS collector](006-rss-collector.md) | 2 | 001, 003 |
| 3 | [007 LLM extraction and prefilter](007-llm-extraction.md) | 2 | 003 |
| 3 | [008 Extraction fixtures](008-extraction-fixtures.md) **[maintainer]** | 1 | 001, 003 |
| 3 | [009 FX rates](009-fx-rates.md) | 1 | 003 |
| 4 | [010 Pipeline store](010-pipeline-store.md) | 2 | 004, 005 |
| 4 | [011 Spend cap](011-spend-cap.md) | 2 | 004 |
| 4 | [012 Company and investor resolution](012-company-resolution.md) | 3 | 004, 005 |
| 4 | [013 Read queries and seed data](013-read-queries.md) | 2 | 004, 005 |
| 4 | [014 Extraction eval](014-extraction-eval.md) **[maintainer]** | 2 | 005, 007, 008 |
| 5 | [015 Event merging and canonical fields](015-event-merging.md) | 3 | 009, 010, 012 |
| 5 | [016 Funding table page and layout](016-funding-table-page.md) | 2 | 013 |
| 5 | [017 Company and investor pages](017-company-investor-pages.md) | 2 | 013 |
| 5 | [018 About and status pages](018-about-status-pages.md) | 1 | 013 |
| 6 | [019 Pipeline runner and CLI](019-pipeline-runner.md) | 2 | 006, 007, 010, 011, 015 |
| 6 | [020 Entity merge CLI](020-entity-merge-cli.md) | 2 | 015 |
| 7 | [021 Deployment](021-deployment.md) **[maintainer]** | 1 | 016, 017, 018, 019, 020 |
| 7 | [022 Scheduled ingest workflow](022-ingest-workflow.md) | 1 | 019 |
| 8 | [023 README, screenshots and diagram](023-readme.md) | 1 | 021, 022 |

Tier counts: 8 at Tier 1, 11 at Tier 2, 4 at Tier 3.

## Shared-file ownership

| File | Owner task |
|---|---|
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `.env.example` | 002 |
| `.github/workflows/ci.yml` | 002 (004 adds the migrations job) |
| `src/core/**` | 003 (014 may change only the default `EXTRACTION_MODEL` in `src/core/env.ts`) |
| `src/db/schema.ts`, `drizzle/**`, `drizzle.config.ts` | 004 |
| `src/app/layout.tsx` | 002, then 016 |
| `.github/workflows/ingest.yml` | 022 |
| `.github/workflows/migrate.yml` | 021 |
| `README.md` | 023 |

If a task finds it needs a dependency or a shared file it doesn't own, it stops and reports. The maintainer then adds a small follow-up task.

# Phase 2 tasks

Phase 2 is specified in `docs/spec-phase2.md`. The same rules apply as in Phase 1: one fresh agent per task, in its own worktree; tasks in a wave never touch the same file; start a wave only when every task it depends on is merged to `main`. Use `pnpm ingest`, not `pnpm pipeline` (D31).

**Extraction gate.** Task 024 changes the extraction schema and prompt. Once it is merged and its live eval passes, paid extraction can start on the hosted database. No later Phase 2 task changes extraction.

**Cuttable.** Waves 7 and 8 (Hacker News and GitHub) are optional. Phase 2 is complete without them.

## Waves

| Wave | Task | Tier | Depends on |
|---|---|---|---|
| 1 | [024 Extraction v2: region, city and tag guidance](024-extraction-v2.md) **[maintainer]** | 3 | none |
| 1 | [025 Phase 2 core contracts](025-phase2-contracts.md) | 3 | none |
| 1 | [026 UK geography: places, postcode districts and regions](026-uk-geography.md) | 2 | none |
| 2 | [027 Phase 2 database schema and migration](027-phase2-schema.md) | 3 | 025 |
| 2 | [028 Trend maths: weeks, rising score and company momentum](028-trend-maths.md) | 3 | 025 |
| 2 | [029 Targeting filter model](029-targeting-filters.md) | 2 | 025, 026 |
| 2 | [030 Server-rendered chart components](030-chart-components.md) | 2 | none |
| 3 | [031 Embedding client and tag embedding step](031-tag-embeddings.md) | 2 | 025, 027 |
| 3 | [032 Theme clustering, assignment and naming](032-themes.md) | 3 | 024, 025, 027 |
| 3 | [033 Derived stats](033-derived-stats.md) | 3 | 027, 028 |
| 3 | [035 UKRI Gateway to Research grants collector](035-gtr-collector.md) | 2 | 025, 027 |
| 3 | [036 Trend read queries and seed data](036-trend-queries.md) | 2 | 027, 028 |
| 3 | [037 Funding table targeting filters and company momentum queries](037-funding-company-queries.md) | 2 | 027, 029 |
| 4 | [034 Company locations](034-company-locations.md) | 2 | 024, 026, 027, 033 |
| 4 | [038 Grant resolution and tagging](038-grant-resolution.md) | 3 | 024, 027, 035 |
| 4 | [039 Theme clustering eval](039-theme-eval.md) **[maintainer]** | 2 | 031, 032 |
| 4 | [040 Trends and theme pages](040-trends-theme-pages.md) | 2 | 030, 036, 037 |
| 4 | [041 Acquisitions and investor activity pages](041-acquisitions-investor-pages.md) | 2 | 030, 036 |
| 4 | [042 Funding page targeting filters and company momentum](042-funding-targeting-ui.md) | 2 | 029, 030, 037 |
| 5 | [043 Pipeline integration, CLIs and workflows](043-pipeline-integration.md) | 2 | 031, 032, 033, 034, 035, 038 |
| 5 | [044 About and status page updates](044-about-status-pages.md) | 1 | 036, 038 |
| 6 | [045 Phase 2 go-live and real-data review](045-phase2-go-live.md) **[maintainer]** | 1 | 039, 043, 044 |
| 7 | [046 Hacker News Show HN and Launch HN collector](046-hn-collector.md) _(deferred, D45)_ | 2 | 043 |
| 8 | [047 GitHub star snapshots](047-github-star-snapshots.md) _(deferred, D45)_ | 2 | 046 |

Tier counts: 2 at Tier 1, 15 at Tier 2, 7 at Tier 3.

Task 034 is numbered with the stats work but runs in wave 4, because it reuses Task 033's diff-write helper.

## Shared-file ownership (Phase 2)

Only the owner may change these files in a given wave. "Then" means a later wave takes over.

| File | Owner task |
|---|---|
| `src/core/extraction-schema.ts`, `src/core/json-schema.ts`, `src/core/eval-fixture.ts` | 024 |
| Every other file in `src/core/**` | 025 |
| `src/pipeline/extract/prompt.ts`, `extract-item.ts`, `openai-client.ts` | 024 |
| `src/pipeline/extract/pricing.ts` | 031 |
| `src/eval/cli.ts` | 024, then 039 |
| `src/eval/score.ts`, `report.ts`, `recording.ts` | 024 |
| `docs/eval-results.md` | 024 |
| `src/lib/geo/**`, `scripts/geo/**` | 026 |
| `src/lib/funding-filters.ts` | 029 |
| `src/app/globals.css` | 030 |
| `src/db/schema.ts`, `drizzle/**`, `scripts/sql/roles.sql` | 027 |
| `src/pipeline/stats/diff-write.ts`, `fingerprint.ts`, `rebuild-stats.ts` | 033 |
| `src/pipeline/themes/cluster.ts` | 032, then 039 (only `DEFAULT_THEME_THRESHOLD`) |
| `src/db/seed-data.ts`, `src/db/seed.ts` | 036 |
| `src/db/queries/funding.ts`, `src/db/queries/companies.ts` | 037 |
| `src/db/queries/status.ts` | 044 |
| `src/pipeline/resolve/event-matcher.ts`, `src/pipeline/resolve/canonicalise.ts` | 038 |
| `src/components/site-header.tsx` | 040 |
| `src/app/page.tsx`, `src/components/funding-table.tsx`, `src/components/funding-filters-form.tsx`, `src/app/companies/[slug]/page.tsx` | 042 |
| `src/pipeline/run.ts`, `src/pipeline/run.test.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts` | 043, then 046, then 047 (`src/cli/pipeline.ts` only) |
| `src/pipeline/store/sources.ts`, `src/cli/themes.ts`, `package.json` (scripts) | 043 |
| `src/pipeline/sources.ts` | 046 |
| `.github/workflows/ingest.yml`, `docs/deployment.md` | 043 |
| `.github/workflows/daily.yml` | 043, then 047 |
| `docs/sources.md` | 026 (wave 1), 035 (wave 3), 046 (wave 7), 047 (wave 8), each in its own section |
| `docs/spec-phase2.md`, `docs/decisions.md`, `docs/roadmap.md` | The maintainer only |

No Phase 2 task adds a dependency. If one turns out to need one, or a shared file it does not own, it stops and reports, and the maintainer adds a small follow-up task.

# Phase 3 tasks

Phase 3 is specified in `docs/spec-phase3.md`. The same rules apply as before: one fresh agent per task, in its own worktree; tasks in a wave never touch the same file; start a wave only when every task it depends on is merged to `main`. Numbers 046 and 047 stay reserved for the deferred Hacker News and GitHub tasks, so Phase 3 starts at 048.

**No extraction change.** Phase 3 does not touch the extraction schema or prompt (spec-phase3 section 4). Nothing needs re-extracting.

**Order against Phase 2 go-live.** No Phase 3 task has to land before Task 045. Task 050 (the record-origin guard) must be merged before anything can mark a news event `confirmed`, which is why it is in wave 1. Task 066 runs after 045 has extracted at least two weeks of real news.

**No paid calls** in waves 1-6. Wave 7 (Task 067, reading SH01 documents) is cuttable and recommended to defer (D55). Phase 3 is complete without it.

## Waves

| Wave | Task | Tier | Depends on |
|---|---|---|---|
| 1 | [048 Phase 3 core contracts](048-phase3-contracts.md) | 3 | none |
| 1 | [049 Companies House key, source check and API fixtures](049-phase3-sources-fixtures.md) **[maintainer]** | 1 | none |
| 1 | [050 Record-origin guard for official events](050-record-origin-guard.md) | 3 | none |
| 2 | [051 Phase 3 database schema, migration and link store](051-phase3-schema.md) | 3 | 048 |
| 2 | [052 SIC codes, sector map, size bands and confirmation wording](052-sic-sectors-size-bands.md) | 2 | 048 |
| 2 | [053 Registry link rules, confirmation rules and the link eval](053-link-rules-eval.md) | 3 | 048 |
| 2 | [054 Companies House API client](054-companies-house-client.md) | 2 | 048, 049 |
| 2 | [055 EDGAR client and Form D parser](055-edgar-client-form-d.md) | 2 | 048, 049 |
| 3 | [056 Companies House linking, profiles and capital filings step](056-companies-house-linking.md) | 3 | 051, 052, 053, 054 |
| 3 | [057 Form D collection and CIK linking](057-form-d-collection-linking.md) | 3 | 051, 053, 055 |
| 3 | [058 Matching news reports to grant events](058-grant-news-matching.md) | 3 | 048, 050 |
| 3 | [059 Registry read queries and filter criteria version 3](059-registry-queries-criteria.md) | 2 | 048, 051, 052 |
| 4 | [060 Filing confirmations and the evidence upgrade](060-confirm-step.md) | 3 | 050, 051, 053, 056, 057 |
| 4 | [061 Registered-office locations and company sectors](061-registry-locations-sectors.md) | 2 | 051, 052, 056 |
| 4 | [062 Registry review CLI and company merges](062-registry-review-cli.md) | 2 | 051, 056, 057 |
| 4 | [063 Confirmed marker, filters and registry facts on pages](063-confirmed-marker-registry-ui.md) | 2 | 052, 059 |
| 4 | [064 About and status page updates](064-about-status-phase3.md) | 1 | 051, 059 |
| 5 | [065 Phase 3 pipeline integration, CLI and workflows](065-phase3-pipeline-integration.md) | 2 | 056, 057, 058, 060, 061, 062 |
| 6 | [066 Phase 3 go-live and link review](066-phase3-go-live.md) **[maintainer]** | 1 | 065, and 045 run |
| 7 | [067 SH01 document reader prototype](067-sh01-document-reader.md) **[maintainer]** _(deferred, D61)_ | 3 | 066 |

Tier counts: 3 at Tier 1, 8 at Tier 2, 9 at Tier 3.

## Shared-file ownership (Phase 3)

Only the owner may change these files in a given wave. "Then" means a later wave takes over. Files a task creates new (listed in its task file) belong to that task alone.

| File | Owner task |
|---|---|
| `src/core/**` | 048 (then 067: `src/core/ports.ts` only) |
| `docs/sources.md` ("Phase 3 sources" section) | 049 |
| `fixtures/companies-house/**`, `fixtures/edgar/**` | 049 |
| `src/pipeline/resolve/event-matcher.ts` | 050, then 058 |
| `src/pipeline/resolve/record-sources.test.ts` | 050 |
| `src/db/schema.ts`, `src/db/schema.test.ts`, `drizzle/**`, `scripts/sql/roles.sql` | 051 |
| `src/pipeline/registry/link-store.ts` | 051 |
| `src/lib/registry/**`, `scripts/registry/**` | 052 |
| `src/pipeline/registry/link-rules.ts`, `src/pipeline/registry/confirm-rules.ts` | 053 |
| `src/eval/cli.ts` | 053, then 067 (`--sh01` only) |
| `fixtures/registry/link-cases.json`, `fixtures/registry/README.md`, `docs/link-eval-results.md` | 053 |
| `src/pipeline/registry/testing.ts`, `ch-client.ts`, `ch-schemas.ts`, `rate-limit.ts` | 054 |
| `src/pipeline/filings/testing.ts`, `edgar-client.ts`, `form-index.ts`, `form-d-xml.ts` | 055 |
| `src/pipeline/resolve/canonicalise.ts`, `src/pipeline/resolve/resolve-extraction.ts` | 058 |
| `src/lib/funding-filters.ts`, `src/lib/filter-summary.ts` | 059 |
| `src/db/queries/funding.ts`, `src/db/queries/companies.ts`, `src/db/seed-data.ts`, `src/db/seed.ts` | 059 |
| `fixtures/registry/confirmation-cases.json` | 060 |
| `src/pipeline/stats/company-locations.ts` | 061 |
| `src/pipeline/resolve/merge-entities.ts` | 062 |
| `package.json` | 062 (the `registry` script only), then 065 |
| `src/app/page.tsx`, `src/components/funding-table.tsx`, `src/components/funding-filters-form.tsx`, `src/app/companies/[slug]/page.tsx`, `src/components/event-timeline.tsx` | 063 |
| `src/app/about/page.tsx`, `src/app/status/page.tsx`, `src/db/queries/status.ts` | 064 |
| `src/pipeline/run.ts`, `src/pipeline/run.test.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts` | 065 |
| `.github/workflows/daily.yml`, `docs/deployment.md`, `.env.example` | 065 |
| `src/pipeline/extract/openai-client.ts` | 067 |
| `docs/phase3-review.md` | 066 |
| `docs/spec-phase3.md`, `docs/decisions.md`, `docs/roadmap.md` | The maintainer only |

No Phase 3 task adds a dependency (`fast-xml-parser` is already installed). Task 067's OCR tools are installed on the runner with `apt`, not added to `package.json`. If a task turns out to need a dependency, or a shared file it does not own, it stops and reports, and the maintainer adds a small follow-up task.
