import { desc, eq } from "drizzle-orm";
import type { IngestStats } from "@/core/domain";
import type { IngestStatus, IngestTrigger } from "@/core/enums";
import type { Db } from "@/db/client";
import { ingestRuns } from "@/db/schema";

export type StoredIngestRun = typeof ingestRuns.$inferSelect;

export interface FinishRunInput {
  status: IngestStatus;
  stats: IngestStats | null;
  error: string | null;
}

export async function startRun(
  db: Db,
  trigger: IngestTrigger,
): Promise<StoredIngestRun> {
  const [run] = await db
    .insert(ingestRuns)
    .values({ trigger, status: "running" })
    .returning();
  if (!run) throw new Error("Insert did not return an ingest run");
  return run;
}

export async function finishRun(
  db: Db,
  id: number,
  input: FinishRunInput,
): Promise<void> {
  await db
    .update(ingestRuns)
    .set({
      status: input.status,
      stats: input.stats,
      error: input.error,
      finishedAt: new Date(),
    })
    .where(eq(ingestRuns.id, id));
}

/** The newest runs, most recently started first. */
export async function latestRuns(
  db: Db,
  n: number,
): Promise<StoredIngestRun[]> {
  if (n < 1) return [];

  return db
    .select()
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.startedAt), desc(ingestRuns.id))
    .limit(n);
}
