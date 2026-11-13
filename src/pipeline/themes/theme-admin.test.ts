import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { tagThemes, tags, themes } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { assignThemesStep } from "./assign-themes";
import { cosine, meanCentroid } from "./cluster";
import { nameThemesStep } from "./name-themes";
import {
  TEST_EMBEDDING_MODEL,
  axis,
  insertCompany,
  insertNamedSeedTheme,
  insertTag,
  insertTheme,
  linkTag,
  vectorAt,
} from "./testing";
import {
  ThemeAdminError,
  listThemes,
  mergeThemes,
  moveTag,
  renameTheme,
  resolveThemeSlug,
  setThemeSector,
  suggestMerges,
} from "./theme-admin";

const clock = { now: () => new Date("2026-11-11T09:00:00Z") };
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

async function theme(id: number) {
  const [row] = await db.select().from(themes).where(eq(themes.id, id));
  return row!;
}

async function linkOf(tagId: number) {
  const [row] = await db
    .select()
    .from(tagThemes)
    .where(eq(tagThemes.tagId, tagId));
  return row;
}

describe("listThemes", () => {
  it("lists active themes with companies and tags, biggest first", async () => {
    await insertNamedSeedTheme(db, { slug: "small", companyCount: 1 });
    await insertNamedSeedTheme(db, {
      slug: "big",
      tagSlugs: ["big", "bigger"],
      companyCount: 3,
      axisIndex: 1,
    });
    const reviewed = await insertNamedSeedTheme(db, {
      slug: "reviewed",
      axisIndex: 2,
    });
    await renameTheme({ db, slug: "reviewed", name: "Checked", clock });

    const all = await listThemes(db);
    expect(all.map((t) => [t.slug, t.companies, t.tags])).toEqual([
      ["big", 3, ["big", "bigger"]],
      ["reviewed", 2, ["reviewed"]],
      ["small", 1, ["small"]],
    ]);
    expect(all[1]).toMatchObject({
      id: reviewed.themeId,
      name: "Checked",
      nameSource: "manual",
      reviewedAt: clock.now(),
    });
    expect(
      (await listThemes(db, { unreviewed: true })).map((t) => t.slug),
    ).toEqual(["big", "small"]);
  });
});

describe("renameTheme and setThemeSector", () => {
  it("sets a manual name that naming never overwrites", async () => {
    const { themeId } = await insertNamedSeedTheme(db, { slug: "ai" });
    await renameTheme({ db, slug: "ai", name: "  Applied   AI ", clock });
    expect(await theme(themeId)).toMatchObject({
      slug: "ai",
      name: "Applied AI",
      nameSource: "manual",
      reviewedAt: clock.now(),
    });

    const llm = {
      complete: () => Promise.reject(new Error("must not be called")),
    };
    const budget = {
      assertCanSpend: () => Promise.resolve(),
      record: () => Promise.resolve(),
      monthToDate: () =>
        Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 0 }),
    };
    const result = await nameThemesStep({
      db,
      llm,
      budget,
      model: "gpt-5.6-luna",
      maxThemes: 20,
    });
    expect(result.themesNamed).toBe(0);
    expect((await theme(themeId)).name).toBe("Applied AI");
  });

  it("refuses bad names, unknown slugs and unknown sectors", async () => {
    await insertNamedSeedTheme(db, { slug: "ai" });
    await expect(renameTheme({ db, slug: "ai", name: "x" })).rejects.toThrow(
      ThemeAdminError,
    );
    await expect(
      renameTheme({ db, slug: "ai", name: "y".repeat(41) }),
    ).rejects.toThrow(ThemeAdminError);
    await expect(
      renameTheme({ db, slug: "missing", name: "Fine" }),
    ).rejects.toThrow(/No theme/);
    await expect(
      setThemeSector({ db, slug: "ai", sector: "crypto" }),
    ).rejects.toThrow(/Unknown sector/);
  });

  it("sets the sector and reviewed_at", async () => {
    const { themeId } = await insertNamedSeedTheme(db, { slug: "ai" });
    await setThemeSector({ db, slug: "ai", sector: "software-ai", clock });
    expect(await theme(themeId)).toMatchObject({
      sector: "software-ai",
      reviewedAt: clock.now(),
    });
  });
});

