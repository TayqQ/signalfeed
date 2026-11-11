import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { eq, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALIAS_SOURCES, LLM_PURPOSES, SOURCE_KINDS } from "@/core/enums";
import type { ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "./client";
import {
  acquisitions,
  companies,
  companyAliases,
  companyLocations,
  EMBEDDING_DIMENSIONS,
  eventInvestors,
  eventRecordSources,
  events,
  eventSources,
  extractions,
  fundingRoundMomentum,
  fundingRounds,
  grantProjects,
  grantProjectTexts,
  investors,
  launches,
  launchMetricSnapshots,
  llmUsage,
  sourceItems,
  sources,
  tags,
  tagThemes,
  themes,
  themeWeeklyStats,
  weeklyTotals,
} from "./schema";
import { createTestDb, type TestDb } from "./testing";

const EXPECTED_TABLES = [
  "acquisitions",
  "companies",
  "company_aliases",
  "company_locations",
  "company_tags",
  "company_themes",
  "derived_rebuilds",
  "entity_merges",
  "event_investors",
  "event_record_sources",
  "event_sources",
  "events",
  "extractions",
  "funding_round_momentum",
  "funding_rounds",
  "fx_rates",
  "grant_participants",
  "grant_project_texts",
  "grant_projects",
  "grant_taggings",
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
  "tag_themes",
  "tags",
  "theme_weekly_stats",
  "themes",
  "weekly_totals",
];

/** Primary key columns of every Phase 2 table, in key order. */
const PHASE_2_PRIMARY_KEYS: Record<string, string[]> = {
  company_locations: ["company_id"],
  company_themes: ["company_id", "theme_id"],
  derived_rebuilds: ["name"],
  event_record_sources: ["event_id", "record_kind", "record_id"],
  funding_round_momentum: ["event_id"],
  grant_participants: ["id"],
  grant_project_texts: ["project_id"],
  grant_projects: ["id"],
  grant_taggings: ["id"],
  tag_themes: ["tag_id"],
  theme_weekly_stats: ["theme_id", "week_start"],
  themes: ["id"],
  weekly_totals: ["week_start"],
};

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_FOLDER)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function migrationStatements(file: string): string[] {
  return readFileSync(`${MIGRATIONS_FOLDER}/${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function newPglite(): Promise<PGlite> {
  return PGlite.create({ extensions: { vector, pg_trgm } });
}

/** A test vector whose values survive pgvector's float4 text format exactly. */
function testVector(offset = 0): number[] {
  return Array.from(
    { length: EMBEDDING_DIMENSIONS },
    (_, i) => (((i + offset) % 33) - 16) / 16,
  );
}

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

async function insertTag(slug = "ai-agents") {
  const [tag] = await db
    .insert(tags)
    .values({ slug, label: slug.replaceAll("-", " ") })
    .returning();
  return tag!;
}

async function insertTheme(slug = "ai-agents") {
  const tag = await insertTag(slug);
  const [theme] = await db
    .insert(themes)
    .values({
      slug,
      name: tag.label,
      seedTagId: tag.id,
      centroid: testVector(),
      embeddingModel: "text-embedding-3-small",
    })
    .returning();
  return { theme: theme!, tag };
}

describe("phase 2 migration", () => {
  it("gives every new table its primary key", async () => {
    const rows = await selectRows<{ table_name: string; columns: string[] }>(
      sql`
        SELECT tc.table_name,
               array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
        GROUP BY tc.table_name
      `,
    );
    const keys = Object.fromEntries(
      rows.map((row) => [row.table_name, row.columns]),
    );
    for (const [table, columns] of Object.entries(PHASE_2_PRIMARY_KEYS)) {
      expect(keys[table], table).toEqual(columns);
    }
  });

  it("matches the appended enum values in src/core/enums.ts", async () => {
    const [row] = await selectRows<{
      source_kind: string;
      llm_purpose: string;
      alias_source: string;
    }>(sql`
      SELECT enum_range(NULL::source_kind)::text AS source_kind,
             enum_range(NULL::llm_purpose)::text AS llm_purpose,
             enum_range(NULL::alias_source)::text AS alias_source
    `);
    const asPgArray = (values: readonly string[]) => `{${values.join(",")}}`;
    expect(row).toEqual({
      source_kind: asPgArray(SOURCE_KINDS),
      llm_purpose: asPgArray(LLM_PURPOSES),
      alias_source: asPgArray(ALIAS_SOURCES),
    });
  });

  it("accepts the appended enum values", async () => {
    await insertSource();
    const company = await insertCompany();

    await db.insert(sources).values({
      slug: "ukri-gtr",
      name: "UKRI Gateway to Research",
      kind: "ukri_gtr",
      url: "https://example.com/gtr",
    });
    await db.insert(companyAliases).values({
      companyId: company.id,
      alias: "Acme Robotics Ltd",
      normalisedAlias: "acme robotics",
      source: "grant",
    });
    await db.insert(llmUsage).values(
      (["theme_naming", "tagging"] as const).map((purpose) => ({
        purpose,
        model: "gpt-4.1-nano",
        inputTokens: 10,
        outputTokens: 5,
        costUsdMicros: 1,
      })),
    );

    const kinds = await db.select({ kind: sources.kind }).from(sources);
    expect(kinds.map((row) => row.kind).sort()).toEqual(["rss", "ukri_gtr"]);
  });

  it("leaves existing rows untouched when it appends enum values", async () => {
    const client = await newPglite();
    try {
      const [phase2, ...earlier] = migrationFiles().reverse();
      for (const file of earlier.reverse()) {
        for (const statement of migrationStatements(file)) {
          await client.exec(statement);
        }
      }
      await client.exec(`
        INSERT INTO sources (slug, name, kind, url)
          VALUES ('old-feed', 'Old feed', 'rss', 'https://example.com/feed');
        INSERT INTO companies (slug, name, normalised_name)
          VALUES ('acme', 'Acme', 'acme');
        INSERT INTO company_aliases (company_id, alias, normalised_alias, source)
          VALUES (1, 'Acme Ltd', 'acme', 'extraction');
        INSERT INTO llm_usage (purpose, model, input_tokens, output_tokens, cost_usd_micros)
          VALUES ('extraction', 'gpt-4.1-nano', 10, 5, 1);
      `);
      const snapshot = `
        SELECT (SELECT row_to_json(s) FROM sources s) AS source,
               (SELECT row_to_json(a) FROM company_aliases a) AS alias,
               (SELECT row_to_json(u) FROM llm_usage u) AS usage
      `;
      const before = await client.query(snapshot);

      for (const statement of migrationStatements(phase2!)) {
        await client.exec(statement);
      }

      expect((await client.query(snapshot)).rows).toEqual(before.rows);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("is a no-op when applied a second time", async () => {
    const client = await newPglite();
    try {
      const pglite = drizzle({ client });
      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });
      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });
      const applied = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
      );
      expect(applied.rows[0]!.count).toBe(migrationFiles().length);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("has no DROP, column type change or UPDATE", () => {
    const phase2 = migrationFiles().find((file) => file.startsWith("0002_"));
    expect(phase2).toBeDefined();
    const text = readFileSync(`${MIGRATIONS_FOLDER}/${phase2}`, "utf8");
    expect(text).not.toMatch(/\bDROP\b/i);
    expect(text).not.toMatch(/ALTER COLUMN/i);
    expect(text).not.toMatch(/^\s*UPDATE\b/im);
  });
});

describe("themes", () => {
  it("store and read back a 512-dimension centroid", async () => {
    const { theme } = await insertTheme();

    const [loaded] = await db
      .select()
      .from(themes)
      .where(eq(themes.id, theme.id));
    expect(loaded).toMatchObject({
      centroid: testVector(),
      status: "active",
      nameSource: "tag",
      mergedIntoId: null,
    });
  });

  it("require merged_into_id exactly when the status is merged", async () => {
    const { theme: into } = await insertTheme("ai-agents");
    const { theme: from } = await insertTheme("agentic-ai");

    expect(
      await sqlState(
        db
          .update(themes)
          .set({ status: "merged" })
          .where(eq(themes.id, from.id)),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db
          .update(themes)
          .set({ mergedIntoId: into.id })
          .where(eq(themes.id, from.id)),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db
          .update(themes)
          .set({ status: "merged", mergedIntoId: from.id })
          .where(eq(themes.id, from.id)),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db
          .update(themes)
          .set({ status: "merged", mergedIntoId: into.id })
          .where(eq(themes.id, from.id)),
      ),
    ).toBeUndefined();
  });

  it("let a person put a tag in no theme", async () => {
    const tag = await insertTag("startup");

    await db
      .insert(tagThemes)
      .values({ tagId: tag.id, themeId: null, assignedBy: "manual" });

    const [link] = await db.select().from(tagThemes);
    expect(link).toMatchObject({
      tagId: tag.id,
      themeId: null,
      similarity: null,
    });
  });
});

describe("derived tables", () => {
  it("reject a week_start that is not a Monday", async () => {
    const { theme } = await insertTheme();
    const tuesday = "2026-11-10";
    const monday = "2026-11-09";

    expect(
      await sqlState(
        db
          .insert(themeWeeklyStats)
          .values({ themeId: theme.id, weekStart: tuesday }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(db.insert(weeklyTotals).values({ weekStart: tuesday })),
    ).toBe(CHECK_VIOLATION);

    await db
      .insert(themeWeeklyStats)
      .values({ themeId: theme.id, weekStart: monday, rounds: 2 });
    await db.insert(weeklyTotals).values({ weekStart: monday, rounds: 2 });
    expect(await db.select().from(weeklyTotals)).toHaveLength(1);
  });

  it("reject negative counts and money", async () => {
    const { theme } = await insertTheme();

    expect(
      await sqlState(
        db.insert(themeWeeklyStats).values({
          themeId: theme.id,
          weekStart: "2026-11-09",
          totalGbpMinor: -1,
        }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db.insert(weeklyTotals).values({ weekStart: "2026-11-09", grants: -1 }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("require latitude and longitude together", async () => {
    const company = await insertCompany();
    const base = {
      companyId: company.id,
      countryCode: "GB",
      itl1Code: "TLE",
      precision: "town",
      source: "news_city",
    } as const;

    expect(
      await sqlState(
        db.insert(companyLocations).values({ ...base, latitude: 53.8 }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db
          .insert(companyLocations)
          .values({ ...base, latitude: 53.8, longitude: -1.55 }),
      ),
    ).toBeUndefined();
  });

  it("cascade event deletes to momentum and record sources", async () => {
    const { event, company } = await insertFundedEvent();
    await db.insert(fundingRoundMomentum).values({
      eventId: event.id,
      companyId: company.id,
      equityRoundNumber: 1,
      roundsIn24mToDate: 1,
    });
    await db
      .insert(eventRecordSources)
      .values({ eventId: event.id, recordKind: "ukri_grant", recordId: 1 });

    await db.delete(events).where(eq(events.id, event.id));

    expect(await db.select().from(fundingRoundMomentum)).toEqual([]);
    expect(await db.select().from(eventRecordSources)).toEqual([]);
  });
});

describe("grants", () => {
  it("reject an abstract longer than 1,500 characters", async () => {
    const source = await insertSource("ukri-gtr");
    const [project] = await db
      .insert(grantProjects)
      .values({
        sourceId: source.id,
        gtrProjectId: "00000000-0000-0000-0000-000000000001",
        title: "Invented robotics project",
        grantCategory: "Collaborative R&D",
        leadFunder: "Innovate UK",
        status: "Active",
        gtrUrl: "https://example.com/gtr/projects/1",
      })
      .returning();

    expect(
      await sqlState(
        db
          .insert(grantProjectTexts)
          .values({ projectId: project!.id, abstract: "a".repeat(1501) }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db
          .insert(grantProjectTexts)
          .values({ projectId: project!.id, abstract: "a".repeat(1500) }),
      ),
    ).toBeUndefined();
  });
});
