import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { seedDatabase } from "../seed";
import { createTestDb, type TestDb } from "../testing";
import { listInvestorActivity } from "./investor-activity";

const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("investor activity", () => {
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

  it("orders by led, then joined, then name", async () => {
    const rows = await listInvestorActivity(db, { now: NOW });
    expect(rows.map((row) => [row.investor.slug, row.led, row.joined])).toEqual(
      [
        ["tidewater-ventures", 6, 3],
        ["larkfield-climate-fund", 5, 1],
        ["marlow-angel-network", 4, 3],
        ["fenland-seed-partners", 4, 0],
      ],
    );
  });

  it("uses the median of known amounts and reports coverage", async () => {
    const rows = await listInvestorActivity(db, { now: NOW });
    const fenland = rows.find(
      (row) => row.investor.slug === "fenland-seed-partners",
    );
    // Led four seed rounds of £1.2M, £2.0M, unknown and £3.5M.
    expect(fenland?.rounds).toBe(4);
    expect(fenland?.roundsWithAmount).toBe(3);
    expect(fenland?.medianRoundGbpMinor).toBe(200_000_000);
  });

  it("leaves out Series A rounds, single-round investors and grants", async () => {
    const slugs = (await listInvestorActivity(db, { now: NOW })).map(
      (row) => row.investor.slug,
    );
    // Quarry Hill led one seed round and three Series A rounds.
    expect(slugs).not.toContain("quarry-hill-capital");
    // Corvid Health led one seed round and three later rounds.
    expect(slugs).not.toContain("corvid-health-ventures");
    expect(slugs).not.toContain("example-research-council");
  });

  it("filters by theme, merged theme and sector", async () => {
    const grid = await listInvestorActivity(db, {
      theme: "grid-batteries",
      now: NOW,
    });
    expect(grid.map((row) => row.investor.slug)).toEqual([
      "tidewater-ventures",
      "larkfield-climate-fund",
    ]);
    // £1.6M, £1.9M, £2.2M and £2.4M: the mean of the middle two.
    expect(grid[0]?.medianRoundGbpMinor).toBe(205_000_000);
    const merged = await listInvestorActivity(db, {
      theme: "home-batteries",
      now: NOW,
    });
    expect(merged).toEqual(grid);
    const energy = await listInvestorActivity(db, {
      sector: "climate-energy",
      now: NOW,
    });
    expect(
      energy.some((row) => row.investor.slug === "marlow-angel-network"),
    ).toBe(true);
    expect(
      await listInvestorActivity(db, { theme: "no-such-theme", now: NOW }),
    ).toEqual([]);
  });

  it("applies the window", async () => {
    const twelve = await listInvestorActivity(db, { now: NOW });
    const sixty = await listInvestorActivity(db, { now: NOW, months: 60 });
    expect(sixty.length).toBeGreaterThan(twelve.length);
    const short = await listInvestorActivity(db, { now: NOW, months: 1 });
    expect(short.every((row) => row.rounds >= 2)).toBe(true);
    expect(short.length).toBeLessThanOrEqual(twelve.length);
  });
});
