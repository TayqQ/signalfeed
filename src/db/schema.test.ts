import { eq, type SQL, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "./client";
import {
  acquisitions,
  companies,
  EMBEDDING_DIMENSIONS,
  eventInvestors,
  events,
  eventSources,
  extractions,
  fundingRounds,
  investors,
  launches,
  launchMetricSnapshots,
  sourceItems,
  sources,
  tags,
} from "./schema";
import { createTestDb, type TestDb } from "./testing";

const EXPECTED_TABLES = [
  "acquisitions",
  "companies",
  "company_aliases",
  "company_tags",
  "entity_merges",
  "event_investors",
  "event_sources",
  "events",
  "extractions",
  "funding_rounds",
  "fx_rates",
  "ingest_runs",
  "investor_aliases",
  "investors",
  "launch_metric_snapshots",
  "launches",
  "llm_usage",
  "merge_candidates",
  "source_item_texts",
  "source_items",
  "sources",
  "tags",
];

const EMPTY_RESULT: ExtractionV1 = { isRelevant: false, events: [] };

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

/** Postgres SQLSTATE of a failed query, looking through Drizzle's error wrapper. */
async function sqlState(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error) {
      if ("code" in current && typeof current.code === "string") {
        return current.code;
      }
      current = current.cause;
    }
    throw error;
  }
  return undefined;
}

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

/** Rows of a raw query. `Db` is driver-agnostic, so `execute` cannot infer them. */
async function selectRows<T>(query: SQL): Promise<T[]> {
  const result: unknown = await db.execute<Record<string, unknown>>(query);
  return (result as { rows: T[] }).rows;
}

async function insertSource(slug = "techcrunch-venture") {
  const [source] = await db
    .insert(sources)
    .values({
      slug,
      name: "TechCrunch Venture",
      kind: "rss",
      url: `https://example.com/${slug}/feed`,
      priority: 10,
    })
    .returning();
  return source!;
}

async function insertSourceItem(sourceId: number, n: number) {
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId,
      externalId: `item-${n}`,
      url: `https://example.com/news/${n}?utm_source=rss`,
      canonicalUrl: `https://example.com/news/${n}`,
      title: `Acme Robotics raises funding ${n}`,
      publishedAt: new Date("2026-09-01T09:00:00Z"),
    })
    .returning();
  return item!;
}

async function insertExtraction(
  sourceItemId: number,
  promptVersion: string,
  isCurrent: boolean,
) {
  return db
    .insert(extractions)
    .values({
      sourceItemId,
      promptVersion,
      model: "gpt-4.1-nano",
      result: EMPTY_RESULT,
      isRelevant: false,
      isCurrent,
      inputTokens: 300,
      outputTokens: 120,
      costUsdMicros: 75,
    })
    .returning();
}

async function insertCompany(slug = "acme-robotics") {
  const [company] = await db
    .insert(companies)
    .values({
      slug,
      name: "Acme Robotics",
      normalisedName: "acme robotics",
      countryCode: "GB",
    })
    .returning();
  return company!;
}

async function insertFundedEvent() {
  const source = await insertSource();
  const item = await insertSourceItem(source.id, 1);
  const [extraction] = await insertExtraction(item.id, "v1", true);
  const company = await insertCompany();
  const [investor] = await db
    .insert(investors)
    .values({
      slug: "example-ventures",
      name: "Example Ventures",
      normalisedName: "example ventures",
      kind: "vc",
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId: company.id,
      announcedOn: "2026-09-01",
      sourceCount: 1,
    })
    .returning();
  await db.insert(fundingRounds).values({
    eventId: event!.id,
    roundType: "series_a",
    roundLabel: "Series A",
    amountMinor: 1_250_000_000,
    currency: "USD",
    amountUsdMinor: 1_250_000_000,
    amountGbpMinor: 925_000_000,
    fxRateDate: "2026-09-01",
  });
  await db
    .insert(eventInvestors)
    .values({ eventId: event!.id, investorId: investor!.id, role: "lead" });
  await db.insert(eventSources).values({
    eventId: event!.id,
    extractionId: extraction!.id,
    sourceItemId: item.id,
    eventIndex: 0,
  });
  return { event: event!, company, investor: investor!, item };
}

