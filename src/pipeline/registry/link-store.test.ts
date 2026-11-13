import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  mergeCandidates,
  registryLinks,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  demoteAutoLink,
  type LinkInput,
  recordCandidate,
  recordLink,
  recordSearch,
  rejectLink,
  searchIsDue,
  unlink,
} from "./link-store";

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

async function insertCompany(
  slug: string,
  values: Partial<typeof companies.$inferInsert> = {},
) {
  const [company] = await db
    .insert(companies)
    .values({
      slug,
      name: "Brightwell Robotics",
      normalisedName: "brightwell robotics",
      countryCode: "GB",
      ...values,
    })
    .returning();
  return company!;
}

async function companyRow(id: number) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  return row!;
}

async function links() {
  return db.select().from(registryLinks).orderBy(asc(registryLinks.id));
}

async function aliases(companyId: number) {
  return db
    .select()
    .from(companyAliases)
    .where(eq(companyAliases.companyId, companyId));
}

function chLink(companyId: number, overrides: Partial<LinkInput> = {}) {
  return {
    companyId,
    registry: "companies_house",
    registryId: "09876543",
    registryName: "BRIGHTWELL ROBOTICS LTD",
    method: "name_filing",
    reason: "exact name; SH01 36 days before the round",
    decidedBy: "auto",
    now: NOW,
    ...overrides,
  } satisfies LinkInput;
}