describe("mergeThemes", () => {
  it("moves links, marks the theme merged and recomputes the centroid", async () => {
    const from = await insertNamedSeedTheme(db, {
      slug: "genai",
      tagSlugs: ["genai", "llm"],
      axisIndex: 1,
    });
    const into = await insertNamedSeedTheme(db, { slug: "ai", axisIndex: 0 });

    const result = await mergeThemes({
      db,
      fromSlug: "genai",
      intoSlug: "ai",
      clock,
    });
    expect(result.tagsMoved).toBe(2);

    for (const tagId of from.tagIds) {
      expect(await linkOf(tagId)).toMatchObject({
        themeId: into.themeId,
        assignedBy: "manual",
        similarity: null,
      });
    }
    expect(await theme(from.themeId)).toMatchObject({
      status: "merged",
      mergedIntoId: into.themeId,
      reviewedAt: clock.now(),
    });
    const survivor = await theme(into.themeId);
    expect(survivor.reviewedAt).toEqual(clock.now());
    expect(
      cosine(survivor.centroid, meanCentroid([axis(0), axis(1), axis(1)])),
    ).toBeCloseTo(1, 6);
  });

  it("resolves old slugs to the survivor, through chains", async () => {
    const a = await insertNamedSeedTheme(db, { slug: "a", axisIndex: 0 });
    await insertNamedSeedTheme(db, { slug: "b", axisIndex: 1 });
    const c = await insertNamedSeedTheme(db, { slug: "c", axisIndex: 2 });
    await mergeThemes({ db, fromSlug: "a", intoSlug: "b" });
    await mergeThemes({ db, fromSlug: "b", intoSlug: "c" });

    expect((await resolveThemeSlug(db, "a"))?.id).toBe(c.themeId);
    expect((await resolveThemeSlug(db, "b"))?.id).toBe(c.themeId);
    expect((await resolveThemeSlug(db, "c"))?.id).toBe(c.themeId);
    expect(await resolveThemeSlug(db, "nope")).toBeNull();
    // The first theme keeps its own record.
    expect((await theme(a.themeId)).slug).toBe("a");
    // Renaming by an old slug changes the survivor.
    await renameTheme({ db, slug: "a", name: "Survivor" });
    expect((await theme(c.themeId)).name).toBe("Survivor");
  });

  it("refuses self-merges, merged sources and merged targets", async () => {
    await insertNamedSeedTheme(db, { slug: "a", axisIndex: 0 });
    await insertNamedSeedTheme(db, { slug: "b", axisIndex: 1 });
    await insertNamedSeedTheme(db, { slug: "c", axisIndex: 2 });
    await expect(
      mergeThemes({ db, fromSlug: "a", intoSlug: "a" }),
    ).rejects.toThrow(/itself/);
    await mergeThemes({ db, fromSlug: "a", intoSlug: "b" });
    await expect(
      mergeThemes({ db, fromSlug: "a", intoSlug: "c" }),
    ).rejects.toThrow(/already merged/);
    await expect(
      mergeThemes({ db, fromSlug: "c", intoSlug: "a" }),
    ).rejects.toThrow(/merge into "b" instead/);
    await expect(
      mergeThemes({ db, fromSlug: "c", intoSlug: "missing" }),
    ).rejects.toThrow(/No theme/);
  });

  it("refuses to merge themes from different embedding models", async () => {
    await insertNamedSeedTheme(db, { slug: "a" });
    const seed = await insertTag(db, { slug: "x", embedding: axis(3) });
    await insertTheme(db, {
      slug: "b",
      seedTagId: seed,
      centroid: axis(3),
      model: "other-model",
    });
    await expect(
      mergeThemes({ db, fromSlug: "a", intoSlug: "b" }),
    ).rejects.toThrow(/embedding models/);
  });
});

