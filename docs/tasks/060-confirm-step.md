# 060 Filing confirmations and the evidence upgrade

- **Tier:** 3 (it changes `events.evidence`, which users see as "confirmed"). **Suggested model:** Claude Opus.
- **Depends on:** 050, 051, 053, 056, 057. **Wave:** 4.

## Goal
Build the `confirm` step: rebuild `event_confirmations` from stored SH01 and Form D filings with the rules from 053, and set `events.evidence` on news events to match.

## Why it matters
This is the Phase 3 goal: a news raise marked `confirmed` because an official filing backs it (spec-phase3 section 9). It must be derived, repeatable and safe: a wrong confirmation tells users something false about a company.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 9.1-9.3, 12)
- `docs/decisions.md` (D12, D37, D54)
- `src/pipeline/registry/confirm-rules.ts` (053)
- `src/pipeline/stats/diff-write.ts`, `src/pipeline/stats/fingerprint.ts`, `src/pipeline/stats/company-locations.ts` (the rebuild pattern)
- `src/db/schema.ts` (`events`, `funding_rounds`, `event_record_sources`, `event_confirmations`, `ch_filings`, `form_d_filings`, `registry_links`)

## Files you may create or change
- `src/pipeline/registry/confirm-events.ts`, `src/pipeline/registry/confirm-events.test.ts` (new)
- `fixtures/registry/confirmation-cases.json` (new)
- `src/pipeline/registry/confirmation-cases.test.ts` (new)

## Steps
1. **Inputs.** Funding rounds of companies with a `linked` registry row (not merged), their `announced_on`, precision, round type and USD amount; `ch_filings` of type SH01 for the linked numbers; `form_d_filings` with a `company_id` (follow merges to the survivor).
2. **Compute.** For each company, apply `allotmentConfirms` and `formDConfirms`, then `assignRecords` (one record, one event). Produce rows for `event_confirmations` with `rule` (`ch_allotment_window` or `form_d_window`), `record_date` and `confirms_amount`.
3. **Write.** In one transaction: `writeDiff` on `event_confirmations`; then set `events.evidence = 'confirmed'` on news events (no `event_record_sources` row) that have a confirmation, and `reported` on news events that have none but are `confirmed`. Never change an event that has a record source.
4. **Fingerprint.** `CONFIRM_LOGIC_VERSION` plus inputs: events and funding rounds (ids, dates, round types, USD amounts), `registry_links` (status), `ch_filings`, `form_d_filings` (company ids). Skip when unchanged, unless `force`.
5. **`confirmStep({ db, clock, force })`** returns `ConfirmStats`.
6. **Confirmation cases.** About 20 labelled event-and-filing pairs in `fixtures/registry/confirmation-cases.json` (invented companies), including C1-C6 from spec section 9.2, tranches (two SH01s for one round), two rounds close together, a `year`-precision event, a debt round, and a Form D amendment. `confirmation-cases.test.ts` runs them through the step on PGlite and asserts no wrong confirmation.

## Tests and acceptance criteria
- `pnpm check` passes. PGlite only.
- C1-C6 give the results in the spec table; a second run writes nothing; removing the SH01 (or demoting the link) sets the event back to `reported` on the next run; a grant event is never changed; a deleted news event's confirmations go with it, and the next rebuild confirms its replacement.
- A news event confirmed by this step is still matched by a later report of the same round (relies on 050; add one end-to-end test).
- The confirmation cases test passes with no wrong confirmation.

## Out of scope
- Rendering (063). Reading SH01 documents (067).
