import type { MergeEntity } from "@/core/enums";
import type { Db } from "@/db/client";
import { mergeCandidates } from "@/db/schema";

export interface MergeCandidateInput {
  entityType: MergeEntity;
  leftId: number;
  rightId: number;
  score: number;
  reason: string;
}

/**
 * Records a pair for manual review. The smaller id is stored as left, so a pair
 * is the same whichever way round it is reported. A pair that already exists,
 * in any status, is left untouched. Returns true when a row was inserted.
 */
export async function addMergeCandidate(
  db: Db,
  input: MergeCandidateInput,
): Promise<boolean> {
  if (input.leftId === input.rightId) return false;
  const inserted = await db
    .insert(mergeCandidates)
    .values({
      entityType: input.entityType,
      leftId: Math.min(input.leftId, input.rightId),
      rightId: Math.max(input.leftId, input.rightId),
      score: input.score,
      reason: input.reason,
    })
    .onConflictDoNothing({
      target: [
        mergeCandidates.entityType,
        mergeCandidates.leftId,
        mergeCandidates.rightId,
      ],
    })
    .returning({ id: mergeCandidates.id });
  return inserted.length > 0;
}
