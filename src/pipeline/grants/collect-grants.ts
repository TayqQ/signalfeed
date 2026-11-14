import { eq, isNull, sql } from "drizzle-orm";
import type { GrantCollectStats } from "@/core/domain";
import type { Db } from "@/db/client";
import { grantParticipants, grantProjects, sources } from "@/db/schema";
import { parseUkPostcode } from "@/lib/geo/postcode";
import type { GtrClient } from "./gtr-client";
import {
  mainAddress,
  projectFundDates,
  type GtrOrganisation,
} from "./gtr-schemas";
import { ensureGtrSource, storeProjects } from "./store-grants";

/** Decision D45: the backfill starts on 1 April 2024. Passed as `since` by the CLI. */
export const GRANTS_BACKFILL_START = "2024-04-01";

const STOP_AFTER_SEEN_PAGES = 3;
/** Organisation fetches stop after this many failures in a row. */
const STOP_AFTER_ORG_FAILURES = 3;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordError(stats: GrantCollectStats, error: unknown): void {
  stats.errorCount = (stats.errorCount ?? 0) + 1;
  stats.lastError = message(error);
}

export interface CollectGrantsOptions {
  db: Db;
  gtr: GtrClient;
  /** YYYY-MM-DD. Projects starting before this date are not stored. */
  since?: string;
  maxPages?: number;
  maxOrgFetches?: number;
  now?: () => Date;
}

/**
 * Walk Innovate UK projects newest first, then fetch each new organisation
 * once. Stops after 3 pages with no unseen project, at `maxPages`, or when
 * project start dates fall before `since`.
 *
 * A page that still fails after the client's retries ends the walk. What is
 * stored stays, the error goes in the stats, and the next run carries on
 * from the data that is missing. If the very first page fails, nothing was
 * fetched and the error is thrown.
 */
export async function collectGrantsStep(
  options: CollectGrantsOptions,
): Promise<GrantCollectStats> {
  const { db, gtr, since, maxPages = 30, maxOrgFetches = 1_500 } = options;
  const now = options.now ?? (() => new Date());
  const stats: GrantCollectStats = {
    pagesFetched: 0,
    projectsFound: 0,
    projectsInserted: 0,
    participantsInserted: 0,
    participantsSkipped: 0,
    orgsFetched: 0,
    orgsFailed: 0,
  };

  const sourceId = await ensureGtrSource(db);

  let pagesWithoutNew = 0;
  let walkFailed = false;
  for (let page = 1; page <= maxPages; page += 1) {
    let response: Awaited<ReturnType<GtrClient["listInnovateUkProjects"]>>;
    try {
      response = await gtr.listInnovateUkProjects(page);
    } catch (error) {
      if (stats.pagesFetched === 0) throw error;
      recordError(stats, error);
      walkFailed = true;
      break;
    }
    stats.pagesFetched += 1;
    if (response.project.length === 0) break;

    // Results are newest start first, so the first old project ends the walk.
    const inRange = since
      ? response.project.filter((project) => {
          const { startOn } = projectFundDates(project);
          return startOn === null || startOn >= since;
        })
      : response.project;
    const reachedSince = inRange.length < response.project.length;

    const stored = await storeProjects(db, sourceId, inRange);
    stats.projectsFound += inRange.length;
    stats.projectsInserted += stored.projectsInserted;
    stats.participantsInserted += stored.participantsInserted;
    stats.participantsSkipped += stored.participantsSkipped;

    if (reachedSince) break;
    pagesWithoutNew = stored.projectsInserted === 0 ? pagesWithoutNew + 1 : 0;
    if (pagesWithoutNew >= STOP_AFTER_SEEN_PAGES) break;
    const totalPages = response.totalPages;
    if (totalPages !== null && totalPages !== undefined && page >= totalPages) {
      break;
    }
  }

  // After a failed page the API is unwell, so leave organisations to the next run.
  if (!walkFailed) {
    await fetchOrganisations(db, gtr, maxOrgFetches, now, stats);
  }
  await db
    .update(sources)
    .set({ lastFetchedAt: now() })
    .where(eq(sources.id, sourceId));
  return stats;
}

interface OrganisationDetails {
  regNumber: string | null;
  postcode: string | null;
  outcode: string | null;
  regionText: string | null;
}

function organisationDetails(
  organisation: GtrOrganisation,
): OrganisationDetails {
  const address = mainAddress(organisation);
  const parsed = address?.postCode ? parseUkPostcode(address.postCode) : null;
  const regNumber = organisation.regNumber?.trim();
  return {
    regNumber: regNumber ? regNumber : null,
    postcode: parsed ? `${parsed.outcode} ${parsed.incode}` : null,
    outcode: parsed?.outcode ?? null,
    regionText: address?.region?.trim() || null,
  };
}

async function fetchOrganisations(
  db: Db,
  gtr: GtrClient,
  maxOrgFetches: number,
  now: () => Date,
  stats: GrantCollectStats,
): Promise<void> {
  if (maxOrgFetches <= 0) return;
  const pending = await db
    .selectDistinct({ gtrOrgId: grantParticipants.gtrOrgId })
    .from(grantParticipants)
    .where(isNull(grantParticipants.orgFetchedAt))
    .orderBy(grantParticipants.gtrOrgId)
    .limit(maxOrgFetches);

  let failuresInARow = 0;
  for (const { gtrOrgId } of pending) {
    let details: OrganisationDetails;
    try {
      details = organisationDetails(await gtr.getOrganisation(gtrOrgId));
      failuresInARow = 0;
    } catch (error) {
      // Left unfetched, so the next run tries again.
      stats.orgsFailed += 1;
      failuresInARow += 1;
      if (failuresInARow >= STOP_AFTER_ORG_FAILURES) {
        recordError(stats, error);
        return;
      }
      continue;
    }
    await db
      .update(grantParticipants)
      .set({ ...details, orgFetchedAt: now() })
      .where(eq(grantParticipants.gtrOrgId, gtrOrgId));
    stats.orgsFetched += 1;
  }
}

/** Counts for the A29 and A30 measurement in `docs/sources.md`. */
export async function grantCoverage(db: Db): Promise<{
  projects: number;
  participants: number;
  withPostcode: number;
}> {
  const [projects] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(grantProjects);
  const [participants] = await db
    .select({
      n: sql<number>`count(*)::int`,
      withPostcode: sql<number>`count(${grantParticipants.postcode})::int`,
    })
    .from(grantParticipants);
  return {
    projects: projects?.n ?? 0,
    participants: participants?.n ?? 0,
    withPostcode: participants?.withPostcode ?? 0,
  };
}
