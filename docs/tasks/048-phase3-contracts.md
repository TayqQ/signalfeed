# 048 Phase 3 core contracts

- **Tier:** 3 (shared contracts every later Phase 3 task builds on). **Suggested model:** Claude Opus.
- **Depends on:** none. **Wave:** 1.

## Goal
Add the Phase 3 enums, environment settings, registry types, step stats and read models to `src/core`, so the schema, clients, rules and UI tasks can work in parallel against one contract.

## Why it matters
Enums become Postgres enums and can only be appended. Read models are what pages render, and the filter model is what Phase 4 will save. Getting these right once avoids follow-up migrations and conflicting guesses in parallel tasks.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 5, 6, 7.3, 9, 11)
- `docs/decisions.md` (D41, D51-D60)
- `src/core/enums.ts`, `src/core/domain.ts`, `src/core/read-models.ts`, `src/core/env.ts`, and their tests

## Files you may create or change
- `src/core/enums.ts`, `src/core/enums.test.ts`
- `src/core/domain.ts`
- `src/core/read-models.ts`
- `src/core/env.ts`, `src/core/env.test.ts`
- `src/core/registry.ts`, `src/core/registry.test.ts` (new)

## Steps
1. **Enums** (`enums.ts`), appended exactly as in spec section 5.1, each under a `// Phase 3` comment:
   - append `ch_allotment`, `sec_form_d` to `RECORD_KINDS`; `registered_office` to `LOCATION_SOURCES`; `registry` to `ALIAS_SOURCES`; `sec_form_d` to `FOUNDED_YEAR_SOURCES`; `document_reading` to `LLM_PURPOSES`;
   - new: `REGISTRY_KINDS`, `REGISTRY_LINK_STATUSES`, `REGISTRY_LINK_METHODS`, `LINK_DECIDED_BY`, `REGISTRY_SEARCH_OUTCOMES`, `SECTOR_SOURCES`, each with its type.
   - Extend `enums.test.ts` so it fails if an existing value is removed or reordered.
2. **`registry.ts`** (pure, no I/O):
   - `normaliseCompanyNumber(text)`: upper case, no spaces, 8 characters, left-padded with zeros when all digits ("9876543" gives "09876543"; "sc123456" gives "SC123456"); null for anything else.
   - `normaliseCik(text)`: digits only, no leading zeros; null otherwise.
   - `COMPANY_SIZE_BANDS` = `micro`, `small`, `medium`, `full_accounts`, `dormant`, `no_accounts_yet`, with `CompanySizeBand` and URL slugs (`full-accounts`, `no-accounts-yet`).
   - The normalised inputs the link rules work on (spec section 7.2): `RegistryCompanyFacts` (number, name, previous names, status, type, incorporated and ceased dates, SIC codes, office postcode and outcode, accounts type and made-up date), `CapitalFiling` (transaction id, type, filed date, action date, capital), `FormDFacts` (accession, CIK, issuer name, entity type, state, city, year of incorporation, industry group, amendment flag, first sale date, offering and sold in USD minor, filed date), and `LinkCandidateDecision` (`linked` with method, `candidate`, `none`, plus a reason string).
   - Links to Companies House and EDGAR pages: `companiesHouseUrl(number)` and `edgarCompanyUrl(cik)`.
3. **Stats types** (`domain.ts`): `RegistryStats` (companies searched, linked by method, candidates, none, skipped, profiles fetched and refreshed, filings stored, address checks, requests, `rateLimited`, `stoppedAtLimit`, `skipped` when there is no key), `FormDStats` (days fetched, days missing, filings found, stored, funds skipped, parse failures, linked by CIK, linked by name, candidates, requests), `ConfirmStats` (confirmations `DiffCounts`, events confirmed, events set back to reported, `skipped`), `SectorStats` (`DiffCounts`, rows by source, `skipped`). Add them as optional fields on `IngestStats`, and an optional `grantReportsAttached` on `ResolveStats`. Old stored runs must still type-check.
4. **Read models** (`read-models.ts`):
   - `FundingCriteria` gains `evidence?: "confirmed"` and `companySizes?: CompanySizeBand[]`.
   - `EventConfirmation` = `{ kind: RecordKind; recordDate: string; confirmsAmount: boolean; text: string }`. `FundingRow` gains `confirmation?: EventConfirmation | null`; `CompanyEventBase` gains `confirmations?: EventConfirmation[]`.
   - `CompanyRegistryView`: Companies House (number, url, name, status label, type label, incorporated on, ceased on, SIC codes with labels, size band, accounts made up to, office outcode) and SEC (CIK, url). `CompanyDetail` gains `registry?: CompanyRegistryView | null`.
   - `StatusSummary` gains optional registry, Form D and confirmation counts (spec section 11).
5. **Env** (`env.ts`): `COMPANIES_HOUSE_API_KEY` (optional), `MAX_CH_REQUESTS_PER_RUN` (default 2000), `MAX_EDGAR_DAYS_PER_RUN` (default 10), `MAX_EDGAR_REQUESTS_PER_RUN` (default 3000), in both pipeline schemas. The web schema must not gain any of them.

## Tests and acceptance criteria
- `pnpm check` passes.
- Enum tests prove every Phase 1 and Phase 2 value is unchanged and in order.
- `normaliseCompanyNumber` and `normaliseCik` cover padding, prefixes (`SC`, `NI`, `OC`), spaces, case and invalid input.
- Env tests: defaults apply; an empty `COMPANIES_HOUSE_API_KEY` counts as missing; the web schema rejects nothing new.

## Out of scope
- The database schema (051), the SIC and size tables (052), any rules or I/O.
