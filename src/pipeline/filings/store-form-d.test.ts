import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { edgarIndexDays, formDFilings, sources } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { parseFormD } from "./form-d-xml";
import {
  EDGAR_SOURCE_SLUG,
  earliestRecordedDay,
  ensureEdgarSource,
  latestDoneDay,
  recordIndexDay,
  recordedDays,
  storeFormDFiling,
  storedAccessions,
} from "./store-form-d";
import { EDGAR_FIXTURE_FILINGS, readEdgarFixture } from "./testing";

const NOW = new Date("2026-11-12T15:00:00Z");

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

function parsed(file: string, key: keyof typeof EDGAR_FIXTURE_FILINGS) {
  return parseFormD(readEdgarFixture(file), {
    accessionNumber: EDGAR_FIXTURE_FILINGS[key].accession,
    filedOn: "2026-11-10",
  });
}

describe("ensureEdgarSource", () => {
  it("creates the sec-edgar row once", async () => {
    const first = await ensureEdgarSource(db);
    const second = await ensureEdgarSource(db);
    expect(second).toBe(first);
    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: EDGAR_SOURCE_SLUG,
      kind: "sec_edgar",
    });
  });
});

describe("storeFormDFiling", () => {
  it("stores a filing once and keeps the first copy", async () => {
    const sourceId = await ensureEdgarSource(db);
    const amendment = parsed("form-d-amendment.xml", "amendment");
    expect(await storeFormDFiling(db, sourceId, amendment, NOW)).toBe("stored");
    expect(
      await storeFormDFiling(
        db,
        sourceId,
        { ...amendment, facts: { ...amendment.facts, issuerName: "Changed" } },
        NOW,
      ),
    ).toBe("exists");

    const rows = await db.select().from(formDFilings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accessionNumber: "0001999002-26-000003",
      cik: "1999002",
      issuerName: "Example Harbor Medical Inc.",
      jurisdiction: "BRITISH COLUMBIA, CANADA",
      issuerState: "A1",
      isAmendment: true,
      previousAccessionNumber: "0001999002-25-000001",
      dateOfFirstSale: "2024-10-04",
      totalOfferingUsdMinor: null,
      totalSoldUsdMinor: 162_338_200,
      investorCount: 11,
      securities: ["equity"],
      exemptions: ["06b"],
      incOverFiveYears: true,
      yearOfInc: null,
      filedOn: "2026-11-10",
      companyId: null,
      linkedAt: null,
    });
  });

  it("never stores a pooled investment fund", async () => {
    const sourceId = await ensureEdgarSource(db);
    const fund = parsed("form-d-fund.xml", "fund");
    expect(fund.isFund).toBe(true);
    expect(await storeFormDFiling(db, sourceId, fund, NOW)).toBe("fund");
    expect(await db.select().from(formDFilings)).toHaveLength(0);
  });

  it("finds stored accession numbers", async () => {
    const sourceId = await ensureEdgarSource(db);
    await storeFormDFiling(
      db,
      sourceId,
      parsed("form-d-company.xml", "company"),
      NOW,
    );
    const found = await storedAccessions(db, [
      EDGAR_FIXTURE_FILINGS.company.accession,
      EDGAR_FIXTURE_FILINGS.amendment.accession,
    ]);
    expect([...found]).toEqual([EDGAR_FIXTURE_FILINGS.company.accession]);
    expect(await storedAccessions(db, [])).toEqual(new Set());
  });
});

describe("index days", () => {
  it("records each day once and finds the latest done day", async () => {
    expect(await latestDoneDay(db)).toBeNull();
    expect(await earliestRecordedDay(db)).toBeNull();
    const base = { formDFound: 0, formDStored: 0, fundSkipped: 0, now: NOW };
    await recordIndexDay(db, { ...base, day: "2026-11-07", status: "missing" });
    await recordIndexDay(db, {
      ...base,
      day: "2026-11-06",
      status: "done",
      formDFound: 5,
      formDStored: 2,
      fundSkipped: 1,
    });
    await recordIndexDay(db, { ...base, day: "2026-11-06", status: "missing" });

    expect(await latestDoneDay(db)).toBe("2026-11-06");
    expect(await earliestRecordedDay(db)).toBe("2026-11-06");
    expect(await recordedDays(db, "2026-11-01", "2026-11-30")).toEqual(
      new Set(["2026-11-06", "2026-11-07"]),
    );
    const rows = await db.select().from(edgarIndexDays);
    expect(rows.find((row) => row.day === "2026-11-06")).toMatchObject({
      status: "done",
      formDFound: 5,
      formDStored: 2,
      fundSkipped: 1,
    });
  });
});
