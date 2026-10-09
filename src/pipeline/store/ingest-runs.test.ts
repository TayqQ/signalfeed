import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IngestStats } from "@/core/domain";
import type { Db } from "@/db/client";
import { ingestRuns } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { finishRun, latestRuns, startRun } from "./ingest-runs";

const stats: IngestStats = {
  collect: {
    sourcesAttempted: 1,
    sourcesNotModified: 0,
    sourcesFailed: 0,
    itemsFound: 2,
    itemsInserted: 2,
  },
  prefilter: { itemsChecked: 2, itemsPassed: 1, itemsFilteredOut: 1 },
  extract: {
    itemsAttempted: 1,
    itemsExtracted: 1,
    itemsRelevant: 1,
    itemsErrored: 0,
    itemsFailed: 0,
  },
  resolve: {
    extractionsResolved: 1,
    companiesCreated: 1,
    investorsCreated: 0,
    eventsCreated: 1,
    eventsUpdated: 0,
    mergeCandidatesCreated: 0,
  },
  fx: { ratesFetched: 1, eventsConverted: 1, eventsMissingRate: 0 },
  spendUsdMicros: 100,
  monthToDateUsdMicros: 100,
  capGbp: 3,
  budgetPaused: false,
};

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

describe("ingest runs", () => {
  it("starts a running row, finishes it, and lists the newest runs", async () => {
    const first = await startRun(db, "schedule");
    const second = await startRun(db, "manual");
    const third = await startRun(db, "manual");

    expect(first).toMatchObject({ trigger: "schedule", status: "running" });
    expect(first.finishedAt).toBeNull();
    expect(first.startedAt).toBeInstanceOf(Date);

    await finishRun(db, first.id, {
      status: "succeeded",
      stats,
      error: null,
    });
    await finishRun(db, second.id, {
      status: "failed",
      stats: null,
      error: "collector crashed",
    });

    const [finished] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, first.id));
    expect(finished).toMatchObject({
      status: "succeeded",
      stats,
      error: null,
    });
    expect(finished?.finishedAt).toBeInstanceOf(Date);

    const [failed] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, second.id));
    expect(failed).toMatchObject({
      status: "failed",
      stats: null,
      error: "collector crashed",
    });

    const latest = await latestRuns(db, 2);
    expect(latest.map((run) => run.id)).toEqual([third.id, second.id]);
    expect(await latestRuns(db, 0)).toEqual([]);
  });
});
