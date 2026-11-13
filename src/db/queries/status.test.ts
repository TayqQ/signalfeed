import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IngestStats } from "@/core/domain";
import { LLM_PURPOSES } from "@/core/enums";
import type { Db } from "../client";
import {
  derivedRebuilds,
  grantParticipants,
  grantProjects,
  ingestRuns,
  llmUsage,
  sources,
  tags,
  themes,
} from "../schema";
import { createTestDb, type TestDb } from "../testing";
import { getStatusSummary } from "./status";

// Wednesday 11 November 2026.
const NOW = new Date("2026-11-11T12:00:00.000Z");

const VECTOR = Array.from({ length: 512 }, () => 0.01);

function usage(
  purpose: (typeof LLM_PURPOSES)[number],
  occurredAt: string,
  costUsdMicros: number,
) {
  return {
    purpose,
    occurredAt: new Date(occurredAt),
    model: "test-model",
    inputTokens: 10,
    outputTokens: 5,
    costUsdMicros,
  };
}

describe("getStatusSummary Phase 2 block", () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;

    await db.insert(llmUsage).values([
      usage("extraction", "2026-11-02T10:00:00Z", 1_000_000),
      usage("extraction", "2026-11-05T10:00:00Z", 500_000),
      usage("embedding", "2026-11-03T10:00:00Z", 20_000),
      usage("theme_naming", "2026-11-04T10:00:00Z", 70_000),
      usage("tagging", "2026-11-06T10:00:00Z", 300_000),
      // Last month: must not count.
      usage("eval", "2026-10-30T10:00:00Z", 9_000_000),
    ]);

    const [tagA, tagB, tagC] = await db
      .insert(tags)
      .values([
        { slug: "a", label: "A", embedding: VECTOR, embeddingModel: "m" },
        { slug: "b", label: "B", embedding: VECTOR, embeddingModel: "m" },
        { slug: "c", label: "C" },
      ])
      .returning();
    if (!tagA || !tagB || !tagC) throw new Error("tags not seeded");

    const themeBase = { centroid: VECTOR, embeddingModel: "m" };
    await db.insert(themes).values([
      // Named by the model, reviewed.
      {
        slug: "one",
        name: "One",
        nameSource: "llm",
        namedAt: NOW,
        reviewedAt: NOW,
        seedTagId: tagA.id,
        ...themeBase,
      },
      // Named by the model, not reviewed.
      {
        slug: "two",
        name: "Two",
        nameSource: "llm",
        namedAt: NOW,
        seedTagId: tagB.id,
        ...themeBase,
      },
      // Still has its tag label, not reviewed.
      { slug: "three", name: "Three", seedTagId: tagC.id, ...themeBase },
      // Merged: never counted.
      {
        slug: "four",
        name: "Four",
        status: "active",
        seedTagId: tagA.id,
        ...themeBase,
      },
    ]);
    // Make "four" merged into "one" without tripping the checks.
    await db.execute(
      `update themes set status = 'merged', merged_into_id = (select id from themes where slug = 'one') where slug = 'four'`,
    );

    const [source] = await db
      .insert(sources)
      .values({
        slug: "ukri-gtr",
        name: "UKRI Gateway to Research",
        kind: "ukri_gtr",
        url: "https://gtr.ukri.org/",
      })
      .returning();
    if (!source) throw new Error("source not seeded");
    const [p1, p2] = await db
      .insert(grantProjects)
      .values(
        [1, 2].map((n) => ({
          sourceId: source.id,
          gtrProjectId: `gtr-${n}`,
          title: `Project ${n}`,
          grantCategory: "Collaborative R&D",
          leadFunder: "Innovate UK",
          status: "Active",
          gtrUrl: `https://gtr.ukri.org/projects?ref=${n}`,
        })),
      )
      .returning();
    if (!p1 || !p2) throw new Error("projects not seeded");

    const participant = (
      projectId: number,
      org: string,
      extra: Partial<typeof grantParticipants.$inferInsert> = {},
    ) => ({
      projectId,
      gtrOrgId: org,
      organisationName: `${org} Ltd`,
      role: "lead" as const,
      ...extra,
    });
    await db.insert(grantParticipants).values([
      participant(p1.id, "kept1", { resolvedAt: NOW }),
      participant(p1.id, "kept2", { resolvedAt: NOW }),
      participant(p2.id, "kept3", { resolvedAt: NOW }),
      participant(p2.id, "skip1", {
        resolvedAt: NOW,
        skippedReason: "no_grant_offer",
      }),
      participant(p2.id, "open1"),
      participant(p2.id, "open2"),
    ]);

    await db.insert(derivedRebuilds).values([
      {
        name: "stats",
        inputFingerprint: "x",
        rebuiltAt: new Date("2026-11-10T03:00:00Z"),
      },
      {
        name: "locations",
        inputFingerprint: "y",
        rebuiltAt: new Date("2026-11-09T03:00:00Z"),
      },
    ]);

    const stats = {
      spendUsdMicros: 0,
      monthToDateUsdMicros: 0,
      capGbp: 10,
      budgetPaused: false,
      grantCollect: {
        pagesFetched: 3,
        projectsFound: 300,
        projectsInserted: 2,
        participantsInserted: 6,
        participantsSkipped: 4,
        orgsFetched: 6,
        orgsFailed: 0,
      },
    } as unknown as IngestStats;
    await db.insert(ingestRuns).values([
      {
        trigger: "schedule",
        status: "succeeded",
        startedAt: new Date("2026-11-08T05:00:00Z"),
        stats,
      },
      // A newer run with no grants step must not be picked.
      {
        trigger: "manual",
        status: "succeeded",
        startedAt: new Date("2026-11-10T05:00:00Z"),
        stats: { ...stats, grantCollect: undefined } as IngestStats,
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await testDb.close();
  });

  it("splits this month's spend by purpose and it sums to the total", async () => {
    const summary = await getStatusSummary(db, NOW);
    const byPurpose = summary.phase2.spendByPurposeUsdMicros;
    expect(Object.keys(byPurpose).sort()).toEqual([...LLM_PURPOSES].sort());
    expect(byPurpose).toEqual({
      extraction: 1_500_000,
      embedding: 20_000,
      theme_naming: 70_000,
      tagging: 300_000,
      eval: 0,
    });
    const sum = Object.values(byPurpose).reduce((a, b) => a + b, 0);
    expect(sum).toBe(summary.monthToDateUsdMicros);
    expect(sum).toBe(1_890_000);
  });

  it("counts embedded and pending tags", async () => {
    const { phase2 } = await getStatusSummary(db, NOW);
    expect(phase2.tags).toEqual({ embedded: 2, pending: 1 });
  });

  it("counts active, unnamed and unreviewed themes, ignoring merged ones", async () => {
    const { phase2 } = await getStatusSummary(db, NOW);
    expect(phase2.themes).toEqual({ active: 3, unnamed: 1, unreviewed: 2 });
  });

  it("counts grant projects and participants", async () => {
    const { phase2 } = await getStatusSummary(db, NOW);
    expect(phase2.grants).toEqual({
      projects: 2,
      participantsKept: 3,
      participantsSkipped: 1,
      participantsUnresolved: 2,
    });
  });

  it("reports rebuild times and the latest grants run", async () => {
    const { phase2 } = await getStatusSummary(db, NOW);
    expect(phase2.statsRebuiltAt).toBe("2026-11-10T03:00:00.000Z");
    expect(phase2.locationsRebuiltAt).toBe("2026-11-09T03:00:00.000Z");
    expect(phase2.latestGrantsRun?.startedAt).toBe("2026-11-08T05:00:00.000Z");
    expect(phase2.latestGrantsRun?.collect?.projectsInserted).toBe(2);
  });
});

describe("getStatusSummary on an empty database", () => {
  it("returns zeros and nulls", async () => {
    const testDb = await createTestDb();
    try {
      const { phase2 } = await getStatusSummary(testDb.db, NOW);
      expect(phase2.tags).toEqual({ embedded: 0, pending: 0 });
      expect(phase2.themes).toEqual({ active: 0, unnamed: 0, unreviewed: 0 });
      expect(phase2.statsRebuiltAt).toBeNull();
      expect(phase2.locationsRebuiltAt).toBeNull();
      expect(phase2.latestGrantsRun).toBeNull();
      expect(Object.values(phase2.spendByPurposeUsdMicros)).toEqual([
        0, 0, 0, 0, 0,
      ]);
    } finally {
      await testDb.close();
    }
  }, 60_000);
});
