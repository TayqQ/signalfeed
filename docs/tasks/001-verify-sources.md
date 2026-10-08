# 001 Verify data sources and external services

- **Tier:** 1 (routine research and docs). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** none. **Wave:** 1.

## Goal
Check every external assumption in `docs/spec.md` section 13 (A1-A14) against the live services and their published terms. Record the results in `docs/sources.md`.

## Why it matters
Later tasks build collectors, cost limits and deployment around these facts. A wrong feed URL or a missed licence restriction is cheap to fix now and expensive later.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 2, 3, 8, 11, 12, 13)

## Files you may create or change
- `docs/sources.md` (create)

## Instructions
1. For each RSS candidate in A1:
   - fetch the feed and confirm the URL, format (RSS 2.0 or Atom) and item count;
   - check whether `<description>` contains a usable summary;
   - estimate items per day from the publication dates;
   - note paywalls or partial feeds.

   If a URL is wrong, find the official one from the publisher's site. Do not use Google News, NewsAPI or any scraping.
2. For each publisher, find the terms of use or RSS terms. Summarise what they say about displaying headlines and links (A2), and quote the relevant clause briefly, with a link. Flag anything that restricts commercial use.
3. Check whether polling every 3 hours will miss items (A3). Recommend an interval per feed if 3 hours is too slow.
4. For A4-A13, record the current facts with links to official docs:
   - limits, keys, rate limits, User-Agent rules;
   - for OpenAI (A10): current cheap model IDs and prices per million input/output tokens, structured-output support, the prepaid and auto-recharge behaviour, and the minimum top-up;
   - free-tier allowances for Neon, Vercel and GitHub Actions.
5. Check A14: say whether committing headlines and URLs in a fixture file is consistent with each publisher's terms.
6. End with a table: `slug`, `name`, `feed_url`, `format`, `items_in_feed`, `items_per_day`, `summary_quality` (good/partial/none), `recommended_priority` (0-10, where higher means more reliable facts), `enabled_in_phase_1` (yes/no), `notes`. Task 006 copies this table into code.

## Acceptance criteria
- `docs/sources.md` covers A1-A14. Each has a status of **confirmed**, **changed** (with the new fact) or **unverifiable** (with the reason), plus a link to the source.
- The final table lists at least 4 feeds enabled for Phase 1, including at least 2 with UK/Europe coverage.
- Any fact that changes the spec, such as a cost assumption or a missing feed, is listed under a heading "Spec changes needed".
- No code or other files changed: `git diff --name-only main` shows only `docs/sources.md`.

## Out of scope
- Writing collectors or any code.
- Editing `docs/spec.md`. The maintainer applies the "Spec changes needed" items.
