import { and, asc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, companyTags, tagThemes, tags, themes } from "@/db/schema";
import { slugify } from "@/lib/normalise";
import {
  DEFAULT_THEME_BANDS,
  DEFAULT_THEME_THRESHOLD,
  type GreedyTag,
  type GreedyTheme,
  type MemberTag,
  type ThemeBands,
  type ThemeTarget,
} from "./cluster";
import { isGenericTag } from "./stoplist";
import {
  assignWithThemeCheck,
  type ThemeCheckDeps,
  type ThemeCheckStats,
} from "./theme-check";

export interface AssignThemesArgs {
  db: Db;
  /** The embedding model in use. Only tags and themes from this model take part. */
  model: string;
  /** Embedding-only τ: the rule with no LLM, and the fallback in the band. */
  threshold?: number;
  bands?: ThemeBands;
  /** The LLM check for tags in the band (D47). Absent: embedding only. */
  check?: ThemeCheckDeps;
}

export interface AssignThemesResult {
  tagsAssigned: number;
  themesCreated: number;
  /** Existing themes whose centroid moved. */
  centroidsUpdated: number;
  /** Unlinked generic tags left out (stoplist). */
  genericSkipped: number;
  /** The LLM check, when a client was given and a tag needed placing. */
  check?: ThemeCheckStats;
}

/** Same limit as `slugify`, kept when a numeric suffix is added. */
const MAX_SLUG_LENGTH = 60;
const SLUG_BATCH_SIZE = 50;
const INSERT_CHUNK = 500;

function withSuffix(base: string, n: number): string {
  if (n === 1) return base;
  const suffix = `-${n}`;
  const head = base
    .slice(0, MAX_SLUG_LENGTH - suffix.length)
    .replace(/-+$/g, "");
  return `${head}${suffix}`;
}

/**
 * The first free theme slug from `base`, then `-2`, `-3` and so on. Mirrors
 * `allocateSlug` in `resolve/slugs.ts`, which only covers companies and investors.
 */
export async function allocateThemeSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base) || "theme";
  for (let start = 1; ; start += SLUG_BATCH_SIZE) {
    const candidates = Array.from({ length: SLUG_BATCH_SIZE }, (_, i) =>
      withSuffix(root, start + i),
    );
    const rows = await db
      .select({ slug: themes.slug })
      .from(themes)
      .where(inArray(themes.slug, candidates));
    const taken = new Set(rows.map((row) => row.slug));
    const free = candidates.find((slug) => !taken.has(slug));
    if (free) return free;
  }
}

async function loadActiveThemes(db: Db, model: string): Promise<GreedyTheme[]> {
  const rows = await db
    .select({ id: themes.id, name: themes.name, centroid: themes.centroid })
    .from(themes)
    .where(and(eq(themes.status, "active"), eq(themes.embeddingModel, model)))
    .orderBy(asc(themes.id));

  const members = await db
    .select({
      themeId: tagThemes.themeId,
      label: tags.label,
      embedding: tags.embedding,
      mentions: liveMentions().mapWith(Number),
    })
    .from(tagThemes)
    .innerJoin(tags, eq(tags.id, tagThemes.tagId))
    .innerJoin(themes, eq(themes.id, tagThemes.themeId))
    .leftJoin(companyTags, eq(companyTags.tagId, tags.id))
    .leftJoin(companies, eq(companies.id, companyTags.companyId))
    .where(
      and(
        eq(themes.status, "active"),
        eq(themes.embeddingModel, model),
        isNotNull(tags.embedding),
        eq(tags.embeddingModel, model),
      ),
    )
    .groupBy(tagThemes.tagId, tagThemes.themeId, tags.id)
    .orderBy(asc(tagThemes.tagId));

  const byTheme = new Map<number, { vectors: number[][]; tags: MemberTag[] }>();
  for (const member of members) {
    if (member.themeId === null || !member.embedding) continue;
    const entry = byTheme.get(member.themeId) ?? { vectors: [], tags: [] };
    entry.vectors.push(member.embedding);
    entry.tags.push({ label: member.label, mentions: member.mentions });
    byTheme.set(member.themeId, entry);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    centroid: row.centroid,
    members: byTheme.get(row.id)?.vectors ?? [],
    memberTags: byTheme.get(row.id)?.tags ?? [],
  }));
}

