import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  eventInvestors,
  eventRecordSources,
  events,
  fundingRounds,
  grantParticipants,
  grantProjects,
  investors,
  mergeCandidates,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { upsertRates } from "@/pipeline/store/fx-rates";
import { insertCompany } from "../resolve/testing";
import {
  SKIPPED_NO_GRANT_OFFER,
  SKIPPED_NO_START_DATE,
  normaliseRegNumber,
  resolveGrantsStep,
} from "./resolve-grants";
import { ensureGtrSource } from "./store-grants";

let testDb: TestDb;
let db: Db;
let sourceId: number;
let nextProject = 0;

const now = () => new Date("2026-11-11T12:00:00Z");

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  sourceId = await ensureGtrSource(db);
  nextProject = 0;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function project(
  options: { startOn?: string | null; grantCategory?: string } = {},
): Promise<number> {
  nextProject += 1;
  const [row] = await db
    .insert(grantProjects)
    .values({
      sourceId,
      gtrProjectId: `project-${nextProject}`,
      title: `Invented project ${nextProject}`,
      grantCategory: options.grantCategory ?? "Collaborative R&D",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: options.startOn === undefined ? "2026-06-01" : options.startOn,
      endOn: null,
      gtrUrl: `https://gtr.test/project-${nextProject}`,
    })
    .returning({ id: grantProjects.id });
  return row!.id;
}

async function participant(
  projectId: number,
  options: {
    name?: string;
    orgId?: string;
    regNumber?: string | null;
    grantOfferMinor?: number | null;
    fetched?: boolean;
  } = {},
): Promise<number> {
  const [row] = await db
    .insert(grantParticipants)
    .values({
      projectId,
      gtrOrgId: options.orgId ?? `org-${projectId}`,
      organisationName: options.name ?? "Invented Widgets Ltd",
      regNumber: options.regNumber ?? null,
      role: "lead",
      grantOfferMinor:
        options.grantOfferMinor === undefined
          ? 5_000_000
          : options.grantOfferMinor,
      projectCostMinor: 8_000_000,
      orgFetchedAt: options.fetched === false ? null : now(),
    })
    .returning({ id: grantParticipants.id });
  return row!.id;
}

async function participantRow(id: number) {
  const [row] = await db
    .select()
    .from(grantParticipants)
    .where(eq(grantParticipants.id, id));
  return row!;
}

async function companyRows() {
  return db.select().from(companies).orderBy(asc(companies.id));
}

describe("normaliseRegNumber", () => {
  it("drops spaces and upper-cases", () => {
    expect(normaliseRegNumber(" sc 123456 ")).toBe("SC123456");
    expect(normaliseRegNumber("  ")).toBeNull();
    expect(normaliseRegNumber(null)).toBeNull();
  });
});

