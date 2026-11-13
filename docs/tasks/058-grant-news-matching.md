# 058 Matching news reports to grant events

- **Tier:** 3 (it changes the resolver and canonical fields, and can corrupt grant events). **Suggested model:** Claude Opus.
- **Depends on:** 048, 050. **Wave:** 3.

## Goal
When news reports an Innovate UK grant that SignalFeed already holds from Gateway to Research, attach the report to the grant event instead of creating a second event, and relink reports stored before Phase 3.

## Why it matters
Today a reported grant appears twice: once from GtR (`confirmed`) and once from news (`reported`). That double-counts grants on the funding table and on company pages. The roadmap asks Phase 3 to match them (spec-phase3 section 9.4).

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 9.3, 9.4)
- `docs/spec-phase2.md` (section 10.4)
- `docs/decisions.md` (D12, D40, D54, D56)
- `src/pipeline/resolve/event-matcher.ts` (after 050), `canonicalise.ts`, `resolve-extraction.ts`, `record-sources.test.ts`, `testing.ts`
- `src/pipeline/grants/resolve-grants.ts`

## Files you may create or change
- `src/pipeline/resolve/event-matcher.ts`
- `src/pipeline/resolve/canonicalise.ts`
- `src/pipeline/resolve/resolve-extraction.ts`
- `src/pipeline/resolve/grant-news.test.ts` (new)
- `src/pipeline/grants/relink-grants.ts`, `src/pipeline/grants/relink-grants.test.ts` (new)

## Steps
1. **`matchGrantRecord(db, incoming)`** in `event-matcher.ts`: for an incoming funding round with round type `grant`, look at the company's record-origin grant events (with an `event_record_sources` row of kind `ukri_grant`) and apply the rule in spec section 9.4: news date from 180 days before to 60 days after the grant start; amount within 15% of the participant's `grant_offer_minor` or `project_cost_minor`, or no news amount and exactly one grant event in the window. Nearest start date wins, then the lower event id.
2. **Resolver.** In `resolve-extraction.ts`, try `matchGrantRecord` before `findMatchingEvent` for grant rounds. A match links the report through `event_sources` to the grant event. Record a count for `ResolveStats.grantReportsAttached`.
3. **Canonical fields.** In `canonicalise.ts`, `recomputeEvent` on a record-origin event with reports:
   - keeps the record's `announced_on`, `date_precision`, round type, label, amounts and FX fields;
   - sets `source_count` from the reports;
   - sets investors to the union of the record's investor ("Innovate UK", lead) and the reports' investors, a lead if any source says so. Today's `rewriteInvestors` deletes and rewrites from reports only, which would drop Innovate UK: fix that for record-origin events.
   - `deleteOrphanEvents` is unchanged (record-origin events are kept).
4. **`relink-grants.ts`:** `relinkGrantReports({ db, fx, now, dryRun })` finds news grant events (no record source) that match a grant event by the same rule, moves their `event_sources` rows to the grant event, recomputes it, and deletes the emptied news events. Returns counts. `dryRun` lists pairs and changes nothing. Wired as `pnpm ingest relink-grants` in 065.

## Tests and acceptance criteria
- `pnpm check` passes. `pnpm eval --resolution` gives the same numbers as before.
- `grant-news.test.ts` (PGlite):
  - example C7 of spec section 9.4 attaches; the grant event keeps its amount, date, `month` precision and `confirmed`; `source_count` is 1; investors include Innovate UK as lead and the report's investors;
  - a news grant 200 days before the start, or with an amount 40% off both figures, stays a separate event;
  - with two grant events in the window and no news amount, nothing attaches;
  - re-extracting the attached report and resolving again leaves exactly one grant event, unchanged;
  - a non-grant news round of the same company never attaches to a grant event.
- `relink-grants.test.ts`: moves sources, deletes the emptied event, and a second run does nothing; `dryRun` changes nothing.

## Out of scope
- Equity confirmations from SH01 or Form D (060).
