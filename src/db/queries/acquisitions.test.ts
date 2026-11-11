import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { seedDatabase } from "../seed";
import { createTestDb, type TestDb } from "../testing";
import { acquirersByTheme, listAcquisitions } from "./acquisitions";

const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("acquisition queries", () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    await seedDatabase(db, NOW);
  }, 60_000);

  afterAll(async () => {
    await testDb.close();
  });

  it("lists acquisitions newest first with target age", async () => {
    const all = await listAcquisitions(db, { page: 1, pageSize: 100 });
    expect(all.total).toBe(12);
    const dates = all.items.map((row) => row.announcedOn);
    expect(dates).toEqual([...dates].sort().reverse());

    const grid = await listAcquisitions(db, {
      theme: "grid-batteries",
      page: 1,
    });
    expect(grid.items.map((row) => row.target.name)).toEqual([
      "Cellmesh Storage",
      "Voltpost",
      "Gridwren",
      "Packwell Energy",
    ]);
    // Announced in 2026: founded 2018, 2021, unknown and 2016.
    expect(grid.items.map((row) => row.targetAgeYears)).toEqual([
      8,
      5,
      null,
      10,
    ]);
    const first = grid.items[0];
    expect(first?.acquirer?.slug).toBe("thames-grid");
    expect(first?.price).toEqual({
      amountMinor: 1_200_000_000,
      currency: "GBP",
    });
    expect(first?.themes.map((theme) => theme.slug)).toEqual([
      "grid-batteries",
    ]);
    expect(grid.items[1]?.acquirer).toBeNull();
    expect(grid.items[1]?.acquirerName).toBe("Brightwater Group");
    expect(grid.items[1]?.price).toBeNull();
  });

  it("filters by merged theme slug, sector and date, and pages", async () => {
    const viaMerged = await listAcquisitions(db, {
      theme: "home-batteries",
      page: 1,
    });
    expect(viaMerged.total).toBe(4);

    const finance = await listAcquisitions(db, {
      sector: "financial-services",
      page: 1,
    });
    expect(finance.total).toBe(2);

    const all = await listAcquisitions(db, { page: 1, pageSize: 100 });
    const from = all.items[3]?.announcedOn ?? "";
    const recent = await listAcquisitions(db, { from, page: 1, pageSize: 100 });
    expect(recent.total).toBe(
      all.items.filter((row) => row.announcedOn >= from).length,
    );

    const pageTwo = await listAcquisitions(db, { page: 2, pageSize: 5 });
    expect(pageTwo.items).toHaveLength(5);
    expect(pageTwo.total).toBe(12);
    expect(pageTwo.items[0]?.eventId).toBe(all.items[5]?.eventId);

    expect(
      (await listAcquisitions(db, { theme: "no-such-theme", page: 1 })).total,
    ).toBe(0);
  });

  it("summarises acquirers, median target age and age coverage", async () => {
    const summaries = await acquirersByTheme(db);
    const grid = summaries.find((row) => row.theme.slug === "grid-batteries");
    expect(grid?.acquisitions).toBe(4);
    expect(grid?.targetAgesKnown).toBe(3);
    expect(grid?.medianTargetAgeYears).toBe(8);
    expect(grid?.topAcquirers[0]).toMatchObject({
      acquirerName: "Thames Grid",
      acquisitions: 2,
    });
    expect(grid?.topAcquirers[0]?.acquirer?.slug).toBe("thames-grid");

    // Two acquisitions, one known age: not enough for a median.
    const accounting = summaries.find(
      (row) => row.theme.slug === "accounting-agents",
    );
    expect(accounting?.acquisitions).toBe(2);
    expect(accounting?.targetAgesKnown).toBe(1);
    expect(accounting?.medianTargetAgeYears).toBeNull();

    expect(summaries.some((row) => row.theme.slug === "heat-pumps")).toBe(
      false,
    );
    const counts = summaries.map((row) => row.acquisitions);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    const sector = await acquirersByTheme(db, {
      sector: "health-life-sciences",
    });
    expect(sector.map((row) => row.theme.slug)).toEqual(["clinical-ai"]);
    const merged = await acquirersByTheme(db, { theme: "home-batteries" });
    expect(merged.map((row) => row.theme.slug)).toEqual(["grid-batteries"]);
  });
});
