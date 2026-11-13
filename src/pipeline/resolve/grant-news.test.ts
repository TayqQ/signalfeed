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
  grantParticipants,
  grantProjects,
  investors,
  sourceItems,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  GRANT_FUNDER,
  resolveGrantsStep,
} from "@/pipeline/grants/resolve-grants";
import { ensureGtrSource } from "@/pipeline/grants/store-grants";
import { insertExtraction } from "@/pipeline/store/extractions";
import { insertCollectedItems } from "@/pipeline/store/source-items";
import { RECORD_INVESTORS } from "./canonicalise";
import { matchGrantRecord } from "./event-matcher";
import { resolveExtraction } from "./resolve-extraction";

// News reports of an Innovate UK grant attach to the grant event from Gateway
// to Research (spec-phase3 section 9.4, D56). The grant keeps its record facts.

let testDb: TestDb;
let db: Db;
let gtrSourceId: number;
let newsSourceId: number;
let nextItem = 0;
let nextProject = 0;

const now = () => new Date("2026-11-11T12:00:00Z");

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  nextItem = 0;
  nextProject = 0;
  gtrSourceId = await ensureGtrSource(db);
  const [news] = await db
    .insert(sources)
    .values({
      slug: "news",
      name: "News",
      kind: "rss",
      url: "https://news.test/feed",
      priority: 5,
    })
    .returning({ id: sources.id });
  newsSourceId = news!.id;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

/** A GtR participant resolved into a grant event by the real grant resolver. */
async function grant(
  options: {
    name?: string;
    startOn?: string;
    grantOfferMinor?: number;
    projectCostMinor?: number;
  } = {},
): Promise<{ eventId: number; companyId: number }> {
  nextProject += 1;
  const [project] = await db
    .insert(grantProjects)
    .values({
      sourceId: gtrSourceId,
      gtrProjectId: `project-${nextProject}`,
      title: `Invented project ${nextProject}`,
      grantCategory: "Feasibility Studies",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: options.startOn ?? "2026-06-01",
      endOn: null,
      gtrUrl: `https://gtr.test/project-${nextProject}`,
    })
    .returning({ id: grantProjects.id });
  const [participant] = await db
    .insert(grantParticipants)
    .values({
      projectId: project!.id,
      gtrOrgId: `org-${nextProject}`,
      organisationName: options.name ?? "Fenwick Thermal Ltd",
      role: "lead",
      grantOfferMinor: options.grantOfferMinor ?? 30_000_000,
      projectCostMinor: options.projectCostMinor ?? 48_000_000,
      orgFetchedAt: now(),
    })
    .returning({ id: grantParticipants.id });
  await resolveGrantsStep({ db, now });
  const [row] = await db
    .select({
      eventId: grantParticipants.eventId,
      companyId: grantParticipants.companyId,
    })
    .from(grantParticipants)
    .where(eq(grantParticipants.id, participant!.id));
  return { eventId: row!.eventId!, companyId: row!.companyId! };
}

function newsRound(
  roundType: NonNullable<ExtractedEventV1["funding"]>["roundType"],
  amountText: string | null,
  investorNames: { name: string; isLead: boolean }[] = [],
  name = "Fenwick Thermal",
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
      investors: investorNames.map((investor) => ({
        ...investor,
        kind: investor.name === "Innovate UK" ? "government" : "vc",
      })),
      includesIndividualAngels: false,
    },
    acquisition: null,
    launch: null,
  };
}

async function extraction(
  sourceItemId: number,
  extracted: ExtractedEventV1[],
  promptVersion = "v1",
): Promise<number> {
  const result: ExtractionV1 = {
    isRelevant: extracted.length > 0,
    events: extracted,
  };
  const stored = await insertExtraction(db, {
    sourceItemId,
    promptVersion,
    model: "test",
    result,
    isRelevant: result.isRelevant,
    inputTokens: 1,
    outputTokens: 1,
    costUsdMicros: 1,
  });
  return stored.id;
}

async function report(
  extracted: ExtractedEventV1[],
  publishedAt: string,
): Promise<{ extractionId: number; sourceItemId: number }> {
  nextItem += 1;
  const url = `https://news.test/${nextItem}`;
  await insertCollectedItems(db, newsSourceId, [
    {
      sourceSlug: "news",
      externalId: url,
      url,
      title: `Report ${nextItem}`,
      summary: null,
      publishedAt: new Date(publishedAt),
    },
  ]);
  const [item] = await db
    .select({ id: sourceItems.id })
    .from(sourceItems)
    .where(eq(sourceItems.externalId, url));
  const sourceItemId = item!.id;
  return {
    extractionId: await extraction(sourceItemId, extracted),
    sourceItemId,
  };
}

