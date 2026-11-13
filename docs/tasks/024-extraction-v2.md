# 024 Extraction v2: region, city and tag guidance [maintainer runs the live eval]

- **Tier:** 3 (the extraction contract; every later extraction depends on it). **Suggested model:** Claude Opus.
- **Depends on:** none. **Wave:** 1.

## Goal
Add `company.regionText` to the extraction schema, sharpen the prompt's city and tag rules (prompt version `v2`), extend the eval to score city and UK region, and make the OpenAI adapter send the JSON schema of whatever Zod schema it is given. The maintainer then runs the live eval once.

## Why it matters
Extraction on the hosted database waits for this task. Once it is merged and the live eval passes, Taylor can start paying for extraction knowing the output already carries what Phase 2 needs: a UK region when the text gives one, cleaner cities, and tags that cluster well. Theme naming and grant tagging (Tasks 032 and 038) need the schema-generic adapter.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 4 and 6, "New ports")
- `docs/spec.md` (sections 6 and 10), `docs/decisions.md` (D6, D8, D9, D20, D28, D33)
- `src/core/extraction-schema.ts`, `src/core/eval-fixture.ts`
- `src/pipeline/extract/prompt.ts`, `src/pipeline/extract/extract-item.ts`, `src/pipeline/extract/openai-client.ts`
- `src/eval/score.ts`, `src/eval/report.ts`, `src/eval/cli.ts`, `src/eval/recording.ts`
- `fixtures/extraction/cases.json`, `fixtures/extraction/README.md`

## Files you may create or change
- `src/core/extraction-schema.ts`, `src/core/extraction-schema.test.ts`
- `src/core/json-schema.ts`, `src/core/json-schema.test.ts` (new)
- `src/core/eval-fixture.ts`
- `src/pipeline/extract/prompt.ts`, `src/pipeline/extract/prompt.test.ts` (new)
- `src/pipeline/extract/extract-item.ts`, `src/pipeline/extract/extract-item.test.ts`
- `src/pipeline/extract/openai-client.ts`, `src/pipeline/extract/openai-client.test.ts`
- `src/eval/score.ts`, `src/eval/score.test.ts`, `src/eval/report.ts`, `src/eval/cli.ts`, `src/eval/recording.ts`, `src/eval/replay.test.ts`
- `fixtures/extraction/cases.json`, `fixtures/extraction/README.md`, `fixtures/extraction/recorded/*.json`
- `docs/eval-results.md`

## Steps
1. **JSON schema helper.** Move the strict-mode conversion (`strictNode`) out of `extraction-schema.ts` into `src/core/json-schema.ts` as `strictJsonSchema(schema: z.ZodType): Record<string, unknown>`. `extractionJsonSchema()` calls it. A test asserts that the V1 JSON schema is byte-for-byte what it was before the move.
2. **Schema v2.** In `extraction-schema.ts` keep `EXTRACTION_SCHEMA_V1` and its types unchanged. Add `EXTRACTION_SCHEMA_V2`, identical except that `company` gains `regionText: z.string().nullable()` with a description. Export `ExtractionV2`, `ExtractedEventV2`, `CURRENT_EXTRACTION_SCHEMA` (= V2), `CURRENT_EXTRACTION_SCHEMA_NAME = "extraction_v2"`, and `upgradeExtraction(value: ExtractionV1 | ExtractionV2): ExtractionV2`, which adds `regionText: null` where it is missing. `extractionJsonSchema()` returns the V2 schema. `ExtractionV2` must stay assignable to `ExtractionV1`, so code that reads V1 compiles unchanged.
3. **Adapter.** `createOpenAiClient` builds `response_format.json_schema.schema` from `strictJsonSchema(request.schema)` and `name` from `request.schemaName`. Test with the fake client that (a) an extraction request body is identical to the one sent before this task, apart from the V2 schema and name, and (b) a small unrelated schema is sent as given.
4. **Extract item.** `extractItem` uses the V2 schema and name, and returns `ExtractionV2`.
5. **Prompt v2.** Set `EXTRACTION_PROMPT_VERSION = "v2"`. Apply the city, region and tag wording in spec section 4.2, in the same plain style as the current prompt. Keep everything else. Add `prompt.test.ts` asserting that the prompt mentions `regionText`, forbids guessing, and lists the banned generic tag words.
6. **Fixtures.** In `eval-fixture.ts` add two optional, nullable fields to expected events: `city` and `regionText`. Fill them in `cases.json` only where the paraphrased summary states them. Do not add facts the fixture text does not support. Add 4-6 new cases with UK nation or region wording ("Scottish", "Welsh", "Yorkshire-based", "Belfast-based"), with invented company names and paraphrased summaries (D20). Update `fixtures/extraction/README.md`.
7. **Scorer.** Add "City, when stated" (normalised: case, diacritics and whitespace) and "UK region, when stated". The region metric compares ITL1 regions after mapping with a small local lookup in `score.ts` for the fixture's values only. The full mapping arrives with Task 026. Report coverage for both, as for country (D28). Old recordings replay through `upgradeExtraction`, and score null for the new fields.
8. **Live eval (maintainer).** Run `pnpm eval --live --model gpt-5.6-luna`. Commit the recording and the regenerated `docs/eval-results.md`. Expected cost is about $0.02. If a Phase 1 target fails, stop and report rather than loosening the prompt.

## Tests and acceptance criteria
- `pnpm check` passes.
- `EXTRACTION_SCHEMA_V2` accepts a full V2 object, rejects a missing `regionText`, and rejects extra keys. `upgradeExtraction` turns every committed V1 recording into a valid V2 object.
- The adapter test shows the extraction request unchanged apart from the schema, and a non-extraction schema passed through.
- `pnpm eval --replay` passes with the old recordings and the new metrics.
- **Maintainer:** the live eval on `gpt-5.6-luna` meets every Phase 1 target and both new targets (≥ 90%), and city coverage is not lower than the previous recording's 6 of 24 events (A28). Record the result in `docs/eval-results.md`.

## Out of scope
- Storing `regionText` anywhere other than the extraction JSON. Task 034 reads it from extractions.
- Changing the resolver, post-processing or the database schema.
- Re-extracting stored items. That is Task 045.