describe("moveTag", () => {
  it("moves a tag to another theme and recomputes both centroids", async () => {
    const from = await insertNamedSeedTheme(db, {
      slug: "ai",
      tagSlugs: ["ai", "robots"],
      axisIndex: 0,
    });
    const to = await insertNamedSeedTheme(db, {
      slug: "robotics",
      axisIndex: 1,
    });
    await db
      .update(tags)
      .set({ embedding: axis(1) })
      .where(eq(tags.id, from.tagIds[1]!));

    const result = await moveTag({
      db,
      tagSlug: "robots",
      themeSlug: "robotics",
      clock,
    });
    expect(result).toMatchObject({
      fromThemeId: from.themeId,
      toTheme: { id: to.themeId },
    });
    expect(await linkOf(from.tagIds[1]!)).toMatchObject({
      themeId: to.themeId,
      assignedBy: "manual",
      similarity: null,
      assignedAt: clock.now(),
    });
    expect((await theme(from.themeId)).reviewedAt).toEqual(clock.now());
    expect((await theme(to.themeId)).reviewedAt).toEqual(clock.now());
    expect(cosine((await theme(from.themeId)).centroid, axis(0))).toBeCloseTo(
      1,
      6,
    );
  });

  it("moving to none makes a null link that auto-assignment respects", async () => {
    const { themeId, tagIds } = await insertNamedSeedTheme(db, {
      slug: "ai",
      tagSlugs: ["ai", "ml"],
    });
    await moveTag({ db, tagSlug: "ml", themeSlug: null, clock });
    expect(await linkOf(tagIds[1]!)).toMatchObject({
      themeId: null,
      assignedBy: "manual",
    });

    // A tag never linked before can also be put in no theme.
    const c = await insertCompany(db, "c");
    const fresh = await insertTag(db, {
      slug: "deep-learning",
      embedding: vectorAt(0.99, 0, 1),
      companies: [{ id: c }],
    });
    await moveTag({ db, tagSlug: "deep-learning", themeSlug: "none-of-them" })
      .then(() => {
        throw new Error("expected a refusal");
      })
      .catch((error: unknown) => expect(error).toBeInstanceOf(ThemeAdminError));
    await moveTag({ db, tagSlug: "deep-learning", themeSlug: null });

    const run = await assignThemesStep({ db, model });
    expect(run.tagsAssigned).toBe(0);
    expect(await linkOf(tagIds[1]!)).toMatchObject({ themeId: null });
    expect(await linkOf(fresh)).toMatchObject({ themeId: null });
    expect((await theme(themeId)).status).toBe("active");
  });

  it("refuses unknown tags", async () => {
    await expect(
      moveTag({ db, tagSlug: "missing", themeSlug: null }),
    ).rejects.toThrow(/No tag/);
  });
});

describe("suggestMerges", () => {
  it("lists close pairs of active themes and changes nothing", async () => {
    const a = await insertTag(db, { slug: "a", embedding: axis(0) });
    const b = await insertTag(db, {
      slug: "b",
      embedding: vectorAt(0.75, 0, 1),
    });
    const c = await insertTag(db, {
      slug: "c",
      embedding: vectorAt(0.65, 0, 2),
    });
    const d = await insertTag(db, { slug: "d", embedding: axis(0) });
    const ta = await insertTheme(db, {
      slug: "a",
      seedTagId: a,
      centroid: axis(0),
    });
    const tb = await insertTheme(db, {
      slug: "b",
      seedTagId: b,
      centroid: vectorAt(0.75, 0, 1),
    });
    await insertTheme(db, {
      slug: "c",
      seedTagId: c,
      centroid: vectorAt(0.65, 0, 2),
    });
    const td = await insertTheme(db, {
      slug: "d",
      seedTagId: d,
      centroid: axis(0),
    });
    for (const [tag, t] of [
      [a, ta],
      [b, tb],
      [d, td],
    ] as const) {
      await linkTag(db, tag, t);
    }
    await mergeThemes({ db, fromSlug: "d", intoSlug: "a" });
    const before = await db.select().from(themes);

    // τ is explicit so the test does not follow the tuned default.
    const pairs = await suggestMerges(db, { threshold: 0.6 });
    expect(pairs.map((p) => [p.a.slug, p.b.slug])).toEqual([["a", "b"]]);
    expect(pairs[0]!.similarity).toBeCloseTo(0.75, 5);
    expect(
      (await suggestMerges(db, { threshold: 0.5 })).map((p) => [
        p.a.slug,
        p.b.slug,
      ]),
    ).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
    expect(await db.select().from(themes)).toEqual(before);
  });
});
