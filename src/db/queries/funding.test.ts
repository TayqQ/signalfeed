import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FundingFilters } from "@/core/read-models";
import type { RoundType } from "@/core/enums";
import { computeRoundMomentum } from "@/lib/company-momentum";
import { findPlaceBySlug } from "@/lib/geo/uk-places";
import { normaliseCompanyName, slugify } from "@/lib/normalise";
import type { Db } from "../client";
import {
  companies,
  companyLocations,
  companyThemes,
  events,
  fundingRoundMomentum,
  fundingRounds,
  tags,
  themes,
} from "../schema";

interface RoundSpec {
  date: string;
  type: RoundType;
  gbp?: number;
  evidence?: "reported" | "confirmed";
}

async function addCompany(
  db: Db,
  name: string,
  options: { country?: string; city?: string } = {},
): Promise<number> {
  const [row] = await db
    .insert(companies)
    .values({
      slug: slugify(name),
      name,
      normalisedName: normaliseCompanyName(name),
      countryCode: options.country ?? "GB",
      city: options.city ?? null,
    })
    .returning({ id: companies.id });
  if (!row) throw new Error("Company insert failed");
  return row.id;
}

/** Inserts rounds, then the momentum rows a stats rebuild would write. */
async function addRounds(
  db: Db,
  companyId: number,
  rounds: RoundSpec[],
): Promise<number[]> {
  const ids: number[] = [];
  for (const round of rounds) {
    const [event] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId,
        announcedOn: round.date,
        evidence: round.evidence ?? "reported",
      })
      .returning({ id: events.id });
    if (!event) throw new Error("Event insert failed");
    await db.insert(fundingRounds).values({
      eventId: event.id,
      roundType: round.type,
      amountMinor: round.gbp ?? null,
      currency: round.gbp == null ? null : "GBP",
      amountGbpMinor: round.gbp ?? null,
    });
    ids.push(event.id);
  }
  const results = computeRoundMomentum(
    rounds.map((round, index) => ({
      eventId: ids[index] ?? 0,
      announcedOn: round.date,
      datePrecision: "day" as const,
      roundType: round.type,
      amountGbpMinor: round.gbp ?? null,
    })),
  );
  for (const result of results) {
    await db.insert(fundingRoundMomentum).values({
      eventId: result.eventId,
      companyId,
      equityRoundNumber: result.equityRoundNumber,
      previousEventId: result.previousEventId,
      monthsSincePrevious: result.monthsSincePrevious,
      stepUpBasisEventId: result.stepUpBasisEventId,
      stepUpRatio: result.stepUpRatio,
      roundsIn24mToDate: result.roundsIn24mToDate,
    });
  }
  return ids;
}

async function locateInPlace(
  db: Db,
  companyId: number,
  placeSlug: string,
): Promise<void> {
  const place = findPlaceBySlug(placeSlug);
  if (!place) throw new Error(`Unknown place ${placeSlug}`);
  await db.insert(companyLocations).values({
    companyId,
    countryCode: "GB",
    itl1Code: place.itl1,
    placeSlug: place.slug,
    latitude: place.lat,
    longitude: place.lon,
    precision: "town",
    source: "news_city",
  });
}

async function addTheme(
  db: Db,
  slug: string,
  options: {
    sector?: string;
    mergedInto?: number;
  } = {},
): Promise<number> {
  const [tag] = await db
    .insert(tags)
    .values({ slug: `tag-${slug}`, label: slug })
    .returning({ id: tags.id });
  if (!tag) throw new Error("Tag insert failed");
  const [theme] = await db
    .insert(themes)
    .values({
      slug,
      name: slug,
      sector: options.sector ?? null,
      status: options.mergedInto == null ? "active" : "merged",
      mergedIntoId: options.mergedInto ?? null,
      seedTagId: tag.id,
      centroid: new Array<number>(512).fill(0),
      embeddingModel: "test",
    })
    .returning({ id: themes.id });
  if (!theme) throw new Error("Theme insert failed");
  return theme.id;
}

async function linkTheme(
  db: Db,
  companyId: number,
  themeId: number,
): Promise<void> {
  await db.insert(companyThemes).values({ companyId, themeId, tagCount: 1 });
}
import { createTestDb, type TestDb } from "../testing";
import { countUnlocatedCompanies, listFundingRounds } from "./funding";

function filters(overrides: Partial<FundingFilters> = {}): FundingFilters {
  return { page: 1, pageSize: 100, ...overrides };
}

