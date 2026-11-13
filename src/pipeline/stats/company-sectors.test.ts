import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  chCompanies,
  companies,
  companySectors,
  companyThemes,
  EMBEDDING_DIMENSIONS,
  registryLinks,
  tags,
  themes,
} from "@/db/schema";
import { insertCompany } from "@/pipeline/resolve/testing";
import { rebuildCompanySectors } from "./company-sectors";

let testDb: TestDb;
let db: Db;
let nextNumber: number;

const clock: Clock = { now: () => new Date("2026-11-12T12:00:00Z") };
const NONE = { inserted: 0, updated: 0, deleted: 0 };

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  nextNumber = 0;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function addTheme(slug: string, sector: string | null): Promise<number> {
  const [tag] = await db
    .insert(tags)
    .values({ slug, label: slug })
    .returning({ id: tags.id });
  const [row] = await db
    .insert(themes)
    .values({
      slug,
      name: slug,
      sector,
      seedTagId: tag?.id as number,
      centroid: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1),
      embeddingModel: "test-embedding",
    })
    .returning({ id: themes.id });
  return row?.id as number;
}

async function putInTheme(companyId: number, themeId: number): Promise<void> {
  await db.insert(companyThemes).values({ companyId, themeId, tagCount: 1 });
}

async function linkSic(
  companyId: number,
  sicCodes: string[],
  status: "linked" | "candidate" = "linked",
): Promise<void> {
  nextNumber += 1;
  const number = String(20_000_000 + nextNumber);
  await db.insert(chCompanies).values({
    companyNumber: number,
    name: "ACME LTD",
    status: "active",
    companyType: "ltd",
    incorporatedOn: "2022-06-01",
    sicCodes,
  });
  await db.insert(registryLinks).values({
    companyId,
    registry: "companies_house",
    registryId: number,
    registryName: "ACME LTD",
    status,
    method: status === "linked" ? "name_filing" : null,
    reason: "test",
    decidedBy: "auto",
  });
}

async function sectorRows() {
  return db
    .select()
    .from(companySectors)
    .orderBy(asc(companySectors.companyId), asc(companySectors.sector));
}

const run = (force = false) => rebuildCompanySectors({ db, clock, force });

describe("rebuildCompanySectors", () => {
  it("gives a company with a theme sector only theme sectors, even with SIC codes", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    const theme = await addTheme("battery-tech", "climate-energy");
    await putInTheme(company.id, theme);
    await linkSic(company.id, ["62012"]);
    const stats = await run();

    expect(await sectorRows()).toEqual([
      { companyId: company.id, sector: "climate-energy", source: "theme" },
    ]);
    expect(stats.rowsBySource).toEqual({ theme: 1, sic: 0 });
    expect(stats.written).toEqual({ inserted: 1, updated: 0, deleted: 0 });
  });

  it("gives a company with no theme its SIC sectors", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    await linkSic(company.id, ["62012", "21100", "62020"]);
    await run();

    expect(await sectorRows()).toEqual([
      { companyId: company.id, sector: "health-life-sciences", source: "sic" },
      { companyId: company.id, sector: "software-ai", source: "sic" },
    ]);
  });

  it("gives a company whose themes have no sector its SIC sectors", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    const theme = await addTheme("misc", null);
    await putInTheme(company.id, theme);
    await linkSic(company.id, ["62012"]);
    await run();

    expect(await sectorRows()).toEqual([
      { companyId: company.id, sector: "software-ai", source: "sic" },
    ]);
  });

  it("gives no row for vague SIC codes", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    await linkSic(company.id, ["70229", "74909", "82990", "99999"]);
    await run();

    expect(await sectorRows()).toEqual([]);
  });

  it("uses only linked Companies House rows", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    await linkSic(company.id, ["62012"], "candidate");
    await run();

    expect(await sectorRows()).toEqual([]);
  });

  it("gives no row to a merged company", async () => {
    const target = await insertCompany(db, { name: "Target" });
    const merged = await insertCompany(db, {
      name: "Merged",
      mergedIntoId: target.id,
    });
    const theme = await addTheme("battery-tech", "climate-energy");
    await putInTheme(merged.id, theme);
    await linkSic(merged.id, ["62012"]);
    await run();

    expect(await sectorRows()).toEqual([]);
  });

  it("writes nothing on a second run, forced or not", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    await linkSic(company.id, ["62012"]);
    await run();
    const before = await sectorRows();

    const second = await run();
    expect(second.skipped).toBe(true);
    expect(second.written).toEqual(NONE);

    const forced = await run(true);
    expect(forced.skipped).toBeUndefined();
    expect(forced.written).toEqual(NONE);
    expect(await sectorRows()).toEqual(before);
  });

  it("moves sectors to the new theme on the next rebuild after a merge", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    const from = await addTheme("old-theme", "climate-energy");
    const into = await addTheme("new-theme", "space-deep-tech");
    await putInTheme(company.id, from);
    await run();
    expect((await sectorRows())[0]?.sector).toBe("climate-energy");

    await db
      .update(themes)
      .set({ status: "merged", mergedIntoId: into })
      .where(eq(themes.id, from));
    const stats = await run();

    expect(stats.written).toEqual({ inserted: 1, updated: 0, deleted: 1 });
    expect(await sectorRows()).toEqual([
      { companyId: company.id, sector: "space-deep-tech", source: "theme" },
    ]);
  });

  it("rebuilds when a theme gains a sector, and when SIC codes change", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    const theme = await addTheme("misc", null);
    await putInTheme(company.id, theme);
    await linkSic(company.id, ["62012"]);
    await run();

    await db
      .update(themes)
      .set({ sector: "education" })
      .where(eq(themes.id, theme));
    await run();
    expect(await sectorRows()).toEqual([
      { companyId: company.id, sector: "education", source: "theme" },
    ]);

    await db.delete(companyThemes).where(eq(companyThemes.themeId, theme));
    await db
      .update(chCompanies)
      .set({ sicCodes: ["21100"] })
      .where(eq(chCompanies.companyNumber, "20000001"));
    await run();
    expect(await sectorRows()).toEqual([
      { companyId: company.id, sector: "health-life-sciences", source: "sic" },
    ]);
  });

  it("leaves the company row alone", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    await linkSic(company.id, ["62012"]);
    await run();
    const [row] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, company.id));
    expect(row).toEqual(company);
  });
});
