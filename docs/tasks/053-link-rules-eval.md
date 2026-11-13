# 053 Registry link rules, confirmation rules and the link eval

- **Tier:** 3 (the rules decide which company a filing belongs to; a wrong link misleads users). **Suggested model:** Claude Opus.
- **Depends on:** 048. **Wave:** 2.

## Goal
Write the linking and confirmation rules as pure functions, and a labelled eval (`pnpm eval --links`) that proves they make no wrong automatic link on hard cases.

## Why it matters
Hands-off running needs automatic, high-precision rules (D53). Pure functions over normalised facts can be tested exhaustively and replayed with no network. The Companies House step (056), the Form D step (057) and the confirm step (060) all call these functions, so the rules exist in exactly one place.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 7.2, 8.3, 9.1, 9.2, 12)
- `docs/decisions.md` (D11, D29, D53, D54)
- `src/core/registry.ts` (from 048)
- `src/lib/normalise.ts`, `src/lib/geo/postcode.ts`, `src/lib/geo/distance.ts`
- `src/eval/resolution.ts`, `src/eval/cli.ts`, `fixtures/resolution/README.md` (the eval pattern)

## Files you may create or change
- `src/pipeline/registry/link-rules.ts`, `src/pipeline/registry/link-rules.test.ts` (new)
- `src/pipeline/registry/confirm-rules.ts`, `src/pipeline/registry/confirm-rules.test.ts` (new)
- `src/eval/links.ts`, `src/eval/links.test.ts` (new)
- `src/eval/cli.ts` (add `--links` only)
- `fixtures/registry/link-cases.json`, `fixtures/registry/README.md` (new)
- `docs/link-eval-results.md` (new, generated)

## Steps
1. **Name matching** (`link-rules.ts`): `registryNameMatch(companyNames, registryName, previousNames)` returns `exact`, `prefix` or `none`, by spec section 7.2 (`normaliseCompanyName`, `&` read as "and", previous names count for exact only, prefix means the company name followed by a space).
2. **Companies House decision:** `decideChLink(input)` where the input holds the company's facts (names, aliases, country, founded year, events with type, round type, date, precision and USD amount, location with coordinates or outcode, grant postcodes, existing `uk_company_number`, numbers it may not use), the candidates (`RegistryCompanyFacts`, with their `CapitalFiling`s when fetched) and the set of numbers already linked to other companies. It returns a `LinkCandidateDecision` for each candidate and an overall outcome, with a reason string naming the rule and signals ("exact name; S3 SH01 2026-02-02, 36 days before seed 2026-03-10; S2 LS1 4 km from Leeds").
   - Conflicts, support signals S1-S3 and the decision table exactly as spec section 7.2. The 25 km distance uses the existing haversine helper.
   - It also says which candidates still need capital filings fetched (so 056 fetches only what a decision depends on).
3. **Form D decision:** `decideFormDLink(filing, companies)` by spec section 8.3: CIK first, then exact name, conflicts, link only when the filing confirms a round (it calls `formDConfirms` below), else a candidate if a round falls within 365 days, else nothing.
4. **Confirmation rules** (`confirm-rules.ts`):
   - `allotmentConfirms(event, filing)` and `formDConfirms(event, filing)` by the table in spec section 9.2, returning `{ confirms, confirmsAmount, daysFromEvent }`.
   - Equity rounds only; `day` or `month` precision only (a `month` event is measured from the first of the month).
   - `assignRecords(events, records)`: each record confirms at most one event, the nearest by date, then the lower event id.
   - The marker wording is not here: pages must not import `src/pipeline`, so it lives in `src/lib/registry/confirmation-text.ts` (052).
5. **Eval set** (`fixtures/registry/link-cases.json`): about 60 cases with invented names, in the normalised types (not raw API JSON). Each case: company facts, candidates as the search would return them, capital filings, and the expected outcome. Cover at least: the six worked examples in spec section 7.2; short common brand names; trading names (prefix) with and without both signals; holdings companies; a dormant namesake; a dissolved predecessor with the same name; a company incorporated after the first event; a founded-year clash; shared addresses (the S2 check must ignore an office postcode flagged as shared); two companies wanting one number; previous names; Scottish (`SC`) and Northern Irish (`NI`) numbers; about 10 Form D cases including the example in section 8.3. `fixtures/registry/README.md` states the labelling rule: "linked only when a careful person with the same facts would be sure".
6. **`src/eval/links.ts`** and `pnpm eval --links`: run every case, score auto-link precision and recall (a correct link sent to review counts against recall, not precision), list each mistake, and write `docs/link-eval-results.md` in the style of `docs/resolution-eval-results.md`.

## Tests and acceptance criteria
- `pnpm check` passes. No network, no database.
- Unit tests: every row of the conflict, signal and decision tables in spec section 7.2; the six worked examples; confirmation cases C1-C6 from spec section 9.2; the one-record-one-event rule.
- `links.test.ts` runs the eval and asserts **no wrong automatic link** and **auto-link recall of at least 50%**.
- No special case for any name in the code. A failing case is fixed by a rule and noted in the results file.

## Out of scope
- HTTP and database access (054, 056, 057). Writing confirmations (060).
