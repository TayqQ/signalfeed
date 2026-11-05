import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "@/db/client";
import {
  acquisitions,
  companies,
  eventInvestors,
  events,
  eventSources,
  fundingRounds,
  investors,
  mergeCandidates,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { insertExtraction } from "@/pipeline/store/extractions";
import { insertCollectedItems } from "@/pipeline/store/source-items";
import { upsertRates } from "@/pipeline/store/fx-rates";
import { resolveExtraction } from "./resolve-extraction";

let testDb: TestDb;
let db: Db;
let nextItem = 0;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  nextItem = 0;
  await db.insert(sources).values([
    { slug: "a", name: "A", kind: "rss", url: "https://a.test/f", priority: 9 },
    { slug: "b", name: "B", kind: "rss", url: "https://b.test/f", priority: 8 },
    { slug: "c", name: "C", kind: "rss", url: "https://c.test/f", priority: 7 },
  ]);
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

interface FundingInput {
  name?: string;
  countryCode?: string | null;
  roundType?: NonNullable<ExtractedEventV1["funding"]>["roundType"];
  amountText?: string | null;
  investors?: Array<{ name: string; isLead: boolean }>;
}

function funding(input: FundingInput = {}): ExtractedEventV1 {
  return {
    type: "funding_round",
    company: {
      name: input.name ?? "Acme",
      websiteDomain: null,
      description: null,
      countryCode: input.countryCode ?? null,
      city: null,
      foundedYear: null,
      tags: [],
    },
    announcedOn: null,
    funding: {
      roundType: input.roundType ?? "seed",
      roundLabel: null,
      amountText: input.amountText === undefined ? "$4M" : input.amountText,
      currencyHint: null,
      investors: (input.investors ?? []).map((i) => ({ ...i, kind: "vc" })),
      includesIndividualAngels: false,
    },
    acquisition: null,
    launch: null,
  };
}

function acquisition(target: string, acquirer: string): ExtractedEventV1 {
  return {
    type: "acquisition",
    company: {
      name: target,
      websiteDomain: null,
      description: null,
      countryCode: null,
      city: null,
      foundedYear: null,
      tags: [],
    },
    announcedOn: null,
    funding: null,
    acquisition: {
      acquirerName: acquirer,
      acquirerDomain: null,
      acquirerCountryCode: null,
      priceText: null,
      currencyHint: null,
    },
    launch: null,
  };
}

/** Stores an item from source `sourceId` and an extraction of it; returns the extraction id. */
async function report(
  events_: ExtractedEventV1[],
  options: { sourceId?: number; publishedAt?: string; title?: string } = {},
): Promise<{ extractionId: number; sourceItemId: number }> {
  nextItem += 1;
  const url = `https://news.test/${nextItem}`;
  await insertCollectedItems(db, options.sourceId ?? 1, [
    {
      sourceSlug: "a",
      externalId: url,
      url,
      title: options.title ?? `Report ${nextItem}`,
      summary: null,
      publishedAt: new Date(options.publishedAt ?? "2026-06-01T12:00:00Z"),
    },
  ]);
  const result: ExtractionV1 = {
    isRelevant: events_.length > 0,
    events: events_,
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

async function eventRows() {
  return db.select().from(events).orderBy(asc(events.id));
}

async function roundRows() {
  return db.select().from(fundingRounds).orderBy(asc(fundingRounds.eventId));
}

describe("resolveExtraction", () => {
  it("1. merges three reports of one seed round into one event", async () => {
    const a = await report(
      [funding({ investors: [{ name: "Example Ventures", isLead: true }] })],
      { sourceId: 1 },
    );
    const b = await report(
      [
        funding({
          amountText: "$4M",
          investors: [{ name: "Beta", isLead: false }],
        }),
      ],
      { sourceId: 2 },
    );
    const c = await report([funding({ amountText: null })], { sourceId: 3 });
    for (const r of [a, b, c]) await resolveExtraction(db, r.extractionId);

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceCount).toBe(3);

    const [round] = await roundRows();
    expect(round?.amountMinor).toBe(400_000_000);
    expect(round?.currency).toBe("USD");

    const roles = await db
      .select({ name: investors.name, role: eventInvestors.role })
      .from(eventInvestors)
      .innerJoin(investors, eq(investors.id, eventInvestors.investorId))
      .orderBy(asc(investors.name));
    expect(roles).toEqual([
      { name: "Beta", role: "participant" },
      { name: "Example Ventures", role: "lead" },
    ]);
  });

  it("2. keeps a seed and a Series A four months apart separate", async () => {
    const seed = await report([funding()]);
    const seriesA = await report(
      [funding({ roundType: "series_a", amountText: "$20M" })],
      { publishedAt: "2026-10-01T12:00:00Z" },
    );
    await resolveExtraction(db, seed.extractionId);
    await resolveExtraction(db, seriesA.extractionId);
    expect(await eventRows()).toHaveLength(2);
    expect(await db.select().from(companies)).toHaveLength(1);
  });

  it("3. keeps different rounds in the same week separate", async () => {
    const seed = await report([funding()]);
    const seriesA = await report(
      [funding({ roundType: "series_a", amountText: "$20M" })],
      { publishedAt: "2026-06-03T12:00:00Z" },
    );
    await resolveExtraction(db, seed.extractionId);
    await resolveExtraction(db, seriesA.extractionId);
    expect(await eventRows()).toHaveLength(2);
  });

  it("4. makes three companies and events from a roundup", async () => {
    const roundup = await report([
      funding({ name: "One" }),
      funding({ name: "Two", amountText: "$10M" }),
      funding({ name: "Three", amountText: "$12M" }),
    ]);
    await resolveExtraction(db, roundup.extractionId);
    expect(await eventRows()).toHaveLength(3);
    expect(await db.select().from(companies)).toHaveLength(3);
    const rows = await eventRows();
    expect(rows.every((row) => row.datePrecision === "month")).toBe(true);
  });

  it("5. merges acquisition reports and marks the target acquired", async () => {
    const first = await report([acquisition("Target", "Buyer")]);
    const second = await report([acquisition("Target", "Buyer Inc")], {
      sourceId: 2,
    });
    await resolveExtraction(db, first.extractionId);
    await resolveExtraction(db, second.extractionId);

    expect(await eventRows()).toHaveLength(1);
    expect(await db.select().from(companies)).toHaveLength(2);
    const [target] = await db
      .select()
      .from(companies)
      .where(eq(companies.name, "Target"));
    expect(target?.status).toBe("acquired");
    const [row] = await db.select().from(acquisitions);
    expect(row?.acquirerCompanyId).not.toBeNull();
  });

  it("drops an acquisition where the company buys itself", async () => {
    const self = await report([acquisition("Acme", "Acme")]);
    await resolveExtraction(db, self.extractionId);
    expect(await eventRows()).toHaveLength(0);
  });

  it("6. creates nothing for an irrelevant extraction and marks it resolved", async () => {
    const irrelevant = await report([]);
    const outcome = await resolveExtraction(db, irrelevant.extractionId);
    expect(outcome.eventsCreated).toBe(0);
    expect(await eventRows()).toHaveLength(0);
    const again = await resolveExtraction(db, irrelevant.extractionId);
    expect(again.alreadyResolved).toBe(true);
  });

  it("7. treats resolving twice as a no-op", async () => {
    const one = await report([
      funding({ investors: [{ name: "Beta", isLead: true }] }),
    ]);
    await resolveExtraction(db, one.extractionId);
    const before = await eventRows();
    const outcome = await resolveExtraction(db, one.extractionId);
    expect(outcome.alreadyResolved).toBe(true);
    expect(await eventRows()).toEqual(before);
    expect(await db.select().from(eventSources)).toHaveLength(1);
  });

  it("8. re-links on re-extraction and deletes the orphaned event", async () => {
    const original = await report([funding()], {
      publishedAt: "2026-06-01T12:00:00Z",
    });
    await resolveExtraction(db, original.extractionId);

    const newer = await insertExtraction(db, {
      sourceItemId: original.sourceItemId,
      promptVersion: "v2",
      model: "test",
      result: {
        isRelevant: true,
        events: [funding({ roundType: "series_a", amountText: "$20M" })],
      },
      isRelevant: true,
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 1,
    });
    await resolveExtraction(db, newer.id);

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    const [round] = await roundRows();
    expect(round?.roundType).toBe("series_a");
    expect(round?.amountMinor).toBe(2_000_000_000);

    const dropped = await insertExtraction(db, {
      sourceItemId: original.sourceItemId,
      promptVersion: "v3",
      model: "test",
      result: { isRelevant: false, events: [] },
      isRelevant: false,
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 1,
    });
    const outcome = await resolveExtraction(db, dropped.id);
    expect(outcome.eventsDeleted).toBe(1);
    expect(await eventRows()).toHaveLength(0);
  });

  it("9. does not depend on arrival order", async () => {
    async function build(order: number[]) {
      const local = await createTestDb();
      const previous = db;
      db = local.db;
      nextItem = 0;
      await db.insert(sources).values([
        {
          slug: "a",
          name: "A",
          kind: "rss",
          url: "https://a.test/f",
          priority: 9,
        },
        {
          slug: "b",
          name: "B",
          kind: "rss",
          url: "https://b.test/f",
          priority: 8,
        },
        {
          slug: "c",
          name: "C",
          kind: "rss",
          url: "https://c.test/f",
          priority: 7,
        },
      ]);
      const reports = [
        await report(
          [
            funding({
              amountText: "$4M",
              investors: [{ name: "Lead", isLead: true }],
            }),
          ],
          { sourceId: 1 },
        ),
        await report([funding({ amountText: "$4.2M" })], {
          sourceId: 2,
          publishedAt: "2026-06-02T12:00:00Z",
        }),
        await report([funding({ amountText: "$4M" })], {
          sourceId: 3,
          publishedAt: "2026-06-03T12:00:00Z",
        }),
      ];
      for (const index of order) {
        await resolveExtraction(
          db,
          (reports[index] as { extractionId: number }).extractionId,
        );
      }
      const [event] = await db.select().from(events);
      const [round] = await db.select().from(fundingRounds);
      const lead = await db.select().from(eventInvestors);
      const snapshot = {
        announcedOn: event?.announcedOn,
        sourceCount: event?.sourceCount,
        amountMinor: round?.amountMinor,
        currency: round?.currency,
        roundType: round?.roundType,
        roles: lead.map((row) => row.role),
        events: (await db.select().from(events)).length,
      };
      await local.close();
      db = previous;
      return snapshot;
    }
    expect(await build([2, 1, 0])).toEqual(await build([0, 1, 2]));
  }, 60_000);

  it("10. fills USD and GBP from stored rates", async () => {
    // 3,000,000 EUR with USD 1.25 and GBP 0.80 per EUR.
    await upsertRates(db, {
      date: "2026-06-01",
      perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
    });
    const one = await report([funding({ amountText: "€3M" })]);
    await resolveExtraction(db, one.extractionId);
    const [round] = await roundRows();
    expect(round?.amountMinor).toBe(300_000_000);
    expect(round?.currency).toBe("EUR");
    expect(round?.amountUsdMinor).toBe(375_000_000);
    expect(round?.amountGbpMinor).toBe(240_000_000);
    expect(round?.fxRateDate).toBe("2026-06-01");
  });

  it("does not let a shared round type alone merge similar names", async () => {
    const first = await report([
      funding({ name: "Open Air", amountText: "$4M" }),
    ]);
    const second = await report([
      funding({ name: "Open AI", amountText: "$90M" }),
    ]);
    await resolveExtraction(db, first.extractionId);
    await resolveExtraction(db, second.extractionId);
    expect(await db.select().from(companies)).toHaveLength(2);
    expect(await db.select().from(mergeCandidates)).toHaveLength(1);
  });

  it("merges similar names when the amounts agree", async () => {
    const first = await report([
      funding({ name: "Mecka AI", amountText: "$60M" }),
    ]);
    const second = await report([
      funding({ name: "Mecka", amountText: "$60 million" }),
    ]);
    await resolveExtraction(db, first.extractionId);
    await resolveExtraction(db, second.extractionId);
    expect(await db.select().from(companies)).toHaveLength(1);
    expect(await eventRows()).toHaveLength(1);
  });

  it("does not split a company on a wrong country when the round agrees", async () => {
    const first = await report([
      funding({ name: "Revolut", countryCode: "GB", amountText: "$60M" }),
    ]);
    const second = await report([
      funding({ name: "Revolut", countryCode: "US", amountText: "$60M" }),
    ]);
    await resolveExtraction(db, first.extractionId);
    await resolveExtraction(db, second.extractionId);
    expect(await db.select().from(companies)).toHaveLength(1);
    expect(await eventRows()).toHaveLength(1);
  });

  it("keeps same-name companies apart when countries differ and nothing agrees", async () => {
    const first = await report([
      funding({ name: "Nova", countryCode: "GB", amountText: "$4M" }),
    ]);
    const second = await report(
      [
        funding({
          name: "Nova",
          countryCode: "US",
          roundType: "series_b",
          amountText: "$90M",
        }),
      ],
      { publishedAt: "2026-06-05T12:00:00Z" },
    );
    await resolveExtraction(db, first.extractionId);
    await resolveExtraction(db, second.extractionId);
    expect(await db.select().from(companies)).toHaveLength(2);
    expect(await db.select().from(mergeCandidates)).toHaveLength(1);
  });
});
