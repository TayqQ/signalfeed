import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoundType } from "@/core/enums";
import type { FormDFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  events,
  formDFilings,
  fundingRounds,
  mergeCandidates,
  registryLinks,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { normaliseCompanyName } from "@/lib/normalise";
import { recordLink } from "@/pipeline/registry/link-store";
import { linkFormDFilings } from "./link-form-d";
import { ensureEdgarSource, storeFormDFiling } from "./store-form-d";

const NOW = new Date("2026-11-12T15:00:00Z");

let testDb: TestDb;
let db: Db;
let slugCounter = 0;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

/** The worked example of spec-phase3 section 8.3. */
function orbitalForge(overrides: Partial<FormDFacts> = {}): FormDFacts {
  return {
    accessionNumber: "0001999999-26-000001",
    cik: "1999999",
    issuerName: "Orbital Forge, Inc.",
    entityType: "Corporation",
    issuerState: "CA",
    issuerCity: "San Francisco",
    yearOfInc: 2025,
    industryGroup: "Other Technology",
    isAmendment: false,
    dateOfFirstSale: "2026-01-05",
    totalOfferingUsdMinor: null,
    totalSoldUsdMinor: 440_000_000,
    filedOn: "2026-01-16",
    ...overrides,
  };
}

async function storeFiling(facts: FormDFacts) {
  const sourceId = await ensureEdgarSource(db);
  await storeFormDFiling(
    db,
    sourceId,
    { facts, isFund: false, previousAccessionNumber: null },
    NOW,
  );
}

async function insertCompany(
  name: string,
  values: Partial<typeof companies.$inferInsert> = {},
) {
  slugCounter += 1;
  const [row] = await db
    .insert(companies)
    .values({
      slug: `company-${slugCounter}`,
      name,
      normalisedName: normaliseCompanyName(name),
      countryCode: "US",
      ...values,
    })
    .returning();
  return row!;
}

async function addRound(
  companyId: number,
  announcedOn: string,
  amountUsdMinor: number | null,
  roundType: RoundType = "seed",
) {
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId,
      announcedOn,
      datePrecision: "day",
    })
    .returning();
  await db.insert(fundingRounds).values({
    eventId: event!.id,
    roundType,
    amountMinor: amountUsdMinor,
    currency: amountUsdMinor === null ? null : "USD",
    amountUsdMinor,
  });
  return event!;
}

async function filings() {
  return db.select().from(formDFilings).orderBy(asc(formDFilings.id));
}

async function links() {
  return db.select().from(registryLinks).orderBy(asc(registryLinks.id));
}

async function company(id: number) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  return row!;
}

