import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ThemeNameSource } from "@/core/enums";
import type { Clock } from "@/core/ports";
import { isSector, type Sector } from "@/core/sectors";
import type { Db } from "@/db/client";
import { companies, companyTags, tagThemes, tags, themes } from "@/db/schema";
import { DEFAULT_THEME_THRESHOLD, meanCentroid } from "./cluster";
import {
  THEME_NAME_MAX_LENGTH,
  THEME_NAME_MIN_LENGTH,
  loadThemeTags,
} from "./name-themes";

// Functions behind `pnpm themes` (spec-phase2 section 7.3). The CLI wrapper is Task 043.

/** A refused manual change, with a message fit for the command line. */
export class ThemeAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeAdminError";
  }
}

const systemClock: Clock = { now: () => new Date() };
/** Merge chains longer than this are treated as broken. */
const MAX_MERGE_HOPS = 100;

export interface ThemeRow {
  id: number;
  slug: string;
  name: string;
  nameSource: ThemeNameSource;
  sector: string | null;
  status: "active" | "merged";
  mergedIntoId: number | null;
  embeddingModel: string;
}

const themeColumns = {
  id: themes.id,
  slug: themes.slug,
  name: themes.name,
  nameSource: themes.nameSource,
  sector: themes.sector,
  status: themes.status,
  mergedIntoId: themes.mergedIntoId,
  embeddingModel: themes.embeddingModel,
};

async function themeBySlug(
  db: Db,
  slug: string,
): Promise<ThemeRow | undefined> {
  const [row] = await db
    .select(themeColumns)
    .from(themes)
    .where(eq(themes.slug, slug));
  return row;
}

async function themeById(db: Db, id: number): Promise<ThemeRow | undefined> {
  const [row] = await db
    .select(themeColumns)
    .from(themes)
    .where(eq(themes.id, id));
  return row;
}

/**
 * The active theme a slug stands for, following `merged_into_id` through any
 * chain of merges. Null when no theme has the slug. Filters and redirects use it.
 */
export async function resolveThemeSlug(
  db: Db,
  slug: string,
): Promise<ThemeRow | null> {
  let theme = await themeBySlug(db, slug);
  for (let hops = 0; theme; hops++) {
    if (theme.status === "active") return theme;
    if (theme.mergedIntoId === null || hops >= MAX_MERGE_HOPS) {
      throw new ThemeAdminError(`Theme "${slug}" has a broken merge chain`);
    }
    theme = await themeById(db, theme.mergedIntoId);
  }
  return null;
}

async function requireActiveTheme(db: Db, slug: string): Promise<ThemeRow> {
  const theme = await resolveThemeSlug(db, slug);
  if (!theme) throw new ThemeAdminError(`No theme with slug "${slug}"`);
  return theme;
}

/**
 * Sets the centroid to the normalised mean of the member tags' embeddings
 * from the theme's model. A theme with no such members keeps its centroid.
 */
export async function recomputeCentroid(
  db: Db,
  themeId: number,
): Promise<void> {
  const theme = await themeById(db, themeId);
  if (!theme) return;
  const members = await db
    .select({ embedding: tags.embedding })
    .from(tagThemes)
    .innerJoin(tags, eq(tags.id, tagThemes.tagId))
    .where(
      and(
        eq(tagThemes.themeId, themeId),
        isNotNull(tags.embedding),
        eq(tags.embeddingModel, theme.embeddingModel),
      ),
    )
    .orderBy(asc(tagThemes.tagId));
  const vectors = members.flatMap((m) => (m.embedding ? [m.embedding] : []));
  if (vectors.length === 0) return;
  await db
    .update(themes)
    .set({ centroid: meanCentroid(vectors) })
    .where(eq(themes.id, themeId));
}

export interface ThemeListEntry {
  id: number;
  slug: string;
  name: string;
  nameSource: ThemeNameSource;
  sector: string | null;
  companies: number;
  /** Tag slugs, most mentioned first. */
  tags: string[];
  reviewedAt: Date | null;
}

