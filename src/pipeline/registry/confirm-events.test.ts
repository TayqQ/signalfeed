import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "@/db/client";
import {
  chFilings,
  companies,
  derivedRebuilds,
  eventConfirmations,
  eventRecordSources,
  events,
  formDFilings,
  fundingRounds,
  registryLinks,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { ensureEdgarSource } from "@/pipeline/filings/store-form-d";
import { resolveExtraction } from "@/pipeline/resolve/resolve-extraction";
import { insertCompany } from "@/pipeline/resolve/testing";
import { insertExtraction } from "@/pipeline/store/extractions";
import { insertCollectedItems } from "@/pipeline/store/source-items";
import {
  CONFIRM_REBUILD,
  computeConfirmations,
  confirmStep,
} from "./confirm-events";
import { RULE_CH_ALLOTMENT, RULE_FORM_D } from "./confirm-rules";

let testDb: TestDb;
let db: Db;
const clock = { now: () => new Date("2026-11-12T12:00:00Z") };

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function linkedCompany(
  registry: "companies_house" | "sec_edgar",
  registryId: string,
  name = "Brightwell Robotics",
): Promise<number> {
  const company = await insertCompany(db, {
    name,
    countryCode: registry === "companies_house" ? "GB" : "US",
  });
  await db.insert(registryLinks).values({
    companyId: company.id,
    registry,
    registryId,
    registryName: name.toUpperCase(),
    status: "linked",
    method: "manual",
    reason: "test",
    decidedBy: "manual",
  });
  return company.id;
}

async function newsRound(
  companyId: number,
  values: {
    announcedOn: string;
    roundType?: "seed" | "series_a" | "grant";
    amountUsdMinor?: number | null;
    evidence?: "reported" | "confirmed";
  },
): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId,
      announcedOn: values.announcedOn,
      evidence: values.evidence ?? "reported",
      sourceCount: 1,
    })
    .returning({ id: events.id });
  await db.insert(fundingRounds).values({
    eventId: row!.id,
    roundType: values.roundType ?? "seed",
    roundLabel: "Seed",
    amountMinor: 200_000_000,
    currency: "GBP",
    amountGbpMinor: 200_000_000,
    amountUsdMinor: values.amountUsdMinor ?? 250_000_000,
    fxRateDate: values.announcedOn,
  });
  return row!.id;
}

async function sh01(
  companyNumber: string,
  actionDate: string,
  key = actionDate,
): Promise<number> {
  const [row] = await db
    .insert(chFilings)
    .values({
      companyNumber,
      transactionId: `tx-${companyNumber}-${key}`,
      type: "SH01",
      category: "capital",
      filedOn: actionDate,
      actionDate,
    })
    .returning({ id: chFilings.id });
  return row!.id;
}

async function evidenceOf(eventId: number) {
  const [row] = await db
    .select({ evidence: events.evidence })
    .from(events)
    .where(eq(events.id, eventId));
  return row?.evidence;
}