describe("linkFormDFilings", () => {
  it("links the Orbital Forge example and fills the CIK and founded year", async () => {
    const orbital = await insertCompany("Orbital Forge");
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());
    await storeFiling(
      orbitalForge({
        accessionNumber: "0001999999-26-000002",
        isAmendment: true,
        yearOfInc: null,
        filedOn: "2026-03-02",
      }),
    );

    const stats = await linkFormDFilings({ db, now: NOW });

    expect(stats).toMatchObject({
      linkedByName: 1,
      linkedByCik: 0,
      candidates: 0,
    });
    expect(await links()).toMatchObject([
      {
        companyId: orbital.id,
        registry: "sec_edgar",
        registryId: "1999999",
        registryName: "Orbital Forge, Inc.",
        status: "linked",
        method: "form_d_round",
        decidedBy: "auto",
      },
    ]);
    expect(await company(orbital.id)).toMatchObject({
      secCik: "1999999",
      foundedYear: 2025,
      foundedYearSource: "sec_form_d",
    });
    for (const row of await filings()) {
      expect(row.companyId).toBe(orbital.id);
      expect(row.linkedAt).toEqual(NOW);
    }
    const aliases = await db.select().from(companyAliases);
    expect(aliases).toMatchObject([
      {
        companyId: orbital.id,
        alias: "Orbital Forge, Inc.",
        source: "registry",
      },
    ]);
  });

  it("keeps a founded year that news already gave", async () => {
    const orbital = await insertCompany("Orbital Forge", {
      foundedYear: 2024,
      foundedYearSource: "news",
    });
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());
    await linkFormDFilings({ db, now: NOW });
    expect(await company(orbital.id)).toMatchObject({
      secCik: "1999999",
      foundedYear: 2024,
      foundedYearSource: "news",
    });
  });

  it("does not link a company whose country is GB", async () => {
    const orbital = await insertCompany("Orbital Forge", { countryCode: "GB" });
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());

    const stats = await linkFormDFilings({ db, now: NOW });
    expect(stats).toMatchObject({ linkedByName: 0, candidates: 0 });
    expect(await links()).toEqual([]);
    expect((await filings())[0]?.companyId).toBeNull();
    expect((await company(orbital.id)).secCik).toBeNull();
  });

  it("gives new filings to the company already linked to the CIK", async () => {
    const holder = await insertCompany("Forge Holdings");
    await recordLink(db, {
      companyId: holder.id,
      registry: "sec_edgar",
      registryId: "1999999",
      registryName: "Orbital Forge, Inc.",
      method: "manual",
      reason: "test",
      decidedBy: "manual",
      now: NOW,
    });
    await storeFiling(orbitalForge());

    const stats = await linkFormDFilings({ db, now: NOW });
    expect(stats.linkedByCik).toBe(1);
    expect((await filings())[0]?.companyId).toBe(holder.id);
  });

  it("makes a merge candidate, not a link, when another company holds the CIK", async () => {
    const holder = await insertCompany("Forge Holdings");
    await recordLink(db, {
      companyId: holder.id,
      registry: "sec_edgar",
      registryId: "1999999",
      registryName: "Forge Holdings Inc",
      method: "manual",
      reason: "test",
      decidedBy: "manual",
      now: NOW,
    });
    const orbital = await insertCompany("Orbital Forge");
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());

    const stats = await linkFormDFilings({ db, now: NOW });

    expect(stats).toMatchObject({
      linkedByCik: 1,
      linkedByName: 0,
      candidates: 1,
    });
    expect((await filings())[0]?.companyId).toBe(holder.id);
    const rows = await links();
    expect(rows.filter((row) => row.status === "linked")).toMatchObject([
      { companyId: holder.id, registryId: "1999999" },
    ]);
    expect(rows.find((row) => row.companyId === orbital.id)).toMatchObject({
      status: "candidate",
      registryId: "1999999",
    });
    expect(await db.select().from(mergeCandidates)).toMatchObject([
      {
        entityType: "company",
        leftId: Math.min(holder.id, orbital.id),
        rightId: Math.max(holder.id, orbital.id),
        reason: "same SEC CIK",
      },
    ]);
    expect((await company(orbital.id)).secCik).toBeNull();
  });

  it("creates nothing for a common name with no round within 365 days", async () => {
    const atlas = await insertCompany("Atlas");
    await addRound(atlas.id, "2024-06-01", 300_000_000);
    await storeFiling(
      orbitalForge({ issuerName: "Atlas LLC", cik: "1888888" }),
    );

    const stats = await linkFormDFilings({ db, now: NOW });
    expect(stats).toMatchObject({ linkedByName: 0, candidates: 0 });
    expect(await links()).toEqual([]);
    expect(await db.select().from(mergeCandidates)).toEqual([]);
  });

  it("records a candidate for a round within 365 days that the Form D does not confirm", async () => {
    const orbital = await insertCompany("Orbital Forge");
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge({ totalSoldUsdMinor: 50_000_000 }));

    const first = await linkFormDFilings({ db, now: NOW });
    const second = await linkFormDFilings({ db, now: NOW });

    expect(first.candidates).toBe(1);
    expect(second.candidates).toBe(0);
    expect(await links()).toMatchObject([
      { companyId: orbital.id, status: "candidate", method: null },
    ]);
    expect((await filings())[0]?.companyId).toBeNull();
  });

  it("sends a trading-name prefix match to review, never to a link", async () => {
    const orbital = await insertCompany("Orbital");
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge({ issuerName: "Orbital Forge Labs, Inc." }));

    const stats = await linkFormDFilings({ db, now: NOW });

    expect(stats).toMatchObject({ linkedByName: 0, candidates: 1 });
    const rows = await links();
    expect(rows).toMatchObject([
      { companyId: orbital.id, status: "candidate", method: null },
    ]);
    expect(rows[0]?.reason).toContain("prefix");
    expect((await filings())[0]?.companyId).toBeNull();
    expect((await company(orbital.id)).secCik).toBeNull();
  });

  it("does not review a prefix match the filing does not confirm", async () => {
    const orbital = await insertCompany("Orbital");
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(
      orbitalForge({
        issuerName: "Orbital Forge Labs, Inc.",
        dateOfFirstSale: "2025-01-05",
      }),
    );
    await linkFormDFilings({ db, now: NOW });
    expect(await links()).toEqual([]);
  });

  it("leaves an unmatched filing alone until a company with its name appears", async () => {
    await storeFiling(orbitalForge());
    const before = await linkFormDFilings({ db, now: NOW });
    expect(before).toMatchObject({ linkedByName: 0, candidates: 0 });
    expect((await filings())[0]?.companyId).toBeNull();

    const company = await insertCompany("Forge Space");
    await addRound(company.id, "2026-02-18", 450_000_000);
    await db.insert(companyAliases).values({
      companyId: company.id,
      alias: "Orbital Forge",
      normalisedAlias: normaliseCompanyName("Orbital Forge"),
      source: "extraction",
    });

    const after = await linkFormDFilings({ db, now: NOW });
    expect(after.linkedByName).toBe(1);
    expect((await filings())[0]?.companyId).toBe(company.id);
  });

  it("ignores merged companies", async () => {
    const survivor = await insertCompany("Forge Space");
    const merged = await insertCompany("Orbital Forge", {
      mergedIntoId: survivor.id,
    });
    await addRound(merged.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());
    await linkFormDFilings({ db, now: NOW });
    expect(await links()).toEqual([]);
  });
});

