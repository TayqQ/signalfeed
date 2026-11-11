import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUND_TYPES } from "@/core/enums";
import { addWeeks, lastCompleteWeek } from "@/lib/weeks";
import type { Db } from "../client";
import { seedDatabase } from "../seed";
import { createTestDb, type TestDb } from "../testing";
import { getThemeDetail, listThemes, resolveThemeSlugs } from "./themes";

// Wednesday 11 November 2026. The last complete week starts on 2026-11-02.
const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("theme queries", () => {
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

  it("lists active themes by sector, then A-Z, with counts", async () => {
    const all = await listThemes(db);
    expect(all.map((theme) => theme.name)).toEqual([
      "Developer agents",
      "Agentic accounting",
      "Climate fintech",
      "Clinical AI",
      "Grid batteries",
      "Heat pumps",
    ]);
    expect(all.some((theme) => theme.slug === "home-batteries")).toBe(false);

    const grid = all.find((theme) => theme.slug === "grid-batteries");
    expect(grid?.companyCount).toBe(10);
    expect(grid?.tagCount).toBe(3);
    expect(grid?.nameIsReviewed).toBe(false);
    expect(
      all.find((theme) => theme.slug === "climate-fintech")?.nameIsReviewed,
    ).toBe(true);

    const energy = await listThemes(db, { sector: "climate-energy" });
    expect(energy.map((theme) => theme.slug)).toEqual([
      "grid-batteries",
      "heat-pumps",
    ]);
  });

  it("returns 52 weekly points with zero weeks filled in", async () => {
    const detail = await getThemeDetail(db, "grid-batteries", { now: NOW });
    expect(detail?.redirectToSlug).toBeNull();
    const weekly = detail?.weekly ?? [];
    expect(weekly).toHaveLength(52);
    expect(weekly[51]?.weekStart).toBe("2026-11-02");
    expect(weekly[0]?.weekStart).toBe(addWeeks(lastCompleteWeek(NOW), -51));
    // Seven recent and three baseline rounds. The grant in week 3 is not a round.
    expect(weekly.reduce((sum, point) => sum + point.rounds, 0)).toBe(10);
    const empty = weekly.filter((point) => point.rounds === 0);
    expect(empty.length).toBeGreaterThan(30);
    expect(
      empty.every(
        (point) =>
          point.earlyRounds === 0 &&
          point.laterRounds === 0 &&
          point.totalGbpMinor === 0,
      ),
    ).toBe(true);
  });

  it("returns the stage mix with every type present and no grants", async () => {
    const detail = await getThemeDetail(db, "grid-batteries", { now: NOW });
    const mix = detail?.stageMix;
    expect(Object.keys(mix ?? {}).sort()).toEqual([...ROUND_TYPES].sort());
    expect(mix).toMatchObject({
      pre_seed: 3,
      seed: 5,
      series_a: 1,
      debt: 1,
      grant: 0,
    });
  });

  it("returns top tags by mentions, then slug", async () => {
    const detail = await getThemeDetail(db, "grid-batteries", { now: NOW });
    expect(detail?.tags.map((tag) => tag.slug)).toEqual([
      "energy-storage",
      "grid-batteries",
      "home-batteries",
    ]);
    expect(detail?.summary.companyCount).toBe(10);
  });

  it("redirects a merged theme and returns null for an unknown one", async () => {
    const merged = await getThemeDetail(db, "home-batteries", { now: NOW });
    expect(merged?.redirectToSlug).toBe("grid-batteries");
    expect(merged?.weekly).toEqual([]);
    expect(await getThemeDetail(db, "no-such-theme", { now: NOW })).toBeNull();
  });

  it("resolves slugs to surviving themes", async () => {
    expect(
      await resolveThemeSlugs(db, [
        "home-batteries",
        "grid-batteries",
        "no-such-theme",
        "heat-pumps",
      ]),
    ).toEqual(["grid-batteries", "heat-pumps"]);
    expect(await resolveThemeSlugs(db, [])).toEqual([]);
  });
});