describe("recordLink", () => {
  it("fills the empty column and adds one registry alias", async () => {
    const company = await insertCompany("brightwell-robotics");

    const result = await recordLink(db, chLink(company.id));

    expect(result).toEqual({
      outcome: "linked",
      companyId: company.id,
      changed: true,
    });
    expect((await companyRow(company.id)).ukCompanyNumber).toBe("09876543");
    expect(await aliases(company.id)).toEqual([
      expect.objectContaining({
        alias: "BRIGHTWELL ROBOTICS LTD",
        normalisedAlias: "brightwell robotics",
        source: "registry",
      }),
    ]);
    expect(await links()).toEqual([
      expect.objectContaining({
        companyId: company.id,
        registryId: "09876543",
        status: "linked",
        method: "name_filing",
        decidedBy: "auto",
        decidedAt: NOW,
      }),
    ]);
  });

  it("changes nothing on a second identical call", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(db, chLink(company.id));
    const before = {
      links: await links(),
      company: await companyRow(company.id),
      aliases: await aliases(company.id),
    };

    const later = new Date(NOW.getTime() + DAY_MS);
    const result = await recordLink(db, chLink(company.id, { now: later }));

    expect(result).toMatchObject({ outcome: "linked", changed: false });
    expect({
      links: await links(),
      company: await companyRow(company.id),
      aliases: await aliases(company.id),
    }).toEqual(before);
  });

  it("normalises the number and fills sec_cik for EDGAR", async () => {
    const company = await insertCompany("orbital-forge", {
      name: "Orbital Forge",
      normalisedName: "orbital forge",
      countryCode: "US",
    });

    await recordLink(db, {
      companyId: company.id,
      registry: "sec_edgar",
      registryId: "0001999999",
      registryName: "Orbital Forge, Inc.",
      method: "form_d_round",
      reason: "exact name; Form D confirms the seed",
      decidedBy: "auto",
      now: NOW,
    });

    const row = await companyRow(company.id);
    expect(row.secCik).toBe("1999999");
    expect(row.ukCompanyNumber).toBeNull();
    expect((await links())[0]).toMatchObject({ registryId: "1999999" });
  });

  it("leaves a column that already holds another number", async () => {
    const company = await insertCompany("brightwell-robotics", {
      ukCompanyNumber: "01234567",
    });

    await recordLink(db, chLink(company.id));

    expect((await companyRow(company.id)).ukCompanyNumber).toBe("01234567");
  });

  it("throws on a value that is not a registry number", async () => {
    const company = await insertCompany("brightwell-robotics");

    await expect(
      recordLink(db, chLink(company.id, { registryId: "not a number" })),
    ).rejects.toThrow(/Invalid companies_house number/);
    expect(await links()).toEqual([]);
  });

  it("makes a candidate and one merge candidate when another company holds the number in its column", async () => {
    const holder = await insertCompany("acme-bio", {
      name: "Acme Bio",
      normalisedName: "acme bio",
      ukCompanyNumber: "09876543",
    });
    const other = await insertCompany("acmebio", {
      name: "AcmeBio",
      normalisedName: "acmebio",
    });

    const first = await recordLink(db, chLink(other.id));
    const second = await recordLink(db, chLink(other.id));

    expect(first).toEqual({
      outcome: "taken",
      companyId: other.id,
      holderCompanyId: holder.id,
    });
    expect(second).toEqual(first);
    expect(await links()).toEqual([
      expect.objectContaining({
        companyId: other.id,
        registryId: "09876543",
        status: "candidate",
        method: null,
      }),
    ]);
    expect(await db.select().from(mergeCandidates)).toEqual([
      expect.objectContaining({
        entityType: "company",
        leftId: holder.id,
        rightId: other.id,
        reason: "same Companies House number",
        status: "open",
      }),
    ]);
    expect((await companyRow(other.id)).ukCompanyNumber).toBeNull();
    expect(await aliases(other.id)).toEqual([]);
  });

  it("makes a candidate when another company holds the number as a link", async () => {
    const holder = await insertCompany("orbital-forge", { countryCode: "US" });
    const other = await insertCompany("orbitalforge", { countryCode: "US" });
    const formD = {
      registry: "sec_edgar",
      registryId: "1999999",
      registryName: "Orbital Forge, Inc.",
      method: "form_d_round",
      reason: "exact name; Form D confirms the seed",
      decidedBy: "auto",
      now: NOW,
    } as const;
    await recordLink(db, { ...formD, companyId: holder.id });

    const result = await recordLink(db, { ...formD, companyId: other.id });

    expect(result).toMatchObject({
      outcome: "taken",
      holderCompanyId: holder.id,
    });
    expect((await links()).map((row) => [row.companyId, row.status])).toEqual([
      [holder.id, "linked"],
      [other.id, "candidate"],
    ]);
    const [merge] = await db.select().from(mergeCandidates);
    expect(merge).toMatchObject({ reason: "same SEC CIK" });
  });

  it("refuses a manual link to a number another company holds and writes nothing", async () => {
    const holder = await insertCompany("acme-bio", {
      ukCompanyNumber: "09876543",
    });
    const other = await insertCompany("acmebio");

    const result = await recordLink(
      db,
      chLink(other.id, { decidedBy: "manual", method: "manual" }),
    );

    expect(result).toMatchObject({
      outcome: "taken",
      holderCompanyId: holder.id,
    });
    expect(await links()).toEqual([]);
    expect(await db.select().from(mergeCandidates)).toEqual([]);
  });

  it("never lets a manual rejection be undone by an automatic link", async () => {
    const company = await insertCompany("nova", {
      name: "Nova",
      normalisedName: "nova",
    });
    await rejectLink(db, {
      companyId: company.id,
      registry: "companies_house",
      registryId: "09876543",
      registryName: "NOVA LTD",
      reason: "a different, older company",
      now: NOW,
    });

    const result = await recordLink(db, chLink(company.id));

    expect(result).toEqual({ outcome: "blocked", companyId: company.id });
    expect(await links()).toEqual([
      expect.objectContaining({ status: "rejected", decidedBy: "manual" }),
    ]);
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
  });

  it("never replaces a manual link with an automatic one", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(
      db,
      chLink(company.id, {
        decidedBy: "manual",
        method: "manual",
        reason: "checked by hand",
      }),
    );

    const other = await recordLink(
      db,
      chLink(company.id, { registryId: "01234567" }),
    );
    const same = await recordLink(db, chLink(company.id));

    expect(other).toEqual({ outcome: "blocked", companyId: company.id });
    expect(same).toEqual({ outcome: "blocked", companyId: company.id });
    expect(await links()).toEqual([
      expect.objectContaining({
        registryId: "09876543",
        status: "linked",
        method: "manual",
        decidedBy: "manual",
        reason: "checked by hand",
      }),
    ]);
  });

  it("keeps an automatic link and records another number as a candidate", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(db, chLink(company.id));

    const result = await recordLink(
      db,
      chLink(company.id, { registryId: "01234567" }),
    );

    expect(result).toEqual({
      outcome: "already_linked",
      companyId: company.id,
      linkedRegistryId: "09876543",
    });
    expect((await links()).map((row) => [row.registryId, row.status])).toEqual([
      ["09876543", "linked"],
      ["01234567", "candidate"],
    ]);
  });

  it("turns a candidate into a link", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordCandidate(db, {
      companyId: company.id,
      registry: "companies_house",
      registryId: "09876543",
      registryName: "BRIGHTWELL ROBOTICS LTD",
      reason: "exact name, no signal",
      now: NOW,
    });

    await recordLink(db, chLink(company.id));

    expect(await links()).toEqual([
      expect.objectContaining({ status: "linked", method: "name_filing" }),
    ]);
  });

  it("lets a person confirm an automatic link", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(db, chLink(company.id));

    const result = await recordLink(
      db,
      chLink(company.id, { decidedBy: "manual", method: "manual" }),
    );

    expect(result).toMatchObject({ outcome: "linked", changed: true });
    expect(await links()).toEqual([
      expect.objectContaining({ decidedBy: "manual", method: "manual" }),
    ]);
  });
});

