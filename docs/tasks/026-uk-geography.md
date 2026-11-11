# 026 UK geography: places, postcode districts and regions

- **Tier:** 2 (open-data preparation and pure lookups). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** none. **Wave:** 1.

## Goal
Build static, committed lookups for UK towns and cities, postcode districts and ITL1 regions, plus pure functions to match a city name, a region phrase or a postcode to a location and to measure distance.

## Why it matters
Town, region and "near a place" filters (spec-phase2 section 9.1) all depend on these lookups. Committing them as data keeps the pipeline deterministic and keeps the network out of tests.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (section 9.1, A21-A23)
- `docs/decisions.md` (D39)
- `docs/sources.md` (format of a verified source entry)
- `src/lib/normalise.ts`, `src/lib/regions.ts`

## Files you may create or change
- `scripts/geo/build-uk-geo.ts`, `scripts/geo/README.md` (new)
- `src/lib/geo/uk-places.json`, `src/lib/geo/uk-outcodes.json` (generated, new)
- `src/lib/geo/uk-regions.ts`, `src/lib/geo/uk-regions.test.ts` (new)
- `src/lib/geo/uk-region-names.ts`, `src/lib/geo/uk-region-names.test.ts` (new)
- `src/lib/geo/uk-places.ts`, `src/lib/geo/uk-places.test.ts` (new)
- `src/lib/geo/postcode.ts`, `src/lib/geo/postcode.test.ts` (new)
- `src/lib/geo/distance.ts`, `src/lib/geo/distance.test.ts` (new)
- `docs/sources.md` (the "A21-A23 — UK geography" section only)

## Steps
1. **Verify sources (A21-A23).** Confirm the licence, fields and coverage of:
   - a GB city and town list with coordinates and region: OS Open Names (`LOCAL_TYPE` City and Town, BNG coordinates) or the ONS Index of Place Names (lat/long). Pick one and say why;
   - a Northern Ireland town list under an open licence (for example NISRA settlements);
   - postcode district centroids: Code-Point Open (GB, OGL) aggregated by outcode, or the ONS Postcode Directory. Note the separate licence on Northern Ireland postcodes;
   - ITL1 January 2025 names and codes, including TLN.

   Record each in `docs/sources.md` with links, licence, attribution wording and the date checked. If a source's licence is unclear, stop and report.
2. **Build script.** `scripts/geo/build-uk-geo.ts` reads downloaded files from a directory passed as an argument (never from inside the repo, never fetched by tests) and writes the two JSON files, sorted, with stable formatting. Convert BNG to WGS84 with a standard Helmert transform if needed (5 m accuracy is plenty). Document the exact download steps in `scripts/geo/README.md`. Run it with `pnpm exec tsx`; do not add a package script.
3. **`uk-places.json`:** `{ slug, name, aliases[], itl1, lat, lon, populationBand }` per city and town, with lat/lon to 4 decimal places. Slugs are unique: a repeated name gets the county or council area appended (`newport-wales`, `newport-isle-of-wight`). `populationBand` is 1-6 (under 10k up to 1M+), from the source's population figures where available, otherwise from place type. Keep the file under 300 KB.
4. **`uk-outcodes.json`:** `{ outcode: [lat, lon, itl1] }`, under 200 KB.
5. **`uk-regions.ts`:** `UK_REGIONS` (slug, ITL1 code, name, from spec section 9.1), `ukRegionBySlug`, `ukRegionByCode`, and `ukRegionFromGtrName("North West")`.
6. **`uk-region-names.ts`:** `ukRegionFromText(text)` maps a region, nation or county phrase to an ITL1 slug, or null: nations and adjectives ("Scottish", "Welsh", "Northern Irish"), English regions ("Yorkshire", "the North East"), ceremonial counties ("Kent", "Cornwall", "Greater Manchester"), and common city regions ("West Midlands"). Ambiguous phrases ("the Midlands", "the North", "the South") return null. Matching is normalised and whole-phrase, never substring.
7. **`uk-places.ts`:** `normalisePlaceName`, `findPlaceBySlug`, and `matchUkCity(city)`, returning `{ place } | { ambiguous: true } | null` with the rules in spec section 9.1: aliases ("Greater London", "City of London", "London, UK"), suffixes stripped (", UK", ", England"), and the larger place chosen only when it is at least two population bands bigger.
8. **`postcode.ts`:** `parseUkPostcode` (validates the format, returns `{ outcode, incode }` or null) and `outcodeCentroid(outcode)`.
9. **`distance.ts`:** `haversineKm(a, b)` and `boundingBox(centre, km)` for SQL prefilters.

## Tests and acceptance criteria
- `pnpm check` passes. No test touches the network.
- `matchUkCity`: "Leeds" and "leeds" match; "Greater London" is London; "Newport" is ambiguous; "Springfield" is null; an alias with ", UK" matches.
- `ukRegionFromText`: "Scottish" and "Edinburgh-based Scottish" phrases map to `scotland` only for whole phrases; "Kent" is `south-east`; "the Midlands" is null.
- `parseUkPostcode("L35 9JJ")` gives outcode `L35`; invalid strings give null. Every outcode in the JSON has an ITL1 code.
- `haversineKm(Leeds, Bradford)` is about 13 km (±2); `boundingBox` contains every point within the radius in a randomised test with a fixed seed.
- Every place has a valid ITL1 code, unique slug and coordinates inside the UK bounding box. Both JSON files are within their size limits.
- `docs/sources.md` records sources, licences and attribution.

## Out of scope
- Storing locations in the database (Tasks 027 and 034) and filtering (029, 037).
- Non-UK gazetteers.
