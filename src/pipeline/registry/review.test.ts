import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { companies, events, fundingRounds, registryLinks } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { insertCompany } from "@/pipeline/resolve/testing";
import { recordCandidate, recordLink } from "./link-store";
import {
  approveLinks,
  link,
  listCandidates,
  reject,
  rejectCandidates,
  showCompany,
  unlinkCompany,
} from "./review";

const NOW = new Date("2026-11-12T09:00:00Z");

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function candidate(
  companyId: number,
  registryId: string,
  name = "ACME LTD",
) {
  await recordCandidate(db, {
    companyId,
    registry: "companies_house",
    registryId,
    registryName: name,
    reason: "prefix match",
    now: NOW,
  });
  const [row] = await db
    .select()
    .from(registryLinks)
    .where(
      and(
        eq(registryLinks.registryId, registryId),
        eq(registryLinks.companyId, companyId),
      ),
    );
  return row!;
}

async function company(id: string) {
  const [row] = await db.select().from(companies).where(eq(companies.slug, id));
  return row!;
}

describe("listCandidates", () => {
  it("lists open candidates only, newest companies first", async () => {
    const old = await insertCompany(db, {
      name: "Old Co",
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    });
    const fresh = await insertCompany(db, {
      name: "Fresh Co",
      firstSeenAt: new Date("2026-06-01T00:00:00Z"),
    });
    await candidate(old.id, "00000001");
    await candidate(fresh.id, "00000002");
    const rejected = await candidate(fresh.id, "00000003");
    await rejectCandidates(db, [rejected.id], NOW);

    const rows = await listCandidates(db, { limit: 10 });
    expect(rows.map((r) => r.registryId)).toEqual(["00000002", "00000001"]);
    expect(rows[0]?.url).toContain("00000002");
  });

  it("shows events, headline count and evidence for and against", async () => {
    const acme = await insertCompany(db, { name: "Acme", city: "Leeds" });
    const [event] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: acme.id,
        announcedOn: "2026-03-10",
      })
      .returning();
    await db.insert(fundingRounds).values({
      eventId: event!.id,
      roundType: "seed",
      amountMinor: 210_000_000,
      currency: "GBP",
    });
    await candidate(acme.id, "00000004", "Acme Systems Ltd");

    const [row] = await listCandidates(db, { limit: 10 });
    expect(row?.company.earliest).toMatchObject({
      announcedOn: "2026-03-10",
      roundType: "seed",
    });
    expect(row?.company.headlines).toBe(0);
    expect(row?.evidenceFor).toContain(
      "name starts with the company name only",
    );
    expect(row?.reason).toBe("prefix match");
  });

  it("filters by registry and leaves out merged companies", async () => {
    const acme = await insertCompany(db, { name: "Acme" });
    await candidate(acme.id, "00000005");
    expect(
      await listCandidates(db, { registry: "sec_edgar", limit: 10 }),
    ).toEqual([]);
    await db
      .update(companies)
      .set({ mergedIntoId: (await insertCompany(db, { name: "Other" })).id })
      .where(eq(companies.id, acme.id));
    expect(await listCandidates(db, { limit: 10 })).toEqual([]);
  });
});

describe("approve, reject, link, unlink", () => {
  it("approve makes a manual link and fills the column", async () => {
    const acme = await insertCompany(db, { name: "Acme" });
    const row = await candidate(acme.id, "00000006");
    const [result] = await approveLinks(db, [row.id], NOW);
    expect(result?.ok).toBe(true);
    const [after] = await db
      .select()
      .from(registryLinks)
      .where(eq(registryLinks.id, row.id));
    expect(after).toMatchObject({
      status: "linked",
      decidedBy: "manual",
      method: "manual",
    });
    expect((await company(acme.slug)).ukCompanyNumber).toBe("00000006");
  });

  it("handles several ids and reports each one", async () => {
    const a = await insertCompany(db, { name: "Alpha" });
    const b = await insertCompany(db, { name: "Beta" });
    const one = await candidate(a.id, "00000007");
    const two = await candidate(b.id, "00000008");
    const results = await approveLinks(db, [one.id, 9999, two.id], NOW);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it("refuses a number held by another company and names it", async () => {
    const holder = await insertCompany(db, { name: "Holder Co" });
    const other = await insertCompany(db, { name: "Other Co" });
    await recordLink(db, {
      companyId: holder.id,
      registry: "companies_house",
      registryId: "00000009",
      registryName: "HOLDER LTD",
      method: "name_location",
      reason: "test",
      decidedBy: "auto",
      now: NOW,
    });
    const row = await candidate(other.id, "00000009");
    const [result] = await approveLinks(db, [row.id], NOW);
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain("Holder Co");
    expect(result?.message).toContain(holder.slug);
  });

  it("reject blocks the same automatic link later", async () => {
    const acme = await insertCompany(db, { name: "Acme" });
    const row = await candidate(acme.id, "00000010");
    const [result] = await rejectCandidates(db, [row.id], NOW);
    expect(result?.ok).toBe(true);
    const outcome = await recordLink(db, {
      companyId: acme.id,
      registry: "companies_house",
      registryId: "00000010",
      registryName: "ACME LTD",
      method: "name_location",
      reason: "again",
      decidedBy: "auto",
      now: NOW,
    });
    expect(outcome.outcome).toBe("blocked");
  });

  it("links a number that was never a candidate, then unlinks it", async () => {
    const acme = await insertCompany(db, { name: "Acme" });
    const linked = await link(db, {
      slug: acme.slug,
      registry: "companies_house",
      registryId: "9876543",
      now: NOW,
    });
    expect(linked.ok).toBe(true);
    expect((await company(acme.slug)).ukCompanyNumber).toBe("09876543");

    const shown = await showCompany(db, acme.slug);
    expect(shown.links).toHaveLength(1);
    expect(shown.links[0]?.status).toBe("linked");

    const removed = await unlinkCompany(db, {
      slug: acme.slug,
      registry: "companies_house",
      now: NOW,
    });
    expect(removed.ok).toBe(true);
    expect((await company(acme.slug)).ukCompanyNumber).toBeNull();
    expect((await showCompany(db, acme.slug)).links[0]?.status).toBe(
      "rejected",
    );
  });

  it("refuses a link over another number until unlinked", async () => {
    const acme = await insertCompany(db, { name: "Acme" });
    await link(db, {
      slug: acme.slug,
      registry: "companies_house",
      registryId: "00000011",
      now: NOW,
    });
    const result = await link(db, {
      slug: acme.slug,
      registry: "companies_house",
      registryId: "00000012",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unlink");
  });

  it("rejects a number by slug", async () => {
    const acme = await insertCompany(db, { name: "Acme" });
    const result = await reject(db, {
      slug: acme.slug,
      registry: "companies_house",
      registryId: "00000013",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect((await showCompany(db, acme.slug)).links[0]?.status).toBe(
      "rejected",
    );
  });
});
