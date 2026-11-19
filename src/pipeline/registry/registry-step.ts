// `pnpm ingest registry` (spec-phase3 section 6): link companies to Companies
// House, then refresh linked profiles, sharing one request limit. Skipped
// without a key. Log lines never carry the key or a full postcode.

import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import type { ChClient } from "./ch-client";
import {
  RequestBudget,
  RunDeadline,
  emptyRegistryStats,
  linkCompanies,
  type RegistryRunStats,
} from "./link-companies";
import { refreshProfiles } from "./refresh-profiles";

export interface RegistryStepOptions {
  db: Db;
  /** Null when no `COMPANIES_HOUSE_API_KEY` is set. */
  client: ChClient | null;
  clock: Clock;
  /** `MAX_CH_REQUESTS_PER_RUN`. */
  maxRequests: number;
  /** `MAX_CH_MINUTES_PER_RUN`. The default is 17. */
  maxMinutes?: number;
  log: (message: string) => void;
}

function summary(stats: RegistryRunStats): string {
  const linked = Object.values(stats.linkedByMethod).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );
  const stop = stats.rateLimited
    ? "; stopped: rate limited"
    : stats.stoppedAtLimit
      ? "; stopped: request limit"
      : stats.stoppedAtTime
        ? "; stopped: time limit"
        : "";
  return (
    `registry: searched ${stats.companiesSearched}, linked ${linked}, ` +
    `candidates ${stats.candidates}, none ${stats.none}, skipped ${stats.companiesSkipped}, ` +
    `profiles ${stats.profilesFetched} new and ${stats.profilesRefreshed} refreshed, ` +
    `filings ${stats.filingsStored}, address checks ${stats.addressChecks}, ` +
    `requests ${stats.requests}${stop}`
  );
}

/** The default for `MAX_CH_MINUTES_PER_RUN` (D63). */
export const DEFAULT_CH_MINUTES = 17;

/**
 * Runs linking, then refreshing, sharing one request limit and one deadline.
 * A rate limit, the request limit or the time limit ends the step early with
 * a normal result; whatever is left stays due for next run.
 */
export async function registryStep(
  options: RegistryStepOptions,
): Promise<RegistryRunStats> {
  const { db, client, clock, maxRequests, log } = options;
  if (client === null) {
    log("registry: skipped, no Companies House key");
    return { ...emptyRegistryStats(), skipped: true };
  }

  const stats = emptyRegistryStats();
  const deadline = new RunDeadline(
    clock,
    options.maxMinutes ?? DEFAULT_CH_MINUTES,
  );
  const budget = new RequestBudget(client, maxRequests, deadline);
  const now = clock.now();
  // Lets the client skip a rate-limit wait that would pass the deadline.
  client.setDeadline?.(deadline.endsAt);
  try {
    await linkCompanies({ db, client, now, maxRequests, budget, stats, log });
    if (!stats.rateLimited && !stats.stoppedAtLimit && !stats.stoppedAtTime) {
      await refreshProfiles({
        db,
        client,
        now,
        maxRequests,
        budget,
        stats,
        log,
      });
    }
  } finally {
    client.setDeadline?.(null);
  }
  log(summary(stats));
  return stats;
}
