import { eq } from "drizzle-orm";
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
  eventInvestors,
  events,
  fundingRoundMomentum,
  fundingRounds,
  investors,
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
import {
  getCompanyDetail,
  getCompanyPreview,
  getSimilarCompanies,
} from "./companies";

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

describe("company preview", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;
  });

  afterEach(async () => {
    await test.close();
  });

  it("returns the light view of a confirmed company", async () => {
    const id = await addCompany(db, "Fake Ledger", { city: "Leeds" });
    await db
      .update(companies)
      .set({ description: "Ledgers for startups", foundedYear: 2021 })
      .where(eq(companies.id, id));
    const fin = await addTheme(db, "fintech", { sector: "financial-services" });
    await linkTheme(db, id, fin);
    const [, latest] = await addRounds(db, id, [
      { date: "2025-03-10", type: "seed", gbp: 150_000_000 },
      {
        date: "2026-09-05",
        type: "series_a",
        gbp: 800_000_000,
        evidence: "confirmed",
      },
    ]);
    if (latest == null) throw new Error("No event");
    await db
      .update(events)
      .set({ sourceCount: 3 })
      .where(eq(events.id, latest));
    await db.insert(chCompanies).values({
      companyNumber: "09000501",
      name: "FAKE LEDGER LIMITED",
      status: "active",
      companyType: "ltd",
      incorporatedOn: "2022-06-01",
      sicCodes: ["62012"],
      officePostcode: "ZZ9 9ZZ",
      accountsType: "micro-entity",
    });
    await db.insert(registryLinks).values({
      companyId: id,
      registry: "companies_house",
      registryId: "09000501",
      registryName: "FAKE LEDGER LIMITED",
      status: "linked",
      method: "name_location",
      reason: "test",
      decidedBy: "auto",
    });
    const [investor] = await db
      .insert(investors)
      .values({
        slug: "example-ventures",
        name: "Example Ventures",
        normalisedName: "example ventures",
      })
      .returning({ id: investors.id });
    if (!investor) throw new Error("Investor insert failed");
    await db.insert(eventInvestors).values({
      eventId: latest,
      investorId: investor.id,
      role: "lead",
    });
    await db.insert(eventConfirmations).values({
      eventId: latest,
      recordKind: "ch_allotment",
      recordId: 1,
      rule: "test",
      recordDate: "2026-09-04",
      confirmsAmount: true,
    });

    const preview = await getCompanyPreview(db, "fake-ledger", "2026-11-11");
    expect(preview).toMatchObject({
      slug: "fake-ledger",
      name: "Fake Ledger",
      description: "Ledgers for startups",
      city: "Leeds",
      mainSector: "financial-services",
      foundedYear: 2021,
      roundsInLast24Months: 2,
      redirectToSlug: null,
      latestRound: {
        eventId: latest,
        roundType: "series_a",
        amountGbpMinor: 800_000_000,
        announcedOn: "2026-09-05",
        leadInvestors: [{ slug: "example-ventures", name: "Example Ventures" }],
        investorCount: 1,
        sourceCount: 3,
        evidence: "confirmed",
        confirmation: { kind: "ch_allotment", recordDate: "2026-09-04" },
      },
      registry: {
        companyNumber: "09000501",
        statusLabel: "Active",
        sizeBand: "micro",
        incorporatedOn: "2022-06-01",
      },
      signals: {
        confirmed: true,
        daysSinceLastRound: 67,
        firstRoundOn: "2025-03-10",
        sourceCount: 3,
      },
    });
    expect(JSON.stringify(preview)).not.toContain("ZZ9 9ZZ");
  });

  it("returns a company with no registry link or rounds", async () => {
    await addCompany(db, "Quiet Co");
    const preview = await getCompanyPreview(db, "quiet-co", "2026-11-11");
    expect(preview?.registry).toBeNull();
    expect(preview?.latestRound).toBeNull();
    expect(preview?.mainSector).toBeNull();
    expect(preview?.signals).toEqual({
      confirmed: false,
      daysSinceLastRound: null,
      firstRoundOn: null,
      sourceCount: 0,
    });
  });

  it("has no registry or confirmation for a reported company", async () => {
    const id = await addCompany(db, "Reported Co");
    await addRounds(db, id, [{ date: "2026-10-01", type: "seed" }]);
    const preview = await getCompanyPreview(db, "reported-co", "2026-11-11");
    expect(preview?.registry).toBeNull();
    expect(preview?.latestRound?.confirmation).toBeNull();
    expect(preview?.signals.confirmed).toBe(false);
    expect(preview?.signals.daysSinceLastRound).toBe(41);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getCompanyPreview(db, "nobody")).toBeNull();
  });
});