describe("schema migrations", () => {
  it("create every table", async () => {
    const rows = await selectRows<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("give each createTestDb call its own database", async () => {
    await insertSource();
    const other = await createTestDb();
    try {
      expect(await other.db.select().from(sources)).toEqual([]);
    } finally {
      await other.close();
    }
  }, 30_000);
});

describe("events", () => {
  it("store a funding round with detail, investor and source", async () => {
    const { event } = await insertFundedEvent();

    const loaded = await db.query.events.findFirst({
      where: eq(events.id, event.id),
      with: {
        company: true,
        fundingRound: true,
        investors: { with: { investor: true } },
        sources: { with: { sourceItem: true } },
      },
    });

    expect(loaded).toMatchObject({
      type: "funding_round",
      announcedOn: "2026-09-01",
      datePrecision: "day",
      evidence: "reported",
      company: { slug: "acme-robotics" },
      fundingRound: {
        roundType: "series_a",
        amountMinor: 1_250_000_000,
        currency: "USD",
        amountGbpMinor: 925_000_000,
        includesIndividualAngels: false,
      },
      investors: [{ role: "lead", investor: { slug: "example-ventures" } }],
      sources: [
        {
          eventIndex: 0,
          sourceItem: { canonicalUrl: "https://example.com/news/1" },
        },
      ],
    });
  });

  it("cascade deletes to detail and link rows", async () => {
    const { event } = await insertFundedEvent();
    await db.insert(launchMetricSnapshots).values({
      eventId: event.id,
      metric: "points",
      value: 42,
    });

    await db.delete(events).where(eq(events.id, event.id));

    expect(await db.select().from(fundingRounds)).toEqual([]);
    expect(await db.select().from(eventInvestors)).toEqual([]);
    expect(await db.select().from(eventSources)).toEqual([]);
    expect(await db.select().from(launchMetricSnapshots)).toEqual([]);
    expect(await db.select().from(companies)).toHaveLength(1);
    expect(await db.select().from(investors)).toHaveLength(1);
    expect(await db.select().from(extractions)).toHaveLength(1);
  });

  it("cascade deletes acquisition and launch details", async () => {
    const company = await insertCompany();
    const [acquisition, launch] = await db
      .insert(events)
      .values([
        {
          type: "acquisition",
          companyId: company.id,
          announcedOn: "2026-09-02",
        },
        { type: "launch", companyId: company.id, announcedOn: "2026-09-03" },
      ])
      .returning();
    await db
      .insert(acquisitions)
      .values({ eventId: acquisition!.id, acquirerName: "Example Corp" });
    await db.insert(launches).values({
      eventId: launch!.id,
      kind: "show_hn",
      productName: "Acme Arm",
    });

    await db.delete(events);

    expect(await db.select().from(acquisitions)).toEqual([]);
    expect(await db.select().from(launches)).toEqual([]);
  });

  it("reject an amount without a currency", async () => {
    const company = await insertCompany();
    const [event] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: company.id,
        announcedOn: "2026-09-01",
      })
      .returning();

    const state = await sqlState(
      db.insert(fundingRounds).values({ eventId: event!.id, amountMinor: 100 }),
    );
    expect(state).toBe(CHECK_VIOLATION);
  });
});

describe("source items and extractions", () => {
  it("reject a second item with the same canonical URL", async () => {
    const source = await insertSource();
    await insertSourceItem(source.id, 1);

    const state = await sqlState(
      db.insert(sourceItems).values({
        sourceId: source.id,
        externalId: "another-guid",
        url: "https://example.com/news/1?utm_medium=feed",
        canonicalUrl: "https://example.com/news/1",
        title: "Acme Robotics raises funding",
      }),
    );
    expect(state).toBe(UNIQUE_VIOLATION);
  });

  it("allow only one current extraction per item", async () => {
    const source = await insertSource();
    const item = await insertSourceItem(source.id, 1);
    await insertExtraction(item.id, "v1", true);

    expect(await sqlState(insertExtraction(item.id, "v2", true))).toBe(
      UNIQUE_VIOLATION,
    );
    expect(
      await sqlState(insertExtraction(item.id, "v2", false)),
    ).toBeUndefined();
    expect(await db.select().from(extractions)).toHaveLength(2);
  });
});

describe("extensions", () => {
  it("run trigram similarity", async () => {
    const [row] = await selectRows<{ score: number }>(
      sql`SELECT similarity('acme robotics', 'acme robotic') AS score`,
    );
    expect(row!.score).toBeGreaterThan(0.6);
  });

  it("store and read back a 512-dimension vector", async () => {
    // Multiples of 1/16 survive pgvector's float4 text format exactly.
    const embedding = Array.from(
      { length: EMBEDDING_DIMENSIONS },
      (_, i) => ((i % 33) - 16) / 16,
    );
    const [tag] = await db
      .insert(tags)
      .values({
        slug: "ai-agents",
        label: "ai agents",
        embedding,
        embeddingModel: "text-embedding-3-small",
      })
      .returning();

    const [loaded] = await db.select().from(tags).where(eq(tags.id, tag!.id));
    expect(loaded!.embedding).toEqual(embedding);
  });
});
