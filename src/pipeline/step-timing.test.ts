import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "@/core/errors";
import type { BudgetGuard } from "@/core/ports";
import {
  StepTimer,
  TimeLimit,
  formatSeconds,
  timeLimitedBudget,
} from "./step-timing";

function fakeClock() {
  let ms = Date.UTC(2026, 10, 20, 12);
  return {
    now: () => new Date(ms),
    advance(seconds: number) {
      ms += seconds * 1000;
    },
  };
}

describe("TimeLimit", () => {
  it("is reached at the limit and remembers that it was", () => {
    const clock = fakeClock();
    const limit = new TimeLimit(clock, 2);
    expect(limit.reached()).toBe(false);
    clock.advance(119);
    expect(limit.reached()).toBe(false);
    expect(limit.hit).toBe(false);
    clock.advance(1);
    expect(limit.reached()).toBe(true);
    expect(limit.hit).toBe(true);
  });
});

describe("StepTimer", () => {
  it("logs one line per step and records whole milliseconds", async () => {
    const clock = fakeClock();
    const log: string[] = [];
    const timer = new StepTimer(clock, (m) => log.push(m));
    await timer.time(
      "extract",
      () => {
        clock.advance(4.2);
        return Promise.resolve(6);
      },
      (n) => `${n} items`,
    );
    await timer.time("fx", () => Promise.resolve(undefined));
    expect(log).toEqual(["step extract: 4.2s (6 items)", "step fx: 0.0s"]);
    expect(timer.stepMs).toEqual({ extract: 4200, fx: 0 });
  });

  it("times a step that throws and rethrows", async () => {
    const clock = fakeClock();
    const log: string[] = [];
    const timer = new StepTimer(clock, (m) => log.push(m));
    await expect(
      timer.time("boom", () => {
        clock.advance(1);
        return Promise.reject(new Error("x"));
      }),
    ).rejects.toThrow("x");
    expect(log).toEqual(["step boom: 1.0s (failed)"]);
    expect(timer.stepMs.boom).toBe(1000);
  });

  it("formats seconds with one decimal", () => {
    expect(formatSeconds(1234)).toBe("1.2s");
    expect(formatSeconds(0)).toBe("0.0s");
  });
});

describe("timeLimitedBudget", () => {
  const estimate = {
    model: "m",
    estimatedInputTokens: 1,
    maxOutputTokens: 1,
    usdMicros: 1,
  };
  const inner: BudgetGuard & { asked: number } = {
    asked: 0,
    assertCanSpend() {
      this.asked += 1;
      return Promise.resolve();
    },
    record: () => Promise.resolve(),
    monthToDate: () => Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 1 }),
  };

  it("passes through before the limit and refuses after, without asking the real guard", async () => {
    const clock = fakeClock();
    const limit = new TimeLimit(clock, 1);
    const guard = timeLimitedBudget(inner, limit);
    await guard.budget.assertCanSpend(estimate);
    expect(inner.asked).toBe(1);
    expect(guard.tripped()).toBe(false);
    clock.advance(60);
    await expect(guard.budget.assertCanSpend(estimate)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(inner.asked).toBe(1);
    expect(guard.tripped()).toBe(true);
  });

  it("is the plain guard when there is no limit", () => {
    expect(timeLimitedBudget(inner, undefined).budget).toBe(inner);
  });
});
