# 062 Registry review CLI and company merges

- **Tier:** 2 (a maintainer tool over the link store, and one change to company merges). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 051, 056, 057. **Wave:** 4.

## Goal
Give the maintainer `pnpm registry` to review link candidates, and make company merges carry registry links to the surviving company.

## Why it matters
Ambiguous cases go to a review queue rather than being guessed (D53). Reviewing must be quick and optional. Merging two companies (`pnpm entities merge`) must not leave a link on the merged-away company, or a number held by nobody.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 6, 7.2)
- `docs/decisions.md` (D11, D53)
- `src/pipeline/registry/link-store.ts` (051), `src/pipeline/registry/testing.ts` (054)
- `src/cli/entities.ts`, `src/cli/themes.ts` (CLI pattern)
- `src/pipeline/resolve/merge-entities.ts` and its test

## Files you may create or change
- `src/pipeline/registry/review.ts`, `src/pipeline/registry/review.test.ts` (new)
- `src/cli/registry.ts` (new)
- `src/pipeline/resolve/merge-entities.ts`, `src/pipeline/resolve/merge-entities.test.ts`
- `package.json` (add the `registry` script only)

## Steps
1. **`review.ts`:**
   - `listCandidates(db, { registry?, limit })`: open candidates with, per row, the company (name, slug, country, town, earliest and latest events with type, round and amount) and the registry side (number or CIK, registry name, status, incorporation date or Form D date, office outcode, the stored reason). Never the full postcode.
   - `showCompany(db, slug)`: every registry row for one company, any status.
   - `link`, `reject`, `unlink`: thin wrappers over the link store with `decided_by = manual`. `link` by number also works for a number that was never a candidate (a manual link the maintainer looked up); it fetches nothing.
2. **`src/cli/registry.ts`:** `pnpm registry <list|show|link|reject|unlink>` with `--registry ch|sec`, `--limit`, and clear usage text. `list` prints a compact table and the Companies House or EDGAR URL for each candidate, so the maintainer can check it in a browser. It never calls an API.
3. **Merges.** In `mergeCompanies`, after the existing work: move the merged company's `registry_links` rows to the kept company. If both have a `linked` row for the same registry and the numbers differ, keep the kept company's link and turn the other into a `candidate` with the reason "from a merge; numbers differ". Keep `uk_company_number` and `sec_cik` consistent with the `linked` rows. Preview counts include registry rows.
4. Add `"registry": "tsx src/cli/registry.ts"` to `package.json`.

## Tests and acceptance criteria
- `pnpm check` passes. PGlite.
- Review: listing shows open candidates only, newest companies first; `link` makes a manual link and fills the column; `reject` blocks the same automatic link later (through the link store); `unlink` clears the column; a link to a number held by another company refuses with a message naming that company.
- Merges: links move to the survivor; two different numbers leave one link and one candidate; the merge audit and existing merge tests still pass.

## Out of scope
- Any automatic linking (056, 057). A web page for review (not planned: review stays off the public site).
