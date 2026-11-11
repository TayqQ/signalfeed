import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { getCompanyDetail } from "./companies";

describe("company detail targeting data", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;
  });

  afterEach(async () => {
    await test.close();
  });

  async function seedSpecCompany(): Promise<void> {
    const id = await addCompany(db, "Spec Example", { city: "Leeds" });
    await addRounds(db, id, [
      { date: "2025-03-10", type: "seed", gbp: 150_000_000 },
      { date: "2026-01-20", type: "seed" },
      { date: "2026-04-02", type: "debt", gbp: 200_000_000 },
      { date: "2026-09-05", type: "series_a", gbp: 800_000_000 },
    ]);
    await locateInPlace(db, id, "leeds");
    const health = await addTheme(db, "health-ai", {
      sector: "health-life-sciences",
    });
    const more = await addTheme(db, "diagnostics", {
      sector: "health-life-sciences",
    });
    const data = await addTheme(db, "data-tools", { sector: "software-ai" });
    await linkTheme(db, id, health);
    await linkTheme(db, id, more);
    await linkTheme(db, id, data);
  }

  it("returns themes, sectors, location and momentum", async () => {
    await seedSpecCompany();
    const detail = await getCompanyDetail(db, "spec-example", "2026-11-11");

    expect(detail?.themes?.map((theme) => theme.slug)).toEqual([
      "data-tools",
      "diagnostics",
      "health-ai",
    ]);
    expect(detail?.sectors?.sort()).toEqual([
      "health-life-sciences",
      "software-ai",
    ]);
    expect(detail?.location).toEqual({
      precision: "town",
      ukRegion: "yorkshire-and-the-humber",
      placeName: "Leeds",
      outcode: null,
      countryCode: "GB",
    });

    const rounds = detail?.events.flatMap((event) =>
      event.type === "funding_round" ? [event] : [],
    );
    const byDate = new Map(rounds?.map((round) => [round.announcedOn, round]));
    expect(byDate.get("2026-04-02")?.momentum).toBeNull();
    expect(byDate.get("2025-03-10")?.momentum?.equityRoundNumber).toBe(1);
    expect(byDate.get("2026-01-20")?.momentum?.monthsSincePrevious).toBe(10);
    const last = byDate.get("2026-09-05")?.momentum;
    expect(last?.equityRoundNumber).toBe(3);
    expect(last?.monthsSincePrevious).toBe(7);
    expect(last?.stepUpRatio).toBeCloseTo(5.33, 1);
    expect(last?.stepUpBasisOn).toBe("2025-03-10");
  });

  it("counts equity rounds in the last 24 months against now", async () => {
    await seedSpecCompany();
    const now = await getCompanyDetail(db, "spec-example", "2026-11-11");
    expect(now?.roundsInLast24Months).toBe(3);
    // By 2027-04-01 the March 2025 round has dropped out of the window.
    const later = await getCompanyDetail(db, "spec-example", "2027-04-01");
    expect(later?.roundsInLast24Months).toBe(2);
  });

  it("returns empty targeting data for a company with none", async () => {
    await addCompany(db, "Bare Co");
    const detail = await getCompanyDetail(db, "bare-co", "2026-11-11");
    expect(detail?.themes).toEqual([]);
    expect(detail?.sectors).toEqual([]);
    expect(detail?.location).toBeNull();
    expect(detail?.roundsInLast24Months).toBe(0);
  });

  it("names a non-UK location by its news city", async () => {
    const id = await addCompany(db, "Zurich Zero", {
      country: "CH",
      city: "Z\u00fcrich",
    });
    await db.insert(companyLocations).values({
      companyId: id,
      countryCode: "CH",
      precision: "town",
      source: "news_city",
    });
    const detail = await getCompanyDetail(db, "zurich-zero", "2026-11-11");
    expect(detail?.location).toMatchObject({
      placeName: "Z\u00fcrich",
      ukRegion: null,
      countryCode: "CH",
    });
  });
});
