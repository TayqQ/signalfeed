# 014 Extraction eval [maintainer runs the live eval]

- **Tier:** 2 (a scorer and CLI against fixed fixtures). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 005, 007, 008. **Wave:** 4.

## Goal
Build the evaluation harness that scores extraction output against the fixtures. Run it live against candidate models, record the results, and set the default model to the cheapest one that meets the targets.

## Why it matters
It turns "the AI seems to work" into measured accuracy, and it justifies the model choice on cost.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 10, including the accuracy targets table)
- `docs/decisions.md` (D6, D8, D20)
- `src/core/eval-fixture.ts`, `src/core/extraction-schema.ts`, `src/core/env.ts`
- `src/pipeline/extract/extract-item.ts`, `src/pipeline/extract/prefilter.ts`, `src/pipeline/extract/pricing.ts`, `src/pipeline/extract/openai-client.ts`
- `src/lib/money.ts`, `src/lib/normalise.ts`
- `fixtures/extraction/cases.json`

## Files you may create or change
- `src/eval/score.ts`, `src/eval/score.test.ts`
- `src/eval/cli.ts`
- `src/eval/replay.test.ts`
- `fixtures/extraction/recorded/*.json`
- `docs/eval-results.md`
- `src/core/env.ts` (only the default value of `EXTRACTION_MODEL`)

## Requirements
- **`score.ts`:** `scoreCase(expected, actual)` and `aggregate(scores)`. Metrics:
  - relevance;
  - event type;
  - company name, compared normalised;
  - round type;
  - amount and currency, comparing `parseAmountText` on both sides;
  - lead investors, as F1 over normalised names;
  - country, only where expected is non-null;
  - prefilter recall over relevant cases.

  Events are matched within a case by normalised company name.
- **`cli.ts`:**
  - `pnpm eval --live --model <id> [--model <id> ...]` uses `createOpenAiClient` and a simple in-memory budget guard capped at $1. It runs every case, writes the raw results to `fixtures/extraction/recorded/<model>.json`, and prints a table (metrics, cost, tokens).
  - `pnpm eval --replay [--model <id>]` scores the recorded files without calling the API.
  - Both modes exit non-zero if any target from spec section 10 is missed.
- **`replay.test.ts`:** for each recorded file present, runs replay scoring and asserts that the recorded default model meets the targets. Skip with a clear message if no recordings exist yet.
- **`docs/eval-results.md`:** date, models tried, a metrics table, cost per 1,000 items, the chosen model and why, and known failure patterns. Include no personal notes.

## Maintainer steps
Run `pnpm eval --live` with a real key, for 2-3 cheap models from `docs/sources.md`. Commit the recordings. Then set the `EXTRACTION_MODEL` default to the cheapest model that passes. If none passes, record that in `docs/eval-results.md` and open a follow-up task to improve the prompt (Task 007 owns it).

## Acceptance criteria
- `pnpm check` passes. `score.test.ts` covers each metric with hand-made expected/actual pairs, including a roundup case with 2 events.
- `pnpm eval --replay` passes for the chosen default model.
- The total live eval cost is printed and is under $1.

## Out of scope
- Prompt changes (follow-up task), running the eval in CI with a real key.
