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
- `fixtures/themes/real-tags.json` and `fixtures/themes/README.md` (the real-tag answer key, step 6)

## Steps (maintainer, with an agent's help)
1. Apply migrations to Neon with the migrate workflow. Re-run `scripts/sql/roles.sql` (it revokes web access to `grant_project_texts`). Confirm the web role cannot read it.
2. Add `OPENAI_API_KEY` if not already set. Check that prepaid credit is in place and auto-recharge is off.
3. **Backlog extraction.** Run `pnpm ingest run` hourly as normal; `MAX_EXTRACTIONS_PER_RUN` (150) works through the backlog. Watch `/status` spend. Expect about £0.20-£0.35 per month of backlog.
4. **Grants backfill** the following month. Follow `docs/deployment.md`: run one full project walk (`pnpm ingest grants --since 2024-04-01 --max-pages 400`), then repeat runs to fetch the remaining organisations. A repeated `--max-pages 50` run only re-reads pages 1-3, because the walk stops after 3 pages with nothing new. Tagging runs at 200 projects per run. Expect about £0.45 in total. Confirm the GtR attribution wording on the About page against UKRI's own guidance.
5. **Theme review.** After about two weeks of extraction: `pnpm themes list --unreviewed`; rename unclear names; set or correct sectors; merge obvious duplicates from `suggest-merges`; move misassigned tags. Record counts and examples.
6. **Real-tag answer key (D50).** Export about 100 real tags with their current themes. The maintainer approves or corrects the groupings once (about 20 minutes), following the market rule in `fixtures/themes/README.md`. Save them as `fixtures/themes/real-tags.json`. Re-run the theme eval on them, comparing the strict and balanced settings. This replaces the agent-written set as the measure of quality.
7. **Theme check with company context (follow-up task).** If recall on real tags is weak, open a task to give the check each tag's company one-line description, which real data provides. Measure it on the real-tag key. If open grouping is still weak after that, open a task to classify tags into a curated list of about 100 named markets under the 16 sectors.
8. **Location review.** Sample 30 companies with a location and 10 without. Check town, region and precision against the source headlines. Add missing aliases by opening a small follow-up task for Task 026's files.
9. **Measure** A26-A30 on real data: tags a month, themes, share of companies with a town, a region, a postcode; grant participants kept and skipped.
10. Write `docs/phase2-review.md`: what was checked, numbers, problems found, follow-up tasks.

## Tests and acceptance criteria
- `/trends`, `/themes`, `/acquisitions`, `/investors` and the new filters work on the hosted site.
- Month-to-date spend stays under the cap, with headroom for normal ingestion.
- `docs/phase2-review.md` exists, with the measurements and any follow-up tasks listed.

## Out of scope
- Code changes. Problems found become follow-up tasks.
