import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoundType } from "@/core/enums";
import { computeRoundMomentum } from "@/lib/company-momentum";
import { findPlaceBySlug } from "@/lib/geo/uk-places";
import { normaliseCompanyName, slugify } from "@/lib/normalise";
import type { Db } from "../client";
import {
  chCompanies,
  chFilings,
  companies,
  companyLocations,
  companySectors,
  companyThemes,
  eventConfirmations,
  events,
  fundingRoundMomentum,
  fundingRounds,
  registryLinks,
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

describe("company registry data", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;
  });

  afterEach(async () => {
    await test.close();
  });

  async function linkRow(
    companyId: number,
    registry: "companies_house" | "sec_edgar",
    registryId: string,
    status: "linked" | "candidate" | "rejected",
  ): Promise<void> {
    await db.insert(registryLinks).values({
      companyId,
      registry,
      registryId,
      registryName: `Name ${registryId}`,
      status,
      method: status === "linked" ? "name_location" : null,
      reason: "test",
      decidedBy: "auto",
    });
  }

  async function addCh(number: string, accountsType: string | null) {
    await db.insert(chCompanies).values({
      companyNumber: number,
      name: "FAKE LEDGER LIMITED",
      status: "active",
      companyType: "ltd",
      incorporatedOn: "2022-06-01",
      sicCodes: ["62012", "00000"],
      officePostcode: "ZZ9 9ZZ",
      officeOutcode: "ZZ9",
      accountsType,
      accountsMadeUpTo: "2025-06-30",
    });
  }

  it("returns the linked registry record without the full postcode", async () => {
    const id = await addCompany(db, "Fake Ledger");
    await addCh("09000401", "micro-entity");
    await linkRow(id, "companies_house", "09000401", "linked");
    await linkRow(id, "sec_edgar", "9000401", "linked");

    const detail = await getCompanyDetail(db, "fake-ledger", "2026-11-11");
    expect(detail?.registry).toEqual({
      companiesHouse: {
        companyNumber: "09000401",
        url: "https://find-and-update.company-information.service.gov.uk/company/09000401",
        name: "FAKE LEDGER LIMITED",
        statusLabel: "Active",
        typeLabel: "Private limited company",
        incorporatedOn: "2022-06-01",
        ceasedOn: null,
        sicCodes: [
          { code: "62012", label: expect.any(String) as string },
          { code: "00000", label: null },
        ],
        sizeBand: "micro",
        accountsMadeUpTo: "2025-06-30",
        officeOutcode: "ZZ9",
      },
      sec: {
        cik: "9000401",
        url: "https://www.sec.gov/edgar/browse/?CIK=9000401",
      },
    });
    const text = JSON.stringify(detail);
    expect(text).not.toContain("ZZ9 9ZZ");
    expect(text).not.toContain("officePostcode");
  });

  it("never reads candidate or rejected links", async () => {
    const id = await addCompany(db, "Fake Ledger");
    await addCh("09000402", "small");
    await addCh("09000403", "small");
    await linkRow(id, "companies_house", "09000402", "candidate");
    await linkRow(id, "companies_house", "09000403", "rejected");
    await linkRow(id, "sec_edgar", "9000402", "candidate");

    const detail = await getCompanyDetail(db, "fake-ledger", "2026-11-11");
    expect(detail?.registry).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("09000402");
  });

  it("returns null registry for an unlinked company", async () => {
    await addCompany(db, "Fake Ledger");
    const detail = await getCompanyDetail(db, "fake-ledger", "2026-11-11");
    expect(detail?.registry).toBeNull();
  });

  it("returns each event's confirmations, closest first", async () => {
    const id = await addCompany(db, "Fake Ledger");
    const [eventId] = await addRounds(db, id, [
      { date: "2026-03-10", type: "seed", evidence: "confirmed" },
    ]);
    if (eventId == null) throw new Error("No event");
    const rows = [];
    for (const [tx, date] of [
      ["T-1", "2026-02-02"],
      ["T-2", "2026-03-05"],
    ] as const) {
      const [row] = await db
        .insert(chFilings)
        .values({
          companyNumber: "09000404",
          transactionId: tx,
          type: "SH01",
          category: "capital",
          filedOn: date,
          actionDate: date,
        })
        .returning({ id: chFilings.id });
      if (!row) throw new Error("Filing insert failed");
      rows.push({ id: row.id, date });
    }
    for (const row of rows) {
      await db.insert(eventConfirmations).values({
        eventId,
        recordKind: "ch_allotment",
        recordId: row.id,
        rule: "test",
        recordDate: row.date,
      });
    }
    const detail = await getCompanyDetail(db, "fake-ledger", "2026-11-11");
    const confirmations = detail?.events[0]?.confirmations ?? [];
    expect(confirmations.map((c) => c.recordDate)).toEqual([
      "2026-03-05",
      "2026-02-02",
    ]);
    expect(confirmations[0]?.text).toBe(
      "Confirmed: shares allotted on 5 March 2026 (Companies House SH01)",
    );
  });

  it("uses company_sectors when present, else the theme sectors", async () => {
    const id = await addCompany(db, "Fake Ledger");
    const theme = await addTheme(db, "health-ai", {
      sector: "health-life-sciences",
    });
    await linkTheme(db, id, theme);
    let detail = await getCompanyDetail(db, "fake-ledger", "2026-11-11");
    expect(detail?.sectors).toEqual(["health-life-sciences"]);

    await db.insert(companySectors).values([
      { companyId: id, sector: "software-ai", source: "theme" },
      { companyId: id, sector: "education", source: "theme" },
    ]);
    detail = await getCompanyDetail(db, "fake-ledger", "2026-11-11");
    expect(detail?.sectors?.sort()).toEqual(["education", "software-ai"]);
  });
});