describe("resolveGrantsStep companies", () => {
  it("matches by reg_number before name", async () => {
    const byNumber = await insertCompany(db, {
      name: "Alpha Holdings",
      ukCompanyNumber: "01234567",
    });
    const byName = await insertCompany(db, { name: "Gamma Robotics" });
    const id = await participant(await project(), {
      name: "Gamma Robotics Ltd",
      regNumber: "01234567",
    });

    const result = await resolveGrantsStep({ db, now });

    expect(result.companiesMatchedByNumber).toBe(1);
    expect(result.companiesCreated).toBe(0);
    expect((await participantRow(id)).companyId).toBe(byNumber.id);
    const aliases = await db
      .select()
      .from(companyAliases)
      .where(eq(companyAliases.companyId, byNumber.id))
      .orderBy(asc(companyAliases.id));
    expect(aliases.map((a) => [a.alias, a.source])).toEqual([
      ["Alpha Holdings", "extraction"],
      ["Gamma Robotics Ltd", "grant"],
    ]);
    const [other] = await db
      .select()
      .from(events)
      .where(eq(events.companyId, byName.id));
    expect(other).toBeUndefined();
  });

  it("creates a new company with its number, country GB and a grant alias", async () => {
    const id = await participant(await project(), {
      name: "Invented Sensors Limited",
      regNumber: "sc 123456",
    });

    const result = await resolveGrantsStep({ db, now });

    expect(result).toMatchObject({
      participantsResolved: 1,
      companiesCreated: 1,
      companiesMatchedByNumber: 0,
      eventsCreated: 1,
    });
    const [company] = await companyRows();
    expect(company).toMatchObject({
      name: "Invented Sensors Limited",
      ukCompanyNumber: "SC123456",
      countryCode: "GB",
    });
    expect((await participantRow(id)).companyId).toBe(company!.id);
    const aliases = await db.select().from(companyAliases);
    expect(aliases.map((a) => a.source)).toEqual(["grant"]);
  });

  it("does not overwrite a company number already set", async () => {
    const existing = await insertCompany(db, {
      name: "Beta Widgets",
      ukCompanyNumber: "11111111",
    });
    const id = await participant(await project(), {
      name: "Beta Widgets Ltd",
      regNumber: "22222222",
    });

    await resolveGrantsStep({ db, now });

    expect((await participantRow(id)).companyId).toBe(existing.id);
    const rows = await companyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ukCompanyNumber).toBe("11111111");
  });

  it("does not give a number held by another company to a name match", async () => {
    const holder = await insertCompany(db, {
      name: "Delta Holdings",
      ukCompanyNumber: "33333333",
    });
    const named = await insertCompany(db, { name: "Delta Robotics" });
    // The holder is merged away, so the number lookup lands on the survivor.
    await db
      .update(companies)
      .set({ mergedIntoId: named.id })
      .where(eq(companies.id, holder.id));
    const id = await participant(await project(), {
      name: "Delta Robotics Ltd",
      regNumber: "33333333",
    });

    await resolveGrantsStep({ db, now });

    expect((await participantRow(id)).companyId).toBe(named.id);
    const [namedRow] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, named.id));
    expect(namedRow?.ukCompanyNumber).toBeNull();
  });

  it("turns a similar name into a merge candidate, never a merge", async () => {
    const similar = await insertCompany(db, { name: "Acme Robotix" });
    const id = await participant(await project(), {
      name: "Acme Robotics Ltd",
    });

    const result = await resolveGrantsStep({ db, now });

    expect(result.companiesCreated).toBe(1);
    expect(result.mergeCandidatesCreated).toBe(1);
    const created = (await participantRow(id)).companyId;
    expect(created).not.toBe(similar.id);
    const [candidate] = await db.select().from(mergeCandidates);
    expect(candidate).toMatchObject({
      entityType: "company",
      leftId: similar.id,
      rightId: created,
    });
  });

  it("gives a participant at two projects two events and one company", async () => {
    const first = await participant(await project(), { orgId: "org-x" });
    const second = await participant(await project({ startOn: "2026-09-01" }), {
      orgId: "org-x",
    });

    const result = await resolveGrantsStep({ db, now });

    expect(result.eventsCreated).toBe(2);
    expect(result.companiesCreated).toBe(1);
    expect(await companyRows()).toHaveLength(1);
    const a = await participantRow(first);
    const b = await participantRow(second);
    expect(a.companyId).toBe(b.companyId);
    expect(a.eventId).not.toBe(b.eventId);
    expect(await db.select().from(events)).toHaveLength(2);
  });
});

