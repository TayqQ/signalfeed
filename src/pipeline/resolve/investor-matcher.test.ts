import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { investorAliases, investors, mergeCandidates } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { resolveInvestor } from "./investor-matcher";
import { insertInvestor, investorFacts } from "./testing";

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function investor(id: number) {
  const [row] = await db.select().from(investors).where(eq(investors.id, id));
  if (!row) throw new Error(`No investor ${id}`);
  return row;
}

async function aliasesOf(id: number): Promise<string[]> {
  const rows = await db
    .select({ alias: investorAliases.alias })
    .from(investorAliases)
    .where(eq(investorAliases.investorId, id))
    .orderBy(asc(investorAliases.id));
  return rows.map((row) => row.alias);
}

async function candidates() {
  return db.select().from(mergeCandidates).orderBy(asc(mergeCandidates.id));
}

describe("resolveInvestor", () => {
  it("creates an investor with a slug and alias", async () => {
    const result = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Capital", kind: "vc" }),
    );
    expect(result).toEqual({
      investorId: result.investorId,
      created: true,
      matchedBy: "new",
    });
    expect(result.investorId).toBeGreaterThan(0);
    expect(await investor(result.investorId)).toMatchObject({
      slug: "northwind-capital",
      name: "Northwind Capital",
      normalisedName: "northwind capital",
      kind: "vc",
      mergedIntoId: null,
    });
    expect(await aliasesOf(result.investorId)).toEqual(["Northwind Capital"]);
  });

  it("matches on an exact alias", async () => {
    const existing = await insertInvestor(db, { name: "Northwind Capital" });
    await db.insert(investorAliases).values({
      investorId: existing.id,
      alias: "NWC",
      normalisedAlias: "nwc",
      source: "manual",
    });

    const result = await resolveInvestor(db, investorFacts({ name: "NWC" }));
    expect(result).toEqual({
      investorId: existing.id,
      created: false,
      matchedBy: "exact_name",
    });
    expect(await aliasesOf(existing.id)).toEqual(["Northwind Capital", "NWC"]);
  });

  it("matches the exact normalised name without duplicating the alias", async () => {
    const existing = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Capital" }),
    );
    const result = await resolveInvestor(
      db,
      investorFacts({ name: "NORTHWIND CAPITAL LLC" }),
    );
    expect(result).toEqual({
      investorId: existing.investorId,
      created: false,
      matchedBy: "exact_name",
    });
    expect(await aliasesOf(existing.investorId)).toEqual(["Northwind Capital"]);
  });

  it("matches on domain even when the name differs", async () => {
    const existing = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Capital", websiteDomain: "nw.vc" }),
    );
    const result = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Growth Fund", websiteDomain: "nw.vc" }),
    );
    expect(result).toEqual({
      investorId: existing.investorId,
      created: false,
      matchedBy: "domain",
    });
  });

  it("creates a merge candidate for a similar name instead of merging", async () => {
    const existing = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Ventures" }),
    );
    const result = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Venture" }),
    );

    expect(result.created).toBe(true);
    expect(result.matchedBy).toBe("new");
    expect(result.investorId).not.toBe(existing.investorId);
    const [candidate, ...rest] = await candidates();
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({
      entityType: "investor",
      leftId: existing.investorId,
      rightId: result.investorId,
      status: "open",
    });
    expect(candidate?.score).toBeGreaterThanOrEqual(0.7);
    expect(candidate?.reason).toMatch(
      /^trigram 0\.\d\d to "northwind ventures"$/,
    );
  });

  it("records no candidate when names are not similar enough", async () => {
    await resolveInvestor(db, investorFacts({ name: "Northwind Ventures" }));
    await resolveInvestor(db, investorFacts({ name: "Southgate Partners" }));
    expect(await candidates()).toEqual([]);
  });

  it("fills an unknown kind but never replaces a known one", async () => {
    const unknown = await insertInvestor(db, {
      name: "Northwind Capital",
      kind: "unknown",
    });
    const known = await insertInvestor(db, {
      name: "Southgate Partners",
      kind: "corporate",
    });

    await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Capital", kind: "vc" }),
    );
    await resolveInvestor(
      db,
      investorFacts({ name: "Southgate Partners", kind: "vc" }),
    );
    await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Capital", kind: "unknown" }),
    );

    expect((await investor(unknown.id)).kind).toBe("vc");
    expect((await investor(known.id)).kind).toBe("corporate");
  });

  it("resolves an alias of a merged investor to the surviving investor", async () => {
    const survivor = await insertInvestor(db, { name: "Northwind Capital" });
    await insertInvestor(db, {
      name: "Northwind Seed",
      mergedIntoId: survivor.id,
    });

    const result = await resolveInvestor(
      db,
      investorFacts({ name: "Northwind Seed" }),
    );
    expect(result).toEqual({
      investorId: survivor.id,
      created: false,
      matchedBy: "exact_name",
    });
  });

  it("works inside a transaction", async () => {
    const result = await db.transaction((tx) =>
      resolveInvestor(tx, investorFacts()),
    );
    expect((await investor(result.investorId)).name).toBe("Example Ventures");
  });
});