/** Mentions across companies that are not merged away. */
function liveMentions() {
  return sql<number>`coalesce(sum(${companyTags.mentionCount}) filter (where ${companies.mergedIntoId} is null), 0)`;
}

interface CandidateTag extends GreedyTag {
  label: string;
}

/** Embedded tags with no `tag_themes` row, with mentions from live companies. */
async function loadUnlinkedTags(
  db: Db,
  model: string,
): Promise<CandidateTag[]> {
  const mentions = liveMentions();
  const rows = await db
    .select({
      id: tags.id,
      slug: tags.slug,
      label: tags.label,
      embedding: tags.embedding,
      mentions: mentions.mapWith(Number),
    })
    .from(tags)
    .leftJoin(companyTags, eq(companyTags.tagId, tags.id))
    .leftJoin(companies, eq(companies.id, companyTags.companyId))
    .where(
      and(
        isNotNull(tags.embedding),
        eq(tags.embeddingModel, model),
        notExists(
          db
            .select({ one: sql`1` })
            .from(tagThemes)
            .where(eq(tagThemes.tagId, tags.id)),
        ),
      ),
    )
    .groupBy(tags.id)
    .orderBy(asc(tags.id));

  return rows.flatMap((row) =>
    row.embedding
      ? [
          {
            id: row.id,
            slug: row.slug,
            label: row.label,
            embedding: row.embedding,
            mentions: row.mentions,
          },
        ]
      : [],
  );
}

/**
 * Pipeline step 10a (spec-phase2 section 7.1): links every new embedded tag
 * to a theme, starting new themes where nothing is close enough. Tags that
 * already have a link, manual, auto or none, are never touched. With an LLM
 * check, tags in the similarity band are placed by its verdict (D47). A
 * refused or failed call never fails the step: those tags fall back to τ.
 */
export async function assignThemesStep({
  db,
  model,
  threshold = DEFAULT_THEME_THRESHOLD,
  bands = DEFAULT_THEME_BANDS,
  check,
}: AssignThemesArgs): Promise<AssignThemesResult> {
  const unlinked = await loadUnlinkedTags(db, model);
  const candidates = unlinked.filter((tag) => !isGenericTag(tag.slug));
  const result: AssignThemesResult = {
    tagsAssigned: 0,
    themesCreated: 0,
    centroidsUpdated: 0,
    genericSkipped: unlinked.length - candidates.length,
  };
  if (candidates.length === 0) return result;

  const existing = await loadActiveThemes(db, model);
  const { greedy, stats } = await assignWithThemeCheck({
    tags: candidates,
    themes: existing,
    threshold,
    bands,
    check,
  });
  if (stats) result.check = stats;
  const labels = new Map(candidates.map((tag) => [tag.id, tag.label]));

  await db.transaction(async (tx) => {
    const newIds: number[] = [];
    for (const theme of greedy.newThemes) {
      const slug = await allocateThemeSlug(tx, theme.seedSlug);
      const [row] = await tx
        .insert(themes)
        .values({
          slug,
          name: labels.get(theme.seedTagId) ?? theme.seedSlug,
          nameSource: "tag",
          seedTagId: theme.seedTagId,
          centroid: theme.centroid,
          embeddingModel: model,
        })
        .returning({ id: themes.id });
      newIds.push(row!.id);
    }

    const themeIdOf = (target: ThemeTarget): number =>
      target.kind === "existing" ? target.id : newIds[target.index]!;

    const links = greedy.assignments.map((assignment) => ({
      tagId: assignment.tagId,
      themeId: themeIdOf(assignment.target),
      similarity: assignment.similarity,
      assignedBy: "auto" as const,
      embeddingModel: model,
    }));
    for (let start = 0; start < links.length; start += INSERT_CHUNK) {
      const inserted = await tx
        .insert(tagThemes)
        .values(links.slice(start, start + INSERT_CHUNK))
        // A link made since the read (a manual move) always wins.
        .onConflictDoNothing({ target: tagThemes.tagId })
        .returning({ tagId: tagThemes.tagId });
      result.tagsAssigned += inserted.length;
    }

    for (const update of greedy.updatedCentroids) {
      await tx
        .update(themes)
        .set({ centroid: update.centroid })
        .where(eq(themes.id, update.id));
    }

    result.themesCreated = newIds.length;
    result.centroidsUpdated = greedy.updatedCentroids.length;
  });

  return result;
}
