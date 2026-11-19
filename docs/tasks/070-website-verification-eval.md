# 070 Website verification rules, LLM check and labelled eval

- **Tier:** 3 (precision gate). **Suggested model:** Claude Opus.
- **Depends on:** 069. **Wave:** 3.5-2.

## Goal
Decide `linked`, `candidate` or `rejected` for each candidate with the rules in spec section 6.3, store the results, and prove 0 wrong links on a labelled eval.

## Read first
- `AGENTS.md`, `docs/spec-phase3.5.md` (sections 6.3-6.6, 8, 10)
- `src/pipeline/registry/link-rules.ts` (`registryNormalise`, generic names), `src/pipeline/registry/link-store.ts` (manual decisions are final)
- `src/pipeline/budget/budget-guard.ts`, `src/pipeline/extract/openai-client.ts`
- `src/eval/` (how `--registry` evals are laid out)

## Files you may create or change
- `src/pipeline/websites/rules.ts`, `src/pipeline/websites/name-match.ts`, `src/pipeline/websites/non-company-hosts.ts`, `src/pipeline/websites/llm-check.ts`, `src/pipeline/websites/website-store.ts`, plus `.test.ts` for each (new)
- `src/eval/websites.ts`, `src/eval/websites.test.ts` (new); `src/eval/cli.ts` (`--websites` only)
- `fixtures/websites/cases.json`, `fixtures/websites/README.md` (new)
- `src/cli/registry.ts`, `src/pipeline/registry/review.ts`, plus tests (`--websites` listing and decisions only)
- `docs/decisions.md` (D64)

## Steps
1. Implement rules X1-X3, W1-W3 and C1-C2 as one pure function over (company facts, page summary, source, holders), returning rule, status and evidence text.
2. Write `llm-check.ts` with strict output, purpose `website_check`, and a refusal when over budget, which gives C1.
3. Write `website-store.ts`. It upserts `company_websites`, keeps `companies.website_domain` in step with the one `linked` row, and never overrides a manual decision.
4. Build the eval: at least 40 cases (spec section 10). The maintainer reviews the labels before the gate counts. Fixtures hold only title, meta and footer snippets, with any person's name removed.
5. Add D64 to `docs/decisions.md`.

## Tests and acceptance criteria
- `pnpm eval --websites` (offline, recorded LLM answers) shows 0 wrong `linked`. The live run is maintainer-only, capped at $0.05.
- Every rule has at least one unit test, plus one test for its precedence.
- A manual `rejected` is never re-linked.

## Out of scope
- Search, the pipeline step, Companies House linking from numbers, UI.
