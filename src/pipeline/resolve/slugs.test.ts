import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { companies, investors } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { allocateSlug } from "./slugs";
import { insertCompany, insertInvestor } from "./testing";

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

describe("allocateSlug", () => {
  it("uses the slugified name when it is free", async () => {
    expect(await allocateSlug(db, companies, "Acme Robotics Ltd")).toBe(
      "acme-robotics-ltd",
    );
  });

  it("adds -2, then -3, when the slug is taken", async () => {
    await insertCompany(db, { name: "Acme" });
    expect(await allocateSlug(db, companies, "ACME")).toBe("acme-2");
    await insertCompany(db, { name: "Acme", slug: "acme-2" });
    expect(await allocateSlug(db, companies, "Acme")).toBe("acme-3");
  });

  it("fills the first gap in the sequence", async () => {
    await insertCompany(db, { name: "Acme" });
    await insertCompany(db, { name: "Acme", slug: "acme-3" });
    expect(await allocateSlug(db, companies, "Acme")).toBe("acme-2");
  });

  it("checks only the table it is given", async () => {
    await insertInvestor(db, { name: "Acme" });
    expect(await allocateSlug(db, companies, "Acme")).toBe("acme");
    expect(await allocateSlug(db, investors, "Acme")).toBe("acme-2");
  });

  it("keeps suffixed slugs within 60 characters", async () => {
    const name = "a".repeat(80);
    await insertCompany(db, { name });
    const slug = await allocateSlug(db, companies, name);
    expect(slug).toBe(`${"a".repeat(58)}-2`);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("falls back to the entity name when the name has no slug characters", async () => {
    expect(await allocateSlug(db, companies, "!!!")).toBe("company");
    expect(await allocateSlug(db, investors, "???")).toBe("investor");
  });

  it("scans past a full batch of taken suffixes", async () => {
    await insertCompany(db, { name: "Acme" });
    for (let n = 2; n <= 51; n += 1) {
      await insertCompany(db, { name: "Acme", slug: `acme-${n}` });
    }
    expect(await allocateSlug(db, companies, "Acme")).toBe("acme-52");
  });
});
