import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatePrecision, RoundType } from "@/core/enums";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  acquisitions,
  companies,
  companyTags,
  companyThemes,
  derivedRebuilds,
  EMBEDDING_DIMENSIONS,
  events,
  fundingRoundMomentum,
  fundingRounds,
  launches,
  tags,
  tagThemes,
  themes,
  themeWeeklyStats,
  weeklyTotals,
} from "@/db/schema";
import { computeRoundMomentum } from "@/lib/company-momentum";
import { insertCompany } from "@/pipeline/resolve/testing";
import { rebuildStatsStep } from "./rebuild-stats";

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

const clock: Clock = { now: () => new Date("2026-11-11T12:00:00Z") };
const NONE = { inserted: 0, updated: 0, deleted: 0 };
const POUND = 100;
const MILLION = 1_000_000 * POUND;

// Builders

async function addTag(db: Db, slug: string): Promise<number> {
  const [row] = await db
    .insert(tags)
    .values({ slug, label: slug })
    .returning({ id: tags.id });
  if (!row) throw new Error("no tag");
  return row.id;
}

async function addTheme(
  db: Db,
  slug: string,
  seedTagId: number,
): Promise<number> {
  const [row] = await db
    .insert(themes)
    .values({
      slug,
      name: slug,
      seedTagId,
      centroid: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1),
      embeddingModel: "test-embedding",
    })
    .returning({ id: themes.id });
  if (!row) throw new Error("no theme");
  return row.id;
}

async function linkTag(
  db: Db,
  tagId: number,
  themeId: number | null,
): Promise<void> {
  await db.insert(tagThemes).values({
    tagId,
    themeId,
    similarity: themeId === null ? null : 0.9,
    assignedBy: themeId === null ? "manual" : "auto",
  });
}

async function tagCompany(
  db: Db,
  companyId: number,
  ...tagIds: number[]
): Promise<void> {
  await db
    .insert(companyTags)
    .values(tagIds.map((tagId) => ({ companyId, tagId })));
}

async function addEvent(
  db: Db,
  type: "funding_round" | "acquisition" | "launch",
  companyId: number,
  announcedOn: string,
  datePrecision: DatePrecision = "day",
): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({ type, companyId, announcedOn, datePrecision })
    .returning({ id: events.id });
  if (!row) throw new Error("no event");
  return row.id;
}

async function addRound(
  db: Db,
  companyId: number,
  announcedOn: string,
  roundType: RoundType,
  amountGbpMinor: number | null,
  datePrecision: DatePrecision = "day",
): Promise<number> {
  const eventId = await addEvent(
    db,
    "funding_round",
    companyId,
    announcedOn,
    datePrecision,
  );
  await db.insert(fundingRounds).values({
    eventId,
    roundType,
    amountMinor: amountGbpMinor,
    currency: amountGbpMinor === null ? null : "GBP",
    amountGbpMinor,
  });
  return eventId;
}

async function addAcquisition(
  db: Db,
  companyId: number,
  announcedOn: string,
): Promise<number> {
  const eventId = await addEvent(db, "acquisition", companyId, announcedOn);
  await db.insert(acquisitions).values({ eventId, acquirerName: "Big Co" });
  return eventId;
}

async function addLaunch(
  db: Db,
  companyId: number,
  announcedOn: string,
): Promise<number> {
  const eventId = await addEvent(db, "launch", companyId, announcedOn);
  await db.insert(launches).values({ eventId, kind: "product" });
  return eventId;
}

// Reads

async function readCompanyThemes(db: Db) {
  return db
    .select()
    .from(companyThemes)
    .orderBy(asc(companyThemes.companyId), asc(companyThemes.themeId));
}

async function readThemeWeekly(db: Db) {
  return db
    .select()
    .from(themeWeeklyStats)
    .orderBy(asc(themeWeeklyStats.themeId), asc(themeWeeklyStats.weekStart));
}

