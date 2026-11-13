import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { LocationStats } from "@/core/domain";
import { upgradeExtraction } from "@/core/extraction-schema";
import type { LocationPrecision } from "@/core/enums";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companies,
  companyLocations,
  chAddressCounts,
  chCompanies,
  eventSources,
  events,
  extractions,
  grantParticipants,
  registryLinks,
  sourceItems,
  sources,
} from "@/db/schema";
import {
  outcodeCentroid,
  outcodeItl1,
  parseUkPostcode,
} from "@/lib/geo/postcode";
import { matchUkCity, normalisePlaceName } from "@/lib/geo/uk-places";
import { ukRegionFromText } from "@/lib/geo/uk-region-names";
import { ukRegionBySlug } from "@/lib/geo/uk-regions";
import {
  SHARED_ADDRESS_THRESHOLD,
  formatPostcode,
} from "@/pipeline/registry/shared-address";
import { emptyDiffCounts, writeDiff } from "./diff-write";
import {
  computeFingerprint,
  recordRebuild,
  shouldRebuild,
  type FingerprintInput,
} from "./fingerprint";

/** The `derived_rebuilds` name of this rebuild. */
export const LOCATIONS_REBUILD = "locations";

/** Bumped when the location rules change, so the next run rebuilds. */
export const LOCATIONS_LOGIC_VERSION = "locations-v2";

/** How many unmatched UK city names are logged. */
const UNMATCHED_LOG_LIMIT = 10;

type LocationRow = typeof companyLocations.$inferInsert;

/**
 * The inputs of the locations rebuild: companies, current extractions, the
 * links from extractions to companies, and resolved grant participants.
 * Source priority is included because it breaks ties between region texts.
 */
export const LOCATION_INPUTS: readonly FingerprintInput[] = [
  {
    table: companies,
    latest: [companies.updatedAt, companies.firstSeenAt],
    sums: [
      companies.mergedIntoId,
      sql`hashtext(coalesce(${companies.city}, '') || '|' || coalesce(${companies.countryCode}, ''))`,
    ],
  },
  {
    table: extractions,
    latest: [extractions.createdAt],
    sums: [sql`${extractions.id}::bigint * (${extractions.isCurrent})::int`],
  },
  {
    table: events,
    sums: [events.companyId],
  },
  {
    table: eventSources,
    sums: [eventSources.eventId, eventSources.extractionId],
  },
  {
    table: sources,
    sums: [sources.priority],
  },
  {
    table: grantParticipants,
    latest: [grantParticipants.resolvedAt],
    sums: [
      grantParticipants.companyId,
      sql`hashtext(coalesce(${grantParticipants.outcode}, ''))`,
    ],
  },
  {
    table: registryLinks,
    sums: [
      registryLinks.companyId,
      sql`hashtext(${registryLinks.registry}::text || '|' || ${registryLinks.registryId} || '|' || ${registryLinks.status}::text)`,
    ],
  },
  {
    table: chCompanies,
    latest: [chCompanies.fetchedAt],
    sums: [
      sql`hashtext(${chCompanies.companyNumber} || '|' || coalesce(${chCompanies.officePostcode}, '') || '|' || coalesce(${chCompanies.officeOutcode}, ''))`,
    ],
  },
  {
    table: chAddressCounts,
    latest: [chAddressCounts.checkedAt],
    sums: [
      chAddressCounts.activeCompanies,
      sql`hashtext(${chAddressCounts.postcode})`,
    ],
  },
];

export function locationsFingerprint(db: Db): Promise<string> {
  return computeFingerprint(db, LOCATIONS_LOGIC_VERSION, LOCATION_INPUTS);
}

export interface RebuildLocationsOptions {
  db: Db;
  clock: Clock;
  /** Rebuild even when the input fingerprint has not changed. */
  force?: boolean;
  /** Receives one line naming the most common unmatched UK city strings. */
  log?: (message: string) => void;
}

