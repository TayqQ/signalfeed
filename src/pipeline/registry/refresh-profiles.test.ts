import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LinkDecidedBy } from "@/core/enums";
import type { CapitalFiling, RegistryCompanyFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import {
  chCompanies,
  chFilings,
  companies,
  events,
  fundingRounds,
  registryLinks,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { recordLink } from "./link-store";
import { profilesDue, refreshProfiles } from "./refresh-profiles";
import { storeChCompany } from "./store-registry";
import { fakeChClient } from "./testing";

const NOW = new Date("2026-11-12T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const NUMBER = "13579246";

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
    companyNumber: NUMBER,
    name: "BRIGHTWELL ROBOTICS LTD",
    previousNames: [],
    status: "active",
    companyType: "ltd",
    incorporatedOn: "2022-06-01",
    ceasedOn: null,
    sicCodes: ["62012"],
    officePostcode: "LS1 4AP",
    officeOutcode: "LS1",
    accountsType: null,
    accountsMadeUpTo: null,
    etag: "etag-1",
    ...overrides,
  };
}

const DISSOLVED = profile({
  status: "dissolved",
  ceasedOn: "2026-06-01",
  etag: "etag-2",
});

function sh01(actionDate: string): CapitalFiling {
  return {
    transactionId: `t-${actionDate}`,
    type: "SH01",
    filedOn: actionDate,
    actionDate,
    capital: null,
  };
}

/** A company linked to NUMBER, its profile fetched `ageDays` ago, with rounds. */
async function linkedCompany(options: {
  decidedBy: LinkDecidedBy;
  ageDays: number | null;
  rounds: string[];
}) {
  const [company] = await db
    .insert(companies)
    .values({
      slug: "brightwell",
      name: "Brightwell Robotics",
      normalisedName: "brightwell robotics",
      countryCode: "GB",
    })
    .returning();
  for (const announcedOn of options.rounds) {
    const [event] = await db
      .insert(events)
      .values({ type: "funding_round", companyId: company!.id, announcedOn })
      .returning();
    await db
      .insert(fundingRounds)
      .values({ eventId: event!.id, roundType: "seed" });
  }
  await recordLink(db, {
    companyId: company!.id,
    registry: "companies_house",
    registryId: NUMBER,
    registryName: "BRIGHTWELL ROBOTICS LTD",
    method: options.decidedBy === "manual" ? "manual" : "name_filing",
    reason: "test",
    decidedBy: options.decidedBy,
    now: NOW,
  });
  if (options.ageDays !== null) {
    await storeChCompany(
      db,
      profile(),
      new Date(NOW.getTime() - options.ageDays * DAY_MS),
    );
  }
  return company!;
}

async function linkRow(companyId: number) {
  const [row] = await db
    .select()
    .from(registryLinks)
    .where(eq(registryLinks.companyId, companyId));
  return row!;
}

async function companyRow(id: number) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  return row!;
}

describe("profilesDue", () => {
  it("is due when never fetched or older than 90 days", async () => {
    await linkedCompany({ decidedBy: "auto", ageDays: 91, rounds: [] });
    expect(await profilesDue(db, NOW)).toHaveLength(1);
  });

  it("is not due within 90 days without a recent round", async () => {
    await linkedCompany({
      decidedBy: "auto",
      ageDays: 30,
      rounds: ["2025-01-10"],
    });
    expect(await profilesDue(db, NOW)).toEqual([]);
  });

  it("is due weekly with an unconfirmed equity round in the last 120 days", async () => {
    await linkedCompany({
      decidedBy: "auto",
      ageDays: 8,
      rounds: ["2026-09-20"],
    });
    expect(await profilesDue(db, NOW)).toEqual([
      expect.objectContaining({ companyNumber: NUMBER, recentRound: true }),
    ]);
    const sixDays = new Date(NOW.getTime() - 2 * DAY_MS);
    expect(await profilesDue(db, sixDays)).toEqual([]);
  });
});

describe("refreshProfiles", () => {
  it("demotes an automatic link when the company dissolved before a later round", async () => {
    const company = await linkedCompany({
      decidedBy: "auto",
      ageDays: 100,
      rounds: ["2024-03-10", "2026-09-01"],
    });
    expect((await companyRow(company.id)).ukCompanyNumber).toBe(NUMBER);
    const client = fakeChClient({ companies: [DISSOLVED] });
    const stats = await refreshProfiles({
      db,
      client,
      now: NOW,
      maxRequests: 10,
    });
    expect(stats.profilesRefreshed).toBe(1);
    const link = await linkRow(company.id);
    expect(link.status).toBe("candidate");
    expect(link.reason).toContain("closed too early");
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
    const [stored] = await db.select().from(chCompanies);
    expect(stored?.status).toBe("dissolved");
  });

  it("never demotes a manual link", async () => {
    const company = await linkedCompany({
      decidedBy: "manual",
      ageDays: 100,
      rounds: ["2026-09-01"],
    });
    const client = fakeChClient({ companies: [DISSOLVED] });
    await refreshProfiles({ db, client, now: NOW, maxRequests: 10 });
    const link = await linkRow(company.id);
    expect(link.status).toBe("linked");
    expect((await companyRow(company.id)).ukCompanyNumber).toBe(NUMBER);
  });

  it("fetches new capital filings for a recent unconfirmed round and fills the founded year", async () => {
    const company = await linkedCompany({
      decidedBy: "manual",
      ageDays: null,
      rounds: ["2026-10-01"],
    });
    const client = fakeChClient({
      companies: [profile()],
      filings: { [NUMBER]: [sh01("2026-09-15")] },
    });
    const stats = await refreshProfiles({
      db,
      client,
      now: NOW,
      maxRequests: 10,
    });
    expect(stats.filingsStored).toBe(1);
    expect(await db.select().from(chFilings)).toHaveLength(1);
    const row = await companyRow(company.id);
    expect(row.foundedYear).toBe(2022);
    expect(row.foundedYearSource).toBe("companies_house");
  });

  it("makes no request when nothing is due", async () => {
    await linkedCompany({ decidedBy: "auto", ageDays: 10, rounds: [] });
    const client = fakeChClient({ companies: [profile()] });
    await refreshProfiles({ db, client, now: NOW, maxRequests: 10 });
    expect(client.requestsMade()).toBe(0);
  });

  it("stops at the request limit", async () => {
    await linkedCompany({
      decidedBy: "auto",
      ageDays: null,
      rounds: ["2026-10-01"],
    });
    const client = fakeChClient({ companies: [profile()] });
    const stats = await refreshProfiles({
      db,
      client,
      now: NOW,
      maxRequests: 1,
    });
    expect(client.requestsMade()).toBe(1);
    expect(stats.stoppedAtLimit).toBe(true);
  });
});
