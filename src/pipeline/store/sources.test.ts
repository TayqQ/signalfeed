import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceConfig } from "@/core/domain";
import type { Db } from "@/db/client";
import { sources } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { listEnabledSources, updateFetchState, upsertSources } from "./sources";

function sourceConfig(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    slug: "techcrunch-venture",
    name: "TechCrunch Venture",
    kind: "rss",
    url: "https://techcrunch.com/category/venture/feed/",
    priority: 9,
    enabled: true,
    ...overrides,
  };
}

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

describe("upsertSources", () => {
  it("inserts a source and updates name, url, priority and enabled by slug", async () => {
    await upsertSources(db, [sourceConfig()]);
    await updateFetchState(db, 1, {
      etag: '"feed-v1"',
      lastModified: "Wed, 01 Jan 2026 00:00:00 GMT",
      fetchedAt: new Date("2026-01-02T00:00:00Z"),
    });

    await upsertSources(db, [
      sourceConfig({
        name: "TechCrunch Venture Capital",
        kind: "github",
        url: "https://techcrunch.com/venture/feed/",
        priority: 4,
        enabled: false,
      }),
    ]);

    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "techcrunch-venture",
      name: "TechCrunch Venture Capital",
      kind: "rss",
      url: "https://techcrunch.com/venture/feed/",
      priority: 4,
      enabled: false,
      etag: '"feed-v1"',
      lastModified: "Wed, 01 Jan 2026 00:00:00 GMT",
    });
  });

  it("does nothing for an empty list", async () => {
    await upsertSources(db, []);
    expect(await db.select().from(sources)).toEqual([]);
  });
});

describe("listEnabledSources", () => {
  it("returns enabled sources with id, config and fetch validators", async () => {
    await upsertSources(db, [
      sourceConfig({ slug: "low", name: "Low", priority: 1, enabled: true }),
      sourceConfig({
        slug: "sifted",
        name: "Sifted",
        priority: 6,
        enabled: false,
      }),
      sourceConfig({ slug: "high", name: "High", priority: 9, enabled: true }),
    ]);
    const enabled = await listEnabledSources(db);
    const high = enabled.find((source) => source.config.slug === "high");
    if (!high) throw new Error("expected the high-priority source");

    await updateFetchState(db, high.id, {
      etag: "abc",
      lastModified: null,
      fetchedAt: new Date("2026-03-01T12:00:00Z"),
    });

    const listed = await listEnabledSources(db);
    expect(listed.map((source) => source.config.slug)).toEqual(["high", "low"]);
    expect(listed[0]).toMatchObject({
      id: high.id,
      etag: "abc",
      lastModified: null,
      config: {
        slug: "high",
        name: "High",
        kind: "rss",
        priority: 9,
        enabled: true,
      },
    });

    const stored = await db
      .select({ lastFetchedAt: sources.lastFetchedAt })
      .from(sources)
      .where(eq(sources.id, high.id));
    expect(stored[0]?.lastFetchedAt).toEqual(new Date("2026-03-01T12:00:00Z"));
  });
});
