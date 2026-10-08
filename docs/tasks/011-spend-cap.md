# 011 Spend cap (BudgetGuard)

- **Tier:** 2 (small and fully specified, but money-critical; tests are mandatory). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 004. **Wave:** 4.

## Goal
Implement the database-backed `BudgetGuard`, which enforces the monthly LLM spend cap before every call and records the actual usage after it.

## Why it matters
This is the app's hard limit on cost. It must fail closed: when anything is uncertain, it refuses the call.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 8)
- `docs/decisions.md` (D5, D10)
- `src/core/ports.ts`, `src/core/domain.ts`, `src/core/errors.ts`
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`

## Files you may create or change
- `src/pipeline/budget/month.ts`
- `src/pipeline/budget/budget-guard.ts`
- `src/pipeline/budget/budget-guard.test.ts`

## Requirements
- **`month.ts`:** `monthWindowUtc(now: Date)` returns `{ start, end }` for the calendar month in UTC.
- **`budget-guard.ts`:** `createBudgetGuard({ db, clock, capGbp, ingestRunId? })` implements `BudgetGuard`.
  - **Cap in USD micros:** `capGbp × gbpToUsd × 1_000_000`, rounded down. `gbpToUsd` is computed from the latest `fx_rates` row for GBP and USD (`perEur.USD / perEur.GBP`). If no rate exists, use `1.0`.
  - **`assertCanSpend(estimate)`:** sums `llm_usage.cost_usd_micros` for the current month. If `spent + estimate.usdMicros > cap`, it throws `BudgetExceededError` with spent, estimate and cap in the message. A `capGbp` of 0 or less always throws.
  - **`record(usage)`:** inserts an `llm_usage` row with `occurred_at = clock.now()`.
  - **`monthToDate()`:** returns spent and cap.
- No caching of the monthly total between calls: always re-query. A run makes at most a few hundred calls, so this is cheap.
- Concurrency is handled by the run-level advisory lock (Task 019), not here. Document that assumption in a code comment on `createBudgetGuard`.

## Acceptance criteria
- `pnpm check` passes.
- PGlite tests prove:
  - under the cap, the call passes;
  - an estimate that would cross the cap throws, even when the current spend is below the cap;
  - usage from the previous month is ignored;
  - with no FX rate, the 1.0 rate is used;
  - with a GBP/USD rate, the cap converts correctly;
  - a cap of 0 always throws;
  - after `record()`, `monthToDate()` reflects the new spend;
  - a month boundary at 23:59:59 UTC on the last day versus 00:00:00 UTC on the 1st is handled correctly.

## Out of scope
- The price table and estimates (007), the per-run item limit (019), provider-side limits (021 docs).
