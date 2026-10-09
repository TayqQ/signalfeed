import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "@/db/client";
import { extractions, sourceItems, sources } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  insertExtraction,
  listSupersededExtractionIds,
  listUnresolvedExtractions,
  markResolved,
  type NewExtraction,
} from "./extractions";
import { insertCollectedItems } from "./source-items";
import { upsertSources } from "./sources";

const ORIGINAL: ExtractionV1 = { isRelevant: false, events: [] };
const REPLACEMENT: ExtractionV1 = {
  isRelevant: true,
  events: [
    {
      type: "funding_round",
      company: {
        name: "Acme Robotics",
        websiteDomain: null,
        description: null,
        countryCode: "GB",
        city: null,
        foundedYear: null,
        tags: [],
      },
      announcedOn: "2026-01-15",
      funding: {
        roundType: "seed",
        roundLabel: null,
        amountText: "$4M",
        currencyHint: "USD",
        investors: [],
        includesIndividualAngels: false,
      },
      acquisition: null,
      launch: null,
    },
  ],
};

function extraction(
  sourceItemId: number,
  overrides: Partial<NewExtraction> = {},
): NewExtraction {
  return {
    sourceItemId,
    promptVersion: "v1",
    model: "gpt-4.1-nano",
    result: ORIGINAL,
    isRelevant: false,
    inputTokens: 300,
    outputTokens: 80,
    costUsdMicros: 40,
    ...overrides,
  };
}

let testDb: TestDb;
let db: Db;
let sourceItemId: number;

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
  const [source] = await db.select({ id: sources.id }).from(sources);
  if (!source) throw new Error("expected a source");
  await insertCollectedItems(db, source.id, [
    {
      sourceSlug: "techcrunch-venture",
      externalId: "story",
      url: "https://example.com/story",
      title: "Acme Robotics raises $4M",
      summary: "A seed round.",
      publishedAt: new Date("2026-01-15T09:00:00Z"),
    },
  ]);
  const [item] = await db.select({ id: sourceItems.id }).from(sourceItems);
  if (!item) throw new Error("expected a source item");
  sourceItemId = item.id;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

describe("insertExtraction", () => {
  it("does nothing when the same extraction is inserted again", async () => {
    const first = await insertExtraction(db, extraction(sourceItemId));
    const second = await insertExtraction(
      db,
      extraction(sourceItemId, {
        result: REPLACEMENT,
        isRelevant: true,
        inputTokens: 999,
        outputTokens: 999,
        costUsdMicros: 999,
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.result).toEqual(ORIGINAL);
    expect(second.costUsdMicros).toBe(40);
    expect(second.isCurrent).toBe(true);

    const rows = await db.select().from(extractions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toEqual(ORIGINAL);
  });

  it("makes a new prompt version current and keeps the previous row", async () => {
    const first = await insertExtraction(db, extraction(sourceItemId));
    const second = await insertExtraction(
      db,
      extraction(sourceItemId, {
        promptVersion: "v2",
        result: REPLACEMENT,
        isRelevant: true,
      }),
    );

    const rows = await db.select().from(extractions).orderBy(extractions.id);
    expect(
      rows.map((row) => [row.id, row.promptVersion, row.isCurrent]),
    ).toEqual([
      [first.id, "v1", false],
      [second.id, "v2", true],
    ]);
    expect(await listSupersededExtractionIds(db, sourceItemId)).toEqual([
      first.id,
    ]);

    const replayed = await insertExtraction(db, extraction(sourceItemId));
    expect(replayed.id).toBe(first.id);
    const afterReplay = await db
      .select()
      .from(extractions)
      .where(eq(extractions.id, second.id));
    expect(afterReplay[0]?.isCurrent).toBe(true);
    expect(await listSupersededExtractionIds(db, sourceItemId)).toEqual([
      first.id,
    ]);
  });
});

describe("listUnresolvedExtractions", () => {
  it("returns the current unresolved extraction with its source context", async () => {
    const created = await insertExtraction(
      db,
      extraction(sourceItemId, { result: REPLACEMENT, isRelevant: true }),
    );

    const unresolved = await listUnresolvedExtractions(db, 10);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({
      id: created.id,
      sourceItemId,
      promptVersion: "v1",
      model: "gpt-4.1-nano",
      isRelevant: true,
      title: "Acme Robotics raises $4M",
      url: "https://example.com/story",
      publishedAt: new Date("2026-01-15T09:00:00Z"),
      summary: "A seed round.",
      sourcePriority: 9,
      sourceName: "TechCrunch Venture",
    });
    expect(unresolved[0]?.result).toEqual(REPLACEMENT);

    await markResolved(db, created.id);
    expect(await listUnresolvedExtractions(db, 10)).toEqual([]);

    const stored = await db
      .select({ resolvedAt: extractions.resolvedAt })
      .from(extractions)
      .where(eq(extractions.id, created.id));
    expect(stored[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it("omits an extraction that a newer prompt version replaced", async () => {
    const first = await insertExtraction(db, extraction(sourceItemId));
    await insertExtraction(
      db,
      extraction(sourceItemId, { promptVersion: "v2" }),
    );

    const unresolved = await listUnresolvedExtractions(db, 10);
    expect(unresolved.map((row) => row.id)).not.toContain(first.id);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.promptVersion).toBe("v2");
  });
});
