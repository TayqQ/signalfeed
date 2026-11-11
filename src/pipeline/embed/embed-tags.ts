import { and, asc, eq, exists, isNull, or, sql } from "drizzle-orm";
import type { EmbedStats } from "@/core/domain";
import { BudgetExceededError } from "@/core/errors";
import type { BudgetGuard, EmbeddingClient } from "@/core/ports";
import type { Db } from "@/db/client";
import { companies, companyTags, tags } from "@/db/schema";
import { costUsdMicros, estimateEmbeddingCost } from "../extract/pricing";

export const EMBED_BATCH_SIZE = 256;

/**
 * Version of the text sent to the embedding model for each tag. Bump it with
 * any change to `tagEmbeddingInput`: the stored identity then changes, so every
 * tag is embedded again and old and new vectors never mix (D46).
 */
export const TAG_EMBEDDING_TEMPLATE = "market-v1";

/** The text embedded for a tag: its label in a short context (D46). */
export function tagEmbeddingInput(label: string): string {
  return `Startup market: ${label}`;
}

/**
 * What `tags.embedding_model` and `themes.embedding_model` store: the model
 * and the input template. The assign and admin steps must use this value, not
 * the bare model name.
 */
export function tagEmbeddingIdentity(model: string): string {
  return `${model}+${TAG_EMBEDDING_TEMPLATE}`;
}

export interface EmbedTagsOptions {
  db: Db;
  /** Absent when there is no OpenAI key: the step is skipped. */
  embedder?: EmbeddingClient;
  budget: BudgetGuard;
  /** The API model name. Pricing uses it; the stored identity adds the template. */
  model: string;
  dimensions: number;
  maxTags: number;
  runId?: number;
}

export async function embedTagsStep({
  db,
  embedder,
  budget,
  model,
  dimensions,
  maxTags,
  runId,
}: EmbedTagsOptions): Promise<EmbedStats> {
  const stats: EmbedStats = { tagsEmbedded: 0, batches: 0 };
  if (!embedder) return { ...stats, skipped: true };
  const identity = tagEmbeddingIdentity(model);

  const pending = await db
    .select({ id: tags.id, label: tags.label })
    .from(tags)
    .where(
      and(
        or(
          isNull(tags.embedding),
          sql`${tags.embeddingModel} is distinct from ${identity}`,
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(companyTags)
            .innerJoin(companies, eq(companies.id, companyTags.companyId))
            .where(
              and(
                eq(companyTags.tagId, tags.id),
                isNull(companies.mergedIntoId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(tags.firstSeenAt), asc(tags.id))
    .limit(Math.max(0, maxTags));

  for (let start = 0; start < pending.length; start += EMBED_BATCH_SIZE) {
    const batch = pending.slice(start, start + EMBED_BATCH_SIZE);
    const inputs = batch.map((tag) => tagEmbeddingInput(tag.label));

    try {
      await budget.assertCanSpend(estimateEmbeddingCost(model, inputs));
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        return { ...stats, budgetPaused: true };
      }
      throw error;
    }

    const result = await embedder.embed({ inputs, dimensions });
    if (result.vectors.length !== batch.length) {
      throw new Error("Embedding client returned the wrong number of vectors");
    }

    // The call is paid for, so record it before anything can fail.
    await budget.record({
      purpose: "embedding",
      model,
      inputTokens: result.usage.inputTokens,
      outputTokens: 0,
      costUsdMicros: costUsdMicros(model, {
        inputTokens: result.usage.inputTokens,
        outputTokens: 0,
      }),
      ingestRunId: runId,
    });

    await db.transaction(async (tx) => {
      for (const [index, tag] of batch.entries()) {
        await tx
          .update(tags)
          .set({
            embedding: result.vectors[index],
            embeddingModel: identity,
          })
          .where(eq(tags.id, tag.id));
      }
    });

    stats.tagsEmbedded += batch.length;
    stats.batches += 1;
  }

  return stats;
}
