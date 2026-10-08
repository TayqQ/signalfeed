# 020 Entity merge CLI

- **Tier:** 2 (a clearly specified data operation with tests). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 015. **Wave:** 6.

## Goal
Give the maintainer commands to review merge candidates, merge or dismiss them, and add aliases, for companies and investors, with a full audit log.

## Why it matters
Automatic rules deliberately avoid risky merges. This is the safe, recorded way to fix the cases they leave open, instead of hard-coding exceptions.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 5 "Data quality", section 7 "Manual tools")
- `docs/decisions.md` (D11, D12)
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`
- `src/lib/normalise.ts`
- `src/pipeline/resolve/canonicalise.ts`, `src/pipeline/resolve/testing.ts`
- `src/pipeline/store/fx-rates.ts`

## Files you may create or change
- `src/pipeline/resolve/merge-entities.ts`, `src/pipeline/resolve/merge-entities.test.ts`
- `src/cli/entities.ts`

## Requirements
- **`mergeCompanies(db, keepId, mergeId, note?)`**, in one transaction:
  - repoint `events.company_id` and `acquisitions.acquirer_company_id`;
  - move aliases (adding the merged company's name as an alias with source `merge`);
  - merge `company_tags` (summing mention counts, min first seen, max last seen);
  - fill the kept company's empty fields from the merged one;
  - set `merged_into_id` and resolve any open `merge_candidates` for the pair as `merged`;
  - write `entity_merges`;
  - recompute the kept company's events (`recomputeEventsForCompany`).

  Two events of the kept company that now look like duplicates are **not** merged automatically. Print them as a warning.
- **`mergeInvestors(db, keepId, mergeId, note?)`**: repoints `event_investors` (resolving primary-key conflicts by keeping the lead role if either was lead), moves aliases, sets `merged_into_id` and writes the audit row.
- Also: `dismissCandidate(db, id)`, `addAlias(db, entityType, id, alias)`, and `listCandidates(db, { entityType, status: 'open', limit })` with both names, countries, domains and event counts.
- Refuse to merge an entity into itself, into an already-merged entity, or to create a chain (always merge into the final surviving entity).
- **CLI:**
  - `pnpm entities candidates [--type company|investor]`
  - `pnpm entities merge --type company --keep <id> --merge <id> [--note ...] [--yes]` (without `--yes` it shows what would change)
  - `pnpm entities dismiss <id>`
  - `pnpm entities alias --type company --id <id> --alias "..."`

## Acceptance criteria
- `pnpm check` passes.
- PGlite tests prove:
  - after a merge, events and aliases point to the kept company and tag counts are summed;
  - the merged company has `merged_into_id` set and an audit row exists;
  - candidates are resolved;
  - merging into a merged entity is refused;
  - for investors, a primary-key conflict on the same event keeps the lead role;
  - the merge without `--yes` changes nothing.

## Out of scope
- A web admin UI, automatic event deduplication after a merge.
