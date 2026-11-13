# 057 Form D collection and CIK linking

- **Tier:** 3 (it decides which news company a US filing belongs to). **Suggested model:** Claude Opus.
- **Depends on:** 051, 053, 055. **Wave:** 3.

## Goal
Build the `formd` step: walk EDGAR daily indexes, store non-fund Form D filings with organisation facts only, and link issuers to news companies by CIK or by the rules in spec-phase3 section 8.3.

## Why it matters
Form D is how US raises become `confirmed` (spec-phase3 section 8). Storing filings now also lets the go-live review count how many issuers news misses, which decides whether Form D-only events are worth adding later (open decision 1).

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 5.4, 6, 8, 9.2)
- `docs/decisions.md` (D51, D53, D58)
- `src/pipeline/filings/*` (from 055), `src/pipeline/registry/link-rules.ts`, `confirm-rules.ts`, `link-store.ts` (053, 051)
- `src/pipeline/grants/store-grants.ts` (creating a source row on first use)
- `src/db/schema.ts`

## Files you may create or change
- `src/pipeline/filings/store-form-d.ts`, `src/pipeline/filings/store-form-d.test.ts` (new)
- `src/pipeline/filings/link-form-d.ts`, `src/pipeline/filings/link-form-d.test.ts` (new)
- `src/pipeline/filings/collect-form-d.ts`, `src/pipeline/filings/collect-form-d.test.ts` (new)

## Steps
1. **`store-form-d.ts`:** create the `sec-edgar` source row (kind `sec_edgar`) on first use; insert filings by `accession_number` (`ON CONFLICT DO NOTHING`; filings never change); never store funds; record each processed day in `edgar_index_days`.
2. **`collect-form-d.ts`:** `collectFormDStep({ db, edgar, clock, since?, maxDays, maxRequests, log })`:
   - days to do: from `since` (default: the day after the latest done day, or 7 days ago on first run) to yesterday in US Eastern time, skipping days already `done`; a 404 for a weekday older than 3 days is `missing`, a 404 for a recent day is left for the next run;
   - for each day: fetch the index, then each `D` and `D/A` XML not yet stored; a parse failure is counted and logged with the accession number, and does not stop the day;
   - stop before `maxRequests`; a day is marked `done` only when every filing in it was processed.
3. **`link-form-d.ts`:** `linkFormDFilings({ db, now })` for stored filings with no `company_id`:
   - a company already linked to the CIK takes the filing;
   - otherwise build the inputs for `decideFormDLink` (companies with an exact normalised name or alias, their country, CIK link, funding rounds with USD amounts) and apply it through `link-store`;
   - on a link, set `form_d_filings.company_id` and `linked_at` for every filing of that CIK, and fill an empty `founded_year` from `year_of_inc` with source `sec_form_d`;
   - a filing with no match stays unlinked and is looked at again only when a new company or alias with that normalised name appears (keep this cheap: one query by normalised name).
4. Return `FormDStats`.

## Tests and acceptance criteria
- `pnpm check` passes. Fake EDGAR client; PGlite.
- Collection: stores the company and amendment fixtures, skips and counts the fund, makes no duplicate on a second run, resumes from the last done day, respects `maxDays` and `maxRequests`, and treats weekend 404s as `missing`.
- Linking: the "Orbital Forge" example of spec section 8.3 links and fills `sec_cik` and `founded_year`; a company with country `GB` is not linked; a CIK already linked to another company makes a merge candidate, not a link; a common name with no round within 365 days creates nothing.
- **No column of any stored row contains a name from the fixture's related persons or sales recipients.**

## Out of scope
- Creating events from Form D (not in Phase 3, D51). Confirmations (060). Wiring (065).
