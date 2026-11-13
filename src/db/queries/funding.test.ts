import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FundingFilters } from "@/core/read-models";
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
  formDFilings,
  fundingRoundMomentum,
  fundingRounds,
  registryLinks,
  sources,
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

async function addChCompany(
  db: Db,
  number: string,
  accountsType: string | null,
): Promise<void> {
  await db.insert(chCompanies).values({
    companyNumber: number,
    name: `TEST ${number} LIMITED`,
    status: "active",
    companyType: "ltd",
    incorporatedOn: "2022-01-01",
    accountsType,
  });
}

async function link(
  db: Db,
  companyId: number,
  number: string,
  status: "linked" | "candidate" | "rejected" = "linked",
): Promise<void> {
  await db.insert(registryLinks).values({
    companyId,
    registry: "companies_house",
    registryId: number,
    registryName: `TEST ${number} LIMITED`,
    status,
    method: status === "linked" ? "name_location" : null,
    reason: "test",
    decidedBy: "auto",
  });
}

describe("Phase 3 filters and confirmations", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;
  });

  afterEach(async () => {
    await test.close();
  });

  it("evidence=confirmed returns only confirmed events", async () => {
    const a = await addCompany(db, "Confirmed Co");
    await addRounds(db, a, [
      { date: "2026-05-01", type: "seed", evidence: "confirmed" },
    ]);
    const b = await addCompany(db, "Reported Co");
    await addRounds(db, b, [{ date: "2026-05-02", type: "seed" }]);
    const mixed = await addCompany(db, "Mixed Co");
    await addRounds(db, mixed, [
      { date: "2026-04-01", type: "seed" },
      { date: "2026-06-01", type: "series_a", evidence: "confirmed" },
    ]);

    expect(await names(db, {})).toEqual([
      "Confirmed Co",
      "Mixed Co",
      "Reported Co",
    ]);
    const page = await listFundingRounds(
      db,
      filters({ evidence: "confirmed" }),
    );
    expect(page.total).toBe(2);
    expect(page.items.every((row) => row.evidence === "confirmed")).toBe(true);
    // Grants are still hidden unless selected.
    const grant = await addCompany(db, "Grant Co");
    await addRounds(db, grant, [
      { date: "2026-05-03", type: "grant", evidence: "confirmed" },
    ]);
    expect(await names(db, { evidence: "confirmed" })).toEqual([
      "Confirmed Co",
      "Mixed Co",
    ]);
    expect(
      await names(db, { evidence: "confirmed", roundTypes: ["grant"] }),
    ).toEqual(["Grant Co"]);
  });

  describe("cosize", () => {
    beforeEach(async () => {
      const cases: Array<[string, string | null]> = [
        ["Micro Co", "micro-entity"],
        ["Small Co", "small"],
        ["Abridged Co", "unaudited-abridged"],
        ["Medium Co", "medium"],
        ["Full Co", "full"],
        ["Group Co", "group"],
        ["Dormant Co", "dormant"],
        ["Initial Co", "initial"],
        ["Blank Co", null],
        ["Odd Co", "brand-new-type"],
      ];
      let n = 0;
      for (const [name, accountsType] of cases) {
        n += 1;
        const number = `0900${String(n).padStart(4, "0")}`;
        const id = await addCompany(db, name);
        await addRounds(db, id, [{ date: "2026-05-01", type: "seed" }]);
        await addChCompany(db, number, accountsType);
        await link(db, id, number);
      }
      const unlinked = await addCompany(db, "Unlinked Co");
      await addRounds(db, unlinked, [{ date: "2026-05-02", type: "seed" }]);
      // A candidate and a rejected link never count.
      const candidate = await addCompany(db, "Candidate Co");
      await addRounds(db, candidate, [{ date: "2026-05-03", type: "seed" }]);
      await addChCompany(db, "09000201", "micro-entity");
      await link(db, candidate, "09000201", "candidate");
      const rejected = await addCompany(db, "Rejected Co");
      await addRounds(db, rejected, [{ date: "2026-05-04", type: "seed" }]);
      await addChCompany(db, "09000202", "micro-entity");
      await link(db, rejected, "09000202", "rejected");
    });

    it("matches micro", async () => {
      expect(await names(db, { companySizes: ["micro"] })).toEqual([
        "Micro Co",
      ]);
    });

    it("matches small, including exemption and abridged types", async () => {
      expect(await names(db, { companySizes: ["small"] })).toEqual([
        "Abridged Co",
        "Small Co",
      ]);
    });

    it("matches medium", async () => {
      expect(await names(db, { companySizes: ["medium"] })).toEqual([
        "Medium Co",
      ]);
    });

    it("matches full accounts, and treats an unknown type the same way", async () => {
      expect(await names(db, { companySizes: ["full_accounts"] })).toEqual([
        "Full Co",
        "Group Co",
        "Odd Co",
      ]);
    });

    it("matches dormant", async () => {
      expect(await names(db, { companySizes: ["dormant"] })).toEqual([
        "Dormant Co",
      ]);
    });

    it("matches no accounts yet, including a blank type", async () => {
      expect(await names(db, { companySizes: ["no_accounts_yet"] })).toEqual([
        "Blank Co",
        "Initial Co",
      ]);
    });

    it("matches any of several bands", async () => {
      expect(await names(db, { companySizes: ["micro", "dormant"] })).toEqual([
        "Dormant Co",
        "Micro Co",
      ]);
    });

    it("never matches a company with no linked record", async () => {
      const every = await names(db, {
        companySizes: [
          "micro",
          "small",
          "medium",
          "full_accounts",
          "dormant",
          "no_accounts_yet",
        ],
      });
      expect(every).not.toContain("Unlinked Co");
      expect(every).not.toContain("Candidate Co");
      expect(every).not.toContain("Rejected Co");
      expect(every).toHaveLength(10);
    });

    it("agrees with the TypeScript mapping for every known accounts type", async () => {
      const { knownAccountsTypes, sizeBandForAccounts } =
        await import("@/lib/registry/company-size");
      let n = 0;
      for (const type of knownAccountsTypes()) {
        n += 1;
        const number = `0800${String(n).padStart(4, "0")}`;
        const id = await addCompany(db, `Table ${type}`);
        await addRounds(db, id, [{ date: "2026-05-05", type: "seed" }]);
        await addChCompany(db, number, type);
        await link(db, id, number);
        const band = sizeBandForAccounts(type);
        const found = await names(db, { companySizes: [band] });
        expect(found, type).toContain(`Table ${type}`);
      }
    });
  });

  describe("sector filter", () => {
    it("falls back to the theme join while company_sectors is empty", async () => {
      const themed = await addCompany(db, "Themed Co");
      await addRounds(db, themed, [{ date: "2026-05-01", type: "seed" }]);
      const theme = await addTheme(db, "health-ai", {
        sector: "health-life-sciences",
      });
      await linkTheme(db, themed, theme);
      const other = await addCompany(db, "Other Co");
      await addRounds(db, other, [{ date: "2026-05-02", type: "seed" }]);

      expect(await names(db, { sectors: ["health-life-sciences"] })).toEqual([
        "Themed Co",
      ]);
    });

    it("also matches company_sectors, with or without a theme", async () => {
      const themed = await addCompany(db, "Themed Co");
      await addRounds(db, themed, [{ date: "2026-05-01", type: "seed" }]);
      const theme = await addTheme(db, "health-ai", {
        sector: "health-life-sciences",
      });
      await linkTheme(db, themed, theme);
      const sic = await addCompany(db, "Sic Co");
      await addRounds(db, sic, [{ date: "2026-05-02", type: "seed" }]);
      await db.insert(companySectors).values({
        companyId: sic,
        sector: "health-life-sciences",
        source: "sic",
      });
      const wrong = await addCompany(db, "Wrong Co");
      await addRounds(db, wrong, [{ date: "2026-05-03", type: "seed" }]);
      await db.insert(companySectors).values({
        companyId: wrong,
        sector: "education",
        source: "sic",
      });

      expect(await names(db, { sectors: ["health-life-sciences"] })).toEqual([
        "Sic Co",
        "Themed Co",
      ]);
      expect(await names(db, { sectors: ["education"] })).toEqual(["Wrong Co"]);
    });
  });

  describe("confirmation on each row", () => {
    async function addSh01(
      number: string,
      transactionId: string,
      actionDate: string,
    ): Promise<number> {
      const [row] = await db
        .insert(chFilings)
        .values({
          companyNumber: number,
          transactionId,
          type: "SH01",
          category: "capital",
          filedOn: actionDate,
          actionDate,
        })
        .returning({ id: chFilings.id });
      if (!row) throw new Error("Filing insert failed");
      return row.id;
    }

    async function confirm(
      eventId: number,
      recordKind: "ch_allotment" | "sec_form_d",
      recordId: number,
      recordDate: string,
    ): Promise<void> {
      await db.insert(eventConfirmations).values({
        eventId,
        recordKind,
        recordId,
        rule: "test",
        recordDate,
      });
    }

    it("uses the closest record, with its wording", async () => {
      const id = await addCompany(db, "Ledger Co");
      const [eventId] = await addRounds(db, id, [
        { date: "2026-03-10", type: "seed", evidence: "confirmed" },
      ]);
      if (eventId == null) throw new Error("No event");
      const far = await addSh01("09000301", "T-FAR", "2026-02-02");
      const near = await addSh01("09000301", "T-NEAR", "2026-03-05");
      await confirm(eventId, "ch_allotment", far, "2026-02-02");
      await confirm(eventId, "ch_allotment", near, "2026-03-05");

      const page = await listFundingRounds(db, filters());
      expect(page.items[0]?.confirmation).toEqual({
        kind: "ch_allotment",
        recordDate: "2026-03-05",
        confirmsAmount: false,
        text: "Confirmed: shares allotted on 5 March 2026 (Companies House SH01)",
      });
    });

    it("breaks a tie by record kind, then id", async () => {
      const id = await addCompany(db, "Tie Co", { country: "US" });
      const [eventId] = await addRounds(db, id, [
        { date: "2026-03-10", type: "seed", evidence: "confirmed" },
      ]);
      if (eventId == null) throw new Error("No event");
      const [edgar] = await db
        .insert(sources)
        .values({
          slug: "sec-edgar",
          name: "SEC EDGAR",
          kind: "sec_edgar",
          url: "https://www.sec.gov/edgar",
        })
        .returning({ id: sources.id });
      if (!edgar) throw new Error("Source insert failed");
      const [form] = await db
        .insert(formDFilings)
        .values({
          sourceId: edgar.id,
          accessionNumber: "0009000002-26-000001",
          cik: "9000002",
          issuerName: "Tie Inc.",
          isAmendment: false,
          dateOfFirstSale: "2026-03-01",
          totalSoldUsdMinor: 440_000_000,
          filedOn: "2026-03-02",
          companyId: id,
        })
        .returning({ id: formDFilings.id });
      if (!form) throw new Error("Form D insert failed");
      const sh01 = await addSh01("09000302", "T-TIE", "2026-03-01");
      await confirm(eventId, "sec_form_d", form.id, "2026-03-01");
      await confirm(eventId, "ch_allotment", sh01, "2026-03-01");

      const first = (await listFundingRounds(db, filters())).items[0];
      expect(first?.confirmation?.kind).toBe("ch_allotment");

      // Without the SH01, the Form D text shows the amount sold.
      await db
        .delete(eventConfirmations)
        .where(eq(eventConfirmations.recordKind, "ch_allotment"));
      const only = (await listFundingRounds(db, filters())).items[0];
      expect(only?.confirmation?.text).toBe(
        "Confirmed: Form D, $4.4M sold, first sale 1 March 2026 (SEC)",
      );
    });

    it("gives a confirmed grant with no confirmation row a grant line", async () => {
      const id = await addCompany(db, "Grant Co");
      await addRounds(db, id, [
        { date: "2026-05-03", type: "grant", evidence: "confirmed" },
      ]);
      const page = await listFundingRounds(
        db,
        filters({ roundTypes: ["grant"] }),
      );
      expect(page.items[0]?.confirmation?.text).toBe(
        "Confirmed: Innovate UK grant (UKRI Gateway to Research)",
      );
      expect(page.items[0]?.confirmation?.kind).toBe("ukri_grant");
    });

    it("has no confirmation on a reported event", async () => {
      const id = await addCompany(db, "Reported Co");
      await addRounds(db, id, [{ date: "2026-05-03", type: "seed" }]);
      const page = await listFundingRounds(db, filters());
      expect(page.items[0]?.confirmation).toBeNull();
    });
  });
});
