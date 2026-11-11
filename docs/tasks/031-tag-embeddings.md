# 031 Embedding client and tag embedding step

- **Tier:** 2 (a port adapter and a bounded batch step). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 025, 027. **Wave:** 3.

## Goal
Implement the OpenAI `EmbeddingClient`, add the embedding model's price, and write the step that embeds tags without an embedding, through `BudgetGuard`.

## Why it matters
Themes are built from tag embeddings. Every paid call, however cheap, must go through the spend cap (D10).

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 6 and 14, A15)
- `docs/decisions.md` (D6, D10, D34)
- `src/core/ports.ts`, `src/core/domain.ts`, `src/core/env.ts`
- `src/pipeline/extract/pricing.ts`, `src/pipeline/extract/openai-client.ts`, `src/pipeline/budget/budget-guard.ts`
- `src/db/schema.ts` (`tags`, `company_tags`)

## Files you may create or change
- `src/pipeline/extract/pricing.ts`, `src/pipeline/extract/pricing.test.ts`
- `src/pipeline/embed/openai-embeddings.ts`, `src/pipeline/embed/openai-embeddings.test.ts` (new)
- `src/pipeline/embed/embed-tags.ts`, `src/pipeline/embed/embed-tags.test.ts` (new)
- `src/pipeline/embed/testing.ts` (new: a deterministic fake `EmbeddingClient` for other tasks' tests)

## Steps
1. **Re-check A15** on OpenAI's pricing page. Add `text-embedding-3-small` at $0.02 per M input tokens to `MODEL_PRICES` (output price 0), with the date checked in the comment. Add `estimateEmbeddingCost(model, inputs)` using the same characters × 0.3 rule as `estimateInputTokens`, rounded up.
2. **`openai-embeddings.ts`:** `createOpenAiEmbeddingClient({ apiKey, model, client? })` calls `embeddings.create({ model, input, dimensions })` through an injectable client surface (like the chat adapter), checks that every vector has `dimensions` numbers and that the count matches the inputs, and returns usage. It uses a 60-second timeout and one retry.
3. **`embed-tags.ts`:** `embedTagsStep({ db, embedder, budget, model, dimensions, maxTags, runId })`:
   - select tags with `embedding IS NULL` or `embedding_model <> model`, used by at least one non-merged company, ordered by `first_seen_at` then id, up to `maxTags`;
   - embed the tag `label` in batches of 256;
   - before each batch, `budget.assertCanSpend`; after it, `budget.record` with purpose `embedding`;
   - write `embedding` and `embedding_model` per tag in one transaction per batch;
   - on `BudgetExceededError`, stop cleanly and report `budgetPaused`;
   - with no embedder (no key), return `{ skipped: true }`.
4. **`testing.ts`:** `createFakeEmbeddingClient()` returns stable vectors derived from a hash of the text, normalised to unit length, with optional fixed vectors for named inputs, so clustering tests can control similarity.

## Tests and acceptance criteria
- `pnpm check` passes.
- Pricing: the embedding model prices input only; an unknown embedding model is refused (fail closed).
- Adapter (fake client): sends `dimensions: 512`; a wrong vector length or count throws; usage is returned.
- Step (PGlite):
  - embeds only unembedded tags and re-embeds tags from another model;
  - batches at 256;
  - records one usage row per batch with purpose `embedding`;
  - a second run is a no-op;
  - a budget refusal leaves remaining tags untouched and returns `budgetPaused`;
  - no key gives `skipped`;
  - tags used only by merged companies are skipped.

## Out of scope
- Clustering (032), wiring into the run (043), embedding companies (not planned).
