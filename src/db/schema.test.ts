import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { eq, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALIAS_SOURCES,
  FOUNDED_YEAR_SOURCES,
  LINK_DECIDED_BY,
  LLM_PURPOSES,
  LOCATION_SOURCES,
  RECORD_KINDS,
  REGISTRY_KINDS,
  REGISTRY_LINK_METHODS,
  REGISTRY_LINK_STATUSES,
  REGISTRY_SEARCH_OUTCOMES,
  SECTOR_SOURCES,
  SOURCE_KINDS,
} from "@/core/enums";
import type { ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "./client";
import {
  acquisitions,
  chAddressCounts,
  companies,
  companyAliases,
  companyLocations,
  companySectors,
  EMBEDDING_DIMENSIONS,
  edgarIndexDays,
  eventConfirmations,
  eventInvestors,
  eventRecordSources,
  events,
  eventSources,
  extractions,
  formDFilings,
  fundingRoundMomentum,
  fundingRounds,
  grantProjects,
  grantProjectTexts,
  investors,
  launches,
  launchMetricSnapshots,
  llmUsage,
  registryLinks,
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
  "ch_address_counts",
  "ch_companies",
  "ch_filings",
  "companies",
  "company_aliases",
  "company_locations",
  "company_sectors",
  "company_tags",
  "company_themes",
  "derived_rebuilds",
  "edgar_index_days",
  "entity_merges",
  "event_confirmations",
  "event_investors",
  "event_record_sources",
  "event_sources",
  "events",
  "extractions",
  "form_d_filings",
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
  "registry_links",
  "registry_searches",
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

/** Primary key columns of every Phase 3 table, in key order. */
const PHASE_3_PRIMARY_KEYS: Record<string, string[]> = {
  ch_address_counts: ["postcode"],
  ch_companies: ["company_number"],
  ch_filings: ["id"],
  company_sectors: ["company_id", "sector"],
  edgar_index_days: ["day"],
  event_confirmations: ["event_id", "record_kind", "record_id"],
  form_d_filings: ["id"],
  registry_links: ["id"],
  registry_searches: ["company_id", "registry"],
};

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_FOLDER)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** The migration file whose name starts with `prefix`, such as "0003_". */
function migrationFile(prefix: string): string {
  const file = migrationFiles().find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`No migration starting with ${prefix}`);
  return file;
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

/** Primary key columns of every table, by table name. */
async function primaryKeys(): Promise<Record<string, string[]>> {
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
  return Object.fromEntries(rows.map((row) => [row.table_name, row.columns]));
}

const asPgArray = (values: readonly string[]) => `{${values.join(",")}}`;

/**
 * Applies every migration before `file`, inserts rows that use only old enum
 * values, applies `file`, and checks the rows are unchanged.
 */
async function expectRowsUntouchedBy(file: string): Promise<void> {
  const client = await newPglite();
  try {
    for (const earlier of migrationFiles().filter((name) => name < file)) {
      for (const statement of migrationStatements(earlier)) {
        await client.exec(statement);
      }
    }
    await client.exec(`
      INSERT INTO sources (slug, name, kind, url)
        VALUES ('old-feed', 'Old feed', 'rss', 'https://example.com/feed');
      INSERT INTO companies (slug, name, normalised_name, founded_year, founded_year_source)
        VALUES ('acme', 'Acme', 'acme', 2021, 'news');
      INSERT INTO company_aliases (company_id, alias, normalised_alias, source)
        VALUES (1, 'Acme Ltd', 'acme', 'extraction');
      INSERT INTO llm_usage (purpose, model, input_tokens, output_tokens, cost_usd_micros)
        VALUES ('extraction', 'gpt-4.1-nano', 10, 5, 1);
    `);
    const snapshot = `
      SELECT (SELECT row_to_json(s) FROM sources s) AS source,
             (SELECT row_to_json(c) FROM companies c) AS company,
             (SELECT row_to_json(a) FROM company_aliases a) AS alias,
             (SELECT row_to_json(u) FROM llm_usage u) AS usage
    `;
    const before = await client.query(snapshot);

    for (const statement of migrationStatements(file)) {
      await client.exec(statement);
    }

    expect((await client.query(snapshot)).rows).toEqual(before.rows);
  } finally {
    await client.close();
  }
}

/** Phase migrations may only add: no DROP, no column type change, no UPDATE. */
function expectAdditiveOnly(file: string): void {
  const text = readFileSync(`${MIGRATIONS_FOLDER}/${file}`, "utf8");
  expect(text).not.toMatch(/\bDROP\b/i);
  expect(text).not.toMatch(/ALTER COLUMN/i);
  expect(text).not.toMatch(/^\s*UPDATE\b/im);
}

describe("phase 2 migration", () => {
  it("gives every new table its primary key", async () => {
    const keys = await primaryKeys();
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
    await expectRowsUntouchedBy(migrationFile("0002_"));
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
    expectAdditiveOnly(migrationFile("0002_"));
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

async function insertLink(
  companyId: number,
  registryId: string,
  status: "linked" | "candidate" | "rejected",
  registry: "companies_house" | "sec_edgar" = "companies_house",
) {
  return db.insert(registryLinks).values({
    companyId,
    registry,
    registryId,
    registryName: "ACME ROBOTICS LTD",
    status,
    method: status === "linked" ? "name_filing" : null,
    reason: "test",
    decidedBy: "auto",
  });
}

describe("phase 3 migration", () => {
  it("gives every new table its primary key", async () => {
    const keys = await primaryKeys();
    for (const [table, columns] of Object.entries(PHASE_3_PRIMARY_KEYS)) {
      expect(keys[table], table).toEqual(columns);
    }
  });

  it("matches the appended and new enum values in src/core/enums.ts", async () => {
    const [row] = await selectRows<Record<string, string>>(sql`
      SELECT enum_range(NULL::alias_source)::text AS alias_source,
             enum_range(NULL::founded_year_source)::text AS founded_year_source,
             enum_range(NULL::llm_purpose)::text AS llm_purpose,
             enum_range(NULL::location_source)::text AS location_source,
             enum_range(NULL::record_kind)::text AS record_kind,
             enum_range(NULL::registry_kind)::text AS registry_kind,
             enum_range(NULL::registry_link_status)::text AS registry_link_status,
             enum_range(NULL::registry_link_method)::text AS registry_link_method,
             enum_range(NULL::link_decided_by)::text AS link_decided_by,
             enum_range(NULL::registry_search_outcome)::text AS registry_search_outcome,
             enum_range(NULL::sector_source)::text AS sector_source
    `);
    expect(row).toEqual({
      alias_source: asPgArray(ALIAS_SOURCES),
      founded_year_source: asPgArray(FOUNDED_YEAR_SOURCES),
      llm_purpose: asPgArray(LLM_PURPOSES),
      location_source: asPgArray(LOCATION_SOURCES),
      record_kind: asPgArray(RECORD_KINDS),
      registry_kind: asPgArray(REGISTRY_KINDS),
      registry_link_status: asPgArray(REGISTRY_LINK_STATUSES),
      registry_link_method: asPgArray(REGISTRY_LINK_METHODS),
      link_decided_by: asPgArray(LINK_DECIDED_BY),
      registry_search_outcome: asPgArray(REGISTRY_SEARCH_OUTCOMES),
      sector_source: asPgArray(SECTOR_SOURCES),
    });
  });

  it("leaves existing rows untouched", async () => {
    await expectRowsUntouchedBy(migrationFile("0003_"));
  }, 30_000);

  it("has no DROP, column type change or UPDATE", () => {
    expectAdditiveOnly(migrationFile("0003_"));
  });

  it("allows one linked row per company and registry", async () => {
    const company = await insertCompany();
    await insertLink(company.id, "09876543", "linked");

    expect(await sqlState(insertLink(company.id, "01234567", "linked"))).toBe(
      UNIQUE_VIOLATION,
    );
    expect(
      await sqlState(insertLink(company.id, "01234567", "candidate")),
    ).toBeUndefined();
    expect(
      await sqlState(insertLink(company.id, "1999999", "linked", "sec_edgar")),
    ).toBeUndefined();
  });

  it("allows one linked row per registry number", async () => {
    const first = await insertCompany("acme-robotics");
    const second = await insertCompany("acmerobotics");
    await insertLink(first.id, "09876543", "linked");

    expect(await sqlState(insertLink(second.id, "09876543", "linked"))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it("allows candidates for the same number on two companies", async () => {
    const first = await insertCompany("acme-robotics");
    const second = await insertCompany("acmerobotics");

    await insertLink(first.id, "09876543", "candidate");
    await insertLink(second.id, "09876543", "candidate");
    await insertLink(second.id, "01234567", "rejected");

    expect(await db.select().from(registryLinks)).toHaveLength(3);
  });

  it("requires a method on a linked row", async () => {
    const company = await insertCompany();

    expect(
      await sqlState(
        db.insert(registryLinks).values({
          companyId: company.id,
          registry: "companies_house",
          registryId: "09876543",
          registryName: "ACME ROBOTICS LTD",
          status: "linked",
          reason: "test",
          decidedBy: "auto",
        }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("rejects negative amounts and counts", async () => {
    const source = await insertSource("sec-edgar");
    const filing = {
      sourceId: source.id,
      accessionNumber: "0001999999-26-000001",
      cik: "1999999",
      issuerName: "Orbital Forge, Inc.",
      isAmendment: false,
      filedOn: "2026-01-16",
    };

    expect(
      await sqlState(
        db.insert(formDFilings).values({ ...filing, totalSoldUsdMinor: -1 }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db.insert(chAddressCounts).values({
          postcode: "EC2A 4NE",
          activeCompanies: -1,
          checkedAt: new Date(),
        }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db
          .insert(edgarIndexDays)
          .values({ day: "2026-01-16", status: "done", fundSkipped: -1 }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db.insert(edgarIndexDays).values({ day: "2026-01-17", status: "late" }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db.insert(formDFilings).values({
          ...filing,
          totalOfferingUsdMinor: null,
          totalSoldUsdMinor: 440_000_000,
        }),
      ),
    ).toBeUndefined();
  });

  it("cascades event deletes to confirmations and accepts the new record kinds", async () => {
    const { event, company } = await insertFundedEvent();
    await db.insert(eventConfirmations).values([
      {
        eventId: event.id,
        recordKind: "ch_allotment",
        recordId: 1,
        rule: "ch_allotment_window",
        recordDate: "2026-08-01",
      },
      {
        eventId: event.id,
        recordKind: "sec_form_d",
        recordId: 1,
        rule: "form_d_window",
        recordDate: "2026-08-05",
        confirmsAmount: true,
      },
    ]);
    await db
      .insert(companySectors)
      .values({ companyId: company.id, sector: "software-ai", source: "sic" });

    await db.delete(events).where(eq(events.id, event.id));

    expect(await db.select().from(eventConfirmations)).toEqual([]);
    expect(await db.select().from(companySectors)).toHaveLength(1);
  });
});
