import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceConfig } from "@/core/domain";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import type {
  Collector,
  CollectResult,
  EmbeddingClient,
  FxProvider,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
} from "@/core/ports";
import { ExtractionValidationError } from "@/core/errors";
import {
  companyLocations,
  companyThemes,
  events,
  fundingRounds,
  grantParticipants,
  ingestRuns,
  llmUsage,
  sourceItems,
  themes,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { createBudgetGuard } from "./budget/budget-guard";
import { createFakeEmbeddingClient } from "./embed/testing";
import { collectGrantsStep } from "./grants/collect-grants";
import { GRANT_TAGS_SCHEMA_NAME } from "./grants/grant-tag-prompt";
import { createGtrClient, type GtrClient } from "./grants/gtr-client";
import { ensureGtrSource } from "./grants/store-grants";
import { fakeGtr, syntheticPage } from "./grants/testing";
import { singleConnectionLock, withIngestLock } from "./lock";
import {
  reextractStep,
  runAll,
  runGrants,
  themesStep,
  type PipelineDeps,
} from "./run";
import { EXTRACTION_PROMPT_VERSION } from "./extract/prompt";
import { upsertRates } from "./store/fx-rates";
import { tagEmbeddingIdentity } from "./embed/embed-tags";
import { THEME_NAMES_SCHEMA_NAME } from "./themes/name-themes";
import { axis, insertCompany, insertTag, vectorAt } from "./themes/testing";
import { THEME_CHECK_SCHEMA_NAME } from "./themes/theme-check";

const NOW = new Date("2026-06-10T12:00:00Z");

function headline(id: string, title: string): CollectResult["items"][number] {
  return {
    sourceSlug: "x",
    externalId: id,
    url: `https://news.test/${id}`,
    title,
    summary: "A short feed summary.",
    publishedAt: new Date("2026-06-09T12:00:00Z"),
  };
}

function fakeCollector(
  bySlug: Record<string, CollectResult["items"] | Error>,
): Collector {
  return {
    collect(source: SourceConfig): Promise<CollectResult> {
      const entry = bySlug[source.slug];
      if (entry instanceof Error) return Promise.reject(entry);
      return Promise.resolve({
        items: entry ?? [],
        etag: null,
        lastModified: null,
        notModified: false,
      });
    },
  };
}

function fundingEvent(name: string): ExtractedEventV1 {
  return {
    type: "funding_round",
    company: {
      name,
      websiteDomain: null,
      description: null,
      countryCode: null,
      city: null,
      foundedYear: null,
      tags: ["ai agents"],
    },
    announcedOn: null,
    funding: {
      roundType: "seed",
      roundLabel: null,
      amountText: "€4M",
      currencyHint: null,
      investors: [{ name: "Example Ventures", kind: "vc", isLead: true }],
      includesIndividualAngels: false,
    },
    acquisition: null,
    launch: null,
  };
}

/** The ids a grant tagging or theme naming prompt asks about. */
function promptIds(
  user: string,
  key: "projects" | "themes" | "tags",
): number[] {
  const parsed = JSON.parse(user) as Record<string, { id: number }[]>;
  return (parsed[key] ?? []).map((entry) => entry.id);
}

/**
 * Answers extraction from the title's first word, tags every grant project
 * "heat pumps" and names every theme. Counts calls and logs each schema name.
 */
function fakeLlm(
  options: {
    fail?: (user: string, schemaName: string) => Error | null;
    log?: string[];
  } = {},
) {
  const state = { calls: 0 };
  const llm: LlmClient = {
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      state.calls += 1;
      options.log?.push(`llm:${request.schemaName}`);
      const failure = options.fail?.(request.user, request.schemaName);
      if (failure) return Promise.reject(failure);
      let data: T;
      if (request.schemaName === GRANT_TAGS_SCHEMA_NAME) {
        data = request.schema.parse({
          projects: promptIds(request.user, "projects").map((id) => ({
            id,
            tags: ["heat pumps"],
          })),
        });
      } else if (request.schemaName === THEME_CHECK_SCHEMA_NAME) {
        data = request.schema.parse({
          verdicts: promptIds(request.user, "tags").map((id) => ({
            id,
            match: 1,
          })),
        });
      } else if (request.schemaName === THEME_NAMES_SCHEMA_NAME) {
        data = request.schema.parse({
          themes: promptIds(request.user, "themes").map((id) => ({
            id,
            name: "Agent software",
            sector: "software-ai",
          })),
        });
      } else {
        const name = /Title: (\S+)/.exec(request.user)?.[1] ?? "Unknown";
        const extraction: ExtractionV1 = {
          isRelevant: true,
          events: [fundingEvent(name)],
        };
        data = extraction as T;
      }
      return Promise.resolve({
        data,
        usage: { inputTokens: 1000, outputTokens: 200 },
        model: "gpt-4.1-nano",
      });
    },
  };
  return { llm, state };
}

