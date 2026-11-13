# 052 SIC codes, sector map, size bands and confirmation wording

- **Tier:** 2 (static data and lookup tables with clear rules). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 048. **Wave:** 2.

## Goal
Commit the condensed SIC 2007 list with descriptions, map SIC codes to the 16 sectors, map Companies House accounts types to size bands, and write the wording of the "Confirmed" marker.

## Why it matters
SIC codes give a sector to companies with no theme (mostly untagged grant companies), and accounts types give the "company size" filter the targeting user asked for (spec-phase3 section 7.3). Both are pure lookups, so they belong in tested code, not in queries.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (section 7.3)
- `docs/decisions.md` (D35, D57, D59)
- `src/core/sectors.ts`, `src/core/registry.ts` (from 048)
- `scripts/geo/README.md` (the pattern for committed open data)

## Files you may create or change
- `src/lib/registry/sic-codes.json`, `src/lib/registry/sic-codes.ts`, `src/lib/registry/sic-codes.test.ts` (new)
- `src/lib/registry/sic-sectors.ts`, `src/lib/registry/sic-sectors.test.ts` (new)
- `src/lib/registry/company-size.ts`, `src/lib/registry/company-size.test.ts` (new)
- `src/lib/registry/confirmation-text.ts`, `src/lib/registry/confirmation-text.test.ts` (new)
- `src/lib/registry/ch-labels.ts`, `src/lib/registry/ch-labels.test.ts` (new)
- `scripts/registry/build-sic-codes.ts`, `scripts/registry/README.md` (new)

## Steps
1. **SIC list.** Find Companies House's "condensed SIC codes" list (SIC 2007, used on the register). Check its licence (expect the Open Government Licence) and record the URL, date and licence in `scripts/registry/README.md`. `build-sic-codes.ts` turns the downloaded CSV into `sic-codes.json` (`{ "62012": "Business and domestic software development", ... }`). Commit the JSON only, not the download. Expect about 730 codes and under 60 KB.
2. **`sic-codes.ts`:** `sicLabel(code)` and `isKnownSic(code)`. Unknown codes return null; the page then shows the code alone.
3. **`sic-sectors.ts`:** `sectorsForSic(codes: string[]): Sector[]`, sorted and without repeats.
   - A table by SIC division (the first two digits), with 5-digit exceptions that win.
   - The vague codes in spec section 7.3 map to nothing: `70229`, `74909`, `82990`, `96090`, `99999`, `98000`. Add others only by the same rule ("says nothing about what the company makes or does"), and list them in a comment.
   - Every division present in `sic-codes.json` must have an explicit entry, even if it is "no sector". A test enforces it.
   - `SIC_SECTOR_MAP_VERSION` (a string), bumped when the table changes, so the sectors rebuild (061) knows to run.
4. **`company-size.ts`:** `sizeBandForAccounts(accountsType: string | null): CompanySizeBand` and `sizeBandLabel(band)`, as the table in spec section 7.3. Labels: "Micro", "Small", "Medium", "Full accounts (size not stated)", "Dormant", "No accounts filed yet". Null or empty input gives `no_accounts_yet`. Any other unknown string gives `full_accounts` (size not stated) and is reported by `isKnownAccountsType`, so the registry step can log it: a new Companies House type must be noticed, not hidden.
5. **`confirmation-text.ts`:** `confirmationText({ kind, recordDate, confirmsAmount, amountUsdMinor? })` gives the marker wording in spec section 9.1, in British English, with dates as "2 February 2026" and money via `src/lib/format.ts`: "Confirmed: shares allotted on 2 February 2026 (Companies House SH01)"; "Confirmed: Form D, $4.4M sold, first sale 5 January 2026 (SEC)"; "Confirmed: Innovate UK grant (UKRI Gateway to Research)". It lives in `src/lib` because pages must not import `src/pipeline`.
6. **`ch-labels.ts`:** `companyStatusLabel(status, detail)` and `companyTypeLabel(type)`, using Companies House's own wording from the `api-enumerations` constants ("Active", "Dissolved", "In Administration", "Private limited company"). Unknown values show as given.

## Tests and acceptance criteria
- `pnpm check` passes.
- Every account type in the Companies House `api-enumerations` constants (listed in spec section 7.3) has a band.
- The spec examples: `62012` gives `software-ai`; `21100` gives `health-life-sciences`; `64999` gives `financial-services`; `35110` gives `climate-energy`; `85590` gives `education`; each vague code gives no sector; `["62012", "70229"]` gives `["software-ai"]`.
- Every division in the committed list has a map entry.
- `confirmationText` gives the three example sentences above.

## Out of scope
- Writing `company_sectors` (061). Showing labels (063).
