import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectedItem } from "@/core/domain";
import type { Db } from "@/db/client";
import { sourceItems, sourceItemTexts, sources } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { insertExtraction } from "./extractions";
import {
  insertCollectedItems,
  listItemsForReextract,
  listPendingItems,
  markExtracted,
  markFilteredOut,
  recordFailure,
} from "./source-items";
import { upsertSources } from "./sources";

const EMPTY_RESULT = { isRelevant: false, events: [] };

function item(overrides: Partial<CollectedItem> = {}): CollectedItem {
  return {
    sourceSlug: "techcrunch-venture",
    externalId: "item-1",
    url: "https://example.com/news/acme",
    title: "Acme Robotics raises a seed round",
    summary: "Acme raised $4M.",
    publishedAt: new Date("2026-01-15T09:00:00Z"),
    ...overrides,
  };
}

let testDb: TestDb;
let db: Db;
let sourceId: number;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  await upsertSources(db, [
    {
      slug: "techcrunch-venture",
      name: "TechCrunch Venture",
      kind: "rss",
      url: "https://techcrunch.com/category/venture/feed/",
      priority: 9,
      enabled: true,
    },
  ]);
  const [row] = await db.select({ id: sources.id }).from(sources);
  if (!row) throw new Error("expected a source");
  sourceId = row.id;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

describe("insertCollectedItems", () => {
  it("inserts nothing the second time the same feed is stored", async () => {
    const feed = [
      item({ externalId: "a", url: "https://example.com/a", summary: "one" }),
      item({
        externalId: "b",
        url: "https://example.com/b",
        title: "Second",
        summary: null,
        publishedAt: null,
      }),
    ];

    expect(await insertCollectedItems(db, sourceId, feed)).toEqual({
      inserted: 2,
      skipped: 0,
    });
    expect(await insertCollectedItems(db, sourceId, feed)).toEqual({
      inserted: 0,
      skipped: 2,
    });

    const rows = await db.select().from(sourceItems);
    const texts = await db.select().from(sourceItemTexts);
    expect(rows).toHaveLength(2);
    expect(texts).toHaveLength(2);
    expect(texts.map((text) => text.summary).sort()).toEqual([null, "one"]);
  });

  it("dedupes URLs that differ only by utm_source", async () => {
    const first = item({
      externalId: "rss",
      url: "https://example.com/story?utm_source=rss",
      summary: "from the feed",
    });
    const second = item({
      externalId: "newsletter",
      url: "https://example.com/story?utm_source=newsletter",
      summary: "from the newsletter",
    });

    expect(await insertCollectedItems(db, sourceId, [first, second])).toEqual({
      inserted: 1,
      skipped: 1,
    });
    expect(await insertCollectedItems(db, sourceId, [second])).toEqual({
      inserted: 0,
      skipped: 1,
    });

    const rows = await db.select().from(sourceItems);
    const texts = await db.select().from(sourceItemTexts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.canonicalUrl).toBe("https://example.com/story");
    expect(rows[0]?.url).toBe("https://example.com/story?utm_source=rss");
    expect(texts).toHaveLength(1);
    expect(texts[0]?.summary).toBe("from the feed");
  });
});

