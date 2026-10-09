import { and, desc, gte, lt, sql } from "drizzle-orm";
import type { IngestStats } from "@/core/domain";
import { EVENT_TYPES, SOURCE_ITEM_STATUSES } from "@/core/enums";
import type { IngestRunSummary, StatusSummary } from "@/core/read-models";
import type { Db } from "../client";
import { events, ingestRuns, llmUsage, sourceItems } from "../schema";

const RECENT_RUN_LIMIT = 10;

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

function zeroCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const key of keys) counts[key] = 0;
  return counts;
}

function isoTimestamp(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function requiredTimestamp(value: Date | string): string {
  const iso = isoTimestamp(value);
  if (!iso) throw new Error("Expected a timestamp");
  return iso;
}

function asStats(value: unknown): IngestStats | null {
  if (typeof value === "string") {
    try {
      return asStats(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== "object") return null;
  return value as IngestStats;
}

function capOf(stats: IngestStats | null): number | null {
  if (
    stats == null ||
    typeof stats.capGbp !== "number" ||
    !Number.isFinite(stats.capGbp)
  ) {
    return null;
  }
  return stats.capGbp;
}

function utcMonthWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function monthToDateUsdMicros(db: Db, now: Date): Promise<number> {
  const { start, end } = utcMonthWindow(now);
  const [row] = await db
    .select({
      total: sql<
        string | number | null
      >`coalesce(sum(${llmUsage.costUsdMicros}), 0)`,
    })
    .from(llmUsage)
    .where(and(gte(llmUsage.occurredAt, start), lt(llmUsage.occurredAt, end)));
  return asCount(row?.total);
}

export async function getStatusSummary(db: Db): Promise<StatusSummary> {
  const now = new Date();
  const [runs, itemRows, eventRows, monthToDate] = await Promise.all([
    db
      .select()
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt), desc(ingestRuns.id))
      .limit(RECENT_RUN_LIMIT),
    db
      .select({
        status: sourceItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(sourceItems)
      .groupBy(sourceItems.status),
    db
      .select({
        type: events.type,
        count: sql<number>`count(*)::int`,
      })
      .from(events)
      .groupBy(events.type),
    monthToDateUsdMicros(db, now),
  ]);

  const itemCountsByStatus = zeroCounts(SOURCE_ITEM_STATUSES);
  for (const row of itemRows) {
    itemCountsByStatus[row.status] = asCount(row.count);
  }

  const eventCountsByType = zeroCounts(EVENT_TYPES);
  for (const row of eventRows) {
    eventCountsByType[row.type] = asCount(row.count);
  }

  const recentRuns: IngestRunSummary[] = runs.map((run) => ({
    id: run.id,
    startedAt: requiredTimestamp(run.startedAt),
    finishedAt: isoTimestamp(run.finishedAt),
    trigger: run.trigger,
    status: run.status,
    stats: asStats(run.stats),
    error: run.error,
  }));

  return {
    recentRuns,
    itemCountsByStatus,
    eventCountsByType,
    monthToDateUsdMicros: monthToDate,
    capGbp: capOf(recentRuns[0]?.stats ?? null),
  };
}
