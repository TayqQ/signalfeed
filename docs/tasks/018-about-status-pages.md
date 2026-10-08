# 018 About and status pages

- **Tier:** 1 (simple pages using existing queries). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 013. **Wave:** 5.

## Goal
Build `/about` (methodology, sources, what is stored, limitations, licence) and `/status` (pipeline health and spend against the cap).

## Why it matters
Being open about methodology and limits is part of the product's credibility. The status page also shows at a glance that ingestion is running and spending stays under the cap.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 2, 3, 8, 9, 11)
- `docs/sources.md`
- `src/core/read-models.ts`
- `src/db/queries/status.ts`, `src/db/web.ts`
- `src/lib/cached.ts`, `src/lib/format.ts`

## Files you may create or change
- `src/app/about/page.tsx`
- `src/app/status/page.tsx`

## Requirements
- **About** (static content, written for users):
  - what SignalFeed does;
  - how data flows (collect, extract, merge);
  - the enabled sources with links and attribution;
  - "We store headlines, links and extracted facts; we never republish article text";
  - no personal data;
  - limitations: news-based coverage only, extraction errors are possible, amounts are as reported, coverage starts on the first ingest date;
  - how to report an error (link to GitHub issues);
  - the AGPL-3.0 licence.
- **Status** (dynamic, cached for 60 seconds):
  - the last 10 ingest runs (start time, duration, status, items collected/extracted, spend);
  - item counts by status;
  - event counts by type;
  - month-to-date LLM spend in £ and $, against the cap, with a simple progress bar;
  - a "budget paused" notice if the latest run's status is `budget_paused`.

  Show a clear empty state before the first run.

## Acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL`.
- Manual check with seed data: the status page renders the runs, and the spend bar reflects the seeded `llm_usage`.

## Out of scope
- Navigation links (016 adds them), alerts.
