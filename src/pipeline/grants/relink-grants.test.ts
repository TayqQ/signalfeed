import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  eventInvestors,
  events,
  eventSources,
  extractions,
  fundingRounds,
  grantParticipants,
  grantProjects,
  investors,
  sourceItems,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { insertCompany } from "../resolve/testing";
import { relinkGrantReports } from "./relink-grants";
import { resolveGrantsStep } from "./resolve-grants";
import { ensureGtrSource } from "./store-grants";

// The one-off relink of news grant events stored before Phase 3 (spec-phase3
// section 9.4, D56).

let testDb: TestDb;
let db: Db;
let gtrSourceId: number;
let newsSourceId: number;
let nextItem = 0;

const now = () => new Date("2026-11-11T12:00:00Z");

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  nextItem = 0;
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

async function grantEvent(companyName: string): Promise<{
  eventId: number;
  companyId: number;
}> {
  const [project] = await db
    .insert(grantProjects)
    .values({
      sourceId: gtrSourceId,
      gtrProjectId: `project-${companyName}`,
      title: "Invented project",
      grantCategory: "Feasibility Studies",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: "2026-06-01",
      endOn: null,
      gtrUrl: `https://gtr.test/${companyName}`,
    })
    .returning({ id: grantProjects.id });
  const [participant] = await db
    .insert(grantParticipants)
    .values({
      projectId: project!.id,
      gtrOrgId: `org-${companyName}`,
      organisationName: companyName,
      role: "lead",
      grantOfferMinor: 30_000_000,
      projectCostMinor: 48_000_000,
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

/**
 * A news grant event as Phase 2 stored it: a `reported` event with one linked
 * report. The extraction holds the facts `recomputeEvent` reads back.
 */
async function newsGrantEvent(
  companyId: number,
  amountText: string,
  amountMinor: number,
): Promise<{ eventId: number; sourceItemId: number }> {
  nextItem += 1;
  const url = `https://news.test/${nextItem}`;
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId: newsSourceId,
      externalId: url,
      url,
      canonicalUrl: url,
      title: `Report ${nextItem}`,
      publishedAt: new Date("2026-04-20T09:00:00Z"),
    })
    .returning({ id: sourceItems.id });
  const [extraction] = await db
    .insert(extractions)
    .values({
      sourceItemId: item!.id,
      promptVersion: "v1",
      model: "test",
      isRelevant: true,
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 1,
      resolvedAt: now(),
      result: {
        isRelevant: true,
        events: [
          {
            type: "funding_round",
            company: {
              name: "Invented",
              websiteDomain: null,
              description: null,
              countryCode: null,
              city: null,
              foundedYear: null,
              tags: [],
            },
            announcedOn: null,
            funding: {
              roundType: "grant",
              roundLabel: null,
              amountText,
              currencyHint: null,
              investors: [{ name: "Tyne Ventures", kind: "vc", isLead: false }],
              includesIndividualAngels: false,
            },
            acquisition: null,
            launch: null,
          },
        ],
      },
    })
    .returning({ id: extractions.id });
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId,
      announcedOn: "2026-04-20",
      sourceCount: 1,
    })
    .returning({ id: events.id });
  await db.insert(fundingRounds).values({
    eventId: event!.id,
    roundType: "grant",
    amountMinor,
    currency: "GBP",
  });
  await db.insert(eventSources).values({
    eventId: event!.id,
    extractionId: extraction!.id,
    sourceItemId: item!.id,
    eventIndex: 0,
  });
  return { eventId: event!.id, sourceItemId: item!.id };
}

async function state() {
  const eventRows = await db.select().from(events).orderBy(asc(events.id));
  const rounds = await db
    .select()
    .from(fundingRounds)
    .orderBy(asc(fundingRounds.eventId));
  const links = await db
    .select()
    .from(eventSources)
    .orderBy(asc(eventSources.sourceItemId));
  const investorRows = await db
    .select()
    .from(eventInvestors)
    .orderBy(asc(eventInvestors.eventId), asc(eventInvestors.investorId));
  return {
    eventRows: eventRows.map((row) => ({ ...row, updatedAt: undefined })),
    rounds,
    links,
    investorRows,
  };
}