/** One report's region text, with what is needed to break ties. */
interface RegionVote {
  key: string;
  priority: number;
  date: Date;
  sourceItemId: number;
}

function emptyPrecisionCounts(): Record<LocationPrecision, number> {
  return { outcode: 0, town: 0, region: 0 };
}

function skipped(): LocationStats {
  return {
    rowsByPrecision: emptyPrecisionCounts(),
    ambiguousCities: 0,
    unmatchedUkCities: 0,
    written: emptyDiffCounts(),
    skipped: true,
  };
}

/**
 * The most frequent value, then the highest-priority source, then the
 * earliest item, as canonical event fields are chosen (D12).
 */
function pickRegionKey(votes: readonly RegionVote[]): string | null {
  const groups = new Map<string, RegionVote[]>();
  for (const vote of votes) {
    const group = groups.get(vote.key);
    if (group) group.push(vote);
    else groups.set(vote.key, [vote]);
  }
  const compare = (a: RegionVote, b: RegionVote): number =>
    b.priority - a.priority ||
    a.date.getTime() - b.date.getTime() ||
    a.sourceItemId - b.sourceItemId;
  const ranked = [...groups].map(([key, items]) => ({
    key,
    count: items.length,
    best: [...items].sort(compare)[0] as RegionVote,
  }));
  ranked.sort((a, b) => b.count - a.count || compare(a.best, b.best));
  return ranked[0]?.key ?? null;
}

/** The latest resolved grant participant with a valid outcode, by company. */
async function loadGrantOutcodes(db: Db): Promise<Map<number, string>> {
  const rows = await db
    .select({
      companyId: grantParticipants.companyId,
      outcode: grantParticipants.outcode,
    })
    .from(grantParticipants)
    .where(
      and(
        isNotNull(grantParticipants.companyId),
        isNotNull(grantParticipants.outcode),
        isNotNull(grantParticipants.resolvedAt),
      ),
    )
    .orderBy(desc(grantParticipants.resolvedAt), desc(grantParticipants.id));
  const byCompany = new Map<number, string>();
  for (const row of rows) {
    if (row.companyId === null || row.outcode === null) continue;
    if (byCompany.has(row.companyId)) continue;
    if (outcodeItl1(row.outcode) === null) continue;
    byCompany.set(row.companyId, row.outcode.trim().toUpperCase());
  }
  return byCompany;
}

/**
 * The registered-office outcode of each company with a `linked` Companies
 * House row (spec-phase3 section 7.3, D61). Fails closed: an office is left
 * out when its full postcode is not valid, has no stored address count, or
 * is shared (the count is at or above `SHARED_ADDRESS_THRESHOLD`). It is also
 * left out when the outcode has no known centroid or area, or disagrees with
 * the stored outcode.
 */
async function loadOfficeOutcodes(db: Db): Promise<Map<number, string>> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        companyId: registryLinks.companyId,
        postcode: chCompanies.officePostcode,
        outcode: chCompanies.officeOutcode,
      })
      .from(registryLinks)
      .innerJoin(
        chCompanies,
        eq(chCompanies.companyNumber, registryLinks.registryId),
      )
      .where(
        and(
          eq(registryLinks.registry, "companies_house"),
          eq(registryLinks.status, "linked"),
          isNotNull(chCompanies.officePostcode),
        ),
      )
      .orderBy(asc(registryLinks.companyId)),
    db.select().from(chAddressCounts),
  ]);
  const countByPostcode = new Map(
    counts.map((row) => [row.postcode, row.activeCompanies]),
  );

  const byCompany = new Map<number, string>();
  for (const row of rows) {
    if (row.postcode === null) continue;
    const key = formatPostcode(row.postcode);
    const parsed = parseUkPostcode(row.postcode);
    if (key === null || parsed === null) continue;
    const count = countByPostcode.get(key);
    if (count === undefined || count >= SHARED_ADDRESS_THRESHOLD) continue;
    const outcode = parsed.outcode.toUpperCase();
    if (row.outcode && row.outcode.trim().toUpperCase() !== outcode) continue;
    if (outcodeCentroid(outcode) === null || outcodeItl1(outcode) === null) {
      continue;
    }
    byCompany.set(row.companyId, outcode);
  }
  return byCompany;
}

