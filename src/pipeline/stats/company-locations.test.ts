import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionV2 } from "@/core/extraction-schema";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  companies,
  companyLocations,
  derivedRebuilds,
  eventSources,
  events,
  extractions,
  grantParticipants,
  grantProjects,
  sourceItems,
  sources,
} from "@/db/schema";
import { findPlaceBySlug } from "@/lib/geo/uk-places";
import { insertCompany } from "@/pipeline/resolve/testing";
import {
  LOCATIONS_REBUILD,
  rebuildCompanyLocations,
} from "./company-locations";

let testDb: TestDb;
let db: Db;
let nextItem: number;
let sourceIds: number[];

const clock: Clock = { now: () => new Date("2026-11-11T12:00:00Z") };
const NONE = { inserted: 0, updated: 0, deleted: 0 };

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  nextItem = 0;
  const rows = await db
    .insert(sources)
    .values([
      { slug: "a", name: "A", kind: "rss", url: "https://a.test", priority: 9 },
      { slug: "b", name: "B", kind: "rss", url: "https://b.test", priority: 5 },
    ])
    .returning({ id: sources.id });
  sourceIds = rows.map((row) => row.id);
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function locationOf(companyId: number) {
  const [row] = await db
    .select()
    .from(companyLocations)
    .where(eq(companyLocations.companyId, companyId));
  return row;
}

/** A report whose single event about `companyId` carries `regionText`. */
async function addReport(
  companyId: number,
  regionText: string | null,
  options: { sourceIndex?: number; publishedAt?: Date } = {},
): Promise<void> {
  nextItem += 1;
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId: sourceIds[options.sourceIndex ?? 0] as number,
      externalId: `item-${nextItem}`,
      url: `https://x.test/${nextItem}`,
      canonicalUrl: `https://x.test/${nextItem}`,
      title: "Headline",
      publishedAt:
        options.publishedAt ?? new Date(`2026-01-${10 + nextItem}T00:00:00Z`),
    })
    .returning({ id: sourceItems.id });
  const result = {
    events: [{ company: { name: "Acme", regionText } }],
  } as unknown as ExtractionV2;
  const [extraction] = await db
    .insert(extractions)
    .values({
      sourceItemId: item?.id as number,
      promptVersion: "v2",
      model: "test",
      result,
      isRelevant: true,
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 1,
    })
    .returning({ id: extractions.id });
  const [event] = await db
    .insert(events)
    .values({ type: "funding_round", companyId, announcedOn: "2026-01-01" })
    .returning({ id: events.id });
  await db.insert(eventSources).values({
    eventId: event?.id as number,
    extractionId: extraction?.id as number,
    sourceItemId: item?.id as number,
    eventIndex: 0,
  });
}

async function addGrant(
  companyId: number,
  outcode: string | null,
  resolvedAt: string,
): Promise<void> {
  const [project] = await db
    .insert(grantProjects)
    .values({
      sourceId: sourceIds[0] as number,
      gtrProjectId: `p-${outcode}-${resolvedAt}`,
      title: "Project",
      grantCategory: "Collaborative R&D",
      leadFunder: "Innovate UK",
      status: "Active",
      gtrUrl: "https://gtr.test/p",
    })
    .returning({ id: grantProjects.id });
  await db.insert(grantParticipants).values({
    projectId: project?.id as number,
    gtrOrgId: `org-${companyId}-${resolvedAt}`,
    organisationName: "Acme Ltd",
    outcode,
    role: "lead",
    companyId,
    resolvedAt: new Date(resolvedAt),
  });
}

const run = (force = false) => rebuildCompanyLocations({ db, clock, force });