async function snapshot(eventId: number) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const [round] = await db
    .select()
    .from(fundingRounds)
    .where(eq(fundingRounds.eventId, eventId));
  const investorRows = await db
    .select({
      name: investors.name,
      role: eventInvestors.role,
    })
    .from(eventInvestors)
    .innerJoin(investors, eq(investors.id, eventInvestors.investorId))
    .where(eq(eventInvestors.eventId, eventId))
    .orderBy(asc(investors.name));
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

async function eventRows() {
  return db.select().from(events).orderBy(asc(events.id));
}

describe("the record investors", () => {
  it("name the grant funder the grant resolver uses", () => {
    expect(RECORD_INVESTORS.ukri_grant).toEqual([
      { ...GRANT_FUNDER, websiteDomain: null },
    ]);
  });
});

describe("matchGrantRecord", () => {
  it("ignores rounds that are not grants", async () => {
    const { companyId } = await grant();
    const incoming = {
      type: "funding_round" as const,
      companyId,
      date: "2026-04-20",
      amount: { amountMinor: 48_000_000, currency: "GBP" },
    };

    expect(
      await matchGrantRecord(db, { ...incoming, roundType: "seed" }),
    ).toBeNull();
    expect(
      await matchGrantRecord(db, { ...incoming, roundType: "grant" }),
    ).not.toBeNull();
  });

  it("uses the window edges: 180 days before and 60 days after the start", async () => {
    const { companyId, eventId } = await grant();
    const at = (date: string, amountMinor = 30_000_000) =>
      matchGrantRecord(db, {
        type: "funding_round",
        companyId,
        date,
        roundType: "grant",
        amount: { amountMinor, currency: "GBP" },
      });

    expect(await at("2025-12-03")).toBe(eventId); // 180 days before
    expect(await at("2025-12-02")).toBeNull();
    expect(await at("2026-07-31")).toBe(eventId); // 60 days after
    expect(await at("2026-08-01")).toBeNull();
    expect(await at("2026-06-01", 34_500_000)).toBe(eventId); // 15% over
    expect(await at("2026-06-01", 34_500_001)).toBeNull();
    expect(await at("2026-06-01", 25_500_000)).toBe(eventId); // 15% under
  });

  it("never compares an amount in another currency", async () => {
    const { companyId } = await grant();
    expect(
      await matchGrantRecord(db, {
        type: "funding_round",
        companyId,
        date: "2026-04-20",
        roundType: "grant",
        amount: { amountMinor: 30_000_000, currency: "EUR" },
        amountUsdMinor: 35_000_000,
      }),
    ).toBeNull();
  });

  it("prefers the nearest start, then the lower event id", async () => {
    const early = await grant({ startOn: "2026-03-01" });
    const late = await grant({ startOn: "2026-07-01" });
    expect(late.companyId).toBe(early.companyId);

    expect(
      await matchGrantRecord(db, {
        type: "funding_round",
        companyId: early.companyId,
        date: "2026-06-10",
        roundType: "grant",
        amount: { amountMinor: 30_000_000, currency: "GBP" },
      }),
    ).toBe(late.eventId);
  });
});

