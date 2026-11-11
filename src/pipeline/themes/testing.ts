import type { ThemeNameSource } from "@/core/enums";
import type { Sector } from "@/core/sectors";
import type { Db } from "@/db/client";
import {
  EMBEDDING_DIMENSIONS,
  companies,
  companyTags,
  tagThemes,
  tags,
  themes,
} from "@/db/schema";

// Test builders for the theme tests and later tasks (039, 043). Not for production code.

export const TEST_EMBEDDING_MODEL = "text-embedding-3-small";

/** The unit vector along `index`. */
export function axis(
  index: number,
  dimensions = EMBEDDING_DIMENSIONS,
): number[] {
  if (index < 0 || index >= dimensions) {
    throw new Error(`Axis ${index} is outside ${dimensions} dimensions`);
  }
  const v = new Array<number>(dimensions).fill(0);
  v[index] = 1;
  return v;
}

/**
 * A unit vector whose cosine similarity with axis `from` is exactly
 * `similarity`, leaning towards axis `towards`.
 */
export function vectorAt(
  similarity: number,
  from: number,
  towards: number,
  dimensions = EMBEDDING_DIMENSIONS,
): number[] {
  if (from === towards) throw new Error("`from` and `towards` must differ");
  const v = axis(from, dimensions);
  v[from] = similarity;
  v[towards] = Math.sqrt(Math.max(0, 1 - similarity * similarity));
  return v;
}

/**
 * Points in a tight group around axis `centre`: each leans slightly towards
 * its own axis (`spread + i`), keeping a similarity of `similarity` to the centre.
 */
export function tightGroup(
  centre: number,
  size: number,
  { similarity = 0.95, spread = 100, dimensions = EMBEDDING_DIMENSIONS } = {},
): number[][] {
  return Array.from({ length: size }, (_, i) =>
    vectorAt(similarity, centre, spread + centre * size + i, dimensions),
  );
}

export async function insertCompany(db: Db, slug: string): Promise<number> {
  const [row] = await db
    .insert(companies)
    .values({ slug, name: slug, normalisedName: slug })
    .returning({ id: companies.id });
  return row!.id;
}

export interface TagSpec {
  slug: string;
  label?: string;
  /** Omit for a tag that has not been embedded yet. */
  embedding?: number[];
  model?: string;
  /** Companies tagged with it and the mention count on each link. */
  companies?: { id: number; mentions?: number }[];
}

export async function insertTag(db: Db, spec: TagSpec): Promise<number> {
  const [row] = await db
    .insert(tags)
    .values({
      slug: spec.slug,
      label: spec.label ?? spec.slug.replace(/-/g, " "),
      embedding: spec.embedding ?? null,
      embeddingModel: spec.embedding
        ? (spec.model ?? TEST_EMBEDDING_MODEL)
        : null,
    })
    .returning({ id: tags.id });
  const tagId = row!.id;
  for (const company of spec.companies ?? []) {
    await db.insert(companyTags).values({
      companyId: company.id,
      tagId,
      mentionCount: company.mentions ?? 1,
    });
  }
  return tagId;
}

export interface ThemeSpec {
  slug: string;
  seedTagId: number;
  centroid: number[];
  name?: string;
  nameSource?: ThemeNameSource;
  sector?: Sector | null;
  model?: string;
  namedAt?: Date | null;
}

export async function insertTheme(db: Db, spec: ThemeSpec): Promise<number> {
  const [row] = await db
    .insert(themes)
    .values({
      slug: spec.slug,
      name: spec.name ?? spec.slug,
      nameSource: spec.nameSource ?? "tag",
      sector: spec.sector ?? null,
      seedTagId: spec.seedTagId,
      centroid: spec.centroid,
      embeddingModel: spec.model ?? TEST_EMBEDDING_MODEL,
      namedAt: spec.namedAt ?? null,
    })
    .returning({ id: themes.id });
  return row!.id;
}

/** Links a tag to a theme (or to none, with `themeId` null). */
export async function linkTag(
  db: Db,
  tagId: number,
  themeId: number | null,
  assignedBy: "auto" | "manual" = "auto",
): Promise<void> {
  await db.insert(tagThemes).values({
    tagId,
    themeId,
    assignedBy,
    similarity: assignedBy === "auto" ? 1 : null,
    embeddingModel: TEST_EMBEDDING_MODEL,
  });
}

/** A theme with `companyCount` companies, each tagged with every one of `tagSlugs`. */
export async function insertNamedSeedTheme(
  db: Db,
  {
    slug,
    tagSlugs = [slug],
    companyCount = 2,
    axisIndex = 0,
    nameSource = "tag",
    sector = null,
  }: {
    slug: string;
    tagSlugs?: string[];
    companyCount?: number;
    axisIndex?: number;
    nameSource?: ThemeNameSource;
    sector?: Sector | null;
  },
): Promise<{ themeId: number; tagIds: number[]; companyIds: number[] }> {
  const companyIds: number[] = [];
  for (let i = 0; i < companyCount; i++) {
    companyIds.push(await insertCompany(db, `${slug}-co-${i + 1}`));
  }
  const tagIds: number[] = [];
  for (const [i, tagSlug] of tagSlugs.entries()) {
    tagIds.push(
      await insertTag(db, {
        slug: tagSlug,
        embedding: axis(axisIndex),
        companies: companyIds.map((id) => ({
          id,
          mentions: tagSlugs.length - i,
        })),
      }),
    );
  }
  const themeId = await insertTheme(db, {
    slug,
    seedTagId: tagIds[0]!,
    centroid: axis(axisIndex),
    nameSource,
    sector,
  });
  for (const tagId of tagIds) await linkTag(db, tagId, themeId);
  return { themeId, tagIds, companyIds };
}
