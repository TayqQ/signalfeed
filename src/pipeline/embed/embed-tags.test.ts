import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CostEstimate } from "@/core/domain";
import { BudgetExceededError } from "@/core/errors";
import type { BudgetGuard, Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companies,
  companyTags,
  ingestRuns,
  llmUsage,
  tags,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { createBudgetGuard } from "../budget/budget-guard";
import {
  embedTagsStep,
  TAG_EMBEDDING_TEMPLATE,
  TAG_MEANING_TEMPLATE,
  tagEmbeddingIdentity,
  tagEmbeddingInput,
  tagEmbeddingTemplate,
} from "./embed-tags";
import { createFakeEmbeddingClient } from "./testing";

const MODEL = "text-embedding-3-small";
const IDENTITY = tagEmbeddingIdentity(MODEL);
const clock: Clock = { now: () => new Date("2026-11-11T12:00:00.000Z") };

let testDb: TestDb;
let db: Db;
let runId: number;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  const [run] = await db
    .insert(ingestRuns)
    .values({ trigger: "manual" })
    .returning();
  runId = run!.id;
});

afterEach(async () => {
  await testDb.close();
});

async function addCompany(slug: string, mergedIntoId?: number) {
  const [row] = await db
    .insert(companies)
    .values({ slug, name: slug, normalisedName: slug, mergedIntoId })
    .returning();
  return row!.id;
}

async function addTags(labels: string[], companyId: number) {
  for (const label of labels) {
    const [tag] = await db
      .insert(tags)
      .values({ slug: label, label })
      .returning();
    await db.insert(companyTags).values({ companyId, tagId: tag!.id });
  }
}

const guard = () => createBudgetGuard({ db, clock, capGbp: 3 });

function run(overrides: Partial<Parameters<typeof embedTagsStep>[0]> = {}) {
  return embedTagsStep({
    db,
    embedder: createFakeEmbeddingClient(),
    budget: guard(),
    model: MODEL,
    dimensions: 512,
    maxTags: 2000,
    runId,
    ...overrides,
  });
}

