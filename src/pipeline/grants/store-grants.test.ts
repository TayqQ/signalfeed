import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  grantParticipants,
  grantProjects,
  grantProjectTexts,
  sources,
} from "@/db/schema";
import { gtrProjectsPageSchema, type GtrProject } from "./gtr-schemas";
import {
  ABSTRACT_MAX_CHARS,
  ensureGtrSource,
  storeProjects,
} from "./store-grants";
import { loadGtrFixture } from "./testing";

let testDb: TestDb;
beforeEach(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  await testDb.close();
});

function fixtureProjects(): GtrProject[] {
  return gtrProjectsPageSchema.parse(loadGtrFixture("projects-page.json"))
    .project;
}

describe("ensureGtrSource", () => {
  it("creates the ukri-gtr source once", async () => {
    const first = await ensureGtrSource(testDb.db);
    const second = await ensureGtrSource(testDb.db);
    expect(second).toBe(first);
    const rows = await testDb.db.select().from(sources);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "ukri-gtr", kind: "ukri_gtr" });
  });
});

describe("storeProjects", () => {
  it("stores projects, abstracts and organisations only", async () => {
    const sourceId = await ensureGtrSource(testDb.db);
    const result = await storeProjects(testDb.db, sourceId, fixtureProjects());
    expect(result).toMatchObject({
      projectsInserted: 3,
      participantsInserted: 3,
      participantsSkipped: 2,
    });

    const projects = await testDb.db.select().from(grantProjects);
    expect(projects).toHaveLength(3);
    const first = projects.find(
      (row) => row.gtrProjectId === "11111111-1111-4111-8111-111111111111",
    );
    expect(first).toMatchObject({
      grantCategory: "Collaborative R&D",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: "2026-07-01",
      endOn: "2027-10-31",
    });
    expect(first?.gtrUrl).toContain(first?.gtrProjectId);

    const participants = await testDb.db.select().from(grantParticipants);
    expect(participants.map((p) => p.organisationName).sort()).toEqual([
      "ACME ROBOTICS LTD",
      "EXAMPLE GROUP LIMITED",
      "SAMPLE WIDGETS LIMITED",
    ]);
    const acme = participants.find((p) =>
      p.organisationName.startsWith("ACME"),
    );
    expect(acme).toMatchObject({
      role: "lead",
      grantOfferMinor: 18262994,
      projectCostMinor: 27258200,
    });
    expect(
      participants.find((p) => p.organisationName.startsWith("SAMPLE"))?.role,
    ).toBe("participant");
    expect(await testDb.db.select().from(grantProjectTexts)).toHaveLength(3);
  });

  it("cuts abstracts to 1,500 characters", async () => {
    const sourceId = await ensureGtrSource(testDb.db);
    const [project] = fixtureProjects();
    if (!project) throw new Error("fixture is empty");
    await storeProjects(testDb.db, sourceId, [
      { ...project, abstractText: "x".repeat(2_000) },
    ]);
    const [text] = await testDb.db.select().from(grantProjectTexts);
    expect(text?.abstract).toHaveLength(ABSTRACT_MAX_CHARS);
  });

  it("changes nothing on a second run, and updates changed values", async () => {
    const sourceId = await ensureGtrSource(testDb.db);
    const projects = fixtureProjects();
    await storeProjects(testDb.db, sourceId, projects);
    const again = await storeProjects(testDb.db, sourceId, projects);
    expect(again).toEqual({
      projectsInserted: 0,
      projectsUpdated: 0,
      participantsInserted: 0,
      participantsUpdated: 0,
      participantsSkipped: 2,
    });

    const [first] = projects;
    if (!first?.participantValues) throw new Error("fixture is empty");
    const changed: GtrProject = {
      ...first,
      status: "Closed",
      abstractText: "A new invented abstract.",
      participantValues: {
        participant: first.participantValues.participant.map((p) => ({
          ...p,
          grantOffer: 1.5,
        })),
      },
    };
    const updated = await storeProjects(testDb.db, sourceId, [changed]);
    expect(updated).toMatchObject({
      projectsUpdated: 1,
      participantsUpdated: 1,
      projectsInserted: 0,
    });
    const [row] = await testDb.db
      .select()
      .from(grantProjects)
      .where(eq(grantProjects.gtrProjectId, first.id));
    expect(row?.status).toBe("Closed");
    const [participant] = await testDb.db
      .select()
      .from(grantParticipants)
      .where(eq(grantParticipants.projectId, row?.id ?? -1));
    expect(participant?.grantOfferMinor).toBe(150);
    expect(await testDb.db.select().from(grantProjects)).toHaveLength(3);
  });

  it("rounds pounds to pence and keeps missing amounts as null", async () => {
    const sourceId = await ensureGtrSource(testDb.db);
    const [project] = fixtureProjects();
    if (!project) throw new Error("fixture is empty");
    await storeProjects(testDb.db, sourceId, [
      {
        ...project,
        participantValues: {
          participant: [
            {
              organisationId: "org-a",
              organisationName: "Invented A Ltd",
              role: "LEAD_PARTICIPANT",
              grantOffer: 12.34,
              projectCost: null,
            },
          ],
        },
      },
    ]);
    const [row] = await testDb.db.select().from(grantParticipants);
    expect(row).toMatchObject({
      grantOfferMinor: 1234,
      projectCostMinor: null,
    });
  });

  it("never stores a skipped participant's name", async () => {
    const sourceId = await ensureGtrSource(testDb.db);
    await storeProjects(testDb.db, sourceId, fixtureProjects());
    const names = (await testDb.db.select().from(grantParticipants)).map(
      (row) => row.organisationName,
    );
    expect(names).not.toContain("UNIVERSITY OF EXAMPLE");
    expect(names).not.toContain("Example Design Studio");
  });
});
