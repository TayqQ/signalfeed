import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  companyTags,
  entityMerges,
  eventInvestors,
  events,
  fundingRounds,
  investors,
  mergeCandidates,
  tags,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { addMergeCandidate } from "./merge-candidates";
import {
  addAlias,
  dismissCandidate,
  listCandidates,
  mergeCompanies,
  mergeInvestors,
  previewCompanyMerge,
} from "./merge-entities";
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

async function roundFor(companyId: number, announcedOn = "2026-06-01") {
  const [event] = await db
    .insert(events)
    .values({ type: "funding_round", companyId, announcedOn })
    .returning();
  if (!event) throw new Error("no event");
  await db
    .insert(fundingRounds)
    .values({ eventId: event.id, roundType: "seed" });
  return event.id;
}

async function tagCompany(
  companyId: number,
  slug: string,
  mentionCount: number,
) {
  await db.insert(tags).values({ slug, label: slug }).onConflictDoNothing();
  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug));
  if (!tag) throw new Error("no tag");
  await db
    .insert(companyTags)
    .values({ companyId, tagId: tag.id, mentionCount });
}

describe("mergeCompanies", () => {
  it("moves events, aliases and tags, and writes the audit row", async () => {
    const keep = await insertCompany(db, { name: "Acme" });
    const merge = await insertCompany(db, {
      name: "Acme Robotics",
      city: "Leeds",
      websiteDomain: "acme.io",
    });
    await roundFor(merge.id);
    await tagCompany(keep.id, "robots", 2);
    await tagCompany(merge.id, "robots", 3);
    await addMergeCandidate(db, {
      entityType: "company",
      leftId: keep.id,
      rightId: merge.id,
      score: 0.7,
      reason: "test",
    });

    await mergeCompanies(db, keep.id, merge.id, { note: "same firm" });

    const moved = await db.select().from(events);
    expect(moved[0]?.companyId).toBe(keep.id);

    const aliases = await db
      .select()
      .from(companyAliases)
      .where(eq(companyAliases.companyId, keep.id));
    expect(aliases.map((alias) => alias.alias).sort()).toEqual([
      "Acme",
      "Acme Robotics",
    ]);

    const [tag] = await db
      .select()
      .from(companyTags)
      .where(eq(companyTags.companyId, keep.id));
    expect(tag?.mentionCount).toBe(5);

    const [kept] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, keep.id));
    expect(kept?.city).toBe("Leeds");
    expect(kept?.websiteDomain).toBe("acme.io");

    const [gone] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, merge.id));
    expect(gone?.mergedIntoId).toBe(keep.id);

    const [audit] = await db.select().from(entityMerges);
    expect(audit).toMatchObject({
      keptId: keep.id,
      mergedId: merge.id,
      note: "same firm",
    });

    const [candidate] = await db.select().from(mergeCandidates);
    expect(candidate?.status).toBe("merged");
  });

  it("warns about look-alike events and does not merge them", async () => {
    const keep = await insertCompany(db, { name: "Acme" });
    const merge = await insertCompany(db, { name: "Acme Ltd Two" });
    const left = await roundFor(keep.id);
    const right = await roundFor(merge.id, "2026-06-05");
    const result = await mergeCompanies(db, keep.id, merge.id);
    expect(result.possibleDuplicateEvents).toEqual([[left, right]]);
    expect(await db.select().from(events)).toHaveLength(2);
  });

  it("refuses self-merges and merges into an already merged company", async () => {
    const a = await insertCompany(db, { name: "A Co One" });
    const b = await insertCompany(db, { name: "B Co Two" });
    const c = await insertCompany(db, { name: "C Co Three" });
    await expect(mergeCompanies(db, a.id, a.id)).rejects.toThrow(/itself/);
    await mergeCompanies(db, a.id, b.id);
    await expect(mergeCompanies(db, b.id, c.id)).rejects.toThrow(
      /already merged/,
    );
    await expect(mergeCompanies(db, c.id, b.id)).rejects.toThrow(
      /already merged/,
    );
  });

  it("a preview changes nothing", async () => {
    const keep = await insertCompany(db, { name: "Acme" });
    const merge = await insertCompany(db, { name: "Other" });
    await roundFor(merge.id);
    const preview = await previewCompanyMerge(db, merge.id);
    expect(preview.events).toBe(1);
    const [row] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, merge.id));
    expect(row?.mergedIntoId).toBeNull();
    expect(keep.id).not.toBe(merge.id);
    expect(await db.select().from(entityMerges)).toHaveLength(0);
  });
});

describe("mergeInvestors", () => {
  it("keeps the lead role when both were on the same event", async () => {
    const company = await insertCompany(db, { name: "Acme" });
    const eventId = await roundFor(company.id);
    const keep = await insertInvestor(db, { name: "Example" });
    const merge = await insertInvestor(db, { name: "Example VC" });
    await db.insert(eventInvestors).values([
      { eventId, investorId: keep.id, role: "participant" },
      { eventId, investorId: merge.id, role: "lead" },
    ]);

    await mergeInvestors(db, keep.id, merge.id);

    const rows = await db.select().from(eventInvestors);
    expect(rows).toEqual([{ eventId, investorId: keep.id, role: "lead" }]);
    const [gone] = await db
      .select()
      .from(investors)
      .where(eq(investors.id, merge.id));
    expect(gone?.mergedIntoId).toBe(keep.id);
  });
});

describe("candidates", () => {
  it("lists both sides, dismisses, and adds aliases", async () => {
    const a = await insertCompany(db, { name: "Acme", countryCode: "GB" });
    const b = await insertCompany(db, { name: "Acmee" });
    await roundFor(a.id);
    await addMergeCandidate(db, {
      entityType: "company",
      leftId: a.id,
      rightId: b.id,
      score: 0.7,
      reason: "similar",
    });

    const [row] = await listCandidates(db, { entityType: "company" });
    expect(row?.left).toMatchObject({
      name: "Acme",
      countryCode: "GB",
      events: 1,
    });
    expect(row?.right).toMatchObject({ name: "Acmee", events: 0 });

    await dismissCandidate(db, row?.id ?? 0);
    expect(await listCandidates(db)).toHaveLength(0);
    await expect(dismissCandidate(db, row?.id ?? 0)).rejects.toThrow(/No open/);

    await addAlias(db, "company", a.id, "ACME Group");
    const aliases = await db
      .select()
      .from(companyAliases)
      .where(eq(companyAliases.companyId, a.id));
    expect(aliases.some((alias) => alias.source === "manual")).toBe(true);
  });
});