describe("embedTagsStep", () => {
  it("embeds only unembedded tags and re-embeds tags from another model", async () => {
    const company = await addCompany("acme");
    await addTags(["ai", "fintech", "old-model", "done"], company);
    const vector = new Array<number>(512).fill(0.01);
    await db
      .update(tags)
      .set({ embedding: vector, embeddingModel: IDENTITY })
      .where(eq(tags.label, "done"));
    await db
      .update(tags)
      .set({ embedding: vector, embeddingModel: "other-model" })
      .where(eq(tags.label, "old-model"));

    const embedder = createFakeEmbeddingClient();
    const stats = await run({ embedder });

    expect(stats).toEqual({ tagsEmbedded: 3, batches: 1 });
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]?.dimensions).toBe(512);
    expect([...(embedder.calls[0]?.inputs ?? [])].sort()).toEqual(
      ["ai", "fintech", "old-model"].map((label) => tagEmbeddingInput(label)),
    );
    const rows = await db.select().from(tags);
    for (const row of rows) {
      expect(row.embeddingModel).toBe(IDENTITY);
      expect(row.embedding).toHaveLength(512);
    }
    const done = rows.find((r) => r.label === "done");
    expect(done?.embedding?.[0]).toBeCloseTo(0.01);
  });

  it("embeds the tag in the template and stores the template in the identity", () => {
    expect(tagEmbeddingInput("pet insurance")).toBe(
      "Startup market: pet insurance",
    );
    expect(IDENTITY).toBe(`${MODEL}+${TAG_EMBEDDING_TEMPLATE}`);
    expect(IDENTITY).not.toBe(MODEL);
  });

  it("adds a meaning after the label for the meaning template (D48)", () => {
    expect(
      tagEmbeddingInput("baas", "banking infrastructure for fintechs"),
    ).toBe("Startup market: baas — banking infrastructure for fintechs");
    expect(tagEmbeddingTemplate(true)).toBe(TAG_MEANING_TEMPLATE);
    expect(tagEmbeddingTemplate(false)).toBe(TAG_EMBEDDING_TEMPLATE);
  });

  it("re-embeds tags stored under the bare model name, so old and new inputs never mix", async () => {
    await addTags(["legacy"], await addCompany("acme"));
    await db
      .update(tags)
      .set({
        embedding: new Array<number>(512).fill(0.01),
        embeddingModel: MODEL,
      })
      .where(eq(tags.label, "legacy"));
    const embedder = createFakeEmbeddingClient();
    const stats = await run({ embedder });
    expect(stats.tagsEmbedded).toBe(1);
    expect(embedder.calls[0]?.inputs).toEqual([tagEmbeddingInput("legacy")]);
    const [row] = await db.select().from(tags);
    expect(row?.embeddingModel).toBe(IDENTITY);
  });

  it("is a no-op the second time", async () => {
    await addTags(["ai", "fintech"], await addCompany("acme"));
    await run();
    const embedder = createFakeEmbeddingClient();
    const stats = await run({ embedder });
    expect(stats).toEqual({ tagsEmbedded: 0, batches: 0 });
    expect(embedder.calls).toHaveLength(0);
  });

  it("batches at 256 and records one usage row per batch", async () => {
    const labels = Array.from({ length: 300 }, (_, i) => `tag-${i}`);
    await addTags(labels, await addCompany("acme"));
    const embedder = createFakeEmbeddingClient();

    const stats = await run({ embedder });

    expect(stats).toEqual({ tagsEmbedded: 300, batches: 2 });
    expect(embedder.calls.map((c) => c.inputs.length)).toEqual([256, 44]);
    const usage = await db.select().from(llmUsage);
    expect(usage).toHaveLength(2);
    for (const row of usage) {
      expect(row.purpose).toBe("embedding");
      expect(row.model).toBe(MODEL);
      expect(row.outputTokens).toBe(0);
      expect(row.ingestRunId).toBe(runId);
      expect(row.costUsdMicros).toBeGreaterThan(0);
    }
  });

  it("respects maxTags", async () => {
    await addTags(["a1", "b2", "c3"], await addCompany("acme"));
    const stats = await run({ maxTags: 2 });
    expect(stats.tagsEmbedded).toBe(2);
  });

  it("stops cleanly on a budget refusal and leaves the rest untouched", async () => {
    const labels = Array.from({ length: 300 }, (_, i) => `tag-${i}`);
    await addTags(labels, await addCompany("acme"));
    const real = guard();
    let calls = 0;
    const budget: BudgetGuard = {
      ...real,
      assertCanSpend(estimate: CostEstimate) {
        calls += 1;
        if (calls === 2) {
          return Promise.reject(
            new BudgetExceededError({
              model: MODEL,
              estimateUsdMicros: estimate.usdMicros,
              spentUsdMicros: 0,
              capUsdMicros: 0,
            }),
          );
        }
        return real.assertCanSpend(estimate);
      },
    };

    const stats = await run({ budget });

    expect(stats).toEqual({
      tagsEmbedded: 256,
      batches: 1,
      budgetPaused: true,
    });
    const rows = await db.select().from(tags);
    expect(rows.filter((r) => r.embedding !== null)).toHaveLength(256);
    expect(rows.filter((r) => r.embedding === null)).toHaveLength(44);
  });

  it("embeds nothing when the cap is zero", async () => {
    await addTags(["ai"], await addCompany("acme"));
    const embedder = createFakeEmbeddingClient();
    const stats = await run({
      embedder,
      budget: createBudgetGuard({ db, clock, capGbp: 0 }),
    });
    expect(stats).toEqual({ tagsEmbedded: 0, batches: 0, budgetPaused: true });
    expect(embedder.calls).toHaveLength(0);
  });

  it("is skipped without an embedder", async () => {
    await addTags(["ai"], await addCompany("acme"));
    const stats = await run({ embedder: undefined });
    expect(stats).toEqual({ tagsEmbedded: 0, batches: 0, skipped: true });
    const [row] = await db.select().from(tags);
    expect(row?.embedding).toBeNull();
  });

  it("skips tags used only by merged companies", async () => {
    const survivor = await addCompany("survivor");
    const merged = await addCompany("merged", survivor);
    await addTags(["merged-only"], merged);
    await addTags(["shared"], merged);
    const [shared] = await db
      .select()
      .from(tags)
      .where(eq(tags.label, "shared"));
    await db
      .insert(companyTags)
      .values({ companyId: survivor, tagId: shared!.id });

    const embedder = createFakeEmbeddingClient();
    await run({ embedder });

    expect(embedder.calls[0]?.inputs).toEqual([tagEmbeddingInput("shared")]);
    const [orphan] = await db
      .select()
      .from(tags)
      .where(eq(tags.label, "merged-only"));
    expect(orphan?.embedding).toBeNull();
  });
});