async function readTotals(db: Db) {
  return db.select().from(weeklyTotals).orderBy(asc(weeklyTotals.weekStart));
}

async function readMomentum(db: Db) {
  return db
    .select()
    .from(fundingRoundMomentum)
    .orderBy(asc(fundingRoundMomentum.eventId));
}

function weekly(
  themeId: number,
  weekStart: string,
  counts: Partial<typeof themeWeeklyStats.$inferSelect>,
) {
  return {
    themeId,
    weekStart,
    rounds: 0,
    roundsWithAmount: 0,
    totalGbpMinor: 0,
    earlyRounds: 0,
    laterRounds: 0,
    unknownStageRounds: 0,
    grants: 0,
    grantGbpMinor: 0,
    acquisitions: 0,
    launches: 0,
    companies: 0,
    ...counts,
  };
}

// Weeks: 2026-03-02 and 2026-03-09 are Mondays.
const W1 = "2026-03-02";
const W2 = "2026-03-09";

/**
 * Two themes. Company A is in both, B only in fintech, D only in climate,
 * C has tags in no theme, and M was merged into B but still has a tag and a
 * round of its own.
 */
async function seedScenario(db: Db) {
  const payments = await addTag(db, "payments");
  const lending = await addTag(db, "lending");
  const carbon = await addTag(db, "carbon-accounting");
  const misc = await addTag(db, "misc");
  const loose = await addTag(db, "not-yet-assigned");

  const fintech = await addTheme(db, "fintech", payments);
  const climate = await addTheme(db, "climate", carbon);
  await linkTag(db, payments, fintech);
  await linkTag(db, lending, fintech);
  await linkTag(db, carbon, climate);
  await linkTag(db, misc, null);

  const a = (await insertCompany(db, { name: "Alpha" })).id;
  const b = (await insertCompany(db, { name: "Bravo" })).id;
  const c = (await insertCompany(db, { name: "Charlie" })).id;
  const d = (await insertCompany(db, { name: "Delta" })).id;
  const m = (await insertCompany(db, { name: "Mike", mergedIntoId: b })).id;

  await tagCompany(db, a, payments, lending, carbon);
  await tagCompany(db, b, payments);
  await tagCompany(db, c, misc, loose);
  await tagCompany(db, d, carbon);
  await tagCompany(db, m, carbon);

  // Week 1
  const aSeed = await addRound(db, a, "2026-03-03", "seed", 1 * MILLION);
  await addRound(db, a, "2026-03-04", "grant", MILLION / 2);
  const bSeriesA = await addRound(db, b, "2026-03-08", "series_a", null); // a Sunday
  await addAcquisition(db, b, "2026-03-05");
  await addLaunch(db, c, "2026-03-06");
  await addRound(db, c, "2026-03-06", "debt", 2 * MILLION);
  // Week 2
  const aUnknown = await addRound(db, a, "2026-03-09", "unknown", 3 * MILLION);
  await addLaunch(db, b, "2026-03-10");
  const dPreSeed = await addRound(db, d, "2026-03-12", "pre_seed", MILLION / 5);
  // The merged company's own round must count nowhere.
  const mSeed = await addRound(db, m, "2026-03-03", "seed", 9 * MILLION);

  return {
    tags: { carbon },
    themes: { fintech, climate },
    companies: { a, b, c, d, m },
    rounds: { aSeed, bSeriesA, aUnknown, dPreSeed, mSeed },
  };
}

