import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CostEstimate, UsageRecord } from "@/core/domain";
import { BudgetExceededError } from "@/core/errors";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import { fxRates, ingestRuns, llmUsage } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { createBudgetGuard } from "./budget-guard";
import { monthWindowUtc } from "./month";

const JANUARY_END = "2026-01-31T23:59:59.000Z";
const FEBRUARY_START = "2026-02-01T00:00:00.000Z";

function clockAt(iso: string): Clock & { set(next: string): void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    set(next: string) {
      current = new Date(next);
    },
  };
}

function estimate(usdMicros: number): CostEstimate {
  return {
    model: "gpt-4.1-nano",
    estimatedInputTokens: 120,
    maxOutputTokens: 200,
    usdMicros,
  };
}

function usage(costUsdMicros: number): UsageRecord {
  return {
    purpose: "extraction",
    model: "gpt-4.1-nano",
    inputTokens: 10,
    outputTokens: 20,
    costUsdMicros,
  };
}

describe("monthWindowUtc", () => {
  it("splits 23:59:59 UTC on the last day from 00:00:00 UTC on the 1st", () => {
    const january = monthWindowUtc(new Date(JANUARY_END));
    expect(january.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(january.end.toISOString()).toBe(FEBRUARY_START);

    const february = monthWindowUtc(new Date(FEBRUARY_START));
    expect(february.start.toISOString()).toBe(FEBRUARY_START);
    expect(february.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    const december = monthWindowUtc(new Date("2025-12-31T23:59:59.999Z"));
    expect(december.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(december.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("createBudgetGuard", () => {
  let testDb: TestDb;
  let db: Db;

  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 30_000);

  afterEach(async () => {
    await testDb.close();
  });

  it("allows a call that stays within the cap", async () => {
    const guard = createBudgetGuard({
      db,
      clock: clockAt("2026-03-15T12:00:00.000Z"),
      capGbp: 3,
    });

    await expect(
      guard.assertCanSpend(estimate(1_000_000)),
    ).resolves.toBeUndefined();
  });

  it("throws when an estimate would cross the cap even though spend is still under it", async () => {
    const guard = createBudgetGuard({
      db,
      clock: clockAt("2026-03-15T12:00:00.000Z"),
      capGbp: 3,
    });
    await guard.record(usage(2_000_000));

    await expect(
      guard.assertCanSpend(estimate(1_000_000)),
    ).resolves.toBeUndefined();

    await expect(
      guard.assertCanSpend(estimate(1_000_001)),
    ).rejects.toMatchObject({
      name: "BudgetExceededError",
      message:
        "Monthly LLM budget exceeded: spent 2000000 + estimate 1000001 > cap 3000000 USD micros (model gpt-4.1-nano)",
      details: {
        model: "gpt-4.1-nano",
        estimateUsdMicros: 1_000_001,
        spentUsdMicros: 2_000_000,
        capUsdMicros: 3_000_000,
      },
    });
    await expect(
      guard.assertCanSpend(estimate(1_000_001)),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("ignores usage from the previous month", async () => {
    const clock = clockAt(JANUARY_END);
    const guard = createBudgetGuard({ db, clock, capGbp: 3 });
    await guard.record(usage(2_900_000));

    clock.set(FEBRUARY_START);

    expect(await guard.monthToDate()).toEqual({
      spentUsdMicros: 0,
      capUsdMicros: 3_000_000,
    });
    await expect(guard.assertCanSpend(estimate(100))).resolves.toBeUndefined();
  });

  it("uses a 1.0 GBP to USD rate when no FX rate is stored", async () => {
    const guard = createBudgetGuard({
      db,
      clock: clockAt("2026-03-15T12:00:00.000Z"),
      capGbp: 3,
    });

    expect(await guard.monthToDate()).toEqual({
      spentUsdMicros: 0,
      capUsdMicros: 3_000_000,
    });
  });

  it("uses 1.0 when only one of GBP or USD is stored", async () => {
    await db.insert(fxRates).values({
      rateDate: "2026-03-01",
      currency: "GBP",
      perEur: 0.85,
    });
    const guard = createBudgetGuard({
      db,
      clock: clockAt("2026-03-15T12:00:00.000Z"),
      capGbp: 3,
    });

    expect((await guard.monthToDate()).capUsdMicros).toBe(3_000_000);
  });

  it("converts the cap with the latest GBP and USD rates, rounded down", async () => {
    await db.insert(fxRates).values([
      { rateDate: "2026-01-02", currency: "GBP", perEur: 1 },
      { rateDate: "2026-01-02", currency: "USD", perEur: 2 },
      { rateDate: "2026-03-02", currency: "GBP", perEur: 4 },
      { rateDate: "2026-03-02", currency: "USD", perEur: 5 },
    ]);
    const guard = createBudgetGuard({
      db,
      clock: clockAt("2026-03-15T12:00:00.000Z"),
      capGbp: 4,
    });

    // 5/4 = 1.25 USD per GBP; 4 × 1.25 × 1_000_000 = 5_000_000.
    // The January rate (2.0) would have produced 8_000_000.
    expect((await guard.monthToDate()).capUsdMicros).toBe(5_000_000);

    await db.insert(fxRates).values([
      { rateDate: "2026-03-03", currency: "GBP", perEur: 3 },
      { rateDate: "2026-03-03", currency: "USD", perEur: 1 },
    ]);
    const fractional = createBudgetGuard({
      db,
      clock: clockAt("2026-03-15T12:00:00.000Z"),
      capGbp: 1,
    });
    // 1/3 USD per GBP, rounded down.
    expect((await fractional.monthToDate()).capUsdMicros).toBe(333_333);
  });

  it("always throws when the cap is zero or negative", async () => {
    const clock = clockAt("2026-03-15T12:00:00.000Z");

    const zero = createBudgetGuard({ db, clock, capGbp: 0 });
    await expect(zero.assertCanSpend(estimate(0))).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    await expect(zero.assertCanSpend(estimate(0))).rejects.toThrow(
      /spent 0 \+ estimate 0 > cap 0/,
    );

    const negative = createBudgetGuard({ db, clock, capGbp: -5 });
    await expect(negative.assertCanSpend(estimate(1))).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("includes recorded usage in monthToDate and stamps occurred_at from the clock", async () => {
    const clock = clockAt("2026-04-10T08:30:00.000Z");
    const [run] = await db
      .insert(ingestRuns)
      .values({ trigger: "manual" })
      .returning();
    const guard = createBudgetGuard({
      db,
      clock,
      capGbp: 3,
      ingestRunId: run!.id,
    });

    expect((await guard.monthToDate()).spentUsdMicros).toBe(0);
    await guard.record(usage(250));
    expect((await guard.monthToDate()).spentUsdMicros).toBe(250);
    await guard.record(usage(750));
    expect(await guard.monthToDate()).toEqual({
      spentUsdMicros: 1_000,
      capUsdMicros: 3_000_000,
    });

    const rows = await db.select().from(llmUsage);
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.occurredAt.getTime() === clock.now().getTime()),
    ).toBe(true);
    expect(rows.every((row) => row.ingestRunId === run!.id)).toBe(true);

    const [stored] = await db
      .select({ occurredAt: llmUsage.occurredAt })
      .from(llmUsage)
      .where(eq(llmUsage.costUsdMicros, 250));
    expect(stored?.occurredAt.toISOString()).toBe("2026-04-10T08:30:00.000Z");
  });

  it("keeps January spend on the last second and starts February at midnight", async () => {
    const clock = clockAt(JANUARY_END);
    const guard = createBudgetGuard({ db, clock, capGbp: 3 });

    await guard.record(usage(100));
    expect((await guard.monthToDate()).spentUsdMicros).toBe(100);

    clock.set(FEBRUARY_START);
    expect((await guard.monthToDate()).spentUsdMicros).toBe(0);
    await expect(
      guard.assertCanSpend(estimate(2_900_000)),
    ).resolves.toBeUndefined();

    await guard.record(usage(40));
    expect((await guard.monthToDate()).spentUsdMicros).toBe(40);

    clock.set(JANUARY_END);
    expect((await guard.monthToDate()).spentUsdMicros).toBe(100);
    await expect(
      guard.assertCanSpend(estimate(2_999_901)),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
