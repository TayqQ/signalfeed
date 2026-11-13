# 034 Company locations

- **Tier:** 2 (clear rules over fixed lookups). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 024, 026, 027, 033. **Wave:** 4.

## Goal
Rebuild `company_locations` from grant postcodes, news cities and news region text, following the rules in spec-phase2 section 9.1.

## Why it matters
Region, town and "near" filters read this table. The rules decide which companies a paying user sees, so they must be explicit and tested.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 5.3 and 9.1)
- `docs/decisions.md` (D12, D37, D39)
- `src/db/schema.ts` (`companies`, `extractions`, `event_sources`, `grant_participants`, `company_locations`)
- `src/core/extraction-schema.ts` (`upgradeExtraction`)
- `src/lib/geo/*.ts`
- `src/pipeline/stats/diff-write.ts`, `src/pipeline/stats/fingerprint.ts`

## Files you may create or change
- `src/pipeline/stats/company-locations.ts`, `src/pipeline/stats/company-locations.test.ts` (new)

## Steps
1. For each non-merged company, gather:
   - the latest resolved grant participant with a valid outcode;
   - `companies.city` and `country_code`;
   - the `regionText` values from the company's current extractions, through `event_sources` and `upgradeExtraction`.
2. Apply the rules in order (grant postcode, UK city, UK region, non-UK city). The region vote is the most frequent normalised value; break ties by source priority, then by the earliest item, as canonical fields do.
3. A region from text that conflicts with a town's region is ignored (the town wins). Record precision and source.
4. Write with `writeDiff`, guarded by a `locations` fingerprint (companies, extractions, grant participants).
5. Return `LocationStats`: rows by precision, ambiguous city names, unmatched UK cities. Log the 10 most common unmatched UK city strings (city names only, never article text), so gazetteer gaps can be fixed with aliases.

## Tests and acceptance criteria
- `pnpm check` passes.
- PGlite cases:
  - a grant outcode beats a news city;
  - a GB "Leeds" gives `town` with Leeds' coordinates and `yorkshire-and-the-humber`;
  - GB "Newport" is ambiguous, falls back to region text if present, and is otherwise absent;
  - a GB company with region text "Scottish" and no city gives `region` / `scotland` with no coordinates;
  - a US "Austin" gives a non-UK row with no coordinates;
  - a company with only a country has no row;
  - a merged company has no row;
  - a second run is skipped, and a forced run writes nothing.

## Out of scope
- Filtering (037), editing companies' own columns, any geocoding call.
