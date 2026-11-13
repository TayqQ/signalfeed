import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { chAddressCounts, companies } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { recordLink } from "./link-store";
import {
  SHARED_ADDRESS_THRESHOLD,
  formatPostcode,
  isSharedAddress,
} from "./shared-address";
import { storeChCompany } from "./store-registry";
import { fakeChClient } from "./testing";

const NOW = new Date("2026-11-12T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

let nextCompany = 0;

/** Links `n` companies to numbers whose office is at `postcode`. */
async function linkedAt(postcode: string, n: number) {
  for (let k = 0; k < n; k += 1) {
    nextCompany += 1;
    const i = nextCompany;
    const number = String(12000000 + i);
    const [company] = await db
      .insert(companies)
      .values({
        slug: `co-${i}`,
        name: `Company ${i}`,
        normalisedName: `company ${i}`,
      })
      .returning();
    await storeChCompany(
      db,
      {
        companyNumber: number,
        name: `COMPANY ${i} LTD`,
        previousNames: [],
        status: "active",
        companyType: "ltd",
        incorporatedOn: "2020-01-01",
        ceasedOn: null,
        sicCodes: [],
        officePostcode: postcode,
        officeOutcode: postcode.split(" ")[0] ?? null,
        accountsType: null,
        accountsMadeUpTo: null,
      },
      NOW,
    );
    await recordLink(db, {
      companyId: company!.id,
      registry: "companies_house",
      registryId: number,
      registryName: `COMPANY ${i} LTD`,
      method: "manual",
      reason: "test",
      decidedBy: "manual",
      now: NOW,
    });
  }
}

describe("isSharedAddress", () => {
  it("uses a threshold of 20", () => {
    expect(SHARED_ADDRESS_THRESHOLD).toBe(20);
  });

  it("formats a postcode for the cache key", () => {
    expect(formatPostcode("ec2a4ne")).toBe("EC2A 4NE");
    expect(formatPostcode("not a postcode")).toBeNull();
  });

  it("counts 25 active companies as shared, caches it and reuses it within 180 days", async () => {
    const client = fakeChClient({ postcodeCounts: { "EC2A 4NE": 25 } });
    expect(await isSharedAddress(db, client, "ec2a 4ne", NOW)).toBe(true);
    expect(client.requestsMade()).toBe(1);
    const rows = await db.select().from(chAddressCounts);
    expect(rows).toEqual([
      { postcode: "EC2A 4NE", activeCompanies: 25, checkedAt: NOW },
    ]);

    const later = new Date(NOW.getTime() + 179 * DAY_MS);
    expect(await isSharedAddress(db, client, "EC2A 4NE", later)).toBe(true);
    expect(client.requestsMade()).toBe(1);

    const stale = new Date(NOW.getTime() + 181 * DAY_MS);
    await isSharedAddress(db, client, "EC2A 4NE", stale);
    expect(client.requestsMade()).toBe(2);
  });

  it("is not shared below 20", async () => {
    const client = fakeChClient({ postcodeCounts: { "LS1 4AP": 19 } });
    expect(await isSharedAddress(db, client, "LS1 4AP", NOW)).toBe(false);
  });

  it("falls back to 3 or more linked companies when counting is unavailable", async () => {
    const client = fakeChClient({ postcodeCounts: {} });
    await linkedAt("M1 1AE", 2);
    expect(await isSharedAddress(db, client, "M1 1AE", NOW)).toBe(false);
    await linkedAt("M1 1AE", 1);
    expect(await isSharedAddress(db, client, "M11AE", NOW)).toBe(true);
    // Nothing is cached when Companies House gave no count.
    expect(await db.select().from(chAddressCounts)).toEqual([]);
  });

  it("never treats a partial postcode as shared and makes no request", async () => {
    const client = fakeChClient();
    expect(await isSharedAddress(db, client, "EC2A", NOW)).toBe(false);
    expect(client.requestsMade()).toBe(0);
  });
});