describe("rebuildCompanyLocations", () => {
  it("prefers a grant outcode over a news city", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      city: "Leeds",
    });
    await addGrant(company.id, "L35", "2026-03-01T00:00:00Z");

    const stats = await run();
    const row = await locationOf(company.id);

    expect(row).toMatchObject({
      precision: "outcode",
      source: "grant_postcode",
      outcode: "L35",
      countryCode: "GB",
      placeSlug: null,
    });
    expect(row?.itl1Code).toBe("TLD");
    expect(row?.latitude).not.toBeNull();
    expect(stats.rowsByPrecision).toEqual({ outcode: 1, town: 0, region: 0 });
  });

  it("uses the latest grant participant that has a valid outcode", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    await addGrant(company.id, "L35", "2026-03-01T00:00:00Z");
    await addGrant(company.id, "ZZ99", "2026-05-01T00:00:00Z");
    await addGrant(company.id, null, "2026-06-01T00:00:00Z");
    expect((await run(), (await locationOf(company.id))?.outcode)).toBe("L35");

    await addGrant(company.id, "LS1", "2026-07-01T00:00:00Z");
    await run();
    expect((await locationOf(company.id))?.outcode).toBe("LS1");
  });

  it("places a GB Leeds in town precision with the gazetteer's data", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      city: "Leeds",
    });
    await run();
    const leeds = findPlaceBySlug("leeds");

    expect(await locationOf(company.id)).toMatchObject({
      precision: "town",
      source: "news_city",
      placeSlug: "leeds",
      itl1Code: "TLE",
    });
    const row = await locationOf(company.id);
    expect(row?.latitude).toBeCloseTo(leeds?.lat as number, 3);
    expect(row?.longitude).toBeCloseTo(leeds?.lon as number, 3);
  });

  it("ignores a news region that conflicts with the town", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      city: "Leeds",
    });
    await addReport(company.id, "Scottish");
    await run();
    expect((await locationOf(company.id))?.itl1Code).toBe("TLE");
  });

  it("treats GB Newport as ambiguous and uses region text if present", async () => {
    const withRegion = await insertCompany(db, {
      name: "Has Region",
      countryCode: "GB",
      city: "Newport",
    });
    await addReport(withRegion.id, "Wales");
    const without = await insertCompany(db, {
      name: "No Region",
      countryCode: "GB",
      city: "Newport",
    });

    const stats = await run();

    expect(await locationOf(withRegion.id)).toMatchObject({
      precision: "region",
      source: "news_region",
      itl1Code: "TLL",
    });
    expect(await locationOf(without.id)).toBeUndefined();
    expect(stats.ambiguousCities).toBe(1);
    expect(stats.unmatchedUkCities).toBe(0);
  });

  it("gives a GB company with region text and no city a region row", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
    });
    await addReport(company.id, "Scottish");
    await run();

    expect(await locationOf(company.id)).toMatchObject({
      precision: "region",
      source: "news_region",
      itl1Code: "TLM",
      placeSlug: null,
      outcode: null,
      latitude: null,
      longitude: null,
    });
  });

  it("votes on region text, then source priority, then the earliest item", async () => {
    const majority = await insertCompany(db, {
      name: "Majority",
      countryCode: "GB",
    });
    await addReport(majority.id, "Scotland");
    await addReport(majority.id, "Wales");
    await addReport(majority.id, "Scottish");

    const byPriority = await insertCompany(db, {
      name: "Priority",
      countryCode: "GB",
    });
    await addReport(byPriority.id, "Wales", { sourceIndex: 1 });
    await addReport(byPriority.id, "Scotland", { sourceIndex: 0 });

    const byDate = await insertCompany(db, {
      name: "Date",
      countryCode: "GB",
    });
    await addReport(byDate.id, "Wales", {
      publishedAt: new Date("2026-02-01T00:00:00Z"),
    });
    await addReport(byDate.id, "Scotland", {
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await run();

    expect((await locationOf(majority.id))?.itl1Code).toBe("TLM");
    expect((await locationOf(byPriority.id))?.itl1Code).toBe("TLM");
    expect((await locationOf(byDate.id))?.itl1Code).toBe("TLM");
  });

  it("ignores region text from extractions that are no longer current", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
    });
    await addReport(company.id, "Scotland");
    await db.update(extractions).set({ isCurrent: false });
    await run();
    expect(await locationOf(company.id)).toBeUndefined();
  });

  it("stores a non-UK city by country only, with no coordinates", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "US",
      city: "Austin",
    });
    await run();

    expect(await locationOf(company.id)).toMatchObject({
      countryCode: "US",
      precision: "town",
      source: "news_city",
      placeSlug: null,
      itl1Code: null,
      latitude: null,
      longitude: null,
    });
  });

  it("gives no row to a company with only a country", async () => {
    const gb = await insertCompany(db, { name: "Uk Co", countryCode: "GB" });
    const us = await insertCompany(db, { name: "Us Co", countryCode: "US" });
    await run();
    expect(await locationOf(gb.id)).toBeUndefined();
    expect(await locationOf(us.id)).toBeUndefined();
  });

  it("gives no row to a merged company", async () => {
    const survivor = await insertCompany(db, { name: "Survivor" });
    const merged = await insertCompany(db, {
      name: "Merged",
      countryCode: "GB",
      city: "Leeds",
      mergedIntoId: survivor.id,
    });
    await addGrant(merged.id, "L35", "2026-03-01T00:00:00Z");
    await run();
    expect(await locationOf(merged.id)).toBeUndefined();
  });

  it("counts unmatched UK cities and logs the common ones, city names only", async () => {
    for (const name of ["One", "Two"]) {
      await insertCompany(db, {
        name,
        countryCode: "GB",
        city: "Nowhereville",
      });
    }
    await insertCompany(db, {
      name: "Three",
      countryCode: "GB",
      city: "Faraway",
    });
    const log = vi.fn();

    const stats = await rebuildCompanyLocations({ db, clock, log });

    expect(stats.unmatchedUkCities).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe(
      "Unmatched UK cities: Nowhereville (2), Faraway (1)",
    );
  });

  it("skips an unchanged second run, and a forced run writes nothing", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      city: "Leeds",
    });
    const first = await run();
    expect(first.written).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    expect(first.skipped).toBeUndefined();
    const [stored] = await db
      .select()
      .from(derivedRebuilds)
      .where(eq(derivedRebuilds.name, LOCATIONS_REBUILD));
    expect(stored).toBeDefined();
    const before = await locationOf(company.id);

    const second = await run();
    expect(second.skipped).toBe(true);
    expect(second.written).toEqual(NONE);

    const forced = await run(true);
    expect(forced.skipped).toBeUndefined();
    expect(forced.written).toEqual(NONE);
    expect(forced.rowsByPrecision.town).toBe(1);
    expect(await locationOf(company.id)).toEqual(before);
  });

  it("rebuilds when an input changes, and removes rows no longer produced", async () => {
    const company = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      city: "Leeds",
    });
    await run();

    await db
      .update(companies)
      .set({ city: null, updatedAt: new Date("2026-12-01T00:00:00Z") })
      .where(eq(companies.id, company.id));
    const stats = await run();

    expect(stats.written).toEqual({ inserted: 0, updated: 0, deleted: 1 });
    expect(await locationOf(company.id)).toBeUndefined();
  });
});