/** Active themes, biggest first. `unreviewed` keeps those no person has checked. */
export async function listThemes(
  db: Db,
  { unreviewed = false }: { unreviewed?: boolean } = {},
): Promise<ThemeListEntry[]> {
  const rows = await db
    .select({
      id: themes.id,
      slug: themes.slug,
      name: themes.name,
      nameSource: themes.nameSource,
      sector: themes.sector,
      reviewedAt: themes.reviewedAt,
    })
    .from(themes)
    .where(
      and(
        eq(themes.status, "active"),
        unreviewed ? isNull(themes.reviewedAt) : undefined,
      ),
    );
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const counts = await db
    .select({
      themeId: tagThemes.themeId,
      companies: sql<number>`count(distinct ${companies.id})`.mapWith(Number),
    })
    .from(tagThemes)
    .innerJoin(companyTags, eq(companyTags.tagId, tagThemes.tagId))
    .innerJoin(
      companies,
      and(
        eq(companies.id, companyTags.companyId),
        isNull(companies.mergedIntoId),
      ),
    )
    .where(inArray(tagThemes.themeId, ids))
    .groupBy(tagThemes.themeId);
  const companyCount = new Map(counts.map((c) => [c.themeId, c.companies]));
  const tagsByTheme = await loadThemeTags(db, ids);

  return rows
    .map((row) => ({
      ...row,
      companies: companyCount.get(row.id) ?? 0,
      tags: (tagsByTheme.get(row.id) ?? []).map((tag) => tag.slug),
    }))
    .sort(
      (a, b) =>
        b.companies - a.companies ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
}

export interface RenameThemeArgs {
  db: Db;
  slug: string;
  name: string;
  clock?: Clock;
}

/** A person's name for a theme. The naming step never overwrites it. */
export async function renameTheme({
  db,
  slug,
  name,
  clock = systemClock,
}: RenameThemeArgs): Promise<ThemeRow> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (
    clean.length < THEME_NAME_MIN_LENGTH ||
    clean.length > THEME_NAME_MAX_LENGTH
  ) {
    throw new ThemeAdminError(
      `A theme name must be ${THEME_NAME_MIN_LENGTH}-${THEME_NAME_MAX_LENGTH} characters`,
    );
  }
  const theme = await requireActiveTheme(db, slug);
  await db
    .update(themes)
    .set({ name: clean, nameSource: "manual", reviewedAt: clock.now() })
    .where(eq(themes.id, theme.id));
  return { ...theme, name: clean, nameSource: "manual" };
}

export interface SetThemeSectorArgs {
  db: Db;
  slug: string;
  sector: string;
  clock?: Clock;
}

export async function setThemeSector({
  db,
  slug,
  sector,
  clock = systemClock,
}: SetThemeSectorArgs): Promise<ThemeRow> {
  if (!isSector(sector)) {
    throw new ThemeAdminError(`Unknown sector "${sector}"`);
  }
  const theme = await requireActiveTheme(db, slug);
  await db
    .update(themes)
    .set({ sector: sector satisfies Sector, reviewedAt: clock.now() })
    .where(eq(themes.id, theme.id));
  return { ...theme, sector };
}

export interface MergeThemesArgs {
  db: Db;
  fromSlug: string;
  intoSlug: string;
  clock?: Clock;
}

export interface MergeThemesResult {
  from: ThemeRow;
  into: ThemeRow;
  tagsMoved: number;
}

/**
 * Moves every tag link from one active theme to another, marks the first as
 * merged into the second and recomputes the survivor's centroid. Slugs of
 * themes merged earlier keep pointing at `from`, so they reach the survivor
 * through the chain.
 */
export async function mergeThemes({
  db,
  fromSlug,
  intoSlug,
  clock = systemClock,
}: MergeThemesArgs): Promise<MergeThemesResult> {
  return db.transaction(async (tx) => {
    const from = await themeBySlug(tx, fromSlug);
    const into = await themeBySlug(tx, intoSlug);
    if (!from) throw new ThemeAdminError(`No theme with slug "${fromSlug}"`);
    if (!into) throw new ThemeAdminError(`No theme with slug "${intoSlug}"`);
    if (from.id === into.id) {
      throw new ThemeAdminError("A theme cannot be merged into itself");
    }
    if (from.status !== "active") {
      throw new ThemeAdminError(`Theme "${fromSlug}" is already merged`);
    }
    if (into.status !== "active") {
      const survivor = await resolveThemeSlug(tx, intoSlug);
      throw new ThemeAdminError(
        `Theme "${intoSlug}" is merged; merge into "${survivor?.slug ?? "?"}" instead`,
      );
    }
    if (from.embeddingModel !== into.embeddingModel) {
      throw new ThemeAdminError(
        "Themes from different embedding models cannot be merged",
      );
    }

    const now = clock.now();
    const moved = await tx
      .update(tagThemes)
      .set({
        themeId: into.id,
        assignedBy: "manual",
        similarity: null,
        assignedAt: now,
      })
      .where(eq(tagThemes.themeId, from.id))
      .returning({ tagId: tagThemes.tagId });
    await tx
      .update(themes)
      .set({ status: "merged", mergedIntoId: into.id, reviewedAt: now })
      .where(eq(themes.id, from.id));
    await tx
      .update(themes)
      .set({ reviewedAt: now })
      .where(eq(themes.id, into.id));
    await recomputeCentroid(tx, into.id);

    return {
      from: { ...from, status: "merged" as const, mergedIntoId: into.id },
      into,
      tagsMoved: moved.length,
    };
  });
}

