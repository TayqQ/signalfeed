import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  getRatesOnOrBefore,
  latestRate,
  missingRateDates,
  upsertRates,
} from "./fx-rates";

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

describe("fx rates", () => {
  it("uses an earlier rate within 7 days and returns null beyond that", async () => {
    await upsertRates(db, {
      date: "2026-03-01",
      perEur: { EUR: 1, USD: 1.25, GBP: 0.75 },
    });
    await upsertRates(db, {
      date: "2026-03-08",
      perEur: { EUR: 1, USD: 1.5, GBP: 0.5 },
    });

    expect(await getRatesOnOrBefore(db, "2026-03-08")).toEqual({
      date: "2026-03-08",
      perEur: { EUR: 1, USD: 1.5, GBP: 0.5 },
    });
    expect(await getRatesOnOrBefore(db, "2026-03-09")).toEqual({
      date: "2026-03-08",
      perEur: { EUR: 1, USD: 1.5, GBP: 0.5 },
    });
    expect(await getRatesOnOrBefore(db, "2026-03-15")).toEqual({
      date: "2026-03-08",
      perEur: { EUR: 1, USD: 1.5, GBP: 0.5 },
    });
    expect(await getRatesOnOrBefore(db, "2026-03-16")).toBeNull();
    expect(await getRatesOnOrBefore(db, "2026-02-28")).toBeNull();
  });

  it("replaces a stored rate and reports the newest currency rate", async () => {
    await upsertRates(db, {
      date: "2026-03-08",
      perEur: { USD: 1.5 },
    });
    await upsertRates(db, {
      date: "2026-03-08",
      perEur: { USD: 2 },
    });

    expect(await latestRate(db, "USD")).toEqual({
      date: "2026-03-08",
      perEur: 2,
    });
    expect(await latestRate(db, "GBP")).toBeNull();
    expect(await getRatesOnOrBefore(db, "2026-03-08")).toEqual({
      date: "2026-03-08",
      perEur: { USD: 2 },
    });
  });

  it("lists dates that have no stored rate", async () => {
    await upsertRates(db, { date: "2026-03-01", perEur: { EUR: 1 } });
    await upsertRates(db, { date: "2026-03-08", perEur: { EUR: 1 } });

    expect(
      await missingRateDates(db, [
        "2026-03-02",
        "2026-03-01",
        "2026-03-02",
        "2026-03-08",
      ]),
    ).toEqual(["2026-03-02"]);
    expect(await missingRateDates(db, [])).toEqual([]);
  });
});