describe("companies like this", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;
  });

  afterEach(async () => {
    await test.close();
  });

  async function inSector(
    name: string,
    themeId: number,
    rounds: RoundSpec[],
  ): Promise<number> {
    const id = await addCompany(db, name);
    await linkTheme(db, id, themeId);
    await addRounds(db, id, rounds);
    return id;
  }

  it("ranks the same sector by stage, then newest, at most five", async () => {
    const fin = await addTheme(db, "fintech", { sector: "financial-services" });
    const pay = await addTheme(db, "payments", {
      sector: "financial-services",
    });
    const ai = await addTheme(db, "ai", { sector: "software-ai" });
    await inSector("Own Co", fin, [{ date: "2026-10-01", type: "series_a" }]);
    // Same round type.
    await inSector("Alpha Pay", pay, [
      { date: "2026-06-01", type: "series_a" },
    ]);
    await inSector("Beta Pay", fin, [{ date: "2026-08-01", type: "series_a" }]);
    // Same stage bucket (venture), different type.
    await inSector("Gamma Pay", fin, [
      { date: "2026-10-20", type: "series_b" },
    ]);
    // Other stages, newest first among themselves.
    await inSector("Delta Pay", fin, [{ date: "2026-09-01", type: "seed" }]);
    await inSector("Epsilon Pay", fin, [
      { date: "2026-11-01", type: "growth" },
    ]);
    await inSector("Zeta Pay", fin, [{ date: "2026-01-01", type: "seed" }]);
    // Another sector, and a company whose latest round is now a seed.
    await inSector("Other Sector", ai, [
      { date: "2026-10-01", type: "series_a" },
    ]);
    await inSector("Moved On", fin, [
      { date: "2025-01-01", type: "series_a" },
      { date: "2026-10-30", type: "seed" },
    ]);

    const similar = await getSimilarCompanies(db, "own-co");
    expect(similar?.mainSector).toBe("financial-services");
    expect(similar?.roundType).toBe("series_a");
    expect(similar?.items.map((item) => item.slug)).toEqual([
      "beta-pay",
      "alpha-pay",
      "gamma-pay",
      "epsilon-pay",
      "moved-on",
    ]);
    expect(similar?.items[0]).toMatchObject({
      name: "Beta Pay",
      roundType: "series_a",
      announcedOn: "2026-08-01",
      countryCode: "GB",
    });
  });

  it("uses the SIC sector when a company has no sector theme", async () => {
    const own = await addCompany(db, "Own Co");
    const fin = await addTheme(db, "fintech", { sector: "financial-services" });
    await linkTheme(db, own, fin);
    await addRounds(db, own, [{ date: "2026-10-01", type: "seed" }]);
    const sicOnly = await addCompany(db, "Sic Bank");
    await addRounds(db, sicOnly, [{ date: "2026-09-01", type: "seed" }]);
    await db.insert(chCompanies).values({
      companyNumber: "09000777",
      name: "SIC BANK LIMITED",
      status: "active",
      companyType: "ltd",
      incorporatedOn: "2020-01-01",
      sicCodes: ["64191"],
      officePostcode: "ZZ9 9ZZ",
      accountsType: "micro-entity",
    });
    await db.insert(registryLinks).values({
      companyId: sicOnly,
      registry: "companies_house",
      registryId: "09000777",
      registryName: "SIC BANK LIMITED",
      status: "linked",
      method: "name_location",
      reason: "test",
      decidedBy: "auto",
    });

    const similar = await getSimilarCompanies(db, "own-co");
    expect(similar?.items.map((item) => item.slug)).toEqual(["sic-bank"]);
  });

  it("leaves out merged companies and companies without rounds", async () => {
    const fin = await addTheme(db, "fintech", { sector: "financial-services" });
    await inSector("Own Co", fin, [{ date: "2026-10-01", type: "seed" }]);
    const survivor = await inSector("Survivor", fin, [
      { date: "2026-09-01", type: "seed" },
    ]);
    const merged = await inSector("Merged Pay", fin, [
      { date: "2026-09-02", type: "seed" },
    ]);
    await db
      .update(companies)
      .set({ mergedIntoId: survivor })
      .where(eq(companies.id, merged));
    const quiet = await addCompany(db, "No Rounds Pay");
    await linkTheme(db, quiet, fin);

    const similar = await getSimilarCompanies(db, "own-co");
    expect(similar?.items.map((item) => item.slug)).toEqual(["survivor"]);
  });

  it("compares nothing while the sector is pending", async () => {
    await addCompany(db, "Unsorted");
    const other = await addCompany(db, "Elsewhere");
    await addRounds(db, other, [{ date: "2026-10-01", type: "seed" }]);
    expect(await getSimilarCompanies(db, "unsorted")).toEqual({
      mainSector: null,
      roundType: null,
      items: [],
    });
    expect(await getSimilarCompanies(db, "nobody")).toBeNull();
  });
});