/** The fake embedder, logging each call and failing when told to. */
function fakeEmbedder(
  options: { log?: string[]; fail?: () => Error | null } = {},
) {
  const inner = createFakeEmbeddingClient();
  const embedder: EmbeddingClient = {
    embed(request) {
      options.log?.push("embed");
      const failure = options.fail?.();
      if (failure) return Promise.reject(failure);
      return inner.embed(request);
    },
  };
  return { embedder, calls: inner.calls };
}

const fakeFx: FxProvider = {
  getRates: (date) =>
    Promise.resolve({
      date,
      perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
    }),
};

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

/** A GtR client over one page of invented projects. Never waits. */
function gtrClient(projects = 1): GtrClient {
  const fake = fakeGtr((page) =>
    page === 1 ? syntheticPage(1, projects) : syntheticPage(page, 0),
  );
  return createGtrClient({
    http: fake.fetcher,
    sleep: () => Promise.resolve(),
  });
}

function deps(
  llm: LlmClient | null,
  collector: Collector,
  overrides: {
    capGbp?: number;
    max?: number;
    embedder?: EmbeddingClient | null;
    gtr?: GtrClient;
  } = {},
): PipelineDeps {
  const clock = { now: () => NOW };
  return {
    db: testDb.db,
    collector,
    llm,
    embedder: overrides.embedder ?? null,
    gtr: overrides.gtr ?? gtrClient(),
    budget: createBudgetGuard({
      db: testDb.db,
      clock,
      capGbp: overrides.capGbp ?? 3,
    }),
    fx: fakeFx,
    clock,
    config: {
      model: "gpt-4.1-nano",
      maxExtractionsPerRun: overrides.max ?? 150,
      capGbp: overrides.capGbp ?? 3,
      embeddingModel: "text-embedding-3-small",
      maxEmbeddingsPerRun: 2000,
      maxThemeNamesPerRun: 20,
      maxGrantTaggingsPerRun: 200,
    },
    log: () => undefined,
  };
}

const lock = () => singleConnectionLock(testDb.db);

const twoRaises = {
  "techcrunch-venture": [
    headline("1", "Alpha raises €4M seed"),
    headline("2", "Beta raises €4M seed"),
    headline("3", "Five things about conferences"),
  ],
};