describe("confirmStep", () => {
  it("confirms a news round from an SH01 and keeps its canonical fields", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const eventId = await newsRound(companyId, { announcedOn: "2026-03-10" });
    const filingId = await sh01("13579246", "2026-02-02");
    const [roundBefore] = await db.select().from(fundingRounds);
    const [eventBefore] = await db.select().from(events);

    const stats = await confirmStep({ db, clock });

    expect(stats).toEqual({
      confirmations: { inserted: 1, updated: 0, deleted: 0 },
      eventsConfirmed: 1,
      eventsSetToReported: 0,
    });
    const rows = await db.select().from(eventConfirmations);
    expect(rows).toEqual([
      expect.objectContaining({
        eventId,
        recordKind: "ch_allotment",
        recordId: filingId,
        rule: RULE_CH_ALLOTMENT,
        recordDate: "2026-02-02",
        confirmsAmount: false,
      }),
    ]);
    const [roundAfter] = await db.select().from(fundingRounds);
    const [eventAfter] = await db.select().from(events);
    expect(roundAfter).toEqual(roundBefore);
    expect({
      ...eventAfter,
      evidence: undefined,
      updatedAt: undefined,
    }).toEqual({ ...eventBefore, evidence: undefined, updatedAt: undefined });
    expect(eventAfter?.evidence).toBe("confirmed");
  });

  it("confirms a US round from a Form D and stores the amount check", async () => {
    const companyId = await linkedCompany("sec_edgar", "1999001");
    const eventId = await newsRound(companyId, {
      announcedOn: "2026-02-18",
      amountUsdMinor: 450_000_000,
    });
    const sourceId = await ensureEdgarSource(db);
    const [filing] = await db
      .insert(formDFilings)
      .values({
        sourceId,
        accessionNumber: "0001999001-26-000001",
        cik: "1999001",
        issuerName: "BRIGHTWELL ROBOTICS INC",
        isAmendment: false,
        dateOfFirstSale: "2026-01-05",
        totalOfferingUsdMinor: 500_000_000,
        totalSoldUsdMinor: 440_000_000,
        filedOn: "2026-01-15",
        companyId,
      })
      .returning({ id: formDFilings.id });

    await confirmStep({ db, clock });

    expect(await db.select().from(eventConfirmations)).toEqual([
      expect.objectContaining({
        eventId,
        recordKind: "sec_form_d",
        recordId: filing!.id,
        rule: RULE_FORM_D,
        recordDate: "2026-01-05",
        confirmsAmount: true,
      }),
    ]);
    expect(await evidenceOf(eventId)).toBe("confirmed");
  });

  it("writes nothing on a second run and skips it", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    await newsRound(companyId, { announcedOn: "2026-03-10" });
    await sh01("13579246", "2026-02-02");
    await confirmStep({ db, clock });

    const again = await confirmStep({ db, clock });
    expect(again.skipped).toBe(true);
    const forced = await confirmStep({ db, clock, force: true });
    expect(forced).toEqual({
      confirmations: { inserted: 0, updated: 0, deleted: 0 },
      eventsConfirmed: 0,
      eventsSetToReported: 0,
    });
    const [rebuild] = await db
      .select()
      .from(derivedRebuilds)
      .where(eq(derivedRebuilds.name, CONFIRM_REBUILD));
    expect(rebuild).toBeDefined();
  });

  it("sets the event back to reported when the SH01 is removed", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const eventId = await newsRound(companyId, { announcedOn: "2026-03-10" });
    const filingId = await sh01("13579246", "2026-02-02");
    await confirmStep({ db, clock });

    await db.delete(chFilings).where(eq(chFilings.id, filingId));
    const stats = await confirmStep({ db, clock });

    expect(stats).toEqual({
      confirmations: { inserted: 0, updated: 0, deleted: 1 },
      eventsConfirmed: 0,
      eventsSetToReported: 1,
    });
    expect(await evidenceOf(eventId)).toBe("reported");
    expect(await db.select().from(eventConfirmations)).toEqual([]);
  });

  it("sets the event back to reported when the link is demoted", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const eventId = await newsRound(companyId, { announcedOn: "2026-03-10" });
    await sh01("13579246", "2026-02-02");
    await confirmStep({ db, clock });

    await db
      .update(registryLinks)
      .set({ status: "candidate", method: null })
      .where(eq(registryLinks.companyId, companyId));
    const stats = await confirmStep({ db, clock });

    expect(stats.eventsSetToReported).toBe(1);
    expect(await evidenceOf(eventId)).toBe("reported");
  });

  it("never changes an event created from a record", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    // A grant event (confirmed) and, to test the guard alone, a record-origin
    // equity event that the window would otherwise fit.
    const grantId = await newsRound(companyId, {
      announcedOn: "2026-03-01",
      roundType: "grant",
      evidence: "confirmed",
    });
    const recordSeedId = await newsRound(companyId, {
      announcedOn: "2026-03-10",
      evidence: "reported",
    });
    await db.insert(eventRecordSources).values([
      { eventId: grantId, recordKind: "ukri_grant", recordId: 1 },
      { eventId: recordSeedId, recordKind: "ukri_grant", recordId: 2 },
    ]);
    await sh01("13579246", "2026-03-05");
    const before = await db.select().from(events).orderBy(asc(events.id));

    const stats = await confirmStep({ db, clock });

    expect(stats.eventsConfirmed).toBe(0);
    expect(stats.eventsSetToReported).toBe(0);
    expect(await db.select().from(eventConfirmations)).toEqual([]);
    expect(await db.select().from(events).orderBy(asc(events.id))).toEqual(
      before,
    );
  });

  it("drops a deleted event's confirmations and confirms its replacement", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const first = await newsRound(companyId, { announcedOn: "2026-03-10" });
    const filingId = await sh01("13579246", "2026-02-02");
    await confirmStep({ db, clock });

    // Re-extraction deletes the event (derived data) and creates a new one.
    await db.delete(events).where(eq(events.id, first));
    expect(await db.select().from(eventConfirmations)).toEqual([]);
    const second = await newsRound(companyId, { announcedOn: "2026-03-11" });

    const stats = await confirmStep({ db, clock });

    expect(stats.confirmations).toEqual({
      inserted: 1,
      updated: 0,
      deleted: 0,
    });
    expect(await db.select().from(eventConfirmations)).toEqual([
      expect.objectContaining({ eventId: second, recordId: filingId }),
    ]);
    expect(await evidenceOf(second)).toBe("confirmed");
  });

  it("confirms neither round when one SH01 fits two, and says why", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const seed = await newsRound(companyId, { announcedOn: "2026-02-10" });
    const seriesA = await newsRound(companyId, {
      announcedOn: "2026-04-20",
      roundType: "series_a",
    });
    const shared = await sh01("13579246", "2026-02-25");
    const lines: string[] = [];

    const computed = await computeConfirmations(db);
    await confirmStep({ db, clock, log: (line) => lines.push(line) });

    expect(computed.rows).toEqual([]);
    expect(computed.ambiguous).toEqual([
      {
        companyId,
        recordKind: "ch_allotment",
        recordId: shared,
        eventIds: [seed, seriesA],
        reason: `fits 2 rounds (events ${seed}, ${seriesA}); not confirmed`,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(await evidenceOf(seed)).toBe("reported");
    expect(await evidenceOf(seriesA)).toBe("reported");
  });

  it("ignores filings of another company's number", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const eventId = await newsRound(companyId, { announcedOn: "2026-03-10" });
    await sh01("99999999", "2026-02-02");

    await confirmStep({ db, clock });

    expect(await evidenceOf(eventId)).toBe("reported");
  });

  it("ignores links held by a merged company", async () => {
    const companyId = await linkedCompany("companies_house", "13579246");
    const survivor = await insertCompany(db, { name: "Brightwell" });
    const eventId = await newsRound(survivor.id, { announcedOn: "2026-03-10" });
    await db
      .update(companies)
      .set({ mergedIntoId: survivor.id })
      .where(eq(companies.id, companyId));
    await sh01("13579246", "2026-02-02");

    await confirmStep({ db, clock });

    expect(await evidenceOf(eventId)).toBe("reported");
  });
});

