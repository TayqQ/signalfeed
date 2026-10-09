import { and, asc, eq, isNull } from "drizzle-orm";
import type { ExtractionV1 } from "@/core/extraction-schema";
import type { Db } from "@/db/client";
import {
  extractions,
  sourceItems,
  sourceItemTexts,
  sources,
} from "@/db/schema";

export type StoredExtraction = typeof extractions.$inferSelect;

export interface NewExtraction {
  sourceItemId: number;
  promptVersion: string;
  model: string;
  result: ExtractionV1;
  isRelevant: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}

/** A current extraction that resolve has not finished, with its source context. */
export interface UnresolvedExtraction {
  id: number;
  sourceItemId: number;
  promptVersion: string;
  model: string;
  result: ExtractionV1;
  isRelevant: boolean;
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
  sourcePriority: number;
  sourceName: string;
}

const UNIQUE_VIOLATION = "23505";

function extractionKey(
  input: Pick<NewExtraction, "sourceItemId" | "promptVersion" | "model">,
) {
  return and(
    eq(extractions.sourceItemId, input.sourceItemId),
    eq(extractions.promptVersion, input.promptVersion),
    eq(extractions.model, input.model),
  );
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && current.code === UNIQUE_VIOLATION) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Store a new current extraction. The same item, prompt version and model
 * returns the existing row and leaves every other row untouched.
 */
export async function insertExtraction(
  db: Db,
  input: NewExtraction,
): Promise<StoredExtraction> {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(extractions)
        .where(extractionKey(input))
        .limit(1);
      if (existing) return existing;

      await tx
        .update(extractions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(extractions.sourceItemId, input.sourceItemId),
            eq(extractions.isCurrent, true),
          ),
        );

      const [created] = await tx
        .insert(extractions)
        .values({
          sourceItemId: input.sourceItemId,
          promptVersion: input.promptVersion,
          model: input.model,
          result: input.result,
          isRelevant: input.isRelevant,
          isCurrent: true,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          costUsdMicros: input.costUsdMicros,
        })
        .returning();
      if (!created) {
        throw new Error("Insert did not return an extraction row");
      }
      return created;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await db
      .select()
      .from(extractions)
      .where(extractionKey(input))
      .limit(1);
    if (!existing) throw error;
    return existing;
  }
}

/** Current extractions still waiting for resolve, oldest first. */
export async function listUnresolvedExtractions(
  db: Db,
  limit: number,
): Promise<UnresolvedExtraction[]> {
  if (limit < 1) return [];

  return db
    .select({
      id: extractions.id,
      sourceItemId: extractions.sourceItemId,
      promptVersion: extractions.promptVersion,
      model: extractions.model,
      result: extractions.result,
      isRelevant: extractions.isRelevant,
      title: sourceItems.title,
      url: sourceItems.url,
      publishedAt: sourceItems.publishedAt,
      summary: sourceItemTexts.summary,
      sourcePriority: sources.priority,
      sourceName: sources.name,
    })
    .from(extractions)
    .innerJoin(sourceItems, eq(sourceItems.id, extractions.sourceItemId))
    .innerJoin(
      sourceItemTexts,
      eq(sourceItemTexts.sourceItemId, sourceItems.id),
    )
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .where(and(eq(extractions.isCurrent, true), isNull(extractions.resolvedAt)))
    .orderBy(asc(extractions.createdAt), asc(extractions.id))
    .limit(limit);
}

export async function markResolved(db: Db, id: number): Promise<void> {
  await db
    .update(extractions)
    .set({ resolvedAt: new Date() })
    .where(eq(extractions.id, id));
}

/** Extractions for this item that are no longer current. */
export async function listSupersededExtractionIds(
  db: Db,
  sourceItemId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: extractions.id })
    .from(extractions)
    .where(
      and(
        eq(extractions.sourceItemId, sourceItemId),
        eq(extractions.isCurrent, false),
      ),
    )
    .orderBy(asc(extractions.id));

  return rows.map((row) => row.id);
}
