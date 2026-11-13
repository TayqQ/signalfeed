# 059 Registry read queries and filter criteria version 3

- **Tier:** 2 (queries and a filter model extension with clear rules). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 048, 051, 052. **Wave:** 3.

## Goal
Read confirmations and registry facts into the existing read models, and add the `evidence` and `cosize` filters to the canonical filter model (version 3).

## Why it matters
The UI tasks (063, 064) render read models only. The filter model is a contract that Phase 4 saved searches will store, so the new parameters must keep canonical serialisation and old URLs intact (D41, D60).

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 7.3, 9.1, 11)
- `docs/spec-phase2.md` (sections 9.2, 9.3)
- `docs/decisions.md` (D41, D57, D59, D60)
- `src/core/read-models.ts`, `src/core/registry.ts` (048)
- `src/lib/funding-filters.ts`, `src/lib/filter-summary.ts` and tests
- `src/db/queries/funding.ts`, `src/db/queries/companies.ts` and tests
- `src/db/seed-data.ts`, `src/db/seed.ts`
- `src/lib/registry/company-size.ts`, `src/lib/registry/sic-codes.ts`, `src/lib/registry/confirmation-text.ts`, `src/lib/registry/ch-labels.ts` (052)

## Files you may create or change
- `src/lib/funding-filters.ts`, `src/lib/funding-filters.test.ts`
- `src/lib/filter-summary.ts`, `src/lib/filter-summary.test.ts`
- `src/db/queries/funding.ts`, `src/db/queries/funding.test.ts`
- `src/db/queries/companies.ts`, `src/db/queries/companies.test.ts`
- `src/db/seed-data.ts`, `src/db/seed.ts`

## Steps
1. **Filter model.** `FUNDING_CRITERIA_VERSION = 3`, with the version note. Parse and serialise `evidence` (only `confirmed`) and `cosize` (multi, the slugs in spec section 11). Canonical order: append the new keys after the version 2 keys. Version 2 URLs parse to the same criteria as before.
2. **Summary.** `describeFundingCriteria` covers both ("Confirmed seed rounds at micro and small companies, …"). British English, as the existing wording.
3. **Funding query** (`funding.ts`):
   - `evidence=confirmed` filters `events.evidence = 'confirmed'`;
   - `cosize` matches companies linked to Companies House whose `ch_companies.accounts_type` falls in any chosen band. Do the band mapping in SQL from the table in `company-size.ts` (generate the `IN` lists from the TypeScript table so they cannot drift);
   - the sector filter matches `company_sectors` **or** the existing theme join (spec section 11), so it never returns fewer rows while `company_sectors` is empty;
   - each row gains `confirmation`: the closest `event_confirmations` row (record date nearest the event, then record kind, then id), with its text from `confirmationText` (`src/lib/registry/confirmation-text.ts`, 052) built in TypeScript from the row's fields. Grant events with no confirmation row get a grant confirmation ("Confirmed: Innovate UK grant (UKRI Gateway to Research)").
4. **Company query** (`companies.ts`): `registry` from the linked `registry_links` rows and `ch_companies` (status and type labels from `src/lib/registry/ch-labels.ts`, SIC codes with labels, size band, outcode only, never the full postcode, links via `companiesHouseUrl` and `edgarCompanyUrl`); each event's `confirmations`; sectors from `company_sectors` when present, else as before. Candidates and rejected links are never read.
5. **Seed data.** Add a few registry rows to the seed: one linked UK company with an SH01 confirmation, one dormant company, one US company with a Form D confirmation, so `pnpm dev` shows every new state.

## Tests and acceptance criteria
- `pnpm check` passes.
- Filter round-trips: parse(serialise(c)) equals c, serialising is idempotent, version 2 URLs are unchanged, invalid values are dropped.
- Queries (PGlite): `evidence=confirmed` returns only confirmed events; each `cosize` band; a company with no link never matches `cosize`; the sector filter with and without `company_sectors` rows; the confirmation text and choice of the closest record; the company page never exposes `office_postcode` (assert on the serialised read model); candidate links never appear.

## Out of scope
- Rendering (063, 064). Writing confirmations or sectors (060, 061). The status query (064).
