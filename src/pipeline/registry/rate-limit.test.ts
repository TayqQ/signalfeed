import { describe, expect, it } from "vitest";
import { createWindowLimiter } from "./rate-limit";

function fakeTime() {
  let now = 1_000_000;
  return {
    clock: { now: () => new Date(now) },
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

describe("createWindowLimiter", () => {
  it("never allows more than 500 requests in any five-minute window", async () => {
    const time = fakeTime();
    const limiter = createWindowLimiter({
      max: 500,
      windowMs: 300_000,
      ...time,
    });
    const stamps: number[] = [];
    for (let i = 0; i < 1_200; i += 1) {
      await limiter.take();
      stamps.push(time.clock.now().getTime());
    }
    for (let i = 0; i < stamps.length; i += 1) {
      const start = stamps[i] ?? 0;
      const inWindow = stamps.filter((t) => t >= start && t < start + 300_000);
      expect(inWindow.length).toBeLessThanOrEqual(500);
    }
    expect(stamps[499]).toBe(stamps[0]);
    expect(stamps[500]).toBeGreaterThanOrEqual((stamps[0] ?? 0) + 300_000);
  });

  it("does not wait while under the limit", async () => {
    const time = fakeTime();
    let slept = 0;
    const limiter = createWindowLimiter({
      max: 3,
      windowMs: 1_000,
      clock: time.clock,
      sleep: (ms) => {
        slept += ms;
        return time.sleep(ms);
      },
    });
    await limiter.take();
    await limiter.take();
    expect(slept).toBe(0);
  });
});