describe("runAll", () => {
  it("creates events and records stats", async () => {
    const { llm, state } = fakeLlm();
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises)),
      lock(),
      "manual",
    );
    expect(summary.status).toBe("succeeded");
    expect(state.calls).toBe(2);
    expect(summary.stats?.collect.itemsInserted).toBe(3);
    expect(summary.stats?.prefilter.itemsFilteredOut).toBe(1);
    expect(summary.stats?.extract.itemsExtracted).toBe(2);
    expect(summary.stats?.resolve.eventsCreated).toBe(2);
    expect(summary.stats?.resolve.investorsCreated).toBe(1);
    expect(summary.stats?.spendUsdMicros).toBeGreaterThan(0);

    const [round] = await testDb.db.select().from(fundingRounds);
    expect(round?.amountUsdMinor).toBe(500_000_000);
    expect(round?.amountGbpMinor).toBe(320_000_000);

    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();

    const usage = await testDb.db.select().from(llmUsage);
    expect(usage).toHaveLength(2);
    expect(usage[0]?.sourceItemId).not.toBeNull();
    expect(usage[0]?.ingestRunId).toBe(run?.id);
  });

  it("makes zero LLM calls on a second run with the same feed", async () => {
    const { llm, state } = fakeLlm();
    const collector = fakeCollector(twoRaises);
    await runAll(deps(llm, collector), lock(), "manual");
    const callsAfterFirst = state.calls;
    const second = await runAll(deps(llm, collector), lock(), "manual");
    expect(state.calls).toBe(callsAfterFirst);
    expect(second.stats?.collect.itemsInserted).toBe(0);
    expect(await testDb.db.select().from(events)).toHaveLength(2);
  });

  it("does no work when the lock is already held", async () => {
    const { llm, state } = fakeLlm();
    const held = {
      tryAcquire: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises)),
      held,
      "manual",
    );
    expect(summary).toEqual({ ran: false });
    expect(state.calls).toBe(0);
    expect(await testDb.db.select().from(ingestRuns)).toHaveLength(0);
  });

  it("pauses at the budget, leaves items pending and resolves what it has", async () => {
    const { llm } = fakeLlm();
    // A cap that fits one worst-case call and not two (1.0 USD per GBP with no rates).
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises), { capGbp: 0.0007 }),
      lock(),
      "schedule",
    );
    expect(summary.status).toBe("budget_paused");
    expect(summary.stats?.budgetPaused).toBe(true);
    expect(summary.stats?.extract.itemsExtracted).toBe(1);
    expect(summary.stats?.resolve.extractionsResolved).toBe(1);
    const pending = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.status, "pending"));
    expect(pending).toHaveLength(1);
  });

  it("keeps going when one feed fails", async () => {
    const { llm } = fakeLlm();
    const summary = await runAll(
      deps(
        llm,
        fakeCollector({
          "techcrunch-venture": new Error("HTTP 500"),
          "tech-eu": [headline("1", "Alpha raises €4M seed")],
        }),
      ),
      lock(),
      "manual",
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.stats?.collect.sourcesFailed).toBe(1);
    expect(summary.stats?.extract.itemsExtracted).toBe(1);
  });

  it("keeps collecting with no key and leaves items pending", async () => {
    const summary = await runAll(
      deps(null, fakeCollector(twoRaises)),
      lock(),
      "schedule",
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.stats?.collect.itemsInserted).toBe(3);
    expect(summary.stats?.extract.skipped).toBe(true);
    const pending = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.status, "pending"));
    expect(pending).toHaveLength(2);
  });

  it("does not use up attempts when the provider refuses", async () => {
    const quota = Object.assign(new Error("insufficient_quota"), {
      status: 429,
    });
    const { llm } = fakeLlm({ fail: () => quota });
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises)),
      lock(),
      "manual",
    );
    expect(summary.status).toBe("failed");
    expect(summary.stats?.extract.providerError).toBe("insufficient_quota");
    const items = await testDb.db
      .select()
      .from(sourceItems)
      .orderBy(asc(sourceItems.id));
    expect(items.every((item) => item.attempts === 0)).toBe(true);
  });

  it("fails an item after three bad responses and carries on", async () => {
    const invalid = new ExtractionValidationError([
      { path: ["events"], message: "bad" },
    ]);
    const { llm } = fakeLlm({
      fail: (user) => (user.includes("Alpha") ? invalid : null),
    });
    const collector = fakeCollector(twoRaises);
    for (let run = 0; run < 3; run += 1) {
      await runAll(deps(llm, collector), lock(), "manual");
    }
    const [alpha] = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.externalId, "1"));
    expect(alpha?.status).toBe("failed");
    expect(alpha?.attempts).toBe(3);
    const [beta] = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.externalId, "2"));
    expect(beta?.status).toBe("extracted");
  });

  it("marks a run failed and rethrows on an unexpected error", async () => {
    const { llm } = fakeLlm();
    const unpriced = deps(llm, fakeCollector(twoRaises));
    unpriced.config.model = "not-a-real-model";
    await expect(runAll(unpriced, lock(), "manual")).rejects.toThrow(
      /No price/,
    );
    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/No price/);
  });
});