/** Region text votes from current extractions, by company. */
async function loadRegionVotes(db: Db): Promise<Map<number, RegionVote[]>> {
  const rows = await db
    .select({
      companyId: events.companyId,
      eventIndex: eventSources.eventIndex,
      sourceItemId: eventSources.sourceItemId,
      result: extractions.result,
      publishedAt: sourceItems.publishedAt,
      fetchedAt: sourceItems.fetchedAt,
      priority: sources.priority,
    })
    .from(eventSources)
    .innerJoin(events, eq(events.id, eventSources.eventId))
    .innerJoin(extractions, eq(extractions.id, eventSources.extractionId))
    .innerJoin(sourceItems, eq(sourceItems.id, eventSources.sourceItemId))
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(eq(extractions.isCurrent, true))
    .orderBy(asc(eventSources.sourceItemId), asc(eventSources.eventIndex));

  const byCompany = new Map<number, RegionVote[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const event = upgradeExtraction(row.result).events[row.eventIndex];
    const text = event?.company.regionText?.trim();
    if (!text) continue;
    // Texts for the same area vote together ("Scottish", "Scotland"). Text
    // that maps to no area votes under its own folded form, so it can still
    // outvote a rarer mapped text, as the plain majority rule says.
    const slug = ukRegionFromText(text);
    const folded = normalisePlaceName(text);
    const key = slug ?? (folded ? `?${folded}` : null);
    if (!key) continue;
    // One vote per company and report, however many events it contains.
    const once = `${row.companyId}:${row.sourceItemId}`;
    if (seen.has(once)) continue;
    seen.add(once);
    const votes = byCompany.get(row.companyId) ?? [];
    votes.push({
      key,
      priority: row.priority,
      date: row.publishedAt ?? row.fetchedAt,
      sourceItemId: row.sourceItemId,
    });
    byCompany.set(row.companyId, votes);
  }
  return byCompany;
}

export interface ComputedLocations {
  rows: LocationRow[];
  stats: Omit<LocationStats, "written" | "skipped">;
  /** UK city strings with no gazetteer match, most common first. */
  unmatchedCities: Array<{ city: string; companies: number }>;
}

/**
 * Applies the rules of spec-phase2 section 9.1 to every non-merged company.
 * The first match wins: grant postcode, UK city, registered office, UK region
 * text, non-UK city (spec-phase3 section 7.3).
 * A region from text never overrides a postcode or a town, so a conflict
 * with a town's region is ignored and the town wins.
 */
