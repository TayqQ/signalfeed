# 061 Registered-office locations and company sectors

- **Tier:** 2 (two rule changes in existing rebuilds, with clear rules). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 051, 052, 056. **Wave:** 4.

## Goal
Add the registered-office rule to `company_locations`, and build the `company_sectors` derived table (theme sectors, plus SIC sectors for companies with no theme sector).

## Why it matters
Only about a quarter of news companies have a town (A28). A registered office gives many more a postcode district, so "near Leeds" and region filters reach further (spec-phase3 section 7.3). SIC sectors give untagged companies a sector for the paying user's filters.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (section 7.3)
- `docs/spec-phase2.md` (section 9.1)
- `docs/decisions.md` (D37, D39, D57)
- `src/pipeline/stats/company-locations.ts` and its test, `diff-write.ts`, `fingerprint.ts`
- `src/pipeline/stats/company-themes.ts`
- `src/pipeline/registry/shared-address.ts` (056: `SHARED_ADDRESS_THRESHOLD`)
- `src/lib/registry/sic-sectors.ts` (052), `src/lib/geo/postcode.ts`, `src/lib/geo/uk-region-names.ts`

## Files you may create or change
- `src/pipeline/stats/company-locations.ts`, `src/pipeline/stats/company-locations.test.ts`
- `src/pipeline/stats/company-sectors.ts`, `src/pipeline/stats/company-sectors.test.ts` (new)

## Steps
1. **Location rule 3, registered office** (spec section 7.3). For a company with a `linked` Companies House row and an office outcode with a known centroid:
   - skip it if `ch_address_counts` marks the full postcode as shared (count at or above `SHARED_ADDRESS_THRESHOLD`), or if no count is stored yet (fail closed);
   - skip it if the company's news region text maps to an ITL1 area different from the outcode's;
   - otherwise write precision `outcode`, source `registered_office`, the outcode's centroid and ITL1 code.
   The order becomes: grant postcode, news city (UK), registered office, news region (UK), non-UK city.
2. Add `registry_links`, `ch_companies` (office postcode, outcode) and `ch_address_counts` to `LOCATION_INPUTS`, and bump `LOCATIONS_LOGIC_VERSION` to `locations-v2` so the next run rebuilds.
3. **`company-sectors.ts`:** `rebuildCompanySectors({ db, clock, force })`:
   - theme sectors: from `company_themes` joined to active themes with a sector (follow theme merges as the funding query does), source `theme`;
   - SIC sectors: only for companies with no theme sector, from the linked `ch_companies.sic_codes` through `sectorsForSic`, source `sic`;
   - diff write, a fingerprint over `company_themes`, `themes` (sector, status), `registry_links`, `ch_companies.sic_codes` and `SIC_SECTOR_MAP_VERSION`; skip when unchanged. Returns `SectorStats`.

## Tests and acceptance criteria
- `pnpm check` passes. PGlite.
- Locations: a linked company with no news town gets an `outcode` row; a news town still wins over the office; a shared postcode gives no office row; a missing count gives no office row; a news region of Scotland with an office in London gives the region row, not the office; the Phase 2 cases still pass.
- Sectors: a company with a theme sector gets only theme sectors, even with SIC codes; a company with no theme gets its SIC sectors; vague SIC codes give no row; a second run writes nothing; a theme merge moves sectors on the next rebuild.

## Out of scope
- Reading sectors on pages (059). Wiring the sectors step into `run` (065).