/** Stores one invented grant project with a fetched lead organisation. */
async function seedGrant(): Promise<void> {
  await collectGrantsStep({ db: testDb.db, gtr: gtrClient(), maxPages: 1 });
}

/**
 * A stored rate near the invented grant's start date. FX runs before grant
 * resolution, so without it the grant's USD amount is filled on the next run.
 */
async function seedGrantRate(): Promise<void> {
  await upsertRates(testDb.db, {
    date: "2026-06-29",
    perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
  });
}

/** Spends past a tiny cap before the run starts. */
async function fillBudget(): Promise<void> {
  await createBudgetGuard({
    db: testDb.db,
    clock: { now: () => NOW },
    capGbp: 3,
  }).record({
    purpose: "eval",
    model: "gpt-4.1-nano",
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 10_000,
  });
}

/** Records every source slug the collector is asked for. */
function recordingCollector(asked: string[]): Collector {
  return {
    collect(source: SourceConfig): Promise<CollectResult> {
      asked.push(source.slug);
      return Promise.resolve({
        items: [],
        etag: null,
        lastModified: null,
        notModified: false,
      });
    },
  };
}

describe("runAll, Phase 2 steps", () => {
  it("runs grant tagging, embedding and naming in order, then locations and stats", async () => {
    await seedGrant();
    const log: string[] = [];
    const { llm } = fakeLlm({ log });
    const { embedder, calls } = fakeEmbedder({ log });
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises), { embedder }),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("succeeded");
    expect(log).toEqual([
      "llm:extraction_v2",
      "llm:extraction_v2",
      `llm:${GRANT_TAGS_SCHEMA_NAME}`,
      "embed",
      `llm:${THEME_NAMES_SCHEMA_NAME}`,
    ]);
    // Grant tags reach companies before embedding, so they embed in the same run.
    const embedded = calls.flatMap((call) => call.inputs).join(" | ");
    expect(embedded).toMatch(/heat pumps/);
    expect(embedded).toMatch(/ai agents/);

    const stats = summary.stats!;
    expect(stats.grantResolve).toMatchObject({
      projectsTagged: 1,
      participantsResolved: 1,
      eventsCreated: 1,
    });
    expect(stats.grantResolve?.taggingSkipped).toBeUndefined();
    expect(stats.embed).toMatchObject({ tagsEmbedded: 2, batches: 1 });
    expect(stats.themes).toMatchObject({
      tagsAssigned: 2,
      themesCreated: 2,
      themesNamed: 1,
    });
    expect(stats.locations?.skipped).toBeUndefined();
    expect(stats.stats?.skipped).toBeUndefined();
    expect(stats.budgetPaused).toBe(false);

    // Stats ran after themes and grants: all three companies have a theme.
    const themed = await testDb.db.select().from(companyThemes);
    expect(new Set(themed.map((row) => row.companyId)).size).toBe(3);
    // Locations ran after grant resolution: the grant company has a postcode.
    expect(await testDb.db.select().from(companyLocations)).not.toHaveLength(0);

    const purposes = (await testDb.db.select().from(llmUsage)).map(
      (row) => row.purpose,
    );
    expect(purposes.sort()).toEqual([
      "embedding",
      "extraction",
      "extraction",
      "tagging",
      "theme_naming",
    ]);
  });

  it("without a key collects, resolves grants and rebuilds stats, and skips the paid steps", async () => {
    await seedGrant();
    const summary = await runAll(
      deps(null, fakeCollector(twoRaises)),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("succeeded");
    const stats = summary.stats!;
    expect(stats.collect.itemsInserted).toBe(3);
    expect(stats.extract.skipped).toBe(true);
    expect(stats.grantResolve).toMatchObject({
      taggingSkipped: true,
      projectsTagged: 0,
      participantsResolved: 1,
      eventsCreated: 1,
    });
    expect(stats.embed).toEqual({ tagsEmbedded: 0, batches: 0, skipped: true });
    expect(stats.themes).toMatchObject({ namingSkipped: true, themesNamed: 0 });
    expect(stats.locations?.skipped).toBeUndefined();
    expect(stats.stats?.skipped).toBeUndefined();
    expect(stats.spendUsdMicros).toBe(0);
    expect(await testDb.db.select().from(llmUsage)).toHaveLength(0);

    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("succeeded");
    expect(run?.error).toBeNull();
  });

  it("a budget pause in embedding skips naming but not locations and stats", async () => {
    const company = await insertCompany(testDb.db, "acme");
    await insertTag(testDb.db, {
      slug: "ai-agents",
      companies: [{ id: company }],
    });
    await fillBudget();
    const { llm, state } = fakeLlm();
    const { embedder, calls } = fakeEmbedder();
    const summary = await runAll(
      deps(llm, fakeCollector({}), { embedder, capGbp: 0.001 }),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("budget_paused");
    const stats = summary.stats!;
    expect(stats.budgetPaused).toBe(true);
    expect(stats.embed).toMatchObject({ tagsEmbedded: 0, budgetPaused: true });
    expect(stats.themes).toMatchObject({ skipped: true, themesNamed: 0 });
    expect(state.calls).toBe(0);
    expect(calls).toHaveLength(0);
    expect(stats.locations).toBeDefined();
    expect(stats.stats).toBeDefined();
    expect(stats.stats?.skipped).toBeUndefined();
  });

  it("a budget pause in grant tagging skips embedding and naming", async () => {
    await seedGrant();
    await fillBudget();
    const { llm, state } = fakeLlm();
    const { embedder } = fakeEmbedder();
    const summary = await runAll(
      deps(llm, fakeCollector({}), { embedder, capGbp: 0.001 }),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("budget_paused");
    const stats = summary.stats!;
    expect(stats.grantResolve).toMatchObject({
      budgetPaused: true,
      projectsTagged: 0,
      eventsCreated: 1,
    });
    expect(stats.embed?.skipped).toBe(true);
    expect(stats.themes?.skipped).toBe(true);
    expect(state.calls).toBe(0);
    expect(stats.stats?.skipped).toBeUndefined();
  });

  it("a second identical run creates nothing new and skips stats", async () => {
    await seedGrant();
    await seedGrantRate();
    const log: string[] = [];
    const { llm } = fakeLlm({ log });
    const { embedder } = fakeEmbedder({ log });
    const collector = fakeCollector(twoRaises);
    await runAll(deps(llm, collector, { embedder }), lock(), "schedule");
    const callsAfterFirst = log.length;
    const eventsAfterFirst = (await testDb.db.select().from(events)).length;

    const second = await runAll(
      deps(llm, collector, { embedder }),
      lock(),
      "schedule",
    );

    expect(second.status).toBe("succeeded");
    expect(log).toHaveLength(callsAfterFirst);
    const stats = second.stats!;
    expect(stats.collect.itemsInserted).toBe(0);
    expect(stats.grantResolve).toMatchObject({
      projectsTagged: 0,
      participantsResolved: 0,
      eventsCreated: 0,
    });
    expect(stats.embed?.tagsEmbedded).toBe(0);
    expect(stats.themes).toMatchObject({
      tagsAssigned: 0,
      themesCreated: 0,
      themesNamed: 0,
    });
    expect(stats.locations?.skipped).toBe(true);
    expect(stats.stats?.skipped).toBe(true);
    expect(stats.spendUsdMicros).toBe(0);
    expect(await testDb.db.select().from(events)).toHaveLength(
      eventsAfterFirst,
    );
  });

  it("a thrown error in the themes step leaves Phase 1 results recorded", async () => {
    const { llm } = fakeLlm({
      fail: (_user, schemaName) =>
        schemaName === THEME_NAMES_SCHEMA_NAME ? new Error("boom") : null,
    });
    const { embedder } = fakeEmbedder();
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises), { embedder }),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("failed");
    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("theme naming: boom");
    expect(run?.stats).toMatchObject({
      collect: { itemsInserted: 3 },
      extract: { itemsExtracted: 2 },
      resolve: { eventsCreated: 2 },
      embed: { tagsEmbedded: 1 },
      themes: { themesCreated: 1, themesNamed: 0 },
    });
    // Not a provider refusal, so it is not reported as one.
    expect(summary.stats?.themes?.providerError).toBeUndefined();
    // Locations and stats still ran after the failure.
    expect(summary.stats?.stats?.skipped).toBeUndefined();
    expect(await testDb.db.select().from(events)).toHaveLength(2);
    expect(await testDb.db.select().from(themes)).toHaveLength(1);
  });

  it("records a provider refusal in embedding and carries on without spending", async () => {
    const quota = Object.assign(new Error("insufficient_quota"), {
      status: 429,
    });
    const { llm, state } = fakeLlm();
    const { embedder } = fakeEmbedder({ fail: () => quota });
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises), { embedder }),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("failed");
    const stats = summary.stats!;
    expect(stats.extract.itemsExtracted).toBe(2);
    expect(stats.embed).toMatchObject({
      tagsEmbedded: 0,
      providerError: "insufficient_quota",
    });
    expect(stats.themes?.skipped).toBe(true);
    expect(state.calls).toBe(2);
    expect(stats.stats?.skipped).toBeUndefined();
    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.error).toBe("embedding: insufficient_quota");
  });

  it("records a provider refusal in grant tagging and still resolves grants", async () => {
    await seedGrant();
    const outage = Object.assign(new Error("server error"), { status: 503 });
    const { llm } = fakeLlm({
      fail: (_user, schemaName) =>
        schemaName === GRANT_TAGS_SCHEMA_NAME ? outage : null,
    });
    const { embedder, calls } = fakeEmbedder();
    const summary = await runAll(
      deps(llm, fakeCollector({}), { embedder }),
      lock(),
      "schedule",
    );

    expect(summary.status).toBe("failed");
    expect(summary.stats?.grantResolve).toMatchObject({
      providerError: "server error",
      participantsResolved: 1,
      eventsCreated: 1,
    });
    expect(summary.stats?.embed?.skipped).toBe(true);
    expect(calls).toHaveLength(0);
    const [participant] = await testDb.db.select().from(grantParticipants);
    expect(participant?.resolvedAt).not.toBeNull();
  });

  it("never sends the ukri-gtr source to the feed collector", async () => {
    await ensureGtrSource(testDb.db);
    const asked: string[] = [];
    const summary = await runAll(
      deps(null, recordingCollector(asked)),
      lock(),
      "schedule",
    );
    expect(summary.status).toBe("succeeded");
    expect(asked).not.toContain("ukri-gtr");
    expect(asked).toContain("techcrunch-venture");
    expect(summary.stats?.collect.sourcesFailed).toBe(0);
  });
});