describe("linkFormDFilings: country hints (D62)", () => {
  it("links a company with no country and a USD round, and records the hint", async () => {
    const orbital = await insertCompany("Orbital Forge", { countryCode: null });
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());

    const stats = await linkFormDFilings({ db, now: NOW });
    expect(stats.linkedByName).toBe(1);
    const [link] = await links();
    expect(link).toMatchObject({
      companyId: orbital.id,
      status: "linked",
      method: "form_d_round",
    });
    expect(link!.reason).toContain("searched on hint: usd; country not stated");
    // The country stays as news gave it: a hint is not a stated country.
    expect((await company(orbital.id)).countryCode).toBeNull();
  });

  it("adds no note for a company whose country is US", async () => {
    const orbital = await insertCompany("Orbital Forge");
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge());
    await linkFormDFilings({ db, now: NOW });
    const [link] = await links();
    expect(link!.reason).not.toContain("country not stated");
  });

  it("never links a company with no country on a prefix name", async () => {
    const orbital = await insertCompany("Orbital", { countryCode: null });
    await addRound(orbital.id, "2026-02-18", 450_000_000);
    await storeFiling(orbitalForge({ issuerName: "Orbital Labs, Inc." }));

    const stats = await linkFormDFilings({ db, now: NOW });
    expect(stats.linkedByName).toBe(0);
    const rows = await links();
    expect(rows.every((row) => row.status !== "linked")).toBe(true);
    expect((await company(orbital.id)).secCik).toBeNull();
  });
});
