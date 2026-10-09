import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  companyTags,
  mergeCandidates,
  tags,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { resolveCompany } from "./company-matcher";
import { addMergeCandidate } from "./merge-candidates";
import {
  companyFacts,
  corroboratesOnly,
  insertCompany,
  neverCorroborates,
  steppingClock,
} from "./testing";
import type { ResolveCompanyOptions } from "./types";

let testDb: TestDb;
let db: Db;
let options: ResolveCompanyOptions;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  options = { corroborates: neverCorroborates, clock: steppingClock() };
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function company(id: number) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  if (!row) throw new Error(`No company ${id}`);
  return row;
}

async function aliasesOf(id: number): Promise<string[]> {
  const rows = await db
    .select({ alias: companyAliases.alias })
    .from(companyAliases)
    .where(eq(companyAliases.companyId, id))
    .orderBy(asc(companyAliases.id));
  return rows.map((row) => row.alias);
}

async function candidates() {
  return db.select().from(mergeCandidates).orderBy(asc(mergeCandidates.id));
}

describe("resolveCompany: creating", () => {
  it("creates a company with its slug, alias and tags", async () => {
    const result = await resolveCompany(
      db,
      companyFacts({
        name: "Acme Robotics Ltd",
        websiteDomain: "acme.ai",
        description: "Warehouse robots.",
        countryCode: "GB",
        city: "London",
        foundedYear: 2021,
        tags: ["robotics", "logistics"],
      }),
      options,
    );

    expect(result).toEqual({
      companyId: result.companyId,
      created: true,
      matchedBy: "new",
    });
    expect(result.companyId).toBeGreaterThan(0);
    const row = await company(result.companyId);
    expect(row).toMatchObject({
      slug: "acme-robotics-ltd",
      name: "Acme Robotics Ltd",
      normalisedName: "acme robotics",
      websiteDomain: "acme.ai",
      description: "Warehouse robots.",
      countryCode: "GB",
      city: "London",
      foundedYear: 2021,
      foundedYearSource: "news",
      mergedIntoId: null,
    });
    expect(await aliasesOf(result.companyId)).toEqual(["Acme Robotics Ltd"]);
    const tagRows = await db.select().from(tags).orderBy(asc(tags.slug));
    expect(tagRows.map((tag) => tag.slug)).toEqual(["logistics", "robotics"]);
    expect(await candidates()).toEqual([]);
  });

  it("gives a second company with the same slug a -2 suffix", async () => {
    const first = await resolveCompany(
      db,
      companyFacts({ name: "Acme", countryCode: "GB" }),
      options,
    );
    const second = await resolveCompany(
      db,
      companyFacts({ name: "Acme", countryCode: "US" }),
      options,
    );
    expect((await company(first.companyId)).slug).toBe("acme");
    expect((await company(second.companyId)).slug).toBe("acme-2");
  });

  it("truncates descriptions to 200 characters", async () => {
    const result = await resolveCompany(
      db,
      companyFacts({ description: "x".repeat(250) }),
      options,
    );
    expect((await company(result.companyId)).description).toHaveLength(200);
  });

  it("works inside a transaction", async () => {
    const result = await db.transaction((tx) =>
      resolveCompany(tx, companyFacts({ tags: ["ai agents"] }), options),
    );
    expect((await company(result.companyId)).name).toBe("Acme");
  });
});

describe("resolveCompany: rule 1, domain", () => {
  it("matches on domain even when the name differs", async () => {
    const existing = await resolveCompany(
      db,
      companyFacts({ name: "Acme", websiteDomain: "acme.com" }),
      options,
    );
    const result = await resolveCompany(
      db,
      companyFacts({
        name: "Totally Different Holdings",
        websiteDomain: "acme.com",
        countryCode: "US",
      }),
      options,
    );

    expect(result).toEqual({
      companyId: existing.companyId,
      created: false,
      matchedBy: "domain",
    });
    expect(await aliasesOf(existing.companyId)).toEqual([
      "Acme",
      "Totally Different Holdings",
    ]);
  });

  it("follows the merge chain when the domain belongs to a merged company", async () => {
    const survivor = await insertCompany(db, { name: "Acme Group" });
    await insertCompany(db, {
      name: "Acme",
      websiteDomain: "acme.com",
      mergedIntoId: survivor.id,
    });

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme", websiteDomain: "acme.com" }),
      options,
    );
    expect(result).toEqual({
      companyId: survivor.id,
      created: false,
      matchedBy: "domain",
    });
  });
});

