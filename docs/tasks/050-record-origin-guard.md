# 050 Record-origin guard for official events

- **Tier:** 3 (it changes how news reports match events, and a mistake creates duplicates or corrupts grants). **Suggested model:** Claude Opus.
- **Depends on:** none. **Wave:** 1.

## Goal
Change the Phase 2 protection of grant events from "skip events with `evidence = confirmed`" to "skip events created from an official record" (events with an `event_record_sources` row), so that confirmed news events still match later news reports.

## Why it matters
Phase 3 marks news rounds as `confirmed` when a filing backs them (spec-phase3 section 9.3). With today's guard, the next news report of a confirmed round would not match it, and would create a duplicate event. The guard must change before anything can set a news event to `confirmed`. On today's data the behaviour is identical, because only grant events are confirmed.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (section 9.3)
- `docs/spec-phase2.md` (section 10.4)
- `docs/decisions.md` (D12, D40, D54)
- `src/pipeline/resolve/event-matcher.ts`, `src/pipeline/resolve/canonicalise.ts` (`deleteOrphanEvents`, `recomputeEvent`)
- `src/pipeline/resolve/record-sources.test.ts`, `src/pipeline/resolve/testing.ts`
- `src/db/schema.ts` (`events`, `event_record_sources`)

## Files you may create or change
- `src/pipeline/resolve/event-matcher.ts`
- `src/pipeline/resolve/record-sources.test.ts`

## Steps
1. Replace `notConfirmed()` with `notFromRecord()`: a `not exists (select 1 from event_record_sources where event_id = events.id)` condition. Use it everywhere `notConfirmed()` was used: `matchFunding`, `matchAcquisition`, `matchLaunch` and `corroboratesFor`.
2. Update the comments, citing spec-phase3 section 9.3.
3. Check that nothing else in `src/pipeline` treats `evidence = 'confirmed'` as "came from a record". If something does, list it in your report instead of editing a file you do not own.

## Tests and acceptance criteria
- `pnpm check` passes. Every existing test in `record-sources.test.ts` and the resolve tests still passes unchanged.
- New cases in `record-sources.test.ts` (PGlite):
  - a news funding round whose `evidence` was set to `confirmed` by hand, with no record source, **is** matched by a second report of the same round (same company, 10 days apart, same round type);
  - it also still corroborates a fuzzy company match;
  - a grant event (with a record source) is still never matched, whatever its `evidence`;
  - a grant event whose `evidence` was set to `reported` by hand is still never matched.
- `pnpm eval --resolution` gives the same numbers as before.

## Out of scope
- Setting evidence (060). Matching news reports to grant events (058).
