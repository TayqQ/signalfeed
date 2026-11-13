import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IngestStats } from "@/core/domain";
import {
  LLM_PURPOSES,
  RECORD_KINDS,
  REGISTRY_KINDS,
  REGISTRY_LINK_METHODS,
  REGISTRY_LINK_STATUSES,
} from "@/core/enums";
import type { Db } from "../client";
import {
  chCompanies,
  companies,
  derivedRebuilds,
  edgarIndexDays,
  eventConfirmations,
  eventRecordSources,
  events,
  formDFilings,
  grantParticipants,
  grantProjects,
  ingestRuns,
  llmUsage,
  registryLinks,
  registrySearches,
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
      document_reading: 0,
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
      const { phase2, registry, formD, confirmations } = await getStatusSummary(
        testDb.db,
        NOW,
      );
      for (const kind of REGISTRY_KINDS) {
        expect(Object.values(registry.links[kind].byStatus)).toEqual(
          REGISTRY_LINK_STATUSES.map(() => 0),
        );
        expect(Object.values(registry.links[kind].linkedByMethod)).toEqual(
          REGISTRY_LINK_METHODS.map(() => 0),
        );
      }
      expect(registry.searchedNoMatch).toBe(0);
      expect(registry.profilesOlderThan90Days).toBe(0);
      expect(registry.lastRun).toBeNull();
      expect(formD).toEqual({
        lastDoneDay: null,
        filingsStored: 0,
        fundsSkipped: 0,
        filingsLinked: 0,
      });
      expect(Object.values(confirmations.byRecordKind)).toEqual(
        RECORD_KINDS.map(() => 0),
      );
      expect(confirmations.newsEventsConfirmed).toBe(0);
      expect(phase2.tags).toEqual({ embedded: 0, pending: 0 });
      expect(phase2.themes).toEqual({ active: 0, unnamed: 0, unreviewed: 0 });
      expect(phase2.statsRebuiltAt).toBeNull();
      expect(phase2.locationsRebuiltAt).toBeNull();
      expect(phase2.latestGrantsRun).toBeNull();
      expect(Object.values(phase2.spendByPurposeUsdMicros)).toEqual(
        LLM_PURPOSES.map(() => 0),
      );
    } finally {
      await testDb.close();
    }
  }, 60_000);
});

