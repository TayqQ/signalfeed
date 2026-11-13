import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "@/db/client";
import {
  eventInvestors,
  eventRecordSources,
  events,
  eventSources,
  fundingRounds,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { insertExtraction } from "@/pipeline/store/extractions";
import { upsertRates } from "@/pipeline/store/fx-rates";
import { insertCollectedItems } from "@/pipeline/store/source-items";
import { deleteOrphanEvents, recomputeEvent, storedFx } from "./canonicalise";
import { corroboratesFor, findMatchingEvent } from "./event-matcher";
import { mergeCompanies } from "./merge-entities";
import { resolveExtraction } from "./resolve-extraction";
import { insertCompany, insertInvestor } from "./testing";

// Grant events come from an official record (event_record_sources) and must
// never be matched, rebuilt or deleted by news resolution (spec-phase2 10.4).
// The guard is the record source, not `evidence`: a confirmed news event still
// matches later reports (spec-phase3 9.3).

let testDb: TestDb;
let db: Db;
let nextItem = 0;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  nextItem = 0;
  await db.insert(sources).values({
    slug: "a",
    name: "A",
    kind: "rss",
    url: "https://a.test/f",
    priority: 9,
  });
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

const GRANT_PENCE = 50_000_000;

/** A grant event as the grant resolver stores it. */
async function grantEvent(
  companyId: number,
  options: {
    announcedOn?: string;
    amountUsdMinor?: number | null;
    evidence?: "reported" | "confirmed";
  } = {},
): Promise<number> {
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId,
      announcedOn: options.announcedOn ?? "2026-06-01",
      datePrecision: "month",
      evidence: options.evidence ?? "confirmed",
      sourceCount: 0,
    })
    .returning({ id: events.id });
  const eventId = event!.id;
  const usd =
    options.amountUsdMinor === undefined ? 62_500_000 : options.amountUsdMinor;
  await db.insert(fundingRounds).values({
    eventId,
    roundType: "grant",
    roundLabel: "Collaborative R&D",
    amountMinor: GRANT_PENCE,
    currency: "GBP",
    amountGbpMinor: GRANT_PENCE,
    amountUsdMinor: usd,
    fxRateDate: usd === null ? null : "2026-06-01",
  });
  const funder = await insertInvestor(db, {
    name: "Innovate UK",
    kind: "government",
  });
  await db
    .insert(eventInvestors)
    .values({ eventId, investorId: funder.id, role: "lead" });
  await db
    .insert(eventRecordSources)
    .values({ eventId, recordKind: "ukri_grant", recordId: 1 });
  return eventId;
}

function newsRound(
  name: string,
  roundType: NonNullable<ExtractedEventV1["funding"]>["roundType"],
  amountText: string,
): ExtractedEventV1 {
  return {
    type: "funding_round",
    company: {
      name,
      websiteDomain: null,
      description: null,
      countryCode: null,
      city: null,
      foundedYear: null,
      tags: [],
    },
    announcedOn: null,
    funding: {
      roundType,
      roundLabel: null,
      amountText,
      currencyHint: null,
      investors: [],
      includesIndividualAngels: false,
    },
    acquisition: null,
    launch: null,
  };
}

async function report(
  extracted: ExtractedEventV1[],
  publishedAt = "2026-06-20T12:00:00Z",
): Promise<{ extractionId: number; sourceItemId: number }> {
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
    isRelevant: extracted.length > 0,
    events: extracted,
  };
  const stored = await insertExtraction(db, {
    sourceItemId: nextItem,
    promptVersion: "v1",
    model: "test",
    result,
    isRelevant: result.isRelevant,
    inputTokens: 1,
    outputTokens: 1,
    costUsdMicros: 1,
  });
  return { extractionId: stored.id, sourceItemId: nextItem };
}

async function grantSnapshot(eventId: number) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const [round] = await db
    .select()
    .from(fundingRounds)
    .where(eq(fundingRounds.eventId, eventId));
  const investorRows = await db
    .select()
    .from(eventInvestors)
    .where(eq(eventInvestors.eventId, eventId));
  const records = await db
    .select()
    .from(eventRecordSources)
    .where(eq(eventRecordSources.eventId, eventId));
  return {
    event: event && { ...event, updatedAt: undefined },
    round,
    investorRows,
    records,
  };
}