describe("recordCandidate", () => {
  it("inserts a candidate only when no row exists for that number", async () => {
    const first = await insertCompany("acme-bio");
    const second = await insertCompany("acmebio");
    const input = {
      registry: "companies_house",
      registryId: "9876543",
      registryName: "ACME BIO LTD",
      reason: "exact name, no signal",
      now: NOW,
    } as const;

    expect(await recordCandidate(db, { ...input, companyId: first.id })).toBe(
      true,
    );
    expect(await recordCandidate(db, { ...input, companyId: first.id })).toBe(
      false,
    );
    expect(await recordCandidate(db, { ...input, companyId: second.id })).toBe(
      true,
    );
    await rejectLink(db, {
      ...input,
      companyId: first.id,
      reason: "wrong company",
    });
    expect(await recordCandidate(db, { ...input, companyId: first.id })).toBe(
      false,
    );

    expect(
      (await links()).map((row) => [row.companyId, row.registryId, row.status]),
    ).toEqual([
      [first.id, "09876543", "rejected"],
      [second.id, "09876543", "candidate"],
    ]);
    expect(await db.select().from(mergeCandidates)).toEqual([]);
  });
});

describe("rejectLink and unlink", () => {
  it("rejecting a linked number clears the column", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(db, chLink(company.id));

    const previous = await rejectLink(db, {
      companyId: company.id,
      registry: "companies_house",
      registryId: "09876543",
      reason: "wrong company",
      now: NOW,
    });

    expect(previous).toBe("linked");
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
  });

  it("needs a registry name to reject a number with no row", async () => {
    const company = await insertCompany("brightwell-robotics");

    await expect(
      rejectLink(db, {
        companyId: company.id,
        registry: "companies_house",
        registryId: "09876543",
        reason: "wrong company",
        now: NOW,
      }),
    ).rejects.toThrow(/registry name/);
  });

  it("unlink clears the column it filled and blocks the same automatic link", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(db, chLink(company.id));

    const unlinked = await unlink(db, {
      companyId: company.id,
      registry: "companies_house",
      reason: "linked by mistake",
      now: NOW,
    });

    expect(unlinked).toBe("09876543");
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
    expect(await links()).toEqual([
      expect.objectContaining({ status: "rejected", decidedBy: "manual" }),
    ]);
    expect(await recordLink(db, chLink(company.id))).toMatchObject({
      outcome: "blocked",
    });
  });

  it("unlink leaves a column that holds another number", async () => {
    const company = await insertCompany("brightwell-robotics", {
      ukCompanyNumber: "01234567",
    });
    await recordLink(db, chLink(company.id));

    await unlink(db, {
      companyId: company.id,
      registry: "companies_house",
      reason: "linked by mistake",
      now: NOW,
    });

    expect((await companyRow(company.id)).ukCompanyNumber).toBe("01234567");
  });

  it("unlink returns null when there is no link", async () => {
    const company = await insertCompany("brightwell-robotics");

    expect(
      await unlink(db, {
        companyId: company.id,
        registry: "companies_house",
        reason: "nothing to do",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("demoteAutoLink", () => {
  it("turns an automatic link into a candidate and clears the column", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(db, chLink(company.id));

    const result = await demoteAutoLink(db, {
      companyId: company.id,
      registry: "companies_house",
      reason: "dissolved before the latest round",
      now: NOW,
    });

    expect(result).toEqual({
      outcome: "demoted",
      companyId: company.id,
      registryId: "09876543",
    });
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
    expect(await links()).toEqual([
      expect.objectContaining({
        status: "candidate",
        method: null,
        decidedBy: "auto",
        reason: "dissolved before the latest round",
      }),
    ]);
  });

  it("refuses a manual link", async () => {
    const company = await insertCompany("brightwell-robotics");
    await recordLink(
      db,
      chLink(company.id, { decidedBy: "manual", method: "manual" }),
    );

    const result = await demoteAutoLink(db, {
      companyId: company.id,
      registry: "companies_house",
      reason: "dissolved before the latest round",
      now: NOW,
    });

    expect(result).toEqual({ outcome: "manual", companyId: company.id });
    expect((await companyRow(company.id)).ukCompanyNumber).toBe("09876543");
    expect((await links())[0]).toMatchObject({ status: "linked" });
  });

  it("reports when there is no link", async () => {
    const company = await insertCompany("brightwell-robotics");

    expect(
      await demoteAutoLink(db, {
        companyId: company.id,
        registry: "sec_edgar",
        reason: "conflict",
        now: NOW,
      }),
    ).toEqual({ outcome: "not_linked", companyId: company.id });
  });
});

describe("searchIsDue", () => {
  it("is due when never searched, when the fingerprint changes, or after 90 days", async () => {
    const company = await insertCompany("brightwell-robotics");
    const due = (fingerprint: string, now: Date) =>
      searchIsDue(db, company.id, "companies_house", fingerprint, now);

    expect(await due("abc", NOW)).toBe(true);

    await recordSearch(db, {
      companyId: company.id,
      registry: "companies_house",
      outcome: "none",
      inputFingerprint: "abc",
      now: NOW,
    });

    expect(await due("abc", NOW)).toBe(false);
    expect(await due("abd", NOW)).toBe(true);
    expect(await due("abc", new Date(NOW.getTime() + 89 * DAY_MS))).toBe(false);
    expect(await due("abc", new Date(NOW.getTime() + 90 * DAY_MS))).toBe(true);
    expect(await searchIsDue(db, company.id, "sec_edgar", "abc", NOW)).toBe(
      true,
    );
  });

  it("replaces the earlier search", async () => {
    const company = await insertCompany("brightwell-robotics");
    const later = new Date(NOW.getTime() + 100 * DAY_MS);
    await recordSearch(db, {
      companyId: company.id,
      registry: "companies_house",
      outcome: "none",
      inputFingerprint: "abc",
      now: NOW,
    });
    await recordSearch(db, {
      companyId: company.id,
      registry: "companies_house",
      outcome: "candidates",
      inputFingerprint: "abd",
      now: later,
    });

    expect(
      await searchIsDue(db, company.id, "companies_house", "abd", later),
    ).toBe(false);
  });
});

describe("merged companies", () => {
  it("act on the survivor", async () => {
    const survivor = await insertCompany("brightwell-robotics");
    const middle = await insertCompany("brightwell", {
      mergedIntoId: survivor.id,
    });
    const merged = await insertCompany("brightwell-robotics-ltd", {
      mergedIntoId: middle.id,
    });

    const result = await recordLink(db, chLink(merged.id));
    await recordSearch(db, {
      companyId: merged.id,
      registry: "companies_house",
      outcome: "linked",
      inputFingerprint: "abc",
      now: NOW,
    });

    expect(result).toMatchObject({
      outcome: "linked",
      companyId: survivor.id,
    });
    expect((await links())[0]).toMatchObject({ companyId: survivor.id });
    expect((await companyRow(survivor.id)).ukCompanyNumber).toBe("09876543");
    expect((await companyRow(merged.id)).ukCompanyNumber).toBeNull();
    expect(await aliases(survivor.id)).toHaveLength(1);
    expect(
      await searchIsDue(db, survivor.id, "companies_house", "abc", NOW),
    ).toBe(false);

    expect(
      await demoteAutoLink(db, {
        companyId: merged.id,
        registry: "companies_house",
        reason: "conflict",
        now: NOW,
      }),
    ).toMatchObject({ outcome: "demoted", companyId: survivor.id });
    expect(
      await recordCandidate(db, {
        companyId: merged.id,
        registry: "companies_house",
        registryId: "01234567",
        registryName: "BRIGHTWELL LTD",
        reason: "exact name, no signal",
        now: NOW,
      }),
    ).toBe(true);
    expect((await links()).every((row) => row.companyId === survivor.id)).toBe(
      true,
    );
  });
});