describe("getStatusSummary Phase 3 blocks", () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;

    const rows = await db
      .insert(companies)
      .values(
        ["a", "b", "c", "d", "e"].map((slug) => ({
          slug,
          name: slug.toUpperCase(),
          normalisedName: slug,
        })),
      )
      .returning();
    const [a, b, c, d, e] = rows;
    if (!a || !b || !c || !d || !e) throw new Error("companies not seeded");

    const link = (
      company: typeof a,
      registry: "companies_house" | "sec_edgar",
      registryId: string,
      status: "linked" | "candidate" | "rejected",
      method: (typeof REGISTRY_LINK_METHODS)[number] | null,
    ) => ({
      companyId: company.id,
      registry,
      registryId,
      registryName: company.name,
      status,
      method,
      reason: "test",
      decidedBy: "auto" as const,
    });
    await db
      .insert(registryLinks)
      .values([
        link(a, "companies_house", "00000001", "linked", "name_location"),
        link(b, "companies_house", "00000002", "linked", "name_filing"),
        link(c, "companies_house", "00000003", "candidate", null),
        link(d, "companies_house", "00000004", "rejected", null),
        link(e, "sec_edgar", "1234", "linked", "form_d_round"),
      ]);

    const profile = {
      status: "active",
      companyType: "ltd",
      incorporatedOn: "2020-01-01",
    };
    await db.insert(chCompanies).values([
      // Linked and fetched 100 days before NOW: stale.
      {
        companyNumber: "00000001",
        name: "A",
        ...profile,
        fetchedAt: new Date("2026-08-03T12:00:00Z"),
      },
      // Linked and fresh.
      {
        companyNumber: "00000002",
        name: "B",
        ...profile,
        fetchedAt: new Date("2026-11-01T12:00:00Z"),
      },
      // Old but not linked: not counted.
      {
        companyNumber: "00000009",
        name: "Z",
        ...profile,
        fetchedAt: new Date("2025-01-01T12:00:00Z"),
      },
    ]);

    const searched = (company: typeof a, outcome: "linked" | "none") => ({
      companyId: company.id,
      registry: "companies_house" as const,
      searchedAt: NOW,
      outcome,
      inputFingerprint: "f",
    });
    await db
      .insert(registrySearches)
      .values([
        searched(a, "linked"),
        searched(c, "none"),
        searched(d, "none"),
        { ...searched(e, "none"), registry: "sec_edgar" as const },
      ]);

    const baseStats = {
      spendUsdMicros: 0,
      monthToDateUsdMicros: 0,
      capGbp: 10,
      budgetPaused: false,
    };
    const registryStats = (requests: number, rateLimited: boolean) =>
      ({
        ...baseStats,
        registry: {
          companiesSearched: 3,
          linkedByMethod: {},
          candidates: 1,
          none: 2,
          companiesSkipped: 0,
          profilesFetched: 2,
          profilesRefreshed: 2,
          filingsStored: 0,
          addressChecks: 0,
          requests,
          rateLimited,
          stoppedAtLimit: !rateLimited,
        },
      }) as unknown as IngestStats;
    await db.insert(ingestRuns).values([
      {
        trigger: "schedule",
        status: "succeeded",
        startedAt: new Date("2026-11-08T05:00:00Z"),
        stats: registryStats(10, true),
      },
      {
        trigger: "schedule",
        status: "succeeded",
        startedAt: new Date("2026-11-09T05:00:00Z"),
        stats: registryStats(500, false),
      },
      // Newest run, but with no registry step: must not be picked.
      {
        trigger: "manual",
        status: "succeeded",
        startedAt: new Date("2026-11-10T05:00:00Z"),
        stats: baseStats as unknown as IngestStats,
      },
    ]);

    const [source] = await db
      .insert(sources)
      .values({
        slug: "sec-edgar",
        name: "SEC EDGAR",
        kind: "sec_edgar",
        url: "https://www.sec.gov/",
      })
      .returning();
    if (!source) throw new Error("source not seeded");
    const day = (
      isoDay: string,
      status: "done" | "missing",
      fundSkipped: number,
    ) => ({
      day: isoDay,
      status,
      formDFound: 0,
      formDStored: 0,
      fundSkipped,
    });
    await db
      .insert(edgarIndexDays)
      .values([
        day("2026-11-04", "done", 2),
        day("2026-11-05", "done", 1),
        day("2026-11-06", "missing", 0),
      ]);
    const filing = (n: number, companyId: number | null) => ({
      sourceId: source.id,
      accessionNumber: `0000000000-26-00000${n}`,
      cik: "1234",
      issuerName: "E Inc",
      isAmendment: false,
      filedOn: "2026-11-05",
      companyId,
    });
    await db
      .insert(formDFilings)
      .values([filing(1, e.id), filing(2, null), filing(3, null)]);

    const eventRows = await db
      .insert(events)
      .values([
        {
          type: "funding_round",
          companyId: a.id,
          announcedOn: "2026-10-01",
          evidence: "confirmed",
        },
        {
          type: "funding_round",
          companyId: b.id,
          announcedOn: "2026-10-02",
          evidence: "confirmed",
        },
        {
          type: "funding_round",
          companyId: e.id,
          announcedOn: "2026-10-03",
          evidence: "confirmed",
        },
        // A grant event: confirmed by its record source, so not a news event.
        {
          type: "funding_round",
          companyId: c.id,
          announcedOn: "2026-10-04",
          evidence: "confirmed",
        },
        {
          type: "funding_round",
          companyId: d.id,
          announcedOn: "2026-10-05",
          evidence: "reported",
        },
      ])
      .returning();
    const [e1, e2, e3, grant] = eventRows;
    if (!e1 || !e2 || !e3 || !grant) throw new Error("events not seeded");
    await db
      .insert(eventRecordSources)
      .values({ eventId: grant.id, recordKind: "ukri_grant", recordId: 1 });
    const confirmation = (
      eventId: number,
      recordKind: "ch_allotment" | "sec_form_d",
      recordId: number,
    ) => ({
      eventId,
      recordKind,
      recordId,
      rule: "test",
      recordDate: "2026-10-01",
    });
    await db
      .insert(eventConfirmations)
      .values([
        confirmation(e1.id, "ch_allotment", 1),
        confirmation(e2.id, "ch_allotment", 2),
        confirmation(e3.id, "sec_form_d", 1),
      ]);
  }, 60_000);

  afterAll(async () => {
    await testDb.close();
  });

  it("counts registry links by status and method for each registry", async () => {
    const { registry } = await getStatusSummary(db, NOW);
    const ch = registry.links.companies_house;
    expect(ch.byStatus).toEqual({ linked: 2, candidate: 1, rejected: 1 });
    expect(ch.linkedByMethod.name_location).toBe(1);
    expect(ch.linkedByMethod.name_filing).toBe(1);
    expect(ch.linkedByMethod.form_d_round).toBe(0);
    const sec = registry.links.sec_edgar;
    expect(sec.byStatus).toEqual({ linked: 1, candidate: 0, rejected: 0 });
    expect(sec.linkedByMethod.form_d_round).toBe(1);
  });

  it("counts Companies House searches with no match and stale profiles", async () => {
    const { registry } = await getStatusSummary(db, NOW);
    expect(registry.searchedNoMatch).toBe(2);
    expect(registry.profilesOlderThan90Days).toBe(1);
  });

  it("reads the latest run that had a registry step", async () => {
    const { registry } = await getStatusSummary(db, NOW);
    expect(registry.lastRun).toEqual({
      requests: 500,
      profilesRefreshed: 2,
      stoppedAtLimit: true,
      rateLimited: false,
      skipped: false,
    });
  });

  it("reports Form D state", async () => {
    const { formD } = await getStatusSummary(db, NOW);
    expect(formD).toEqual({
      lastDoneDay: "2026-11-05",
      filingsStored: 3,
      fundsSkipped: 3,
      filingsLinked: 1,
    });
  });

  it("counts confirmations by kind and confirmed news events", async () => {
    const { confirmations } = await getStatusSummary(db, NOW);
    expect(confirmations.byRecordKind).toEqual({
      ukri_grant: 0,
      ch_allotment: 2,
      sec_form_d: 1,
    });
    expect(confirmations.newsEventsConfirmed).toBe(3);
  });
});