export interface MoveTagArgs {
  db: Db;
  tagSlug: string;
  /** Null puts the tag in no theme; automatic assignment then leaves it alone. */
  themeSlug: string | null;
  clock?: Clock;
}

export interface MoveTagResult {
  tagId: number;
  fromThemeId: number | null;
  toTheme: ThemeRow | null;
}

/** A manual link. Automatic assignment never changes it. */
export async function moveTag({
  db,
  tagSlug,
  themeSlug,
  clock = systemClock,
}: MoveTagArgs): Promise<MoveTagResult> {
  return db.transaction(async (tx) => {
    const [tag] = await tx
      .select({ id: tags.id, embeddingModel: tags.embeddingModel })
      .from(tags)
      .where(eq(tags.slug, tagSlug));
    if (!tag) throw new ThemeAdminError(`No tag with slug "${tagSlug}"`);
    const target =
      themeSlug === null ? null : await requireActiveTheme(tx, themeSlug);

    const [previous] = await tx
      .select({ themeId: tagThemes.themeId })
      .from(tagThemes)
      .where(eq(tagThemes.tagId, tag.id));
    const fromThemeId = previous?.themeId ?? null;

    const now = clock.now();
    const link = {
      themeId: target?.id ?? null,
      similarity: null,
      assignedBy: "manual" as const,
      embeddingModel: tag.embeddingModel,
      assignedAt: now,
    };
    await tx
      .insert(tagThemes)
      .values({ tagId: tag.id, ...link })
      .onConflictDoUpdate({ target: tagThemes.tagId, set: link });

    const touched = [
      ...new Set(
        [fromThemeId, target?.id ?? null].filter(
          (id): id is number => id !== null,
        ),
      ),
    ];
    for (const id of touched) {
      await tx.update(themes).set({ reviewedAt: now }).where(eq(themes.id, id));
      await recomputeCentroid(tx, id);
    }

    return { tagId: tag.id, fromThemeId, toTheme: target };
  });
}

export interface MergeSuggestion {
  a: { id: number; slug: string; name: string };
  b: { id: number; slug: string; name: string };
  similarity: number;
}

/**
 * Pairs of active themes from the same embedding model whose centroids have
 * a cosine similarity of at least `threshold + 0.1`. Changes nothing.
 */
export async function suggestMerges(
  db: Db,
  { threshold = DEFAULT_THEME_THRESHOLD }: { threshold?: number } = {},
): Promise<MergeSuggestion[]> {
  const cutoff = threshold + 0.1;
  const a = alias(themes, "a");
  const b = alias(themes, "b");
  const similarity = sql<number>`1 - (${a.centroid} <=> ${b.centroid})`;
  const rows = await db
    .select({
      aId: a.id,
      aSlug: a.slug,
      aName: a.name,
      bId: b.id,
      bSlug: b.slug,
      bName: b.name,
      similarity: similarity.mapWith(Number),
    })
    .from(a)
    .innerJoin(b, and(lt(a.id, b.id), eq(a.embeddingModel, b.embeddingModel)))
    .where(
      and(
        eq(a.status, "active"),
        eq(b.status, "active"),
        sql`${similarity} >= ${cutoff}`,
      ),
    )
    .orderBy(desc(similarity), asc(a.id), asc(b.id));

  return rows.map((row) => ({
    a: { id: row.aId, slug: row.aSlug, name: row.aName },
    b: { id: row.bId, slug: row.bSlug, name: row.bName },
    similarity: row.similarity,
  }));
}
