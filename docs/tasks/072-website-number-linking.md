# 072 Company numbers from websites feed Companies House linking

- **Tier:** 3 (link precision). **Suggested model:** Claude Opus.
- **Depends on:** 070, and 068 merged. **Wave:** 3.5-3 (parallel with 071).

## Goal
Use a UK company number shown on a verified website as tier-0 evidence and a new `website_number` link method, under the D53 rules.

## Read first
- `AGENTS.md`, `docs/spec-phase3.5.md` (section 7), `docs/spec-phase3.md` (7.2), `docs/decisions.md` (D53, D61, D62, D63)
- `src/pipeline/registry/link-companies.ts`, `link-rules.ts`, `search-hints.ts`, `src/eval/` registry link cases

## Files you may create or change
- `src/pipeline/registry/link-companies.ts`, `link-rules.ts`, `search-hints.ts`, plus their tests
- `src/eval/` registry link cases (ch-61 onwards) and their fixtures
- `docs/decisions.md` (D65)

## Steps
1. Add a `website_number` reason. It is tier 0 when the company has a `linked` website row with a W2 or W3 rule and a `company_number_seen`.
2. Add the link rule from spec section 7: fetch the profile, match the name (current or previous) under D53, and check that the company was not dissolved before its first event. Otherwise make it a candidate.
3. Add eval cases ch-61 onwards (reseller, parent, dissolved, rebrand), plus D65.

## Tests and acceptance criteria
- The link eval stays at 0 wrong links, including the new cases.
- A W1 website never feeds this method, so there is no circular evidence.
- Nothing writes `country_code`.

## Out of scope
- UI.
