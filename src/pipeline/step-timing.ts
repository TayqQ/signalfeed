import { BudgetExceededError } from "@/core/errors";
import type { BudgetGuard, Clock } from "@/core/ports";

/**
 * A run's time limit (D67). Loops and the gaps between steps ask `reached()`;
 * the first time it says yes, `hit` stays true, so the run can record that it
 * stopped early. It never interrupts anything: whoever asks decides where it
 * is safe to stop.
 */
export class TimeLimit {
  readonly endsAt: Date;
  private stopped = false;

  constructor(
    private readonly clock: Clock,
    minutes: number,
  ) {
    this.endsAt = new Date(clock.now().getTime() + minutes * 60_000);
  }

  /** True once the limit has passed. Remembers that it was asked and said yes. */
  reached(): boolean {
    if (this.clock.now().getTime() >= this.endsAt.getTime()) {
      this.stopped = true;
    }
    return this.stopped;
  }

  /** Whether any check found the limit passed. */
  get hit(): boolean {
    return this.stopped;
  }
}

/** `4.2s`: one decimal place, from whole milliseconds. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The two fields a timed run adds to its stored stats. */
export interface TimingStats {
  /** Milliseconds each step took, by step name. Steps that did not run are absent. */
  stepMs: Record<string, number>;
  /** True when the run's time limit ended a step or skipped one. */
  stoppedAtTime?: boolean;
}

/**
 * Times steps with the run's clock and logs one line per step when it ends:
 * `step extract: 4.2s (6 items)`. The durations are kept in `stepMs`.
 */
export class StepTimer {
  readonly stepMs: Record<string, number> = {};

  constructor(
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
  ) {}

  async time<T>(
    name: string,
    fn: () => Promise<T>,
    detail?: (result: T) => string | undefined,
  ): Promise<T> {
    const started = this.clock.now().getTime();
    const finish = (note: string | undefined): void => {
      const ms = Math.max(0, this.clock.now().getTime() - started);
      this.stepMs[name] = ms;
      this.log(`step ${name}: ${formatSeconds(ms)}${note ? ` (${note})` : ""}`);
    };
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      finish("failed");
      throw error;
    }
    finish(detail?.(result));
    return result;
  }
}

/** Runs `fn` under the timer when there is one, and plainly when there is not. */
export function timed<T>(
  timer: StepTimer | undefined,
  name: string,
  fn: () => Promise<T>,
  detail?: (result: T) => string | undefined,
): Promise<T> {
  return timer ? timer.time(name, fn, detail) : fn();
}

/**
 * A budget guard that also refuses once the time limit has passed, so a step
 * whose loop already stops on a budget refusal (tagging, embedding, theme
 * naming) stops between batches at the time limit too. The refusal comes
 * before any paid call and any write, so nothing is cut part way. `tripped()`
 * tells the caller the refusal was the time limit, not the budget.
 */
export function timeLimitedBudget(
  budget: BudgetGuard,
  limit: TimeLimit | undefined,
): { budget: BudgetGuard; tripped: () => boolean } {
  if (!limit) return { budget, tripped: () => false };
  let tripped = false;
  return {
    budget: {
      assertCanSpend: async (estimate) => {
        if (limit.reached()) {
          tripped = true;
          throw new BudgetExceededError({
            spentUsdMicros: 0,
            estimateUsdMicros: estimate.usdMicros,
            capUsdMicros: 0,
            model: estimate.model,
          });
        }
        await budget.assertCanSpend(estimate);
      },
      record: (usage) => budget.record(usage),
      monthToDate: () => budget.monthToDate(),
    },
    tripped: () => tripped,
  };
}