describe("resolveCompany: rule 2, exact name", () => {
  it('matches "Acme Ltd" to "ACME"', async () => {
    const existing = await resolveCompany(
      db,
      companyFacts({ name: "ACME" }),
      options,
    );
    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme Ltd" }),
      options,
    );

    expect(result).toEqual({
      companyId: existing.companyId,
      created: false,
      matchedBy: "exact_name",
    });
    expect(await aliasesOf(existing.companyId)).toEqual(["ACME"]);
  });

  it("matches on an alias", async () => {
    const existing = await insertCompany(db, { name: "Acme Robotics" });
    await db.insert(companyAliases).values({
      companyId: existing.id,
      alias: "AcmeBot",
      normalisedAlias: "acmebot",
      source: "manual",
    });

    const result = await resolveCompany(
      db,
      companyFacts({ name: "AcmeBot Inc." }),
      options,
    );
    expect(result).toEqual({
      companyId: existing.id,
      created: false,
      matchedBy: "exact_name",
    });
  });

  it("does not add a duplicate alias for a name it already knows", async () => {
    const existing = await resolveCompany(db, companyFacts(), options);
    await resolveCompany(db, companyFacts(), options);
    expect(await aliasesOf(existing.companyId)).toEqual(["Acme"]);
  });

  it('keeps "Acme" in GB and "Acme" in US apart and records a candidate', async () => {
    const gb = await resolveCompany(
      db,
      companyFacts({ name: "Acme", countryCode: "GB" }),
      options,
    );
    const us = await resolveCompany(
      db,
      companyFacts({ name: "Acme", countryCode: "US" }),
      options,
    );

    expect(us.created).toBe(true);
    expect(us.matchedBy).toBe("new");
    expect(us.companyId).not.toBe(gb.companyId);
    expect(await candidates()).toEqual([
      expect.objectContaining({
        entityType: "company",
        leftId: gb.companyId,
        rightId: us.companyId,
        score: 1,
        status: "open",
        reason: 'exact name "acme"; country GB vs US',
      }),
    ]);
  });

  it("treats differing known domains as a conflict", async () => {
    const first = await resolveCompany(
      db,
      companyFacts({ name: "Acme", websiteDomain: "acme.com" }),
      options,
    );
    const second = await resolveCompany(
      db,
      companyFacts({ name: "Acme", websiteDomain: "acme.io" }),
      options,
    );
    expect(second.created).toBe(true);
    expect(await candidates()).toEqual([
      expect.objectContaining({
        leftId: first.companyId,
        rightId: second.companyId,
        reason: 'exact name "acme"; domain acme.com vs acme.io',
      }),
    ]);
  });

  it("matches when only one side knows the country", async () => {
    const existing = await resolveCompany(
      db,
      companyFacts({ name: "Acme", countryCode: "GB" }),
      options,
    );
    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme" }),
      options,
    );
    expect(result.companyId).toBe(existing.companyId);
    expect(result.matchedBy).toBe("exact_name");
  });

  it("prefers the non-conflicting candidate with the most recent activity", async () => {
    const older = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });
    const newer = await insertCompany(db, {
      name: "Acme",
      countryCode: "US",
      updatedAt: new Date("2025-06-01T00:00:00Z"),
    });
    const newest = await insertCompany(db, {
      name: "Acme",
      countryCode: "DE",
      updatedAt: new Date("2025-09-01T00:00:00Z"),
    });

    const anyCountry = await resolveCompany(
      db,
      companyFacts({ name: "Acme" }),
      options,
    );
    expect(anyCountry).toEqual({
      companyId: newest.id,
      created: false,
      matchedBy: "exact_name",
    });

    const usOnly = await resolveCompany(
      db,
      companyFacts({ name: "Acme", countryCode: "US" }),
      options,
    );
    expect(usOnly.companyId).toBe(newer.id);
    expect(usOnly.companyId).not.toBe(older.id);
  });

  it("creates a company and candidates when equally recent candidates tie", async () => {
    const updatedAt = new Date("2025-01-01T00:00:00Z");
    const gb = await insertCompany(db, {
      name: "Acme",
      countryCode: "GB",
      updatedAt,
    });
    const us = await insertCompany(db, {
      name: "Acme",
      countryCode: "US",
      updatedAt,
    });

    const result = await resolveCompany(db, companyFacts(), options);
    expect(result.matchedBy).toBe("new");
    const rows = await candidates();
    expect(rows.map((row) => [row.leftId, row.rightId])).toEqual([
      [gb.id, result.companyId],
      [us.id, result.companyId],
    ]);
    expect(rows[0]?.reason).toBe(
      'exact name "acme"; several equally recent companies',
    );
  });

  it("resolves an alias of a merged company to the surviving company", async () => {
    const survivor = await insertCompany(db, { name: "Acme Group" });
    const merged = await insertCompany(db, {
      name: "Acme Labs",
      mergedIntoId: survivor.id,
    });

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme Labs Ltd" }),
      options,
    );
    expect(result).toEqual({
      companyId: survivor.id,
      created: false,
      matchedBy: "exact_name",
    });
    expect(await aliasesOf(survivor.id)).toEqual([
      "Acme Group",
      "Acme Labs Ltd",
    ]);
    expect(await aliasesOf(merged.id)).toEqual(["Acme Labs"]);
  });

  it("ignores the name of a merged company that has no alias", async () => {
    const survivor = await insertCompany(db, { name: "Acme Group" });
    const [merged] = await db
      .insert(companies)
      .values({
        slug: "acme-labs",
        name: "Acme Labs",
        normalisedName: "acme labs",
        mergedIntoId: survivor.id,
      })
      .returning();

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme Labs" }),
      options,
    );
    expect(result.companyId).not.toBe(merged?.id);
    expect(result.companyId).not.toBe(survivor.id);
    expect(result.created).toBe(true);
  });
});

