import { asc, desc, eq, sql } from "drizzle-orm";
import type { SourceConfig } from "@/core/domain";
import type { Db } from "@/db/client";
import { sources } from "@/db/schema";

/** An enabled source plus the validators for a conditional GET. */
export interface EnabledSource {
  id: number;
  config: SourceConfig;
  etag: string | null;
  lastModified: string | null;
}

export interface SourceFetchState {
  etag: string | null;
  lastModified: string | null;
  fetchedAt: Date;
}

/**
 * Insert sources by slug. An existing slug keeps its id, kind and fetch
 * validators, and takes the new name, url, priority and enabled flag.
 */
export async function upsertSources(
  db: Db,
  configs: readonly SourceConfig[],
): Promise<void> {
  const bySlug = new Map<string, SourceConfig>();
  for (const config of configs) {
    bySlug.set(config.slug, config);
  }
  const rows = [...bySlug.values()].map((config) => ({
    slug: config.slug,
    name: config.name,
    kind: config.kind,
    url: config.url,
    priority: config.priority,
    enabled: config.enabled,
  }));
  if (rows.length === 0) return;

  await db
    .insert(sources)
    .values(rows)
    .onConflictDoUpdate({
      target: sources.slug,
      set: {
        name: sql`excluded.name`,
        url: sql`excluded.url`,
        priority: sql`excluded.priority`,
        enabled: sql`excluded.enabled`,
      },
    });
}

/** Enabled sources, highest priority first, then slug. */
export async function listEnabledSources(db: Db): Promise<EnabledSource[]> {
  const rows = await db
    .select()
    .from(sources)
    .where(eq(sources.enabled, true))
    .orderBy(desc(sources.priority), asc(sources.slug));

  return rows.map((row) => ({
    id: row.id,
    config: {
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      url: row.url,
      priority: row.priority,
      enabled: row.enabled,
    },
    etag: row.etag,
    lastModified: row.lastModified,
  }));
}

export async function updateFetchState(
  db: Db,
  sourceId: number,
  state: SourceFetchState,
): Promise<void> {
  await db
    .update(sources)
    .set({
      etag: state.etag,
      lastModified: state.lastModified,
      lastFetchedAt: state.fetchedAt,
    })
    .where(eq(sources.id, sourceId));
}
