import { and, desc, eq, gte, lt, sum } from "drizzle-orm";
import type { CostEstimate, UsageRecord } from "@/core/domain";
import { BudgetExceededError } from "@/core/errors";
import type { BudgetGuard, Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import { fxRates, llmUsage } from "@/db/schema";
import { monthWindowUtc } from "./month";

const USD_MICROS_PER_UNIT = 1_000_000;

export interface CreateBudgetGuardOptions {
  db: Db;
  clock: Clock;
  /** Monthly cap in GBP major units. Zero or less refuses every call. */
  capGbp: number;
  /** Stored on each usage row when the record does not set its own run id. */
  ingestRunId?: number;
}

interface MonthSpend {
  spentUsdMicros: number;
  capUsdMicros: number;
}

/**
 * Database-backed monthly LLM spend cap. The month total is re-queried on
 * every call. Concurrent runs are serialised by the run-level advisory lock
 * (Task 019); this guard does not take a lock of its own.
 */
export function createBudgetGuard(
  options: CreateBudgetGuardOptions,
): BudgetGuard {
  const { db, clock, capGbp, ingestRunId } = options;

  async function monthSpend(now: Date): Promise<MonthSpend> {
    const spentUsdMicros = await spentInMonth(db, now);
    const capUsdMicros = await capInUsdMicros(db, capGbp);
    return { spentUsdMicros, capUsdMicros };
  }

  return {
    async assertCanSpend(estimate: CostEstimate): Promise<void> {
      const { spentUsdMicros, capUsdMicros } = await monthSpend(clock.now());
      const estimateUsdMicros = estimate.usdMicros;
      if (
        !Number.isFinite(capGbp) ||
        capGbp <= 0 ||
        !Number.isFinite(estimateUsdMicros) ||
        estimateUsdMicros < 0 ||
        spentUsdMicros + estimateUsdMicros > capUsdMicros
      ) {
        throw new BudgetExceededError({
          model: estimate.model,
          estimateUsdMicros,
          spentUsdMicros,
          capUsdMicros,
        });
      }
    },

    async record(usage: UsageRecord): Promise<void> {
      await db.insert(llmUsage).values({
        occurredAt: clock.now(),
        purpose: usage.purpose,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsdMicros: usage.costUsdMicros,
        sourceItemId: usage.sourceItemId,
        ingestRunId: usage.ingestRunId ?? ingestRunId,
      });
    },

    async monthToDate(): Promise<MonthSpend> {
      return monthSpend(clock.now());
    },
  };
}

async function spentInMonth(db: Db, now: Date): Promise<number> {
  const { start, end } = monthWindowUtc(now);
  const [row] = await db
    .select({ spent: sum(llmUsage.costUsdMicros) })
    .from(llmUsage)
    .where(and(gte(llmUsage.occurredAt, start), lt(llmUsage.occurredAt, end)));

  return parseSpentMicros(row?.spent);
}

/**
 * `capGbp × (perEur.USD / perEur.GBP) × 1_000_000`, rounded down.
 * Each currency uses its latest stored row. If either rate is missing or
 * unusable, the rate is 1.0.
 */
async function capInUsdMicros(db: Db, capGbp: number): Promise<number> {
  if (!Number.isFinite(capGbp) || capGbp <= 0) return 0;
  const rate = await gbpToUsd(db);
  return Math.floor(capGbp * rate * USD_MICROS_PER_UNIT);
}

async function gbpToUsd(db: Db): Promise<number> {
  const [gbpPerEur, usdPerEur] = await Promise.all([
    latestPerEur(db, "GBP"),
    latestPerEur(db, "USD"),
  ]);
  if (
    gbpPerEur == null ||
    usdPerEur == null ||
    !Number.isFinite(gbpPerEur) ||
    !Number.isFinite(usdPerEur) ||
    gbpPerEur <= 0 ||
    usdPerEur <= 0
  ) {
    return 1;
  }
  return usdPerEur / gbpPerEur;
}

async function latestPerEur(
  db: Db,
  currency: "GBP" | "USD",
): Promise<number | null> {
  const [row] = await db
    .select({ perEur: fxRates.perEur })
    .from(fxRates)
    .where(eq(fxRates.currency, currency))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);
  return row ? row.perEur : null;
}

/** A missing month sums to 0. Anything else unreadable refuses the call. */
function parseSpentMicros(value: string | null | undefined): number {
  if (value == null) return 0;
  const spent = Number(value);
  if (!Number.isSafeInteger(spent) || spent < 0) {
    throw new Error("Unable to read monthly LLM spend; refusing the call");
  }
  return spent;
}