describe("listPendingItems", () => {
  it("skips filtered_out, extracted and 3-attempt items", async () => {
    await insertCollectedItems(db, sourceId, [
      item({ externalId: "pending", url: "https://example.com/pending" }),
      item({ externalId: "retry", url: "https://example.com/retry" }),
      item({ externalId: "filtered", url: "https://example.com/filtered" }),
      item({ externalId: "extracted", url: "https://example.com/extracted" }),
      item({ externalId: "failed", url: "https://example.com/failed" }),
      item({ externalId: "exhausted", url: "https://example.com/exhausted" }),
    ]);

    const rows = await db.select().from(sourceItems).orderBy(sourceItems.id);
    const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
    const idOf = (externalId: string) => {
      const row = byExternalId.get(externalId);
      if (!row) throw new Error(`missing ${externalId}`);
      return row.id;
    };

    await db
      .update(sourceItems)
      .set({ fetchedAt: new Date("2026-01-02T00:00:00Z"), attempts: 2 })
      .where(eq(sourceItems.id, idOf("retry")));
    await db
      .update(sourceItems)
      .set({ fetchedAt: new Date("2026-01-03T00:00:00Z") })
      .where(eq(sourceItems.id, idOf("pending")));
    await markFilteredOut(db, [idOf("filtered")]);
    await markExtracted(db, idOf("extracted"));
    await db
      .update(sourceItems)
      .set({ status: "failed", attempts: 3 })
      .where(eq(sourceItems.id, idOf("failed")));
    await db
      .update(sourceItems)
      .set({ status: "pending", attempts: 3 })
      .where(eq(sourceItems.id, idOf("exhausted")));

    const pending = await listPendingItems(db, 10);
    expect(pending.map((row) => row.externalId)).toEqual(["retry", "pending"]);
    expect(pending[0]).toMatchObject({
      attempts: 2,
      summary: "Acme raised $4M.",
      sourceName: "TechCrunch Venture",
      status: "pending",
    });
    expect(await listPendingItems(db, 1)).toHaveLength(1);
    expect(await listPendingItems(db, 0)).toEqual([]);
  });
});

describe("recordFailure", () => {
  it("increments attempts and sets failed on the third error", async () => {
    await insertCollectedItems(db, sourceId, [item()]);
    const [stored] = await db.select().from(sourceItems);
    if (!stored) throw new Error("expected an item");

    await recordFailure(db, stored.id, "validation failed");
    await recordFailure(db, stored.id, "still failing");
    const [retrying] = await db.select().from(sourceItems);
    expect(retrying).toMatchObject({
      attempts: 2,
      status: "pending",
      lastError: "still failing",
    });

    await recordFailure(db, stored.id, "gave up");
    const [failed] = await db.select().from(sourceItems);
    expect(failed).toMatchObject({
      attempts: 3,
      status: "failed",
      lastError: "gave up",
    });
    expect(await listPendingItems(db, 10)).toEqual([]);
  });
});

describe("listItemsForReextract", () => {
  it("returns items whose current extraction uses another prompt version", async () => {
    await insertCollectedItems(db, sourceId, [
      item({ externalId: "old", url: "https://example.com/old" }),
      item({ externalId: "current", url: "https://example.com/current" }),
      item({ externalId: "fresh", url: "https://example.com/fresh" }),
    ]);
    const rows = await db.select().from(sourceItems);
    const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
    const old = byExternalId.get("old");
    const current = byExternalId.get("current");
    if (!old || !current) throw new Error("expected stored items");

    await insertExtraction(db, {
      sourceItemId: old.id,
      promptVersion: "v1",
      model: "gpt-4.1-nano",
      result: EMPTY_RESULT,
      isRelevant: false,
      inputTokens: 10,
      outputTokens: 5,
      costUsdMicros: 1,
    });
    await insertExtraction(db, {
      sourceItemId: current.id,
      promptVersion: "v1",
      model: "gpt-4.1-nano",
      result: EMPTY_RESULT,
      isRelevant: false,
      inputTokens: 10,
      outputTokens: 5,
      costUsdMicros: 1,
    });
    await insertExtraction(db, {
      sourceItemId: current.id,
      promptVersion: "v2",
      model: "gpt-4.1-nano",
      result: EMPTY_RESULT,
      isRelevant: false,
      inputTokens: 10,
      outputTokens: 5,
      costUsdMicros: 1,
    });
    await db
      .update(sourceItems)
      .set({ fetchedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(sourceItems.id, old.id));

    const listed = await listItemsForReextract(db, {
      promptVersion: "v2",
      limit: 10,
    });
    expect(listed.map((row) => row.externalId)).toEqual(["old"]);
    expect(listed[0]?.summary).toBe("Acme raised $4M.");
    expect(listed[0]?.sourceName).toBe("TechCrunch Venture");
  });
});
