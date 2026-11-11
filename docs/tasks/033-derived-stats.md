# 033 Derived stats: company themes, weekly theme stats and round momentum

- **Tier:** 3 (every chart and score reads these tables). **Suggested model:** Claude Opus.
- **Depends on:** 027, 028. **Wave:** 3.

## Goal
Rebuild `company_themes`, `theme_weekly_stats`, `weekly_totals` and `funding_round_momentum` from source tables, idempotently, writing only the rows that changed, and skipping the whole rebuild when its inputs have not changed.

## Why it matters
These tables turn events into trends. If the rebuild is not idempotent, scores drift. If it rewrites everything hourly, it wastes Neon compute and storage history (spec-phase2 section 5.6).

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 5.3 and 8)
- `docs/decisions.md` (D12, D37, D43, D44)
- `src/db/schema.ts`
- `src/lib/weeks.ts`, `src/lib/rising-score.ts`, `src/lib/company-momentum.ts`

## Files you may create or change
- `src/pipeline/stats/diff-write.ts`, `src/pipeline/stats/diff-write.test.ts` (new)
- `src/pipeline/stats/fingerprint.ts`, `src/pipeline/stats/fingerprint.test.ts` (new)
- `src/pipeline/stats/company-themes.ts` (new)
- `src/pipeline/stats/theme-weekly.ts` (new)
- `src/pipeline/stats/round-momentum.ts` (new)
- `src/pipeline/stats/rebuild-stats.ts`, `src/pipeline/stats/rebuild-stats.test.ts` (new)

## Steps
1. **`diff-write.ts`:** `writeDiff(tx, table, keyColumns, rows)` loads the current rows, then inserts new keys, updates changed rows, and deletes keys no longer produced. It returns counts. This is the only place derived rows are deleted, and only from the tables listed in spec section 5.3.
2. **`fingerprint.ts`:** `statsFingerprint(db)` hashes row counts and maximum timestamps of `events`, `funding_rounds`, `company_tags`, `tag_themes`, `themes` and `companies` (merges). `shouldRebuild(db, name, fingerprint)` compares it with `derived_rebuilds`.
3. **`company-themes.ts`:** `company_tags` joined to `tag_themes` (non-null theme) and to active themes, following `merged_into_id` for themes. Exclude merged companies. `tag_count` = number of the company's tags in that theme.
4. **`theme-weekly.ts`:** for every event of a non-merged company, its `weekStart(announced_on)`, joined to `company_themes`. Count per spec section 5.3: rounds excluding `grant`, early, later and unknown-stage rounds, grants and grant GBP, acquisitions, launches, distinct companies, rounds with an amount and total GBP (GBP from `amount_gbp_minor`, only where known). `weekly_totals` counts distinct events across all companies. Only rows with at least one event.
5. **`round-momentum.ts`:** load each company's funding rounds and call `computeRoundMomentum`. Merged companies' events have already been repointed to the survivor (Phase 1 merge).
6. **`rebuild-stats.ts`:** `rebuildStatsStep({ db, clock, force? })` checks the fingerprint, runs 3-5 in one transaction, writes the new fingerprint, and returns `DerivedStats` (rows inserted, updated, deleted per table, or `skipped`).

## Tests and acceptance criteria
- `pnpm check` passes.
- Using seeded companies, tags, themes and events (PGlite):
  - weekly counts per theme match hand-computed values, including an event in two themes counted once in `weekly_totals`, grants counted only as grants, and a Sunday event landing in the right week;
  - momentum rows match `computeRoundMomentum` for the spec's example company;
  - a second rebuild with no changes is skipped; with `force` it writes 0 inserts, 0 updates and 0 deletes;
  - adding one event changes only the affected rows (asserted through the counts);
  - merging two themes moves their companies and weekly rows to the survivor on the next rebuild;
  - a merged company contributes nothing.

## Out of scope
- `company_locations` (034), reading the tables (036, 037), wiring (043).