describe("relinkGrantReports", () => {
  it("moves the reports, deletes the emptied event and does nothing the second time", async () => {
    const grant = await grantEvent("Fenwick Thermal Ltd");
    const [grantRoundBefore] = await db
      .select()
      .from(fundingRounds)
      .where(eq(fundingRounds.eventId, grant.eventId));
    const news = await newsGrantEvent(grant.companyId, "£480k", 48_000_000);
    // Too far from both figures: stays where it is.
    const other = await newsGrantEvent(grant.companyId, "£180k", 18_000_000);

    const result = await relinkGrantReports({ db, now });

    expect(result).toEqual({
      dryRun: false,
      newsEventsChecked: 2,
      pairs: [
        {
          newsEventId: news.eventId,
          grantEventId: grant.eventId,
          companyId: grant.companyId,
          sources: 1,
        },
      ],
      sourcesMoved: 1,
      grantEventsRecomputed: 1,
      eventsDeleted: 1,
    });
    const rows = await db.select().from(events).orderBy(asc(events.id));
    expect(rows.map((row) => row.id)).toEqual([grant.eventId, other.eventId]);
    expect(rows[0]).toMatchObject({
      announcedOn: "2026-06-01",
      datePrecision: "month",
      evidence: "confirmed",
      sourceCount: 1,
    });
    const [grantRound] = await db
      .select()
      .from(fundingRounds)
      .where(eq(fundingRounds.eventId, grant.eventId));
    expect(grantRound).toEqual(grantRoundBefore);
    const links = await db
      .select()
      .from(eventSources)
      .where(eq(eventSources.sourceItemId, news.sourceItemId));
    expect(links.map((link) => link.eventId)).toEqual([grant.eventId]);
    const names = await db
      .select({ name: investors.name, role: eventInvestors.role })
      .from(eventInvestors)
      .innerJoin(investors, eq(investors.id, eventInvestors.investorId))
      .where(eq(eventInvestors.eventId, grant.eventId))
      .orderBy(asc(investors.name));
    expect(names).toEqual([
      { name: "Innovate UK", role: "lead" },
      { name: "Tyne Ventures", role: "participant" },
    ]);

    const settled = await state();
    const second = await relinkGrantReports({ db, now });
    expect(second).toMatchObject({
      newsEventsChecked: 1,
      pairs: [],
      sourcesMoved: 0,
      eventsDeleted: 0,
    });
    expect(await state()).toEqual(settled);
  });

  it("lists the pairs and changes nothing in a dry run", async () => {
    const grant = await grantEvent("Fenwick Thermal Ltd");
    const news = await newsGrantEvent(grant.companyId, "£300k", 30_000_000);
    const before = await state();

    const result = await relinkGrantReports({ db, now, dryRun: true });

    expect(result).toEqual({
      dryRun: true,
      newsEventsChecked: 1,
      pairs: [
        {
          newsEventId: news.eventId,
          grantEventId: grant.eventId,
          companyId: grant.companyId,
          sources: 1,
        },
      ],
      sourcesMoved: 0,
      grantEventsRecomputed: 0,
      eventsDeleted: 0,
    });
    expect(await state()).toEqual(before);
  });

  it("never pairs a news grant of another company", async () => {
    await grantEvent("Fenwick Thermal Ltd");
    const stranger = await insertCompany(db, { name: "Other Thermal" });
    await newsGrantEvent(stranger.id, "£480k", 48_000_000);
    const before = await state();

    const result = await relinkGrantReports({ db, now });

    expect(result.pairs).toEqual([]);
    expect(await state()).toEqual(before);
  });
});
