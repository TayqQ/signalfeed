import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapitalFiling, RegistryCompanyFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import { chCompanies, chFilings, companies } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  fillFoundedYear,
  storeChCompany,
  storeChFilings,
} from "./store-registry";

const NOW = new Date("2026-11-12T09:00:00Z");
const LATER = new Date("2026-11-20T09:00:00Z");

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

function profile(
  overrides: Partial<RegistryCompanyFacts> = {},
): RegistryCompanyFacts {
  return {
    companyNumber: "13579246",
    name: "BRIGHTWELL ROBOTICS LTD",
    previousNames: ["BRIGHTWELL LABS LTD"],
    status: "active",
    companyType: "ltd",
    incorporatedOn: "2022-06-01",
    ceasedOn: null,
    sicCodes: ["62012"],
    officePostcode: "LS1 4AP",
    officeOutcode: "LS1",
    accountsType: "micro-entity",
    accountsMadeUpTo: "2025-06-30",
    statusDetail: null,
    officeLocality: "Leeds",
    hasInsolvencyHistory: false,
    etag: "etag-1",
    ...overrides,
  };
}

function sh01(transactionId: string, actionDate: string): CapitalFiling {
  return {
    transactionId,
    type: "SH01",
    filedOn: actionDate,
    actionDate,
    capital: [{ currency: "GBP", figure: "1,250.00" }],
    documentId: "doc-1",
  };
}

async function chRow(number = "13579246") {
  const [row] = await db
    .select()
    .from(chCompanies)
    .where(eq(chCompanies.companyNumber, number));
  return row!;
}

describe("storeChCompany", () => {
  it("inserts a profile with every stored field", async () => {
    expect(await storeChCompany(db, profile(), NOW)).toBe("inserted");
    const row = await chRow();
    expect(row).toMatchObject({
      name: "BRIGHTWELL ROBOTICS LTD",
      status: "active",
      companyType: "ltd",
      incorporatedOn: "2022-06-01",
      sicCodes: ["62012"],
      officePostcode: "LS1 4AP",
      officeOutcode: "LS1",
      officeLocality: "Leeds",
      previousNames: ["BRIGHTWELL LABS LTD"],
      accountsType: "micro-entity",
      accountsMadeUpTo: "2025-06-30",
      etag: "etag-1",
    });
    expect(row.fetchedAt).toEqual(NOW);
    expect(row.firstSeenAt).toEqual(NOW);
  });

  it("only sets fetched_at when the etag is the same", async () => {
    await storeChCompany(db, profile(), NOW);
    const result = await storeChCompany(
      db,
      profile({ status: "dissolved" }),
      LATER,
    );
    expect(result).toBe("unchanged");
    const row = await chRow();
    expect(row.status).toBe("active");
    expect(row.fetchedAt).toEqual(LATER);
  });

  it("updates the row when the etag changed, keeping first_seen_at", async () => {
    await storeChCompany(db, profile(), NOW);
    const result = await storeChCompany(
      db,
      profile({ status: "dissolved", ceasedOn: "2026-10-01", etag: "etag-2" }),
      LATER,
    );
    expect(result).toBe("updated");
    const row = await chRow();
    expect(row).toMatchObject({
      status: "dissolved",
      ceasedOn: "2026-10-01",
      etag: "etag-2",
    });
    expect(row.firstSeenAt).toEqual(NOW);
    expect(row.fetchedAt).toEqual(LATER);
  });
});

describe("storeChFilings", () => {
  it("upserts SH01 filings by transaction id and skips other types", async () => {
    const other: CapitalFiling = {
      ...sh01("t-3", "2026-01-01"),
      type: "SH19",
    };
    const first = await storeChFilings(
      db,
      "13579246",
      [sh01("t-1", "2026-02-02"), sh01("t-2", "2025-05-01"), other],
      NOW,
    );
    expect(first).toBe(2);
    const again = await storeChFilings(
      db,
      "13579246",
      [sh01("t-1", "2026-02-02")],
      LATER,
    );
    expect(again).toBe(0);
    const rows = await db.select().from(chFilings);
    expect(rows).toHaveLength(2);
    const updated = rows.find((r) => r.transactionId === "t-1");
    expect(updated).toMatchObject({
      companyNumber: "13579246",
      type: "SH01",
      category: "capital",
      actionDate: "2026-02-02",
      capital: [{ currency: "GBP", figure: "1,250.00" }],
      documentId: "doc-1",
    });
    expect(updated?.fetchedAt).toEqual(LATER);
  });
});

describe("fillFoundedYear", () => {
  async function insertCompany(values: Partial<typeof companies.$inferInsert>) {
    const [row] = await db
      .insert(companies)
      .values({
        slug: "brightwell",
        name: "Brightwell Robotics",
        normalisedName: "brightwell robotics",
        countryCode: "GB",
        city: "Leeds",
        ...values,
      })
      .returning();
    return row!;
  }

  async function companyRow(id: number) {
    const [row] = await db.select().from(companies).where(eq(companies.id, id));
    return row!;
  }

  it("fills an empty founded year with source companies_house", async () => {
    const company = await insertCompany({});
    expect(await fillFoundedYear(db, company.id, "2022-06-01")).toBe(true);
    const row = await companyRow(company.id);
    expect(row.foundedYear).toBe(2022);
    expect(row.foundedYearSource).toBe("companies_house");
    expect(row.status).toBe("active");
    expect(row.city).toBe("Leeds");
  });

  it("never replaces a news founded year", async () => {
    const company = await insertCompany({
      foundedYear: 2020,
      foundedYearSource: "news",
    });
    expect(await fillFoundedYear(db, company.id, "2022-06-01")).toBe(false);
    const row = await companyRow(company.id);
    expect(row.foundedYear).toBe(2020);
    expect(row.foundedYearSource).toBe("news");
  });
});
