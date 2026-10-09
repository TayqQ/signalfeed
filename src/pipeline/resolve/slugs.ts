import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, investors } from "@/db/schema";
import { slugify } from "@/lib/normalise";

export type SluggedTable = typeof companies | typeof investors;

/** Same limit as `slugify`, kept when a numeric suffix is added. */
const MAX_SLUG_LENGTH = 60;
const BATCH_SIZE = 50;

function fallbackSlug(table: SluggedTable): string {
  return table === companies ? "company" : "investor";
}

function withSuffix(base: string, n: number): string {
  if (n === 1) return base;
  const suffix = `-${n}`;
  const head = base
    .slice(0, MAX_SLUG_LENGTH - suffix.length)
    .replace(/-+$/g, "");
  return `${head}${suffix}`;
}

async function takenSlugs(
  db: Db,
  table: SluggedTable,
  candidates: string[],
): Promise<Set<string>> {
  const rows =
    table === companies
      ? await db
          .select({ slug: companies.slug })
          .from(companies)
          .where(inArray(companies.slug, candidates))
      : await db
          .select({ slug: investors.slug })
          .from(investors)
          .where(inArray(investors.slug, candidates));
  return new Set(rows.map((row) => row.slug));
}

/**
 * The first free slug of `name`, then `-2`, `-3` and so on. Callers store it
 * once; slugs never change after creation.
 */
export async function allocateSlug(
  db: Db,
  table: SluggedTable,
  name: string,
): Promise<string> {
  const base = slugify(name) || fallbackSlug(table);
  for (let start = 1; ; start += BATCH_SIZE) {
    const candidates = Array.from({ length: BATCH_SIZE }, (_, i) =>
      withSuffix(base, start + i),
    );
    const taken = await takenSlugs(db, table, candidates);
    const free = candidates.find((slug) => !taken.has(slug));
    if (free) return free;
  }
}