describe("resolving a news report of a grant", () => {
  it("attaches example C7 to the grant event and keeps the record facts", async () => {
    const { eventId } = await grant();
    const before = await snapshot(eventId);

    const news = await report(
      [
        newsRound("grant", "£480k", [
          { name: "Innovate UK", isLead: false },
          { name: "Tyne Ventures", isLead: false },
        ]),
      ],
      "2026-04-20T09:00:00Z",
    );
    const outcome = await resolveExtraction(db, news.extractionId);

    expect(outcome).toMatchObject({
      eventsCreated: 0,
      eventsUpdated: 1,
      grantReportsAttached: 1,
    });
    expect((await eventRows()).map((row) => row.id)).toEqual([eventId]);
    const links = await db.select().from(eventSources);
    expect(links).toEqual([
      expect.objectContaining({
        eventId,
        sourceItemId: news.sourceItemId,
        extractionId: news.extractionId,
      }),
    ]);

    const after = await snapshot(eventId);
    expect(after.event).toEqual({ ...before.event, sourceCount: 1 });
    expect(after.event).toMatchObject({
      announcedOn: "2026-06-01",
      datePrecision: "month",
      evidence: "confirmed",
    });
    expect(after.round).toEqual(before.round);
    expect(after.round).toMatchObject({
      roundType: "grant",
      amountMinor: 30_000_000,
      currency: "GBP",
    });
    expect(after.records).toEqual(before.records);
    expect(after.investorRows).toEqual([
      { name: "Innovate UK", role: "lead" },
      { name: "Tyne Ventures", role: "participant" },
    ]);
  });

  it.each([
    ["200 days before the start", "£480k", "2025-11-13T09:00:00Z"],
    ["40% off both figures", "£180k", "2026-04-20T09:00:00Z"],
  ])(
    "keeps a news grant %s as a separate event",
    async (_case, amount, publishedAt) => {
      const { eventId } = await grant();
      const before = await snapshot(eventId);

      const news = await report([newsRound("grant", amount)], publishedAt);
      const outcome = await resolveExtraction(db, news.extractionId);

      expect(outcome).toMatchObject({
        eventsCreated: 1,
        grantReportsAttached: 0,
      });
      const rows = await eventRows();
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ evidence: "reported", sourceCount: 1 });
      expect(await snapshot(eventId)).toEqual(before);
    },
  );

  it("attaches nothing when two grant events are in the window and the news has no amount", async () => {
    const first = await grant({ startOn: "2026-05-01" });
    const second = await grant({ startOn: "2026-06-01" });
    expect(second.companyId).toBe(first.companyId);
    const before = [
      await snapshot(first.eventId),
      await snapshot(second.eventId),
    ];

    const news = await report(
      [newsRound("grant", null)],
      "2026-04-20T09:00:00Z",
    );
    const outcome = await resolveExtraction(db, news.extractionId);

    expect(outcome).toMatchObject({
      eventsCreated: 1,
      grantReportsAttached: 0,
    });
    expect(await eventRows()).toHaveLength(3);
    expect([
      await snapshot(first.eventId),
      await snapshot(second.eventId),
    ]).toEqual(before);
  });

  it("attaches a report with no amount when one grant event is in the window", async () => {
    const { eventId } = await grant();

    const news = await report(
      [newsRound("grant", null)],
      "2026-04-20T09:00:00Z",
    );
    const outcome = await resolveExtraction(db, news.extractionId);

    expect(outcome.grantReportsAttached).toBe(1);
    expect((await eventRows()).map((row) => row.id)).toEqual([eventId]);
  });

  it("leaves one unchanged grant event when the report is re-extracted", async () => {
    const { eventId } = await grant();
    const reportOf = newsRound("grant", "£480k", [
      { name: "Tyne Ventures", isLead: true },
    ]);
    const news = await report([reportOf], "2026-04-20T09:00:00Z");
    await resolveExtraction(db, news.extractionId);
    const attached = await snapshot(eventId);

    const again = await extraction(news.sourceItemId, [reportOf], "v2");
    const outcome = await resolveExtraction(db, again);

    expect(outcome).toMatchObject({
      eventsCreated: 0,
      eventsDeleted: 0,
      grantReportsAttached: 1,
    });
    expect((await eventRows()).map((row) => row.id)).toEqual([eventId]);
    expect(await snapshot(eventId)).toEqual(attached);
    expect(attached.investorRows).toEqual([
      { name: "Innovate UK", role: "lead" },
      { name: "Tyne Ventures", role: "lead" },
    ]);
    const links = await db.select().from(eventSources);
    expect(links.map((link) => [link.eventId, link.extractionId])).toEqual([
      [eventId, again],
    ]);
  });

  it("restores the grant event when the report is re-extracted away", async () => {
    const { eventId } = await grant();
    const before = await snapshot(eventId);
    const news = await report(
      [newsRound("grant", "£480k", [{ name: "Tyne Ventures", isLead: false }])],
      "2026-04-20T09:00:00Z",
    );
    await resolveExtraction(db, news.extractionId);

    const dropped = await extraction(news.sourceItemId, [], "v2");
    const outcome = await resolveExtraction(db, dropped);

    expect(outcome.eventsDeleted).toBe(0);
    expect((await eventRows()).map((row) => row.id)).toEqual([eventId]);
    expect(await snapshot(eventId)).toEqual(before);
  });

  it("never attaches a non-grant round of the same company", async () => {
    const { eventId } = await grant();
    const before = await snapshot(eventId);

    const news = await report(
      [newsRound("seed", "£480k")],
      "2026-05-20T09:00:00Z",
    );
    const outcome = await resolveExtraction(db, news.extractionId);

    expect(outcome).toMatchObject({
      eventsCreated: 1,
      grantReportsAttached: 0,
    });
    const rows = await eventRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ evidence: "reported" });
    expect(await snapshot(eventId)).toEqual(before);
  });
});
