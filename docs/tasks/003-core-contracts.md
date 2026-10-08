# 003 Core contracts and types

- **Tier:** 3 (cross-cutting contracts; every later task builds against them). **Suggested model:** Claude Opus.
- **Depends on:** 002. **Wave:** 2.

## Goal
Define the shared enums, domain types, extraction schema, port interfaces, read models, errors and environment schemas in `src/core/`. No I/O and no implementations, apart from Zod schemas and small pure helpers.

## Why it matters
Wave 3 runs six tasks in parallel. They can only fit together if they code against fixed contracts. Changing these later means touching many tasks, so get the names and shapes right now.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 5, 6, 7, 8, 9)
- `docs/decisions.md` (D5, D6, D8, D10, D16, D19)
- `package.json`, `tsconfig.json`

## Files you may create or change
- `src/core/enums.ts`
- `src/core/domain.ts`
- `src/core/extraction-schema.ts`
- `src/core/ports.ts`
- `src/core/read-models.ts`
- `src/core/errors.ts`
- `src/core/env.ts`
- `src/core/eval-fixture.ts`
- `src/core/extraction-schema.test.ts`
- `src/core/env.test.ts`

## Requirements
1. **`enums.ts`:** every enum in spec section 5, each as `export const ROUND_TYPES = [...] as const` plus `export type RoundType = (typeof ROUND_TYPES)[number]`. Task 004 builds `pgEnum`s from these arrays.
2. **`domain.ts`:**
   - `SourceConfig { slug, name, kind, url, priority, enabled }`
   - `CollectedItem { sourceSlug, externalId, url, title, summary: string | null, publishedAt: Date | null }`
   - `Money { amountMinor: number; currency: string }`
   - `CurrencyCode` (string alias, documented as ISO 4217)
   - `ModelPrice { model, inputUsdPerMillion, outputUsdPerMillion }`
   - `CostEstimate { model, estimatedInputTokens, maxOutputTokens, usdMicros }`
   - `UsageRecord { purpose, model, inputTokens, outputTokens, costUsdMicros, sourceItemId?, ingestRunId? }`
   - `FxRates { date: string; perEur: Record<CurrencyCode, number> }`
   - `IngestStats`, covering per-step counts, `spendUsdMicros`, `monthToDateUsdMicros`, `capGbp`, `budgetPaused`.
3. **`extraction-schema.ts`:**
   - `EXTRACTION_SCHEMA_V1`, exactly as in spec section 6, with `type ExtractionV1 = z.infer<...>`. Every property is required, nullable where unknown, objects are strict, `events` has at most 10 entries, `tags` has at most 5.
   - `extractionJsonSchema()`, which returns `z.toJSONSchema(EXTRACTION_SCHEMA_V1)` adjusted, if needed, for OpenAI strict mode (`additionalProperties: false`, every property in `required`).
4. **`ports.ts`** (interfaces only):
   - `HttpFetcher.get(url, { headers?, etag?, lastModified?, timeoutMs? })` returns `{ status, body: string, etag: string | null, lastModified: string | null }`.
   - `LlmClient.complete<T>({ system, user, schema: z.ZodType<T>, schemaName, maxOutputTokens })` returns `{ data: T, usage: { inputTokens, outputTokens }, model }`.
   - `BudgetGuard`: `assertCanSpend(estimate: CostEstimate): Promise<void>` (throws `BudgetExceededError`), `record(usage: UsageRecord): Promise<void>`, `monthToDate(): Promise<{ spentUsdMicros: number; capUsdMicros: number }>`.
   - `FxProvider.getRates(date: string): Promise<FxRates>`.
   - `Clock.now(): Date`.
   - `Collector.collect(source: SourceConfig, state: { etag: string | null; lastModified: string | null }): Promise<{ items: CollectedItem[]; etag: string | null; lastModified: string | null; notModified: boolean }>`.
5. **`read-models.ts`:**
   - `FundingSort = 'announced' | 'amount' | 'relevance'`
   - `FundingFilters { q?, roundTypes?, regions?, countryCodes?, tag?, investorSlug?, from?, to?, minGbpMinor?, maxGbpMinor?, sort?, direction?, page, pageSize }`
   - `FundingRow`, covering event id, company slug/name, country, city, round type/label, original `Money | null`, `amountGbpMinor`, `amountUsdMinor`, `announcedOn`, `leadInvestors: {slug,name}[]`, `investorCount`, `sourceCount`, `tags`.
   - `Page<T> { items, total, page, pageSize }`
   - `CompanyDetail`, with company fields, tags, `redirectToSlug: string | null`, and `events: CompanyEvent[]`. A `CompanyEvent` is a discriminated union on `type`, carrying the type-specific fields and `sources: { title, url, sourceName, publishedAt }[]`.
   - `InvestorDetail`, with investor fields, `rounds: FundingRow[]` and `roundTypeCounts`.
   - `StatusSummary`, with `recentRuns`, item counts by status, event counts by type, `monthToDateUsdMicros`, `capGbp | null`.
6. **`errors.ts`:** `BudgetExceededError`, `UnknownModelPriceError`, `ExtractionValidationError`, `ConfigError`, each with a stable `code` string.
7. **`env.ts`:**
   - `webEnvSchema` contains only `DATABASE_URL`.
   - `pipelineEnvSchema` contains `DATABASE_URL`, `OPENAI_API_KEY`, `EXTRACTION_MODEL` (default `'gpt-4.1-nano'`; Task 014 may change it), `LLM_MONTHLY_CAP_GBP` (coerced number, default 3, must be > 0), `MAX_EXTRACTIONS_PER_RUN` (default 150), `HTTP_CONTACT` (required).
   - Parsers `parseWebEnv(env)` and `parsePipelineEnv(env)` throw a `ConfigError` that lists the missing keys and never prints secret values.
8. **`eval-fixture.ts`:** a Zod schema for `fixtures/extraction/cases.json`: an array of `{ id, sourceSlug, url, headline, summary, publishedAt, expected }`. `expected` has the shape `{ isRelevant, events: [{ type, companyName, countryCode | null, roundType | null, amountText | null, leadInvestors: string[], investors: string[], acquirerName | null }] }`.

## Acceptance criteria
- `pnpm check` passes.
- `extraction-schema.test.ts` proves:
  - a valid funding example, a valid acquisition example and an irrelevant example all parse;
  - a missing property fails, and an extra property fails;
  - the JSON schema has `additionalProperties: false` on every object, and every property is listed in `required`.
- `env.test.ts` proves that defaults apply, a missing `OPENAI_API_KEY` throws `ConfigError` without echoing values, and `webEnvSchema` ignores `OPENAI_API_KEY`.
- No file in `src/core` imports from outside `src/core` except `zod`.

## Out of scope
- Database schema (004), implementations of any port, the prompt text (007).