async function names(db: Db, overrides: Partial<FundingFilters>) {
  const page = await listFundingRounds(db, filters(overrides));
  return [...new Set(page.items.map((row) => row.companyName))].sort();
}

describe("targeting filters", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;

    const bradford = await addCompany(db, "Bradford Bio", {
      city: "Bradford",
    });
    await addRounds(db, bradford, [{ date: "2026-10-01", type: "seed" }]);
    await locateInPlace(db, bradford, "bradford");

    const york = await addCompany(db, "York Yield", { city: "York" });
    await addRounds(db, york, [{ date: "2026-10-02", type: "seed" }]);
    await locateInPlace(db, york, "york");

    const leeds = await addCompany(db, "Leeds Ledger", { city: "Leeds" });
    await addRounds(db, leeds, [{ date: "2026-10-03", type: "series_a" }]);
    await locateInPlace(db, leeds, "leeds");

    const regionOnly = await addCompany(db, "Region Only");
    await addRounds(db, regionOnly, [{ date: "2026-10-04", type: "seed" }]);
    await db.insert(companyLocations).values({
      companyId: regionOnly,
      countryCode: "GB",
      itl1Code: "TLE",
      precision: "region",
      source: "news_region",
    });

    const zurich = await addCompany(db, "Zurich Zero", {
      country: "CH",
      city: "Z\u00fcrich",
    });
    await addRounds(db, zurich, [{ date: "2026-10-05", type: "seed" }]);
    await db.insert(companyLocations).values({
      companyId: zurich,
      countryCode: "CH",
      precision: "town",
      source: "news_city",
    });

    const grantee = await addCompany(db, "Grant Gears");
    await addRounds(db, grantee, [
      { date: "2026-10-06", type: "grant", evidence: "confirmed" },
    ]);

    // The spec's worked example (section 8.3).
    const spec = await addCompany(db, "Spec Example", { city: "Leeds" });
    await addRounds(db, spec, [
      { date: "2025-03-10", type: "seed", gbp: 150_000_000 },
      { date: "2026-01-20", type: "seed" },
      { date: "2026-04-02", type: "debt", gbp: 200_000_000 },
      { date: "2026-09-05", type: "series_a", gbp: 800_000_000 },
    ]);
    await locateInPlace(db, spec, "leeds");

    const health = await addTheme(db, "health-ai", {
      sector: "health-life-sciences",
    });
    const survivor = await addTheme(db, "fintech", {
      sector: "financial-services",
    });
    await addTheme(db, "payments-old", { mergedInto: survivor });
    await linkTheme(db, bradford, health);
    await linkTheme(db, leeds, survivor);
    await linkTheme(db, york, health);
  });

  afterEach(async () => {
    await test.close();
  });

  it("hides grants unless round=grant is selected", async () => {
    expect(await names(db, {})).not.toContain("Grant Gears");
    expect(await names(db, { roundTypes: ["seed"] })).not.toContain(
      "Grant Gears",
    );
    expect(await names(db, { roundTypes: ["grant"] })).toEqual(["Grant Gears"]);
    expect(await names(db, { roundTypes: ["grant", "series_a"] })).toEqual([
      "Grant Gears",
      "Leeds Ledger",
      "Spec Example",
    ]);
  });

  it("returns evidence on each row", async () => {
    const page = await listFundingRounds(
      db,
      filters({ roundTypes: ["grant"] }),
    );
    expect(page.items[0]?.evidence).toBe("confirmed");
    expect(page.items[0]?.momentum).toBeNull();
  });

  it("filters by theme, following merged slugs", async () => {
    expect(await names(db, { themes: ["health-ai"] })).toEqual([
      "Bradford Bio",
      "York Yield",
    ]);
    expect(await names(db, { themes: ["fintech"] })).toEqual(["Leeds Ledger"]);
    expect(await names(db, { themes: ["payments-old"] })).toEqual([
      "Leeds Ledger",
    ]);
    expect(await names(db, { themes: ["health-ai", "payments-old"] })).toEqual([
      "Bradford Bio",
      "Leeds Ledger",
      "York Yield",
    ]);
    expect(await names(db, { themes: ["no-such-theme"] })).toEqual([]);
  });

  it("filters by sector", async () => {
    expect(await names(db, { sectors: ["health-life-sciences"] })).toEqual([
      "Bradford Bio",
      "York Yield",
    ]);
    expect(await names(db, { sectors: ["education"] })).toEqual([]);
  });

  it("filters by UK region", async () => {
    expect(
      await names(db, { ukRegions: ["yorkshire-and-the-humber"] }),
    ).toEqual([
      "Bradford Bio",
      "Leeds Ledger",
      "Region Only",
      "Spec Example",
      "York Yield",
    ]);
    expect(await names(db, { ukRegions: ["scotland"] })).toEqual([]);
  });

  it("matches a UK place slug on place_slug", async () => {
    expect(await names(db, { cities: ["leeds"] })).toEqual([
      "Leeds Ledger",
      "Spec Example",
    ]);
  });

  it("matches other cities by normalised companies.city", async () => {
    expect(await names(db, { cities: ["zurich"] })).toEqual(["Zurich Zero"]);
    expect(await names(db, { cities: ["ZURICH"] })).toEqual(["Zurich Zero"]);
    expect(await names(db, { cities: ["zurich", "york"] })).toEqual([
      "York Yield",
      "Zurich Zero",
    ]);
    expect(await names(db, { cities: ["atlantis"] })).toEqual([]);
  });

  it("finds companies near a place and drops region-only ones", async () => {
    const near = await names(db, { near: { placeSlug: "leeds", km: 25 } });
    expect(near).toContain("Bradford Bio");
    expect(near).toContain("Leeds Ledger");
    expect(near).not.toContain("York Yield");
    expect(near).not.toContain("Region Only");
    expect(near).not.toContain("Zurich Zero");

    const wider = await names(db, { near: { placeSlug: "leeds", km: 50 } });
    expect(wider).toContain("York Yield");
    expect(wider).not.toContain("Region Only");

    expect(
      await names(db, { near: { placeSlug: "no-such-place", km: 25 } }),
    ).toEqual([]);
  });

  it("counts companies a distance search cannot place", async () => {
    const count = await countUnlocatedCompanies(
      db,
      filters({ near: { placeSlug: "leeds", km: 25 } }),
    );
    const located = await names(db, {});
    const nearNames = await names(db, { near: { placeSlug: "leeds", km: 25 } });
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(located.length - nearNames.length);
    // Region Only and Zurich Zero have no coordinates, so they are counted.
    const narrowed = await countUnlocatedCompanies(
      db,
      filters({ cities: ["zurich"] }),
    );
    expect(narrowed).toBe(1);
    expect(
      await countUnlocatedCompanies(db, filters({ cities: ["leeds"] })),
    ).toBe(0);
  });

  it("filters by momentum", async () => {
    const first = await names(db, { momentum: "first" });
    expect(first).toContain("Bradford Bio");
    expect(first).not.toContain("Grant Gears");
    // Of the spec company, only the 2025 seed is a first recorded round.
    const specFirst = await listFundingRounds(
      db,
      filters({ momentum: "first", q: "Spec Example" }),
    );
    expect(specFirst.items.map((row) => row.announcedOn)).toEqual([
      "2025-03-10",
    ]);

    // Round 2 is 10 months on and round 3 is 7: both repeat. The debt round
    // has no momentum row, so it never matches.
    const repeat = await listFundingRounds(
      db,
      filters({ momentum: "repeat", roundTypes: ["seed", "debt", "series_a"] }),
    );
    expect(repeat.items.map((row) => row.announcedOn).sort()).toEqual([
      "2026-01-20",
      "2026-09-05",
    ]);
  });

  it("returns momentum on rows, with the basis date", async () => {
    const page = await listFundingRounds(
      db,
      filters({ q: "Spec Example", roundTypes: ["series_a"] }),
    );
    const momentum = page.items[0]?.momentum;
    expect(momentum?.equityRoundNumber).toBe(3);
    expect(momentum?.monthsSincePrevious).toBe(7);
    expect(momentum?.stepUpRatio).toBeCloseTo(5.33, 1);
    expect(momentum?.stepUpBasisOn).toBe("2025-03-10");
  });

  it("combines filters: AND across parameters, OR within one", async () => {
    expect(
      await names(db, {
        sectors: ["health-life-sciences"],
        near: { placeSlug: "leeds", km: 25 },
      }),
    ).toEqual(["Bradford Bio"]);
    expect(
      await names(db, {
        roundTypes: ["seed", "series_a"],
        ukRegions: ["yorkshire-and-the-humber"],
        momentum: "first",
        cities: ["bradford", "leeds"],
      }),
    ).toEqual(["Bradford Bio", "Leeds Ledger", "Spec Example"]);
    expect(
      await names(db, {
        themes: ["health-ai"],
        cities: ["zurich"],
      }),
    ).toEqual([]);
  });

  it("counts and pages with the same filters", async () => {
    const page = await listFundingRounds(
      db,
      filters({ near: { placeSlug: "leeds", km: 25 }, pageSize: 2 }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
  });
});