describe("a confirmed news round and later reports", () => {
  let nextItem = 0;

  beforeEach(async () => {
    nextItem = 0;
    await db.insert(sources).values({
      slug: "a",
      name: "A",
      kind: "rss",
      url: "https://a.test/f",
      priority: 9,
    });
  });

  function seedReport(name: string): ExtractedEventV1 {
    return {
      type: "funding_round",
      company: {
        name,
        websiteDomain: null,
        description: null,
        countryCode: "GB",
        city: null,
        foundedYear: null,
        tags: [],
      },
      announcedOn: null,
      funding: {
        roundType: "seed",
        roundLabel: null,
        amountText: "£2m",
        currencyHint: null,
        investors: [],
        includesIndividualAngels: false,
      },
      acquisition: null,
      launch: null,
    };
  }

  async function report(publishedAt: string): Promise<number> {
    nextItem += 1;
    const url = `https://news.test/${nextItem}`;
    await insertCollectedItems(db, 1, [
      {
        sourceSlug: "a",
        externalId: url,
        url,
        title: `Report ${nextItem}`,
        summary: null,
        publishedAt: new Date(publishedAt),
      },
    ]);
    const result: ExtractionV1 = {
      isRelevant: true,
      events: [seedReport("Brightwell Robotics")],
    };
    const stored = await insertExtraction(db, {
      sourceItemId: nextItem,
      promptVersion: "v1",
      model: "test",
      result,
      isRelevant: true,
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 1,
    });
    return stored.id;
  }

  it("still matches the confirmed event, and stays confirmed", async () => {
    await resolveExtraction(db, await report("2026-03-10T09:00:00Z"));
    const [event] = await db.select().from(events);
    await db.insert(registryLinks).values({
      companyId: event!.companyId,
      registry: "companies_house",
      registryId: "13579246",
      registryName: "BRIGHTWELL ROBOTICS LTD",
      status: "linked",
      method: "manual",
      reason: "test",
      decidedBy: "manual",
    });
    await sh01("13579246", "2026-02-02");
    await confirmStep({ db, clock });
    expect(await evidenceOf(event!.id)).toBe("confirmed");

    const outcome = await resolveExtraction(
      db,
      await report("2026-03-18T09:00:00Z"),
    );
    expect(outcome.eventsCreated).toBe(0);
    expect(outcome.eventsUpdated).toBe(1);

    const stats = await confirmStep({ db, clock });
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: event!.id,
      evidence: "confirmed",
      sourceCount: 2,
    });
    expect(stats.eventsSetToReported).toBe(0);
    expect(await db.select().from(eventConfirmations)).toHaveLength(1);
  });
});
