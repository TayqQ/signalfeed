# 012 Company and investor resolution

- **Tier:** 3 (entity matching; wrong merges corrupt data silently). **Suggested model:** Claude Opus.
- **Depends on:** 004, 005. **Wave:** 4.

## Goal
Given extracted company or investor facts, find the existing record or create a new one, following the deterministic rules in spec section 7. Record ambiguous cases as merge candidates.

## Why it matters
Clean companies and investors are the foundation of every trend, acquisition and investor view. A previous version used per-headline hacks; this replaces them with rules that are tested and explainable.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 5 entity tables, section 7 "Entity resolution rules")
- `docs/decisions.md` (D11, D12, D19)
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`
- `src/core/enums.ts`, `src/core/extraction-schema.ts`
- `src/lib/normalise.ts`

## Files you may create or change
- `src/pipeline/resolve/types.ts`
- `src/pipeline/resolve/slugs.ts`, `src/pipeline/resolve/slugs.test.ts`
- `src/pipeline/resolve/merge-candidates.ts`
- `src/pipeline/resolve/company-matcher.ts`, `src/pipeline/resolve/company-matcher.test.ts`
- `src/pipeline/resolve/investor-matcher.ts`, `src/pipeline/resolve/investor-matcher.test.ts`
- `src/pipeline/resolve/testing.ts` (test builders shared with Task 015)

## Requirements
- **`types.ts`:**
  - `CompanyFacts { name, websiteDomain | null (already validated), description, countryCode, city, foundedYear, tags: string[] (already normalised) }`;
  - `InvestorFacts { name, kind, websiteDomain | null }`;
  - `Corroboration`: a callback `(candidateCompanyId) => Promise<boolean>` that Task 015 provides to say whether the incoming event matches an existing event of that candidate.
- **`slugs.ts`:** `allocateSlug(db, table, name)` uses `slugify`, and adds `-2`, `-3` and so on when taken. Slugs never change after creation.
- **`merge-candidates.ts`:** `addMergeCandidate(db, { entityType, leftId, rightId, score, reason })`. It stores the smaller id as left, and repeated pairs are ignored.
- **`company-matcher.ts`:** `resolveCompany(db, facts, { corroborates })` returns `{ companyId, created: boolean, matchedBy: 'domain' | 'exact_name' | 'fuzzy_corroborated' | 'new' }`. It:
  - applies rules 1-4 from spec section 7 in order;
  - ignores companies with `merged_into_id` set, and follows `merged_into_id` if a matched alias points to a merged company;
  - **on match:** adds the alias if it's new, fills empty fields (country, city, founded year with source `news`, domain if unclaimed, description if empty) and never overwrites non-empty fields, upserts `company_tags` (incrementing `mention_count`, updating `last_seen_at`), and updates `updated_at`;
  - **on create:** allocates a slug, inserts the company, its alias and its tags (`tags` rows by `normaliseTag` slug);
  - uses `similarity()` from pg_trgm in SQL for fuzzy candidates, with a limit of 5;
  - contains no hard-coded company names.
- **`investor-matcher.ts`:** `resolveInvestor(db, facts)` returns `{ investorId, created, matchedBy }`. Match by domain, then exact normalised name or alias. Otherwise create, and if trigram similarity is at least 0.7, add a merge candidate. Never merge automatically on fuzzy evidence. Fill an empty `kind` when the existing value is `unknown`.
- Every function accepts a transaction-capable `Db`, so Task 015 can call it inside one transaction.

## Acceptance criteria
- `pnpm check` passes.
- PGlite tests cover at least:
  - a domain match even when the name differs;
  - "Acme Ltd" matching "ACME" exactly;
  - "Acme" in GB not matching "Acme" in US (country conflict), which creates a new company and a merge candidate;
  - "Acme Robotics" against "Acme Robotic" matching only when `corroborates` returns true, and otherwise creating a new company plus a merge candidate;
  - an alias pointing to a merged company resolving to the surviving company;
  - non-empty fields never being overwritten;
  - tag mention counts incrementing;
  - slug collisions producing `-2`;
  - investors: an exact alias match, and a fuzzy name creating a candidate rather than merging.

## Out of scope
- Event matching and canonical fields (015), manual merge commands (020), embeddings (Phase 2).
