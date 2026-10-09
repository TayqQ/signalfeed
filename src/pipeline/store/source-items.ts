import { and, asc, eq, inArray, lt, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { CollectedItem } from "@/core/domain";
import type { SourceItemStatus } from "@/core/enums";
import type { Db } from "@/db/client";
import {
  extractions,
  sourceItems,
  sourceItemTexts,
  sources,
} from "@/db/schema";
import { canonicaliseUrl } from "@/lib/normalise";

/** A stored item with the feed summary and source name the pipeline reads. */
export interface PipelineSourceItem {
  id: number;
  sourceId: number;
  externalId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  attempts: number;
  status: SourceItemStatus;
  summary: string | null;
  sourceName: string;
}

export interface InsertCollectedItemsResult {
  inserted: number;
  skipped: number;
}

interface PreparedItem {
  externalId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
}

const pipelineItemFields = {
  id: sourceItems.id,
  sourceId: sourceItems.sourceId,
  externalId: sourceItems.externalId,
  url: sourceItems.url,
  canonicalUrl: sourceItems.canonicalUrl,
  title: sourceItems.title,
  publishedAt: sourceItems.publishedAt,
  fetchedAt: sourceItems.fetchedAt,
  attempts: sourceItems.attempts,
  status: sourceItems.status,
  summary: sourceItemTexts.summary,
  sourceName: sources.name,
};

const reextractTarget = alias(extractions, "reextract_target");

/** Keep the first item for each canonical URL and external id in this batch. */
function prepareItems(items: readonly CollectedItem[]): PreparedItem[] {
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  const prepared: PreparedItem[] = [];

  for (const item of items) {
    const canonicalUrl = canonicaliseUrl(item.url);
    if (seenUrls.has(canonicalUrl) || seenExternalIds.has(item.externalId)) {
      continue;
    }
    seenUrls.add(canonicalUrl);
    seenExternalIds.add(item.externalId);
    prepared.push({
      externalId: item.externalId,
      url: item.url,
      canonicalUrl,
      title: item.title,
      summary: item.summary,
      publishedAt: item.publishedAt,
    });
  }

  return prepared;
}

/**
 * Canonicalise URLs, then insert items and their summaries.
 * A canonical URL or external id that already exists is left unchanged.
 */
export async function insertCollectedItems(
  db: Db,
  sourceId: number,
  items: readonly CollectedItem[],
): Promise<InsertCollectedItemsResult> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  const prepared = prepareItems(items);
  const summaryByUrl = new Map(
    prepared.map((item) => [item.canonicalUrl, item.summary]),
  );

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(sourceItems)
      .values(
        prepared.map((item) => ({
          sourceId,
          externalId: item.externalId,
          url: item.url,
          canonicalUrl: item.canonicalUrl,
          title: item.title,
          publishedAt: item.publishedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({
        id: sourceItems.id,
        canonicalUrl: sourceItems.canonicalUrl,
      });

    if (rows.length > 0) {
      await tx
        .insert(sourceItemTexts)
        .values(
          rows.map((row) => ({
            sourceItemId: row.id,
            summary: summaryByUrl.get(row.canonicalUrl) ?? null,
          })),
        )
        .onConflictDoNothing();
    }

    return rows;
  });

  return {
    inserted: inserted.length,
    skipped: items.length - inserted.length,
  };
}

/** Pending items with fewer than 3 attempts, oldest fetch first. */
export async function listPendingItems(
  db: Db,
  limit: number,
): Promise<PipelineSourceItem[]> {
  if (limit < 1) return [];

  return db
    .select(pipelineItemFields)
    .from(sourceItems)
    .innerJoin(
      sourceItemTexts,
      eq(sourceItemTexts.sourceItemId, sourceItems.id),
    )
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(and(eq(sourceItems.status, "pending"), lt(sourceItems.attempts, 3)))
    .orderBy(asc(sourceItems.fetchedAt), asc(sourceItems.id))
    .limit(limit);
}

export async function markFilteredOut(
  db: Db,
  ids: readonly number[],
): Promise<void> {
  if (ids.length === 0) return;

  await db
    .update(sourceItems)
    .set({ status: "filtered_out" })
    .where(inArray(sourceItems.id, [...ids]));
}

export async function markExtracted(db: Db, id: number): Promise<void> {
  await db
    .update(sourceItems)
    .set({ status: "extracted" })
    .where(eq(sourceItems.id, id));
}

/** Increment attempts. The third failure sets the item to `failed`. */
export async function recordFailure(
  db: Db,
  id: number,
  error: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        attempts: sourceItems.attempts,
        status: sourceItems.status,
      })
      .from(sourceItems)
      .where(eq(sourceItems.id, id))
      .limit(1);

    if (!item) {
      throw new Error(`Cannot record a failure for missing source item ${id}`);
    }

    const attempts = item.attempts + 1;
    await tx
      .update(sourceItems)
      .set({
        attempts,
        lastError: error,
        status: attempts >= 3 ? "failed" : item.status,
      })
      .where(eq(sourceItems.id, id));
  });
}

/**
 * Items that already have a current extraction and have never been extracted
 * with this prompt version, oldest fetch first.
 */
export async function listItemsForReextract(
  db: Db,
  input: { promptVersion: string; limit: number },
): Promise<PipelineSourceItem[]> {
  if (input.limit < 1) return [];

  return db
    .select(pipelineItemFields)
    .from(sourceItems)
    .innerJoin(
      extractions,
      and(
        eq(extractions.sourceItemId, sourceItems.id),
        eq(extractions.isCurrent, true),
      ),
    )
    .innerJoin(
      sourceItemTexts,
      eq(sourceItemTexts.sourceItemId, sourceItems.id),
    )
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(
      notExists(
        db
          .select({ id: reextractTarget.id })
          .from(reextractTarget)
          .where(
            and(
              eq(reextractTarget.sourceItemId, sourceItems.id),
              eq(reextractTarget.promptVersion, input.promptVersion),
            ),
          ),
      ),
    )
    .orderBy(asc(sourceItems.fetchedAt), asc(sourceItems.id))
    .limit(input.limit);
}
