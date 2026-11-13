import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addWeeks, lastCompleteWeek } from "@/lib/weeks";
import type { Db } from "../client";
import {
  companies,
  companyThemes,
  events,
  fundingRounds,
  themes,
  themeWeeklyStats,
  weeklyTotals,
} from "../schema";
import { seedDatabase } from "../seed";
import { createTestDb, type TestDb } from "../testing";
import { listEarlyMomentum, listRisingThemes } from "./trends";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const LAST = lastCompleteWeek(NOW);

// All rounds in the seed: 19 in the 8 recent weeks and 12 in the baseline.
const N_R = 19;
const N_B = 12;
const ALPHA = 3;

function score(r: number, b: number, nR: number, nB: number): number {
  return Math.log((r + ALPHA) / ((b * nR) / nB + ALPHA));
}

describe("trend queries", () => {
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

  it("scores rising themes as worked out by hand", async () => {
    const result = await listRisingThemes(db, { now: NOW });
    expect(result.notEnoughHistory).toBe(false);
    const bySlug = new Map(result.rows.map((row) => [row.theme.slug, row]));

    // Grid batteries: 7 recent rounds and 3 baseline. The grant in week 3 does not count.
    const grid = bySlug.get("grid-batteries");
    expect(grid?.recentRounds).toBe(7);
    expect(grid?.baselineRounds).toBe(3);
    expect(grid?.expected).toBeCloseTo((3 * 19) / 12, 10);
    expect(grid?.score).toBeCloseTo(score(7, 3, N_R, N_B), 10);

    // Developer agents: 3 recent rounds and none before. One grant does not count.
    const agents = bySlug.get("developer-agents");
    expect(agents?.recentRounds).toBe(3);
    expect(agents?.score).toBeCloseTo(Math.log(6 / 3), 10);

    expect(result.rows.map((row) => row.theme.slug)).toEqual([
      "developer-agents",
      "accounting-agents",
      "grid-batteries",
      "climate-fintech",
    ]);
  });

  it("gives each row a 26-week sparkline of rounds", async () => {
    const result = await listRisingThemes(db, { now: NOW });
    const grid = result.rows.find((row) => row.theme.slug === "grid-batteries");
    expect(grid?.sparkline).toHaveLength(26);
    expect(grid?.sparkline[25]).toBe(1);
    expect(grid?.sparkline.reduce((sum, count) => sum + count, 0)).toBe(10);
    expect(grid?.recentGbpMinor).toBeGreaterThan(0);
  });

  it("never counts grants as rounds", async () => {
    const result = await listRisingThemes(db, { now: NOW });
    // Clinical AI has 2 recent rounds and 1 recent grant, so it stays below 3.
    expect(result.rows.some((row) => row.theme.slug === "clinical-ai")).toBe(
      false,
    );
    // Derived round counts match the non-grant rounds in the source tables.
    const [theme] = await db
      .select({ id: themes.id })
      .from(themes)
      .where(eq(themes.slug, "grid-batteries"));
    const stats = await db
      .select()
      .from(themeWeeklyStats)
      .where(eq(themeWeeklyStats.themeId, theme?.id ?? 0));
    const source = await db
      .select({ roundType: fundingRounds.roundType })
      .from(companyThemes)
      .innerJoin(events, eq(events.companyId, companyThemes.companyId))
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(eq(companyThemes.themeId, theme?.id ?? 0));
    expect(source.filter((row) => row.roundType === "grant")).toHaveLength(2);
    expect(stats.reduce((sum, row) => sum + row.rounds, 0)).toBe(
      source.filter((row) => row.roundType !== "grant").length,
    );
    expect(stats.reduce((sum, row) => sum + row.grants, 0)).toBe(2);
  });

  it("lists early momentum with late share", async () => {
    const result = await listEarlyMomentum(db, { now: NOW });
    expect(result.notEnoughHistory).toBe(false);
    expect(result.rows.map((row) => row.theme.slug)).toEqual([
      "accounting-agents",
      "grid-batteries",
    ]);
    // 4 recent and 2 baseline early rounds, out of 12 and 9 in all.
    const accounting = result.rows[0];
    expect(accounting?.recentEarlyRounds).toBe(4);
    expect(accounting?.score).toBeCloseTo(score(4, 2, 12, 9), 10);
    // Six companies with a known round type, one at Series A.
    expect(accounting?.lateShare).toBeCloseTo(1 / 6, 10);
    // Clinical AI is mostly late-stage and has few early rounds.
    expect(result.rows.some((row) => row.theme.slug === "clinical-ai")).toBe(
      false,
    );
  });

  it("leaves out themes with fewer than 3 companies", async () => {
    const [theme] = await db
      .select({ id: themes.id })
      .from(themes)
      .where(eq(themes.slug, "heat-pumps"));
    const themeId = theme?.id ?? 0;
    await db.insert(themeWeeklyStats).values(
      [0, 1, 2].map((weeks) => ({
        themeId,
        weekStart: addWeeks(LAST, -weeks),
        rounds: 2,
        earlyRounds: 2,
      })),
    );
    const before = await listRisingThemes(db, { now: NOW });
    expect(before.rows.some((row) => row.theme.slug === "heat-pumps")).toBe(
      false,
    );
    const [extra] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.slug, "agentwell"));
    await db
      .insert(companyThemes)
      .values({ companyId: extra?.id ?? 0, themeId, tagCount: 1 });
    const after = await listRisingThemes(db, { now: NOW });
    expect(after.rows.some((row) => row.theme.slug === "heat-pumps")).toBe(
      true,
    );
    await db.delete(companyThemes).where(eq(companyThemes.themeId, themeId));
  });
});

describe("trend queries with little history", () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    await seedDatabase(db, NOW);
    // Keep only the last 10 weeks of data.
    const first = addWeeks(LAST, -9);
    const { lt } = await import("drizzle-orm");
    await db
      .delete(themeWeeklyStats)
      .where(lt(themeWeeklyStats.weekStart, first));
    await db.delete(weeklyTotals).where(lt(weeklyTotals.weekStart, first));
  }, 60_000);

  afterAll(async () => {
    await testDb.close();
  });

  it("reports not enough history and gives no scores", async () => {
    const rising = await listRisingThemes(db, { now: NOW });
    expect(rising.notEnoughHistory).toBe(true);
    expect(rising.firstWeek).toBe(addWeeks(LAST, -9));
    expect(rising.rows.length).toBeGreaterThan(0);
    expect(rising.rows.every((row) => row.score === null)).toBe(true);
    const early = await listEarlyMomentum(db, { now: NOW });
    expect(early.notEnoughHistory).toBe(true);
    expect(early.rows).toEqual([]);
  });
});
