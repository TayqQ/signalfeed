# 038 Grant resolution and tagging

- **Tier:** 3 (it touches Phase 1 resolution code and can corrupt events). **Suggested model:** Claude Opus.
- **Depends on:** 024, 027, 035. **Wave:** 4.

## Goal
Turn collected grant participants into companies and `confirmed` grant events, tag grant projects with a small batched LLM call, and protect grant events from the news resolver.

## Why it matters
Grants only help users once they appear as companies with tags, locations and events. Grant events must never be overwritten or deleted by news re-extraction (spec-phase2 section 10.4).

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 4.2, 10.3, 10.4)
- `docs/decisions.md` (D11, D12, D19, D29, D40)
- `src/pipeline/resolve/company-matcher.ts`, `src/pipeline/resolve/investor-matcher.ts`, `src/pipeline/resolve/event-matcher.ts`, `src/pipeline/resolve/canonicalise.ts`, `src/pipeline/resolve/resolve-extraction.ts`, `src/pipeline/resolve/testing.ts`
- `src/pipeline/extract/extract-item.ts` (the budget pattern), `src/core/json-schema.ts`
- `src/db/schema.ts` (grant tables, `event_record_sources`)
- `src/lib/normalise.ts`

## Files you may create or change
- `src/pipeline/grants/resolve-grants.ts`, `src/pipeline/grants/resolve-grants.test.ts` (new)
- `src/pipeline/grants/tag-grants.ts`, `src/pipeline/grants/tag-grants.test.ts` (new)
- `src/pipeline/grants/grant-tag-prompt.ts` (new)
- `src/pipeline/resolve/event-matcher.ts`
- `src/pipeline/resolve/canonicalise.ts`
- `src/pipeline/resolve/record-sources.test.ts` (new)

## Steps
1. **Protect grant events.**
   - In `event-matcher.ts`, candidate events with `evidence = 'confirmed'` are never matched.
   - In `canonicalise.ts`, `deleteOrphanEvents` keeps events that have an `event_record_sources` row.
   - `recomputeEvent` on an event with no extraction evidence must leave its detail row untouched (it already does; add a test).
2. **`tag-grants.ts`:** `tagGrantsStep({ db, llm, budget, model, maxProjects, runId })`:
   - pick projects with kept participants and no `grant_taggings` row for prompt version `grant-tags-v1` and this model;
   - batch 20 per call;
   - input per project: id, title, and the abstract cut to 800 characters;
   - strict output `{ projects: [{ id, tags }] }`, tags normalised with `normaliseTag`, at most 5;
   - the tag rules are the same wording as extraction v2 (spec section 4.2), kept in `grant-tag-prompt.ts`;
   - budget check before and usage record after each call, purpose `tagging`;
   - store one `grant_taggings` row per project, splitting tokens and cost evenly, with the remainder on the first.
3. **`resolve-grants.ts`:** `resolveGrantsStep({ db, fx, now })`. For each participant with `resolved_at IS NULL` and `org_fetched_at` set, in one transaction:
   - **company:** by `reg_number` = `companies.uk_company_number` first; otherwise `resolveCompany` with name, `GB` and the project's tags (if tagged). Corroboration is always false, so fuzzy names become merge candidates, never merges. Fill an empty `uk_company_number` if no other company has it. New aliases use source `grant`;
   - **event:** always new, as in spec section 10.4 (round type `grant`, label = grant category, GBP amount, `announced_on` from `start_on` with `month` precision, `evidence = confirmed`, `source_count = 0`). Investor "Innovate UK" (kind `government`) as lead, through `resolveInvestor`. Insert `event_record_sources`;
   - **tags:** insert `company_tags` with source `grant` from the project's tagging, `ON CONFLICT DO NOTHING`, so repeats never inflate `mention_count`;
   - set `company_id`, `event_id`, `resolved_at`.
   - Participants with no grant offer or no start date get `skipped_reason` and `resolved_at`.
   - Projects tagged after their participants were resolved: each run also applies any `grant_taggings` tags to the companies of already-resolved participants, with the same `ON CONFLICT DO NOTHING` insert. Tagging and resolution can therefore run in either order, and a run without an LLM key still resolves grants.
4. USD amounts are filled by the existing FX step; make sure grant events are picked up by its "unconverted" query (they have `amount_minor` and no `amount_usd_minor`).

## Tests and acceptance criteria
- `pnpm check` passes. Fake LLM only.
- `record-sources.test.ts`:
  - a news funding round of the same company within 45 days does not match a grant event;
  - re-extracting the news item that created a nearby news event never deletes the grant event;
  - a company merge keeps the grant event and its amount.
- Resolve (PGlite):
  - a `reg_number` match beats name matching;
  - a new company gets `uk_company_number`;
  - a duplicate `reg_number` on another company is not overwritten;
  - the event has the right type, amount, precision, evidence and investor;
  - a second run does nothing;
  - a participant at two projects gets two events and one company.
- Tagging:
  - batches of 20;
  - ids not sent are ignored;
  - a budget refusal stops cleanly;
  - tags reach `company_tags` with source `grant`;
  - each project is tagged once per prompt version and model.

## Out of scope
- Collection (035), wiring (043), matching grants to news events (Phase 3).
