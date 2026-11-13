import { asc } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  companies,
  events,
  fundingRoundMomentum,
  tags,
  weeklyTotals,
} from "@/db/schema";
import { insertCompany } from "@/pipeline/resolve/testing";
import { writeDiff } from "./diff-write";

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

function week(weekStart: string, rounds: number) {
  return {
    weekStart,
    rounds,
    earlyRounds: 0,
    grants: 0,
    acquisitions: 0,
    launches: 0,
  };
}

async function totals() {
  return testDb.db
    .select()
    .from(weeklyTotals)
    .orderBy(asc(weeklyTotals.weekStart));
}

describe("writeDiff", () => {
  it("inserts, updates and deletes only what changed", async () => {
    const { db } = testDb;
    const first = await writeDiff(
      db,
      weeklyTotals,
      ["weekStart"],
      [week("2026-01-05", 1), week("2026-01-12", 2), week("2026-01-19", 3)],
    );
    expect(first).toEqual({ inserted: 3, updated: 0, deleted: 0 });

    const same = await writeDiff(
      db,
      weeklyTotals,
      ["weekStart"],
      [week("2026-01-19", 3), week("2026-01-05", 1), week("2026-01-12", 2)],
    );
    expect(same).toEqual({ inserted: 0, updated: 0, deleted: 0 });

    const changed = await writeDiff(
      db,
      weeklyTotals,
      ["weekStart"],
      [week("2026-01-05", 1), week("2026-01-12", 5), week("2026-01-26", 4)],
    );
    expect(changed).toEqual({ inserted: 1, updated: 1, deleted: 1 });
    expect((await totals()).map((row) => [row.weekStart, row.rounds])).toEqual([
      ["2026-01-05", 1],
      ["2026-01-12", 5],
      ["2026-01-26", 4],
    ]);

    expect(await writeDiff(db, weeklyTotals, ["weekStart"], [])).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 3,
    });
    expect(await totals()).toEqual([]);
  });

  it("treats a real column as equal after float32 rounding", async () => {
    const { db } = testDb;
    const company = await insertCompany(db, { name: "Ratio Ltd" });
    const inserted = await db
      .insert(events)
      .values([
        {
          type: "funding_round",
          companyId: company.id,
          announcedOn: "2025-01-01",
        },
        {
          type: "funding_round",
          companyId: company.id,
          announcedOn: "2026-01-01",
        },
      ])
      .returning({ id: events.id });
    const [a, b] = inserted.map((row) => row.id) as [number, number];
    const row = {
      eventId: b,
      companyId: company.id,
      equityRoundNumber: 2,
      previousEventId: a,
      monthsSincePrevious: 12,
      stepUpBasisEventId: a,
      stepUpRatio: 16 / 3,
      roundsIn24mToDate: 2,
    };
    const keys = ["eventId"] as const;
    expect(await writeDiff(db, fundingRoundMomentum, keys, [row])).toEqual({
      inserted: 1,
      updated: 0,
      deleted: 0,
    });
    expect(await writeDiff(db, fundingRoundMomentum, keys, [row])).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
    });
    expect(
      await writeDiff(db, fundingRoundMomentum, keys, [
        { ...row, stepUpRatio: null },
      ]),
    ).toEqual({ inserted: 0, updated: 1, deleted: 0 });
  });

  it("refuses tables outside the derived list", async () => {
    await expect(
      writeDiff(testDb.db, tags as never, ["id"] as never, []),
    ).rejects.toThrow(/derived tables/);
    await expect(
      writeDiff(testDb.db, companies as never, ["id"] as never, []),
    ).rejects.toThrow(/derived tables/);
  });

  it("rejects duplicate keys", async () => {
    await expect(
      writeDiff(
        testDb.db,
        weeklyTotals,
        ["weekStart"],
        [week("2026-01-05", 1), week("2026-01-05", 2)],
      ),
    ).rejects.toThrow(/Duplicate/);
  });
});
