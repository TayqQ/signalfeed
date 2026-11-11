# 045 Phase 2 go-live and real-data review [maintainer]

- **Tier:** 1 (operations and review). **Suggested model:** Composer 2.5 or Claude Sonnet, working with the maintainer.
- **Depends on:** 039, 043, 044. **Wave:** 6.

## Goal
Migrate the hosted database, start paid extraction, backfill grants, review the first themes and locations on real data, and record the results.

## Why it matters
Thresholds and rules were tuned on fixtures. Real data is the first true test, and spend needs watching while the backlog is processed.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 13, 14, A26-A30)
- `docs/deployment.md`
- `docs/theme-eval-results.md`, `docs/eval-results.md`

## Files you may create or change
- `docs/phase2-review.md` (new)

## Steps (maintainer, with an agent's help)
1. Apply migrations to Neon with the migrate workflow. Re-run `scripts/sql/roles.sql` (it revokes web access to `grant_project_texts`). Confirm the web role cannot read it.
2. Add `OPENAI_API_KEY` if not already set. Check that prepaid credit is in place and auto-recharge is off.
3. **Backlog extraction.** Run `pnpm ingest run` hourly as normal; `MAX_EXTRACTIONS_PER_RUN` (150) works through the backlog. Watch `/status` spend. Expect about £0.20-£0.35 per month of backlog.
4. **Grants backfill** in chunks the following month: `pnpm ingest grants --since 2024-04-01 --max-pages 50`, repeated. Tagging runs at 200 projects per run. Expect about £0.45 in total.
5. **Theme review.** After about two weeks of extraction: `pnpm themes list --unreviewed`; rename unclear names; set or correct sectors; merge obvious duplicates from `suggest-merges`; move misassigned tags. Record counts and examples.
6. **Location review.** Sample 30 companies with a location and 10 without. Check town, region and precision against the source headlines. Add missing aliases by opening a small follow-up task for Task 026's files.
7. **Measure** A26-A30 on real data: tags a month, themes, share of companies with a town, a region, a postcode; grant participants kept and skipped.
8. Write `docs/phase2-review.md`: what was checked, numbers, problems found, follow-up tasks.

## Tests and acceptance criteria
- `/trends`, `/themes`, `/acquisitions`, `/investors` and the new filters work on the hosted site.
- Month-to-date spend stays under the cap, with headroom for normal ingestion.
- `docs/phase2-review.md` exists, with the measurements and any follow-up tasks listed.

## Out of scope
- Code changes. Problems found become follow-up tasks.