export async function computeCompanyLocations(
  db: Db,
): Promise<ComputedLocations> {
  const grantOutcodes = await loadGrantOutcodes(db);
  const regionVotes = await loadRegionVotes(db);
  const officeOutcodes = await loadOfficeOutcodes(db);
  const active = await db
    .select({
      id: companies.id,
      city: companies.city,
      countryCode: companies.countryCode,
    })
    .from(companies)
    .where(isNull(companies.mergedIntoId))
    .orderBy(asc(companies.id));

  const rows: LocationRow[] = [];
  const ambiguous = new Set<string>();
  const unmatched = new Map<string, number>();

  for (const company of active) {
    const outcode = grantOutcodes.get(company.id);
    if (outcode) {
      const centroid = outcodeCentroid(outcode);
      const code = outcodeItl1(outcode);
      if (code) {
        rows.push({
          companyId: company.id,
          countryCode: "GB",
          itl1Code: code,
          placeSlug: null,
          outcode,
          latitude: centroid?.lat ?? null,
          longitude: centroid?.lon ?? null,
          precision: "outcode",
          source: "grant_postcode",
        });
        continue;
      }
    }

    const city = company.city?.trim() || null;

    if (company.countryCode === "GB") {
      if (city) {
        const match = matchUkCity(city);
        if (match && "place" in match) {
          const { place } = match;
          rows.push({
            companyId: company.id,
            countryCode: "GB",
            itl1Code: place.itl1,
            placeSlug: place.slug,
            outcode: null,
            latitude: place.lat,
            longitude: place.lon,
            precision: "town",
            source: "news_city",
          });
          continue;
        }
        const name = normalisePlaceName(city);
        if (match) ambiguous.add(name);
        else if (name) unmatched.set(city, (unmatched.get(city) ?? 0) + 1);
      }

      const key = pickRegionKey(regionVotes.get(company.id) ?? []);
      const region = key ? ukRegionBySlug(key) : null;

      // Registered office. Skipped when the news names a different area.
      const office = officeOutcodes.get(company.id);
      const officeCode = office ? outcodeItl1(office) : null;
      if (office && officeCode && (!region || region.code === officeCode)) {
        const centroid = outcodeCentroid(office);
        rows.push({
          companyId: company.id,
          countryCode: "GB",
          itl1Code: officeCode,
          placeSlug: null,
          outcode: office,
          latitude: centroid?.lat ?? null,
          longitude: centroid?.lon ?? null,
          precision: "outcode",
          source: "registered_office",
        });
        continue;
      }

      if (region) {
        rows.push({
          companyId: company.id,
          countryCode: "GB",
          itl1Code: region.code,
          placeSlug: null,
          outcode: null,
          latitude: null,
          longitude: null,
          precision: "region",
          source: "news_region",
        });
      }
      continue;
    }

    if (company.countryCode && city) {
      rows.push({
        companyId: company.id,
        countryCode: company.countryCode,
        itl1Code: null,
        placeSlug: null,
        outcode: null,
        latitude: null,
        longitude: null,
        precision: "town",
        source: "news_city",
      });
    }
  }

  const rowsByPrecision = emptyPrecisionCounts();
  for (const row of rows) rowsByPrecision[row.precision] += 1;

  return {
    rows,
    stats: {
      rowsByPrecision,
      ambiguousCities: ambiguous.size,
      unmatchedUkCities: unmatched.size,
    },
    unmatchedCities: [...unmatched]
      .map(([city, count]) => ({ city, companies: count }))
      .sort(
        (a, b) => b.companies - a.companies || a.city.localeCompare(b.city),
      ),
  };
}

/**
 * Rebuilds `company_locations` (spec-phase2 sections 5.3 and 9.1, D37, D39).
 * Skipped when the inputs have not changed, unless `force` is set. Writes
 * only changed rows in one transaction.
 *
 * The fingerprint is taken before the inputs are read, so a change made in
 * between makes the next run rebuild again rather than being missed.
 */
export async function rebuildCompanyLocations({
  db,
  clock,
  force = false,
  log,
}: RebuildLocationsOptions): Promise<LocationStats> {
  const fingerprint = await locationsFingerprint(db);
  if (!force && !(await shouldRebuild(db, LOCATIONS_REBUILD, fingerprint))) {
    return skipped();
  }

  const computed = await computeCompanyLocations(db);
  const written = await db.transaction(async (tx) => {
    const counts = await writeDiff(
      tx,
      companyLocations,
      ["companyId"],
      computed.rows,
    );
    await recordRebuild(tx, LOCATIONS_REBUILD, fingerprint, clock.now());
    return counts;
  });

  if (log && computed.unmatchedCities.length > 0) {
    const top = computed.unmatchedCities
      .slice(0, UNMATCHED_LOG_LIMIT)
      .map((item) => `${item.city} (${item.companies})`)
      .join(", ");
    log(`Unmatched UK cities: ${top}`);
  }

  return { ...computed.stats, written };
}