describe("resolveGrantsStep events", () => {
  it("creates a confirmed grant round led by Innovate UK", async () => {
    await upsertRates(db, {
      date: "2026-06-12",
      perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
    });
    const id = await participant(
      await project({ startOn: "2026-06-15", grantCategory: "Smart Grants" }),
    );

    await resolveGrantsStep({ db, now });

    const row = await participantRow(id);
    expect(row.resolvedAt).toEqual(now());
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, row.eventId!));
    expect(event).toMatchObject({
      type: "funding_round",
      companyId: row.companyId,
      announcedOn: "2026-06-15",
      datePrecision: "month",
      evidence: "confirmed",
      sourceCount: 0,
    });
    const [round] = await db
      .select()
      .from(fundingRounds)
      .where(eq(fundingRounds.eventId, event!.id));
    expect(round).toMatchObject({
      roundType: "grant",
      roundLabel: "Smart Grants",
      amountMinor: 5_000_000,
      currency: "GBP",
      amountGbpMinor: 5_000_000,
      amountUsdMinor: 7_812_500,
      fxRateDate: "2026-06-12",
    });
    const lead = await db
      .select({
        name: investors.name,
        kind: investors.kind,
        role: eventInvestors.role,
      })
      .from(eventInvestors)
      .innerJoin(investors, eq(investors.id, eventInvestors.investorId))
      .where(eq(eventInvestors.eventId, event!.id));
    expect(lead).toEqual([
      { name: "Innovate UK", kind: "government", role: "lead" },
    ]);
    expect(await db.select().from(eventRecordSources)).toEqual([
      { eventId: event!.id, recordKind: "ukri_grant", recordId: id },
    ]);
  });

  it("leaves USD empty for the FX step when no rate is stored", async () => {
    await participant(await project());
    await resolveGrantsStep({ db, now });
    const [round] = await db.select().from(fundingRounds);
    expect(round).toMatchObject({
      amountMinor: 5_000_000,
      amountGbpMinor: 5_000_000,
      amountUsdMinor: null,
    });
  });

  it("reuses one Innovate UK investor across grants", async () => {
    await participant(await project(), { orgId: "a", name: "One Ltd" });
    await participant(await project(), { orgId: "b", name: "Two Ltd" });
    await resolveGrantsStep({ db, now });
    expect(await db.select().from(investors)).toHaveLength(1);
    expect(await db.select().from(eventInvestors)).toHaveLength(2);
  });

  it("skips participants with no grant offer or no start date", async () => {
    const noOffer = await participant(await project(), {
      orgId: "a",
      grantOfferMinor: null,
    });
    const zeroOffer = await participant(await project(), {
      orgId: "b",
      grantOfferMinor: 0,
    });
    const noStart = await participant(await project({ startOn: null }), {
      orgId: "c",
    });

    const result = await resolveGrantsStep({ db, now });

    expect(result.participantsSkipped).toBe(3);
    expect(result.participantsResolved).toBe(0);
    expect((await participantRow(noOffer)).skippedReason).toBe(
      SKIPPED_NO_GRANT_OFFER,
    );
    expect((await participantRow(zeroOffer)).skippedReason).toBe(
      SKIPPED_NO_GRANT_OFFER,
    );
    const skipped = await participantRow(noStart);
    expect(skipped.skippedReason).toBe(SKIPPED_NO_START_DATE);
    expect(skipped.resolvedAt).toEqual(now());
    expect(skipped.companyId).toBeNull();
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await companyRows()).toHaveLength(0);
  });

  it("waits for the organisation fetch", async () => {
    const id = await participant(await project(), { fetched: false });
    const result = await resolveGrantsStep({ db, now });
    expect(result.participantsResolved).toBe(0);
    expect((await participantRow(id)).resolvedAt).toBeNull();
  });

  it("does nothing on a second run", async () => {
    await participant(await project(), { orgId: "a", regNumber: "44444444" });
    await participant(await project(), { orgId: "b", grantOfferMinor: null });
    await resolveGrantsStep({ db, now });
    const snapshot = async () => ({
      companies: await companyRows(),
      events: await db.select().from(events).orderBy(asc(events.id)),
      rounds: await db.select().from(fundingRounds),
      participants: await db
        .select()
        .from(grantParticipants)
        .orderBy(asc(grantParticipants.id)),
      aliases: await db.select().from(companyAliases),
    });
    const before = await snapshot();

    const again = await resolveGrantsStep({
      db,
      now: () => new Date("2026-11-12T12:00:00Z"),
    });

    expect(again).toEqual({
      participantsResolved: 0,
      participantsSkipped: 0,
      companiesCreated: 0,
      companiesMatchedByNumber: 0,
      eventsCreated: 0,
      mergeCandidatesCreated: 0,
      tagsApplied: 0,
    });
    expect(await snapshot()).toEqual(before);
  });
});