describe("grant events and news resolution", () => {
  it("never matches a news round of the same company within 45 days", async () => {
    const company = await insertCompany(db, {
      name: "Acme Ltd",
      countryCode: "GB",
    });
    const grant = await grantEvent(company.id);
    const before = await grantSnapshot(grant);

    const news = await report([newsRound("Acme", "grant", "£500k")]);
    const outcome = await resolveExtraction(db, news.extractionId);

    expect(outcome.eventsCreated).toBe(1);
    expect(outcome.eventsUpdated).toBe(0);
    const rows = await db.select().from(events).orderBy(asc(events.id));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      companyId: company.id,
      evidence: "reported",
      sourceCount: 1,
    });
    const links = await db.select().from(eventSources);
    expect(links.map((link) => link.eventId)).toEqual([rows[1]!.id]);
    expect(await grantSnapshot(grant)).toEqual(before);
  });

  it("never deletes the grant event when the nearby news item is re-extracted", async () => {
    const company = await insertCompany(db, {
      name: "Acme Ltd",
      countryCode: "GB",
    });
    const grant = await grantEvent(company.id);
    const before = await grantSnapshot(grant);
    const news = await report([newsRound("Acme", "seed", "£2m")]);
    await resolveExtraction(db, news.extractionId);

    const dropped = await insertExtraction(db, {
      sourceItemId: news.sourceItemId,
      promptVersion: "v2",
      model: "test",
      result: { isRelevant: false, events: [] },
      isRelevant: false,
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 1,
    });
    const outcome = await resolveExtraction(db, dropped.id);

    expect(outcome.eventsDeleted).toBe(1);
    const rows = await db.select().from(events);
    expect(rows.map((row) => row.id)).toEqual([grant]);
    expect(await grantSnapshot(grant)).toEqual(before);
  });

  it("keeps events with a record source when asked to delete orphans", async () => {
    const company = await insertCompany(db, { name: "Acme Ltd" });
    const grant = await grantEvent(company.id);
    const [orphan] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: company.id,
        announcedOn: "2026-06-02",
      })
      .returning({ id: events.id });

    expect(await deleteOrphanEvents(db, [grant, orphan!.id])).toBe(1);
    const rows = await db.select().from(events);
    expect(rows.map((row) => row.id)).toEqual([grant]);
  });

  it("keeps the grant event and its amount through a company merge", async () => {
    const grantee = await insertCompany(db, {
      name: "Acme Robotics Ltd",
      countryCode: "GB",
    });
    const grant = await grantEvent(grantee.id);
    const before = await grantSnapshot(grant);
    const news = await report([newsRound("Acme Robots", "seed", "£2m")]);
    await resolveExtraction(db, news.extractionId);
    const [newsEvent] = await db
      .select()
      .from(events)
      .where(eq(events.evidence, "reported"));
    const keepId = newsEvent!.companyId;
    expect(keepId).not.toBe(grantee.id);

    await mergeCompanies(db, keepId, grantee.id);

    const after = await grantSnapshot(grant);
    expect(after.event).toEqual({ ...before.event, companyId: keepId });
    expect(after.round).toEqual(before.round);
    expect(after.investorRows).toEqual(before.investorRows);
    expect(after.records).toEqual(before.records);
  });
});