describe("rebuildStatsStep", () => {
  it("builds weekly counts that match hand-computed values", async () => {
    const { db } = testDb;
    const s = await seedScenario(db);
    const { fintech, climate } = s.themes;
    const { a, b, d } = s.companies;

    const result = await rebuildStatsStep({ db, clock });
    expect(result.skipped).toBeUndefined();
    expect(result.companyThemes).toEqual({ ...NONE, inserted: 4 });
    expect(result.themeWeeklyStats).toEqual({ ...NONE, inserted: 4 });
    expect(result.weeklyTotals).toEqual({ ...NONE, inserted: 2 });

    expect(await readCompanyThemes(db)).toEqual([
      { companyId: a, themeId: fintech, tagCount: 2 },
      { companyId: a, themeId: climate, tagCount: 1 },
      { companyId: b, themeId: fintech, tagCount: 1 },
      { companyId: d, themeId: climate, tagCount: 1 },
    ]);

    expect(await readThemeWeekly(db)).toEqual([
      // A seed and grant, B's Sunday Series A (no amount) and acquisition.
      weekly(fintech, W1, {
        rounds: 2,
        roundsWithAmount: 1,
        totalGbpMinor: 1 * MILLION,
        earlyRounds: 1,
        laterRounds: 1,
        grants: 1,
        grantGbpMinor: MILLION / 2,
        acquisitions: 1,
        companies: 2,
      }),
      // A unknown-stage round and B launch.
      weekly(fintech, W2, {
        rounds: 1,
        roundsWithAmount: 1,
        totalGbpMinor: 3 * MILLION,
        unknownStageRounds: 1,
        launches: 1,
        companies: 2,
      }),
      // A seed and grant.
      weekly(climate, W1, {
        rounds: 1,
        roundsWithAmount: 1,
        totalGbpMinor: 1 * MILLION,
        earlyRounds: 1,
        grants: 1,
        grantGbpMinor: MILLION / 2,
        companies: 1,
      }),
      // A unknown-stage round and D pre-seed.
      weekly(climate, W2, {
        rounds: 2,
        roundsWithAmount: 2,
        totalGbpMinor: 3 * MILLION + MILLION / 5,
        earlyRounds: 1,
        unknownStageRounds: 1,
        companies: 2,
      }),
    ]);

    // A's seed is in two themes but counted once. C has no theme but counts.
    expect(await readTotals(db)).toEqual([
      {
        weekStart: W1,
        rounds: 3,
        earlyRounds: 1,
        grants: 1,
        acquisitions: 1,
        launches: 1,
      },
      {
        weekStart: W2,
        rounds: 2,
        earlyRounds: 1,
        grants: 0,
        acquisitions: 0,
        launches: 1,
      },
    ]);
  });

  it("leaves out a merged company entirely", async () => {
    const { db } = testDb;
    const s = await seedScenario(db);
    await rebuildStatsStep({ db, clock });

    const themed = await readCompanyThemes(db);
    expect(themed.some((row) => row.companyId === s.companies.m)).toBe(false);
    const momentum = await readMomentum(db);
    expect(momentum.some((row) => row.companyId === s.companies.m)).toBe(false);
    expect(momentum.some((row) => row.eventId === s.rounds.mSeed)).toBe(false);
    // Its £9M seed is in no total.
    const [w1] = await readTotals(db);
    expect(w1?.earlyRounds).toBe(1);
  });

  it("matches computeRoundMomentum for the spec's example company", async () => {
    const { db } = testDb;
    const company = (await insertCompany(db, { name: "Example Co" })).id;
    const seed = await addRound(
      db,
      company,
      "2025-03-10",
      "seed",
      1_500_000 * POUND,
    );
    const extension = await addRound(db, company, "2026-01-20", "seed", null);
    const debt = await addRound(db, company, "2026-04-02", "debt", 2 * MILLION);
    const seriesA = await addRound(
      db,
      company,
      "2026-09-05",
      "series_a",
      8 * MILLION,
    );

    const result = await rebuildStatsStep({ db, clock });
    expect(result.fundingRoundMomentum).toEqual({ ...NONE, inserted: 3 });

    const rows = await readMomentum(db);
    expect(rows.map((row) => row.eventId)).toEqual([seed, extension, seriesA]);
    expect(rows.some((row) => row.eventId === debt)).toBe(false);
    expect(rows.map((row) => row.equityRoundNumber)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.monthsSincePrevious)).toEqual([null, 10, 7]);
    expect(rows.map((row) => row.previousEventId)).toEqual([
      null,
      seed,
      extension,
    ]);
    expect(rows.map((row) => row.stepUpBasisEventId)).toEqual([
      null,
      null,
      seed,
    ]);
    expect(rows[0]?.stepUpRatio).toBeNull();
    expect(rows[1]?.stepUpRatio).toBeNull();
    expect(rows[2]?.stepUpRatio).toBeCloseTo(8 / 1.5, 5);
    expect(rows.map((row) => row.roundsIn24mToDate)).toEqual([1, 2, 3]);

    const expected = computeRoundMomentum([
      {
        eventId: seed,
        announcedOn: "2025-03-10",
        datePrecision: "day",
        roundType: "seed",
        amountGbpMinor: 1_500_000 * POUND,
      },
      {
        eventId: extension,
        announcedOn: "2026-01-20",
        datePrecision: "day",
        roundType: "seed",
        amountGbpMinor: null,
      },
      {
        eventId: debt,
        announcedOn: "2026-04-02",
        datePrecision: "day",
        roundType: "debt",
        amountGbpMinor: 2 * MILLION,
      },
      {
        eventId: seriesA,
        announcedOn: "2026-09-05",
        datePrecision: "day",
        roundType: "series_a",
        amountGbpMinor: 8 * MILLION,
      },
    ]);
    const rounded = (ratio: number | null) =>
      ratio === null ? null : Math.round(ratio * 1e5) / 1e5;
    expect(
      rows.map((row) => ({ ...row, stepUpRatio: rounded(row.stepUpRatio) })),
    ).toEqual(
      expected.map((row) => ({
        eventId: row.eventId,
        companyId: company,
        equityRoundNumber: row.equityRoundNumber,
        previousEventId: row.previousEventId,
        monthsSincePrevious: row.monthsSincePrevious,
        stepUpBasisEventId: row.stepUpBasisEventId,
        stepUpRatio: rounded(row.stepUpRatio),
        roundsIn24mToDate: row.roundsIn24mToDate,
      })),
    );
  });

  it("skips a second rebuild, and a forced one writes nothing", async () => {
    const { db } = testDb;
    await seedScenario(db);
    const eventsBefore = await db.select().from(events);

    await rebuildStatsStep({ db, clock });
    const tables = {
      companyThemes: await readCompanyThemes(db),
      themeWeekly: await readThemeWeekly(db),
      totals: await readTotals(db),
      momentum: await readMomentum(db),
    };

    expect(await rebuildStatsStep({ db, clock })).toEqual({
      companyThemes: NONE,
      themeWeeklyStats: NONE,
      weeklyTotals: NONE,
      fundingRoundMomentum: NONE,
      skipped: true,
    });
    expect(await rebuildStatsStep({ db, clock, force: true })).toEqual({
      companyThemes: NONE,
      themeWeeklyStats: NONE,
      weeklyTotals: NONE,
      fundingRoundMomentum: NONE,
    });

    expect({
      companyThemes: await readCompanyThemes(db),
      themeWeekly: await readThemeWeekly(db),
      totals: await readTotals(db),
      momentum: await readMomentum(db),
    }).toEqual(tables);
    // Source rows are never rewritten.
    expect(await db.select().from(events)).toEqual(eventsBefore);
    const [rebuild] = await db.select().from(derivedRebuilds);
    expect(rebuild?.name).toBe("stats");
  });

  it("changes only the affected rows when one event is added", async () => {
    const { db } = testDb;
    const s = await seedScenario(db);
    await rebuildStatsStep({ db, clock });

    // A second launch for B in week 2 updates one theme row and one total.
    await addLaunch(db, s.companies.b, "2026-03-11");
    expect(await rebuildStatsStep({ db, clock })).toEqual({
      companyThemes: NONE,
      themeWeeklyStats: { ...NONE, updated: 1 },
      weeklyTotals: { ...NONE, updated: 1 },
      fundingRoundMomentum: NONE,
    });
    const [, fintechW2] = await readThemeWeekly(db);
    expect(fintechW2?.launches).toBe(2);

    // A seed round for B in a new week adds one row to each table.
    await addRound(db, s.companies.b, "2026-03-16", "seed", 2 * MILLION);
    expect(await rebuildStatsStep({ db, clock })).toEqual({
      companyThemes: NONE,
      themeWeeklyStats: { ...NONE, inserted: 1 },
      weeklyTotals: { ...NONE, inserted: 1 },
      fundingRoundMomentum: { ...NONE, inserted: 1 },
    });
  });

  it("moves companies and weekly rows to the survivor when themes merge", async () => {
    const { db } = testDb;
    const s = await seedScenario(db);
    const { fintech, climate } = s.themes;
    const { a, b, d } = s.companies;
    await rebuildStatsStep({ db, clock });

    await db
      .update(themes)
      .set({ status: "merged", mergedIntoId: fintech })
      .where(eq(themes.id, climate));

    const result = await rebuildStatsStep({ db, clock });
    // A's climate row goes and its fintech count rises; D moves to fintech.
    expect(result.companyThemes).toEqual({
      inserted: 1,
      updated: 1,
      deleted: 2,
    });
    // Both climate weeks go; fintech week 2 gains D's pre-seed round.
    expect(result.themeWeeklyStats).toEqual({
      inserted: 0,
      updated: 1,
      deleted: 2,
    });
    expect(result.weeklyTotals).toEqual(NONE);

    expect(await readCompanyThemes(db)).toEqual([
      { companyId: a, themeId: fintech, tagCount: 3 },
      { companyId: b, themeId: fintech, tagCount: 1 },
      { companyId: d, themeId: fintech, tagCount: 1 },
    ]);
    const weeklyRows = await readThemeWeekly(db);
    expect(weeklyRows.map((row) => [row.themeId, row.weekStart])).toEqual([
      [fintech, W1],
      [fintech, W2],
    ]);
    expect(weeklyRows[1]).toEqual(
      weekly(fintech, W2, {
        rounds: 2,
        roundsWithAmount: 2,
        totalGbpMinor: 3 * MILLION + MILLION / 5,
        earlyRounds: 1,
        unknownStageRounds: 1,
        launches: 1,
        companies: 3,
      }),
    );
    // The merged theme row itself is kept.
    const [merged] = await db
      .select()
      .from(themes)
      .where(eq(themes.id, climate));
    expect(merged?.mergedIntoId).toBe(fintech);
  });

  it("rebuilds after a company merge moves events to the survivor", async () => {
    const { db } = testDb;
    const s = await seedScenario(db);
    await rebuildStatsStep({ db, clock });

    // As a Phase 1 merge would: D's events and tags move to B.
    await db
      .update(events)
      .set({ companyId: s.companies.b })
      .where(eq(events.companyId, s.companies.d));
    await db
      .delete(companyTags)
      .where(eq(companyTags.companyId, s.companies.d));
    await tagCompany(db, s.companies.b, s.tags.carbon);
    await db
      .update(companies)
      .set({ mergedIntoId: s.companies.b })
      .where(eq(companies.id, s.companies.d));

    const result = await rebuildStatsStep({ db, clock });
    expect(result.skipped).toBeUndefined();
    const momentum = await readMomentum(db);
    const moved = momentum.find((row) => row.eventId === s.rounds.dPreSeed);
    expect(moved?.companyId).toBe(s.companies.b);
    expect(
      (await readCompanyThemes(db)).some(
        (row) => row.companyId === s.companies.d,
      ),
    ).toBe(false);
  });
});