describe("runGrants", () => {
  it("collects grants without a key and records a run", async () => {
    const summary = await runGrants(
      deps(null, fakeCollector({}), { gtr: gtrClient(2) }),
      lock(),
      "schedule",
      { maxPages: 1 },
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.stats?.grantCollect).toMatchObject({
      pagesFetched: 1,
      projectsInserted: 2,
    });
    expect(summary.stats?.extract.skipped).toBe(true);
    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("succeeded");
    expect(run?.stats).toMatchObject({ grantCollect: { projectsInserted: 2 } });
    expect(await testDb.db.select().from(grantParticipants)).toHaveLength(2);
  });

  it("does no work when the lock is already held", async () => {
    const held = {
      tryAcquire: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const summary = await runGrants(
      deps(null, fakeCollector({})),
      held,
      "manual",
    );
    expect(summary).toEqual({ ran: false });
    expect(await testDb.db.select().from(ingestRuns)).toHaveLength(0);
  });
});

describe("reextractStep", () => {
  it("makes zero LLM calls on a dry run", async () => {
    const { llm, state } = fakeLlm();
    const run = deps(llm, fakeCollector(twoRaises));
    await runAll(run, lock(), "manual");
    const before = state.calls;
    await testDb.db.execute("update extractions set prompt_version = 'v0'");
    const summary = await reextractStep(run, {
      promptVersion: EXTRACTION_PROMPT_VERSION,
      limit: 10,
      dryRun: true,
      yes: false,
    });
    expect(state.calls).toBe(before);
    expect(summary.items).toBe(2);
    expect(summary.estimatedUsdMicros).toBeGreaterThan(0);
  });

  it("refuses a real run without --yes", async () => {
    const { llm } = fakeLlm();
    await expect(
      reextractStep(deps(llm, fakeCollector({})), {
        promptVersion: EXTRACTION_PROMPT_VERSION,
        limit: 10,
        dryRun: false,
        yes: false,
      }),
    ).rejects.toThrow(/--yes/);
  });
});

describe("singleConnectionLock", () => {
  it("excludes a second holder until released", async () => {
    const first = singleConnectionLock(testDb.db);
    const inner = await withIngestLock(first, () => Promise.resolve("work"));
    expect(inner).toEqual({ ran: true, result: "work" });
  });
});

describe("themes step with the LLM check", () => {
  /** Two tags 0.8 apart: inside the default band, so the check decides. */
  async function seedBandTags() {
    const model = tagEmbeddingIdentity("text-embedding-3-small");
    const companyId = await insertCompany(testDb.db, "agentco");
    await insertTag(testDb.db, {
      slug: "ai-agents",
      embedding: axis(0),
      model,
      companies: [{ id: companyId, mentions: 3 }],
    });
    await insertTag(testDb.db, {
      slug: "agentic-ai",
      embedding: vectorAt(0.8, 0, 1),
      model,
      companies: [{ id: companyId, mentions: 1 }],
    });
  }

  it("joins a band tag on the verdict and records the spend as theme_naming", async () => {
    await seedBandTags();
    const log: string[] = [];
    const { llm } = fakeLlm({ log });
    const outcome = await themesStep(deps(llm, fakeCollector({})), {
      paidAllowed: true,
    });

    expect(outcome.errors).toEqual([]);
    expect(outcome.stats).toMatchObject({ tagsAssigned: 2, themesCreated: 1 });
    expect(log[0]).toBe(`llm:${THEME_CHECK_SCHEMA_NAME}`);
    const purposes = (await testDb.db.select().from(llmUsage)).map(
      (row) => row.purpose,
    );
    expect(purposes).toContain("theme_naming");
  });

  it("falls back on a provider refusal, keeps the links and skips naming", async () => {
    await seedBandTags();
    const quota = Object.assign(new Error("insufficient_quota"), {
      status: 429,
    });
    const log: string[] = [];
    const { llm } = fakeLlm({
      log,
      fail: (_user, schemaName) =>
        schemaName === THEME_CHECK_SCHEMA_NAME ? quota : null,
    });
    const outcome = await themesStep(deps(llm, fakeCollector({})), {
      paidAllowed: true,
    });

    // 0.8 is above the embedding-only τ, so the fallback joins them.
    expect(outcome.stats).toMatchObject({
      tagsAssigned: 2,
      themesCreated: 1,
      themesNamed: 0,
      providerError: "insufficient_quota",
    });
    expect(outcome.errors).toEqual(["theme check: insufficient_quota"]);
    expect(outcome.stopsPaidSteps).toBe(true);
    expect(log).toEqual([`llm:${THEME_CHECK_SCHEMA_NAME}`]);
  });

  it("pauses on a budget refusal without losing the assignment", async () => {
    await seedBandTags();
    const log: string[] = [];
    const { llm } = fakeLlm({ log });
    const outcome = await themesStep(
      deps(llm, fakeCollector({}), { capGbp: 0 }),
      { paidAllowed: true },
    );

    expect(outcome.stats).toMatchObject({
      tagsAssigned: 2,
      budgetPaused: true,
    });
    expect(outcome.errors).toEqual([]);
    expect(log).toEqual([]);
  });
});