describe("recomputeEvent with no extraction evidence", () => {
  it("leaves a grant event's detail row and investors untouched", async () => {
    const company = await insertCompany(db, { name: "Acme Ltd" });
    const grant = await grantEvent(company.id);
    await upsertRates(db, {
      date: "2026-06-01",
      perEur: { EUR: 1, USD: 2, GBP: 1 },
    });
    const before = await grantSnapshot(grant);

    await recomputeEvent(db, grant, storedFx);

    expect(await grantSnapshot(grant)).toEqual(before);
  });

  it("fills only a missing USD figure, as the FX step needs", async () => {
    const company = await insertCompany(db, { name: "Acme Ltd" });
    const grant = await grantEvent(company.id, { amountUsdMinor: null });
    const before = await grantSnapshot(grant);

    await recomputeEvent(db, grant, storedFx);
    expect(await grantSnapshot(grant)).toEqual(before);

    await upsertRates(db, {
      date: "2026-06-01",
      perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
    });
    await recomputeEvent(db, grant, storedFx);

    const after = await grantSnapshot(grant);
    expect(after.round).toEqual({
      ...before.round,
      amountUsdMinor: 78_125_000,
      fxRateDate: "2026-06-01",
    });
    expect(after.event).toEqual(before.event);
    expect(after.investorRows).toEqual(before.investorRows);
  });

  it("does not convert a news event that lost its reports", async () => {
    const company = await insertCompany(db, { name: "Acme Ltd" });
    const [event] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: company.id,
        announcedOn: "2026-06-01",
      })
      .returning({ id: events.id });
    await db.insert(fundingRounds).values({
      eventId: event!.id,
      roundType: "seed",
      amountMinor: 100_000,
      currency: "GBP",
    });
    await upsertRates(db, {
      date: "2026-06-01",
      perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
    });

    await recomputeEvent(db, event!.id, storedFx);

    const [round] = await db
      .select()
      .from(fundingRounds)
      .where(eq(fundingRounds.eventId, event!.id));
    expect(round?.amountUsdMinor).toBeNull();
  });
});

describe("the record-origin guard", () => {
  async function confirmedNewsRound(companyName: string) {
    const first = await report(
      [newsRound(companyName, "seed", "£2m")],
      "2026-06-10T12:00:00Z",
    );
    await resolveExtraction(db, first.extractionId);
    const [event] = await db.select().from(events);
    await db
      .update(events)
      .set({ evidence: "confirmed" })
      .where(eq(events.id, event!.id));
    const [round] = await db
      .select()
      .from(fundingRounds)
      .where(eq(fundingRounds.eventId, event!.id));
    return { event: event!, round: round! };
  }

  it("matches a confirmed news round with a second report 10 days later", async () => {
    const { event } = await confirmedNewsRound("Acme");

    const second = await report(
      [newsRound("Acme", "seed", "£2m")],
      "2026-06-20T12:00:00Z",
    );
    const outcome = await resolveExtraction(db, second.extractionId);

    expect(outcome.eventsCreated).toBe(0);
    expect(outcome.eventsUpdated).toBe(1);
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: event.id,
      evidence: "confirmed",
      sourceCount: 2,
    });
    const links = await db.select().from(eventSources);
    expect(links.map((link) => link.eventId)).toEqual([event.id, event.id]);
  });

  it("lets a confirmed news round corroborate a fuzzy company match", async () => {
    const { event, round } = await confirmedNewsRound("Acme");

    const corroborates = corroboratesFor(db, {
      type: "funding_round",
      date: "2026-06-20",
      roundType: "seed",
      amount: { amountMinor: round.amountMinor!, currency: round.currency! },
    });

    expect(await corroborates(event.companyId)).toBe(true);
  });

  it.each(["confirmed", "reported"] as const)(
    "never matches a grant event whose evidence is %s",
    async (evidence) => {
      const company = await insertCompany(db, {
        name: "Acme Ltd",
        countryCode: "GB",
      });
      const grant = await grantEvent(company.id, { evidence });
      const before = await grantSnapshot(grant);
      const incoming = {
        type: "funding_round" as const,
        date: "2026-06-11",
        roundType: "grant" as const,
        amount: { amountMinor: GRANT_PENCE, currency: "GBP" },
      };

      expect(
        await findMatchingEvent(db, { ...incoming, companyId: company.id }),
      ).toBeNull();
      expect(await corroboratesFor(db, incoming)(company.id)).toBe(false);

      const news = await report(
        [newsRound("Acme", "grant", "£500k")],
        "2026-06-11T12:00:00Z",
      );
      const outcome = await resolveExtraction(db, news.extractionId);

      expect(outcome.eventsCreated).toBe(1);
      expect(outcome.eventsUpdated).toBe(0);
      const rows = await db.select().from(events).orderBy(asc(events.id));
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ evidence: "reported", sourceCount: 1 });
      expect(await grantSnapshot(grant)).toEqual(before);
    },
  );
});