describe("resolveCompany: rules 3 and 4, fuzzy names", () => {
  it('matches "Acme Robotic" to "Acme Robotics" when an event corroborates', async () => {
    const existing = await resolveCompany(
      db,
      companyFacts({ name: "Acme Robotics" }),
      options,
    );
    const corroborates = vi.fn(corroboratesOnly(existing.companyId));

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme Robotic" }),
      { ...options, corroborates },
    );

    expect(corroborates).toHaveBeenCalledWith(existing.companyId);
    expect(result).toEqual({
      companyId: existing.companyId,
      created: false,
      matchedBy: "fuzzy_corroborated",
    });
    expect(await aliasesOf(existing.companyId)).toEqual([
      "Acme Robotics",
      "Acme Robotic",
    ]);
    expect(await candidates()).toEqual([]);
  });

  it("creates a company and a candidate when nothing corroborates", async () => {
    const existing = await resolveCompany(
      db,
      companyFacts({ name: "Acme Robotics" }),
      options,
    );
    const corroborates = vi.fn(neverCorroborates);

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme Robotic" }),
      { ...options, corroborates },
    );

    expect(corroborates).toHaveBeenCalledWith(existing.companyId);
    expect(result.created).toBe(true);
    expect(result.matchedBy).toBe("new");
    const [candidate, ...rest] = await candidates();
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({
      entityType: "company",
      leftId: existing.companyId,
      rightId: result.companyId,
      status: "open",
    });
    expect(candidate?.score).toBeGreaterThanOrEqual(0.6);
    expect(candidate?.reason).toMatch(
      /^trigram 0\.\d\d to "acme robotics"; no corroborating event$/,
    );
  });

  it("never asks about a fuzzy candidate whose country conflicts", async () => {
    await resolveCompany(
      db,
      companyFacts({ name: "Acme Robotics", countryCode: "GB" }),
      options,
    );
    const corroborates = vi.fn(() => Promise.resolve(true));

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme Robotic", countryCode: "FR" }),
      { ...options, corroborates },
    );

    expect(corroborates).not.toHaveBeenCalled();
    expect(result.created).toBe(true);
    const [candidate] = await candidates();
    expect(candidate?.reason).toMatch(/country GB vs FR$/);
  });

  it("does not ask about names below the similarity threshold", async () => {
    await resolveCompany(db, companyFacts({ name: "Acme Robotics" }), options);
    const corroborates = vi.fn(() => Promise.resolve(true));

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Zenith Biotech" }),
      { ...options, corroborates },
    );

    expect(corroborates).not.toHaveBeenCalled();
    expect(result.created).toBe(true);
    expect(await candidates()).toEqual([]);
  });
});

