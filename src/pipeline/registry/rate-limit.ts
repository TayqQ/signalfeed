import type { Clock } from "@/core/ports";

export interface WindowLimiterOptions {
  /** Most requests allowed in any window. */
  max: number;
  windowMs: number;
  clock: Clock;
  /** Test double. Production waits for real. */
  sleep?: (ms: number) => Promise<void>;
}

export interface WindowLimiter {
  /** Resolves when one more request fits in the window, and counts it. */
  take(): Promise<void>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * A sliding-window limiter. No more than `max` calls to `take()` resolve in
 * any span of `windowMs`. Callers are served in order.
 */
export function createWindowLimiter(
  options: WindowLimiterOptions,
): WindowLimiter {
  const { max, windowMs, clock } = options;
  if (!Number.isInteger(max) || max < 1) throw new Error("max must be >= 1");
  const sleep = options.sleep ?? realSleep;
  const taken: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  async function acquire(): Promise<void> {
    for (;;) {
      const now = clock.now().getTime();
      while (taken.length > 0 && now - (taken[0] ?? now) >= windowMs) {
        taken.shift();
      }
      if (taken.length < max) {
        taken.push(now);
        return;
      }
      const oldest = taken[0] ?? now;
      await sleep(Math.max(1, oldest + windowMs - now));
    }
  }

  return {
    take() {
      const turn = queue.then(acquire);
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}
