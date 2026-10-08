# Phase 1 tasks

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