describe("resolveCompany: updating a matched company", () => {
  it("never overwrites non-empty fields", async () => {
    const existing = await insertCompany(db, {
      name: "Acme",
      websiteDomain: "acme.co.uk",
      description: "Original description.",
      countryCode: "GB",
      city: "London",
      foundedYear: 2019,
      foundedYearSource: "companies_house",
    });

    const result = await resolveCompany(
      db,
      companyFacts({
        name: "Acme",
        websiteDomain: "acme.co.uk",
        description: "A different description.",
        countryCode: "US",
        city: "Austin",
        foundedYear: 2020,
      }),
      options,
    );

    expect(result.matchedBy).toBe("domain");
    expect(await company(existing.id)).toMatchObject({
      websiteDomain: "acme.co.uk",
      description: "Original description.",
      countryCode: "GB",
      city: "London",
      foundedYear: 2019,
      foundedYearSource: "companies_house",
    });
  });

  it("fills empty fields and bumps updated_at", async () => {
    const existing = await insertCompany(db, {
      name: "Acme",
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });

    await resolveCompany(
      db,
      companyFacts({
        name: "Acme",
        websiteDomain: "acme.io",
        description: "Builds rockets.",
        countryCode: "gb",
        city: "Leeds",
        foundedYear: 2022,
      }),
      options,
    );

    expect(await company(existing.id)).toMatchObject({
      websiteDomain: "acme.io",
      description: "Builds rockets.",
      countryCode: "GB",
      city: "Leeds",
      foundedYear: 2022,
      foundedYearSource: "news",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("does not copy a domain that a merged company still holds", async () => {
    const holder = await insertCompany(db, {
      name: "Other",
      websiteDomain: "shared.com",
    });
    const target = await insertCompany(db, { name: "Acme" });
    await db
      .update(companies)
      .set({ mergedIntoId: target.id })
      .where(eq(companies.id, holder.id));

    const result = await resolveCompany(
      db,
      companyFacts({ name: "Acme", websiteDomain: "shared.com" }),
      options,
    );
    expect(result).toMatchObject({
      companyId: target.id,
      matchedBy: "domain",
    });
    expect((await company(target.id)).websiteDomain).toBeNull();
    expect((await company(holder.id)).websiteDomain).toBe("shared.com");
  });

  it("increments tag mention counts and updates last_seen_at", async () => {
    const first = await resolveCompany(
      db,
      companyFacts({ tags: ["ai agents", "fintech"] }),
      options,
    );
    await resolveCompany(
      db,
      companyFacts({ tags: ["AI  Agents", "climate"] }),
      options,
    );

    const rows = await db
      .select({
        slug: tags.slug,
        mentionCount: companyTags.mentionCount,
        firstSeenAt: companyTags.firstSeenAt,
        lastSeenAt: companyTags.lastSeenAt,
      })
      .from(companyTags)
      .innerJoin(tags, eq(tags.id, companyTags.tagId))
      .where(eq(companyTags.companyId, first.companyId))
      .orderBy(asc(tags.slug));

    expect(rows).toEqual([
      {
        slug: "ai agents",
        mentionCount: 2,
        firstSeenAt: new Date("2026-01-01T00:00:00Z"),
        lastSeenAt: new Date("2026-01-01T00:00:01Z"),
      },
      {
        slug: "climate",
        mentionCount: 1,
        firstSeenAt: new Date("2026-01-01T00:00:01Z"),
        lastSeenAt: new Date("2026-01-01T00:00:01Z"),
      },
      {
        slug: "fintech",
        mentionCount: 1,
        firstSeenAt: new Date("2026-01-01T00:00:00Z"),
        lastSeenAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(await db.select().from(tags)).toHaveLength(3);
  });
});

describe("addMergeCandidate", () => {
  it("stores the smaller id on the left and ignores repeated pairs", async () => {
    const a = await insertCompany(db, { name: "Alpha" });
    const b = await insertCompany(db, { name: "Beta" });
    const input = {
      entityType: "company" as const,
      score: 0.8,
      reason: "test",
    };

    expect(
      await addMergeCandidate(db, { ...input, leftId: b.id, rightId: a.id }),
    ).toBe(true);
    expect(
      await addMergeCandidate(db, { ...input, leftId: a.id, rightId: b.id }),
    ).toBe(false);
    expect(
      await addMergeCandidate(db, {
        ...input,
        leftId: b.id,
        rightId: a.id,
        score: 0.9,
      }),
    ).toBe(false);

    expect(await candidates()).toEqual([
      expect.objectContaining({ leftId: a.id, rightId: b.id, score: 0.8 }),
    ]);
  });

  it("keeps company and investor pairs separate and skips self-pairs", async () => {
    const input = { score: 1, reason: "test", leftId: 1, rightId: 2 };
    expect(
      await addMergeCandidate(db, { ...input, entityType: "company" }),
    ).toBe(true);
    expect(
      await addMergeCandidate(db, { ...input, entityType: "investor" }),
    ).toBe(true);
    expect(
      await addMergeCandidate(db, {
        ...input,
        entityType: "company",
        rightId: 1,
      }),
    ).toBe(false);
    expect(await candidates()).toHaveLength(2);
  });
});
