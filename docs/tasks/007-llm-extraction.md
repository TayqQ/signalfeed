# 007 LLM extraction and prefilter

- **Tier:** 2 (a clearly specified feature behind fixed ports). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 003. **Wave:** 3.

## Goal
Implement:
- the free keyword prefilter;
- the versioned extraction prompt;
- the OpenAI `LlmClient` adapter;
- the model price table and cost estimate;
- `extractItem()`, which turns one item into a validated extraction under the budget guard.

## Why it matters
This is the only code that spends money. It must call the model once per item, validate everything, and never bypass the budget guard.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 6, 7 steps 3-4, 8)
- `docs/decisions.md` (D6, D7, D8, D9, D10)
- `src/core/extraction-schema.ts`, `src/core/ports.ts`, `src/core/domain.ts`, `src/core/errors.ts`

## Files you may create or change
- `src/pipeline/extract/prefilter.ts`, `src/pipeline/extract/prefilter.test.ts`
- `src/pipeline/extract/prompt.ts`
- `src/pipeline/extract/pricing.ts`, `src/pipeline/extract/pricing.test.ts`
- `src/pipeline/extract/openai-client.ts`, `src/pipeline/extract/openai-client.test.ts`
- `src/pipeline/extract/extract-item.ts`, `src/pipeline/extract/extract-item.test.ts`

## Requirements
- **`prefilter.ts`:** `isCandidate({ title, summary }): boolean`. Case-insensitive patterns for:
  - funding words (raise(s/d), funding, seed, pre-seed, series [a-h], round, backed, investment, invests, secures, closes);
  - acquisition words (acquire(s/d), acquisition, buys, bought, merger);
  - launch words (launch(es), unveils, "show hn", "launch hn");
  - money patterns (currency symbol or code next to a number with k/m/bn/million/billion).

  Err on the side of passing items through.
- **`prompt.ts`:** `EXTRACTION_PROMPT_VERSION = 'v1'`, `buildSystemPrompt()`, `buildUserPrompt({ title, summary, url, sourceName, publishedAt })`. The system prompt explains:
  - the schema fields and what counts as relevant (completed events only, not rumours or valuations);
  - `amountText` must be copied verbatim;
  - organisations only, never individual names (use `includesIndividualAngels`);
  - tags are short lowercase theme phrases;
  - `websiteDomain` only when it is in the text;
  - use `null` when a value is unknown.

  Keep the system prompt under about 900 tokens, since it is sent on every call.
- **`pricing.ts`:** `MODEL_PRICES: ModelPrice[]` with the cheap OpenAI models from `docs/sources.md` if present, otherwise clearly marked placeholders. `estimateCost({ model, system, user, maxOutputTokens })` returns a `CostEstimate`, using characters/4 × 1.2 as the input token estimate. `costUsdMicros(model, usage)`. An unknown model throws `UnknownModelPriceError`.
- **`openai-client.ts`:** `createOpenAiClient({ apiKey, model, client? })` implements `LlmClient`:
  - uses Chat Completions or Responses with `response_format`/`text.format` of type `json_schema`, `strict: true`, schema from `extractionJsonSchema()`;
  - `temperature: 0` where the model supports it;
  - parses the JSON and validates it with the Zod schema, throwing `ExtractionValidationError` on failure;
  - returns usage tokens.

  The OpenAI SDK client is injectable so tests use a fake. No real calls in tests.
- **`extract-item.ts`:** `extractItem({ item, llm, budget, model, maxOutputTokens = 1200 })` returns `{ result: ExtractionV1, usage, costUsdMicros, promptVersion, model }`. Steps:
  1. build the prompts and estimate the cost;
  2. `await budget.assertCanSpend(estimate)`;
  3. call `llm.complete`;
  4. compute the actual cost;
  5. `await budget.record({ purpose: 'extraction', ... })`. Record usage even if validation fails afterwards and the tokens were consumed;
  6. return.

  `BudgetExceededError` propagates unchanged.

## Acceptance criteria
- `pnpm check` passes.
- Tests prove:
  - the prefilter passes 10 invented relevant headlines and rejects 5 irrelevant ones (opinion piece, layoffs, conference recap, earnings, podcast);
  - the budget guard is called before the LLM, and when it throws, the LLM is never called;
  - usage is recorded after a successful call;
  - invalid model JSON raises `ExtractionValidationError` and usage is still recorded;
  - an unknown model price throws before any call.
- Any examples in the prompt use only placeholder names ("ExampleCo", "Example Ventures"), so the eval measures real extraction rather than memorised examples.

## Out of scope
- Database writes (010/019), the budget guard implementation (011), eval harness (014), embeddings (Phase 2).
