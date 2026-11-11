import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetGuard, LlmClient, LlmCompleteRequest } from "@/core/ports";
import type { Db } from "@/db/client";
import { tagThemes, tags, themes } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { allocateThemeSlug, assignThemesStep } from "./assign-themes";
import { cosine, meanCentroid } from "./cluster";
import {
  TEST_EMBEDDING_MODEL,
  axis,
  insertCompany,
  insertTag,
  insertTheme,
  linkTag,
  vectorAt,
} from "./testing";

const model = TEST_EMBEDDING_MODEL;

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.close();
});

async function links() {
  return db
    .select({
      slug: tags.slug,
      themeId: tagThemes.themeId,
      assignedBy: tagThemes.assignedBy,
      similarity: tagThemes.similarity,
    })
    .from(tagThemes)
    .innerJoin(tags, eq(tags.id, tagThemes.tagId))
    .orderBy(asc(tags.slug));
}

async function allThemes() {
  return db.select().from(themes).orderBy(asc(themes.id));
}

describe("assignThemesStep", () => {
  it("creates themes in mention order and links similar tags", async () => {
    const c1 = await insertCompany(db, "c1");
    const c2 = await insertCompany(db, "c2");
    await insertTag(db, {
      slug: "fintech",
      label: "fintech",
      embedding: axis(0),
      companies: [{ id: c1, mentions: 3 }, { id: c2 }],
    });
    await insertTag(db, {
      slug: "payments",
      embedding: vectorAt(0.8, 0, 1),
      companies: [{ id: c1 }],
    });
    await insertTag(db, {
      slug: "solar",
      embedding: axis(5),
      companies: [{ id: c2 }],
    });
    // Not embedded, or from another model: left alone.
    await insertTag(db, { slug: "pending", companies: [{ id: c1 }] });
    await insertTag(db, {
      slug: "old-model",
      embedding: axis(9),
      model: "other-model",
    });

    const result = await assignThemesStep({ db, model });
    expect(result).toEqual({
      tagsAssigned: 3,
      themesCreated: 2,
      centroidsUpdated: 0,
      genericSkipped: 0,
    });

    const rows = await allThemes();
    expect(rows.map((t) => [t.slug, t.name, t.nameSource])).toEqual([
      ["fintech", "fintech", "tag"],
      ["solar", "solar", "tag"],
    ]);
    expect(rows[0]!.embeddingModel).toBe(model);
    expect(
      cosine(rows[0]!.centroid, meanCentroid([axis(0), vectorAt(0.8, 0, 1)])),
    ).toBeCloseTo(1, 6);

    const linked = await links();
    expect(linked.map((l) => [l.slug, l.themeId, l.assignedBy])).toEqual([
      ["fintech", rows[0]!.id, "auto"],
      ["payments", rows[0]!.id, "auto"],
      ["solar", rows[1]!.id, "auto"],
    ]);
    expect(linked.find((l) => l.slug === "payments")!.similarity).toBeCloseTo(
      0.8,
      5,
    );
  });

  it("is a no-op on a second run", async () => {
    const c1 = await insertCompany(db, "c1");
    await insertTag(db, {
      slug: "a",
      embedding: axis(0),
      companies: [{ id: c1 }],
    });
    await insertTag(db, {
      slug: "b",
      embedding: axis(1),
      companies: [{ id: c1 }],
    });
    await assignThemesStep({ db, model });
    const themesBefore = await allThemes();
    const linksBefore = await links();

    const second = await assignThemesStep({ db, model });
    expect(second).toEqual({
      tagsAssigned: 0,
      themesCreated: 0,
      centroidsUpdated: 0,
      genericSkipped: 0,
    });
    expect(await allThemes()).toEqual(themesBefore);
    expect(await links()).toEqual(linksBefore);
  });

  it("joins existing themes, updates their centroid and keeps old links", async () => {
    const seed = await insertTag(db, { slug: "ai", embedding: axis(0) });
    const themeId = await insertTheme(db, {
      slug: "ai",
      seedTagId: seed,
      centroid: axis(0),
    });
    await linkTag(db, seed, themeId);
    await insertTag(db, { slug: "llm", embedding: vectorAt(0.9, 0, 1) });

    const result = await assignThemesStep({ db, model });
    expect(result).toMatchObject({ tagsAssigned: 1, centroidsUpdated: 1 });
    const [theme] = await allThemes();
    expect(
      cosine(theme!.centroid, meanCentroid([axis(0), vectorAt(0.9, 0, 1)])),
    ).toBeCloseTo(1, 6);
  });

  it("keeps manual links and null links", async () => {
    const seed = await insertTag(db, { slug: "ai", embedding: axis(0) });
    const themeId = await insertTheme(db, {
      slug: "ai",
      seedTagId: seed,
      centroid: axis(0),
    });
    await linkTag(db, seed, themeId);
    // Close to "ai", but a person put it in no theme.
    const ignored = await insertTag(db, {
      slug: "machine-learning",
      embedding: vectorAt(0.95, 0, 1),
    });
    await linkTag(db, ignored, null, "manual");
    // Far from "ai", but a person put it there.
    const moved = await insertTag(db, { slug: "robots", embedding: axis(3) });
    await linkTag(db, moved, themeId, "manual");

    const result = await assignThemesStep({ db, model });
    expect(result.tagsAssigned).toBe(0);
    const linked = await links();
    expect(linked.map((l) => [l.slug, l.themeId, l.assignedBy])).toEqual([
      ["ai", themeId, "auto"],
      ["machine-learning", null, "manual"],
      ["robots", themeId, "manual"],
    ]);
    expect(await allThemes()).toHaveLength(1);
  });

  it("lets the LLM check place band tags and never touches manual links", async () => {
    const companyId = await insertCompany(db, "co");
    const seed = await insertTag(db, {
      slug: "heat-pumps",
      embedding: axis(0),
      companies: [{ id: companyId, mentions: 5 }],
    });
    const themeId = await insertTheme(db, {
      slug: "heat-pumps",
      seedTagId: seed,
      centroid: axis(0),
    });
    await linkTag(db, seed, themeId);
    // In the band, but a person already placed it: never asked, never moved.
    const manual = await insertTag(db, {
      slug: "heat-pump-installers",
      embedding: vectorAt(0.8, 0, 1),
    });
    await linkTag(db, manual, null, "manual");
    // In the band: the check decides.
    await insertTag(db, {
      slug: "ground-source-heat",
      embedding: vectorAt(0.8, 0, 2),
    });

    const users: string[] = [];
    const llm: LlmClient = {
      complete<T>(request: LlmCompleteRequest<T>) {
        users.push(request.user);
        return Promise.resolve({
          data: request.schema.parse({ verdicts: [{ id: 1, match: 1 }] }),
          usage: { inputTokens: 100, outputTokens: 10 },
          model: "gpt-5.6-luna",
        });
      },
    };
    const recorded: unknown[] = [];
    const budget: BudgetGuard = {
      assertCanSpend: () => Promise.resolve(),
      record: (usage) => {
        recorded.push(usage);
        return Promise.resolve();
      },
      monthToDate: () =>
        Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 1 }),
    };

    const result = await assignThemesStep({
      db,
      model,
      bands: { low: 0.7, high: 0.9 },
      check: { llm, budget, model: "gpt-5.6-luna", purpose: "theme_naming" },
    });

    // The existing theme is shown by its member tags.
    expect(users).toHaveLength(1);
    expect(JSON.parse(users[0]!)).toEqual({
      tags: [
        {
          id: 1,
          tag: "ground source heat",
          candidates: [{ n: 1, tags: ["heat pumps"] }],
        },
      ],
    });
    expect(result).toMatchObject({
      tagsAssigned: 1,
      themesCreated: 0,
      check: { calls: 1, questions: 1, joined: 1 },
    });
    expect(recorded).toHaveLength(1);
    const linked = await links();
    expect(linked.map((l) => [l.slug, l.themeId, l.assignedBy])).toEqual([
      ["ground-source-heat", themeId, "auto"],
      ["heat-pump-installers", null, "manual"],
      ["heat-pumps", themeId, "auto"],
    ]);
  });

  it("skips generic tags", async () => {
    await insertTag(db, { slug: "startup", embedding: axis(0) });
    await insertTag(db, { slug: "technology", embedding: axis(1) });
    await insertTag(db, { slug: "edtech", embedding: axis(2) });

    const result = await assignThemesStep({ db, model });
    expect(result).toMatchObject({
      tagsAssigned: 1,
      themesCreated: 1,
      genericSkipped: 2,
    });
    expect((await links()).map((l) => l.slug)).toEqual(["edtech"]);
  });

  it("adds -2 when the tag's slug is already a theme slug", async () => {
    const other = await insertTag(db, { slug: "neobank", embedding: axis(0) });
    const existing = await insertTheme(db, {
      slug: "banking",
      seedTagId: other,
      centroid: axis(0),
    });
    await linkTag(db, other, existing);
    await insertTag(db, { slug: "banking", embedding: axis(7) });

    await assignThemesStep({ db, model });
    expect((await allThemes()).map((t) => t.slug)).toEqual([
      "banking",
      "banking-2",
    ]);
  });

  it("respects the threshold argument", async () => {
    await insertTag(db, { slug: "a", embedding: axis(0) });
    await insertTag(db, { slug: "b", embedding: vectorAt(0.7, 0, 1) });
    expect(
      (await assignThemesStep({ db, model, threshold: 0.75 })).themesCreated,
    ).toBe(2);
  });
});

describe("allocateThemeSlug", () => {
  it("returns the base, then numbered slugs", async () => {
    expect(await allocateThemeSlug(db, "Climate Tech")).toBe("climate-tech");
    const seed = await insertTag(db, { slug: "x", embedding: axis(0) });
    await insertTheme(db, {
      slug: "climate-tech",
      seedTagId: seed,
      centroid: axis(0),
    });
    await insertTheme(db, {
      slug: "climate-tech-2",
      seedTagId: seed,
      centroid: axis(0),
    });
    expect(await allocateThemeSlug(db, "climate-tech")).toBe("climate-tech-3");
  });
});
