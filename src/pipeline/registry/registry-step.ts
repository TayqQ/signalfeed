// `pnpm ingest registry` (spec-phase3 section 6): link companies to Companies
// House, then refresh linked profiles, sharing one request limit. Skipped
// without a key. Log lines never carry the key or a full postcode.

import type { RegistryStats } from "@/core/domain";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import type { ChClient } from "./ch-client";
import {
  RequestBudget,
  emptyRegistryStats,
  linkCompanies,
} from "./link-companies";
import { refreshProfiles } from "./refresh-profiles";

export interface RegistryStepOptions {
  db: Db;
  /** Null when no `COMPANIES_HOUSE_API_KEY` is set. */
  client: ChClient | null;
  clock: Clock;
  /** `MAX_CH_REQUESTS_PER_RUN`. */
  maxRequests: number;
  log: (message: string) => void;
}

function summary(stats: RegistryStats): string {
  const linked = Object.values(stats.linkedByMethod).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );
  const stop = stats.rateLimited
    ? "; stopped: rate limited"
    : stats.stoppedAtLimit
      ? "; stopped: request limit"
      : "";
  return (
    `registry: searched ${stats.companiesSearched}, linked ${linked}, ` +
    `candidates ${stats.candidates}, none ${stats.none}, skipped ${stats.companiesSkipped}, ` +
    `profiles ${stats.profilesFetched} new and ${stats.profilesRefreshed} refreshed, ` +
    `filings ${stats.filingsStored}, address checks ${stats.addressChecks}, ` +
    `requests ${stats.requests}${stop}`
  );
}

/**
 * Runs linking, then refreshing. A rate limit or the request limit ends the
 * step early with a normal result; whatever is left stays due for next run.
 */
export async function registryStep(
  options: RegistryStepOptions,
): Promise<RegistryStats> {
  const { db, client, clock, maxRequests, log } = options;
  if (client === null) {
    log("registry: skipped, no Companies House key");
    return { ...emptyRegistryStats(), skipped: true };
  }

  const stats = emptyRegistryStats();
  const budget = new RequestBudget(client, maxRequests);
  const now = clock.now();
  await linkCompanies({ db, client, now, maxRequests, budget, stats, log });
  if (!stats.rateLimited && !stats.stoppedAtLimit) {
    await refreshProfiles({ db, client, now, maxRequests, budget, stats, log });
  }
  log(summary(stats));
  return stats;
}
