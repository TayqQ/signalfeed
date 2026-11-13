// Keeps linked Companies House profiles fresh (spec-phase3 sections 7.2 and
// 7.3, D52). A refreshed profile can show a conflict that was not there when
// the company was linked, such as a dissolution before a later round. Then an
// automatic link goes back to review. Manual links are never touched.

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  max,
  notInArray,
  sql,
} from "drizzle-orm";
import type { RegistryStats } from "@/core/domain";
import type { Db } from "@/db/client";
import {
  chCompanies,
  chFilings,
  companies,
  eventConfirmations,
  events,
  fundingRounds,
  registryLinks,
} from "@/db/schema";
import { RateLimitedError, type ChClient } from "./ch-client";
import { isEquityRound } from "./confirm-rules";
import {
  RequestBudget,
  RequestLimitReached,
  describeError,
  emptyRegistryStats,
  filingsSince,
  isFatal,
  loadCompanyLinkFacts,
  markStopped,
} from "./link-companies";
import { demoteAutoLink } from "./link-store";
import { chConflicts } from "./link-rules";
import {
  fillFoundedYear,
  storeChCompany,
  storeChFilings,
} from "./store-registry";

/** A linked profile is fetched again after this many days. */
export const PROFILE_MAX_AGE_DAYS = 90;
/** An equity round this recent, not yet confirmed, makes refreshes weekly. */
export const RECENT_ROUND_DAYS = 120;
export const RECENT_ROUND_REFRESH_DAYS = 7;

const REGISTRY = "companies_house" as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface RefreshDue {
  companyId: number;
  companyNumber: string;
  decidedBy: "auto" | "manual";
  /** Null when no profile is stored yet (for example after a manual link). */
  fetchedAt: Date | null;
  /** An unconfirmed equity round in the last 120 days. */
  recentRound: boolean;
}

/** Companies with an unconfirmed equity round announced in the last 120 days. */
async function companiesWithRecentRounds(
  db: Db,
  companyIds: readonly number[],
  now: Date,
): Promise<Set<number>> {
  if (companyIds.length === 0) return new Set();
  const since = isoDay(new Date(now.getTime() - RECENT_ROUND_DAYS * DAY_MS));
  const rows = await db
    .selectDistinct({ companyId: events.companyId })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        inArray(events.companyId, [...companyIds]),
        eq(events.type, "funding_round"),
        notInArray(fundingRounds.roundType, ["debt", "grant"]),
        gte(events.announcedOn, since),
        sql`not exists (select 1 from ${eventConfirmations} where ${eventConfirmations.eventId} = ${events.id})`,
      ),
    );
  return new Set(rows.map((row) => row.companyId));
}

/**
 * Linked companies whose profile is due, oldest first: never fetched, older
 * than 90 days, or older than 7 days with a recent unconfirmed equity round.
 */
export async function profilesDue(db: Db, now: Date): Promise<RefreshDue[]> {
  const rows = await db
    .select({
      companyId: registryLinks.companyId,
      companyNumber: registryLinks.registryId,
      decidedBy: registryLinks.decidedBy,
      fetchedAt: chCompanies.fetchedAt,
    })
    .from(registryLinks)
    .innerJoin(companies, eq(companies.id, registryLinks.companyId))
    .leftJoin(
      chCompanies,
      eq(chCompanies.companyNumber, registryLinks.registryId),
    )
    .where(
      and(
        eq(registryLinks.registry, REGISTRY),
        eq(registryLinks.status, "linked"),
        isNull(companies.mergedIntoId),
      ),
    )
    .orderBy(asc(chCompanies.fetchedAt), asc(registryLinks.companyId));

  const recent = await companiesWithRecentRounds(
    db,
    rows.map((row) => row.companyId),
    now,
  );
  const due: RefreshDue[] = [];
  for (const row of rows) {
    const recentRound = recent.has(row.companyId);
    const age =
      row.fetchedAt === null ? null : now.getTime() - row.fetchedAt.getTime();
    const isDue =
      age === null ||
      age >= PROFILE_MAX_AGE_DAYS * DAY_MS ||
      (recentRound && age >= RECENT_ROUND_REFRESH_DAYS * DAY_MS);
    if (isDue) due.push({ ...row, recentRound });
  }
  due.sort((a, b) => {
    const ta = a.fetchedAt?.getTime() ?? -Infinity;
    const tb = b.fetchedAt?.getTime() ?? -Infinity;
    return ta === tb ? a.companyId - b.companyId : ta - tb;
  });
  return due;
}

