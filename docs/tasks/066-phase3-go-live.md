# 066 Phase 3 go-live and link review [maintainer]

- **Tier:** 1 (operations and review). **Suggested model:** Composer 2.5 or Claude Sonnet, working with the maintainer.
- **Depends on:** 065, and Task 045 having run with at least two weeks of real extraction. **Wave:** 6.

## Goal
Migrate the hosted database, run the Companies House and Form D backfills, relink reported grants, and check links and confirmations on real data before relying on them.

## Why it matters
The link rules were tuned on invented cases. A wrong link puts a real company's status, age or size on the wrong page. Real data is the first true test, and the review decides whether automatic linking stays as strict as planned or gets stricter (spec-phase3 section 12).

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 7, 8, 9, 12, 13, A41-A47)
- `docs/deployment.md` ("Phase 3")
- `docs/link-eval-results.md`

## Files you may create or change
- `docs/phase3-review.md` (new)

## Steps (maintainer, with an agent's help)
1. **[maintainer]** Add the `COMPANIES_HOUSE_API_KEY` secret to GitHub Actions (not Vercel). Set the `HTTP_CONTACT` repository variable to the email address chosen in 049.
2. Apply the migration with the migrate workflow. Re-run `scripts/sql/roles.sql`. Confirm the web role can read the new tables and still cannot read `source_item_texts` or `grant_project_texts`.
3. **Grant relink.** `pnpm ingest relink-grants --dry-run`, check the pairs by eye, then run it for real.
4. **Companies House backfill.** Run `pnpm ingest registry --max-requests 2000` by hand (or let the daily job do it) until no company is due. About 15 runs for 6,000 companies. Watch `/status` for 429s.
5. **Form D backfill.** `pnpm ingest formd --since 2026-05-01 --max-days 60`, repeated until yesterday.
6. **Link review.** Sample 50 automatic links (stratified by method) and 20 open candidates. For each, check the Companies House or EDGAR page against the company's news. Record right or wrong, and why. **[maintainer]** decides the candidates you are sure of with `pnpm registry link` or `reject`.
   - **Target: at most 1 wrong automatic link in 50.** If there are more, open a follow-up task to tighten the rule that failed (for example, S2 alone no longer enough), with the failing cases added to `fixtures/registry/link-cases.json`. Until then, note it on `/about`.
7. **Confirmation review.** Sample 20 confirmed events and 10 linked companies' rounds that stayed `reported`. Check the SH01 or Form D against the news.
8. **Location review.** Sample 20 registered-office locations. Note any formation-agent address that got through, and the share of linked companies dropped as shared addresses (A47).
9. **Measure** A41, A44, A45 and A47: link rate for UK news and grant companies, founded-year coverage before and after, share of companies with a postcode district before and after, candidates a month, Form D filings a month, and how many are tech or health issuers under five years old with no news company (for open decision 1).
10. Write `docs/phase3-review.md`: what was checked, the numbers, problems found, follow-up tasks, and a recommendation on Task 067.

## Tests and acceptance criteria
- Confirmed markers, filters and registry blocks work on the hosted site.
- No LLM spend from Phase 3 steps (the `llm_usage` purposes are unchanged).
- `docs/phase3-review.md` exists with the measurements and decisions.

## Out of scope
- Code changes. Problems found become follow-up tasks.