async function latestStoredFiling(
  db: Db,
  companyNumber: string,
): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(chFilings.filedOn) })
    .from(chFilings)
    .where(eq(chFilings.companyNumber, companyNumber));
  return row?.latest ?? null;
}

export interface RefreshProfilesOptions {
  db: Db;
  client: ChClient;
  now: Date;
  maxRequests: number;
  /** Shared with the linking pass. Made from `maxRequests` when missing. */
  budget?: RequestBudget;
  /** Added to in place. A new one when missing. */
  stats?: RegistryStats;
  log?: (message: string) => void;
}

/**
 * Refreshes due profiles and fetches new capital filings for companies with
 * equity rounds that need them: a recent unconfirmed round, or rounds and no
 * filing stored yet. Re-checks the conflicts and demotes an automatic link
 * that now conflicts. Stops at the request limit or a rate limit.
 */
export async function refreshProfiles(
  options: RefreshProfilesOptions,
): Promise<RegistryStats> {
  const { db, client, now } = options;
  const stats = options.stats ?? emptyRegistryStats();
  const budget =
    options.budget ?? new RequestBudget(client, options.maxRequests);
  const log = options.log ?? (() => undefined);
  const startUsed = budget.used();

  try {
    const due = await profilesDue(db, now);
    for (const item of due) {
      try {
        budget.require(1);
        const profile = await client.getCompany(item.companyNumber);
        if (profile === null) {
          log(`registry: profile ${item.companyNumber} not found; link kept`);
          continue;
        }
        await storeChCompany(db, profile, now);
        stats.profilesRefreshed += 1;

        const facts = (await loadCompanyLinkFacts(db, [item.companyId])).get(
          item.companyId,
        );
        const companyEvents = facts?.company.events ?? [];
        const hasEquity = companyEvents.some(isEquityRound);
        const latest = await latestStoredFiling(db, item.companyNumber);
        if (hasEquity && (item.recentRound || latest === null)) {
          budget.require(1);
          const since = latest ?? filingsSince(companyEvents);
          const filings = await client.getCapitalFilings(
            item.companyNumber,
            since === undefined ? {} : { since },
          );
          stats.filingsStored += await storeChFilings(
            db,
            item.companyNumber,
            filings,
            now,
          );
        }

        const conflicts = facts ? chConflicts(facts.company, profile) : [];
        if (conflicts.length > 0 && item.decidedBy === "auto") {
          const demoted = await demoteAutoLink(db, {
            companyId: item.companyId,
            registry: REGISTRY,
            reason: `refreshed profile conflicts: ${conflicts.join("; ")}`,
            now,
          });
          if (demoted.outcome === "demoted") {
            log(
              `registry: company ${item.companyId} link demoted to review after a refresh`,
            );
          }
          continue;
        }
        await fillFoundedYear(db, item.companyId, profile.incorporatedOn);
      } catch (error) {
        if (
          error instanceof RateLimitedError ||
          error instanceof RequestLimitReached ||
          isFatal(error)
        ) {
          throw error;
        }
        log(
          `registry: profile ${item.companyNumber} not refreshed: ${describeError(error)}`,
        );
      }
    }
  } catch (error) {
    if (!markStopped(stats, error)) throw error;
  }
  stats.requests += budget.used() - startUsed;
  return stats;
}
