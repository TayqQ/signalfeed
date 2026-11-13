import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  grantParticipants,
  grantProjects,
  grantProjectTexts,
  sources,
} from "@/db/schema";
import { GTR_API_BASE } from "./gtr-client";
import {
  projectFundDates,
  type GtrParticipant,
  type GtrProject,
} from "./gtr-schemas";
import { isOrganisation } from "./organisation-rule";

export const GTR_SOURCE_SLUG = "ukri-gtr";
export const ABSTRACT_MAX_CHARS = 1_500;

export interface StoreProjectsResult {
  projectsInserted: number;
  projectsUpdated: number;
  participantsInserted: number;
  participantsUpdated: number;
  /** Participants that failed the organisation rule. Nothing about them is stored. */
  participantsSkipped: number;
}

/** The `ukri-gtr` source row, created on first use. */
export async function ensureGtrSource(db: Db): Promise<number> {
  await db
    .insert(sources)
    .values({
      slug: GTR_SOURCE_SLUG,
      name: "UKRI Gateway to Research",
      kind: "ukri_gtr",
      url: GTR_API_BASE,
    })
    .onConflictDoNothing({ target: sources.slug });
  const [row] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.slug, GTR_SOURCE_SLUG));
  if (!row) throw new Error("Could not create the ukri-gtr source");
  return row.id;
}

/** Whole characters, so a surrogate pair is never cut in half. */
function cutAbstract(text: string | null | undefined): string {
  return Array.from((text ?? "").trim())
    .slice(0, ABSTRACT_MAX_CHARS)
    .join("");
}

/** Pounds to pence, rounded. Missing, negative or non-finite values become null. */
function toMinor(pounds: number | null | undefined): number | null {
  if (pounds === null || pounds === undefined) return null;
  const minor = Math.round(pounds * 100);
  return Number.isFinite(minor) && minor >= 0 ? minor : null;
}

function participantRole(role: string): "lead" | "participant" {
  return role === "LEAD_PARTICIPANT" ? "lead" : "participant";
}

function projectValues(sourceId: number, project: GtrProject) {
  const { startOn, endOn } = projectFundDates(project);
  return {
    sourceId,
    title: project.title,
    grantCategory: project.grantCategory,
    leadFunder: project.leadFunder,
    status: project.status,
    startOn,
    endOn,
    gtrUrl: `https://gtr.ukri.org/project/${encodeURIComponent(project.id)}`,
  };
}

function participantValues(participant: GtrParticipant) {
  return {
    organisationName: participant.organisationName,
    role: participantRole(participant.role),
    grantOfferMinor: toMinor(participant.grantOffer),
    projectCostMinor: toMinor(participant.projectCost),
  };
}

/** True when any wanted value differs from the stored row. */
function hasChanged<T extends object>(wanted: T, row: T): boolean {
  return (Object.keys(wanted) as (keyof T)[]).some(
    (key) => wanted[key] !== row[key],
  );
}

/**
 * Upsert projects, abstracts and organisation participants from one page.
 * Rows are updated when GtR values change and never deleted.
 */
export async function storeProjects(
  db: Db,
  sourceId: number,
  projects: readonly GtrProject[],
): Promise<StoreProjectsResult> {
  const result: StoreProjectsResult = {
    projectsInserted: 0,
    projectsUpdated: 0,
    participantsInserted: 0,
    participantsUpdated: 0,
    participantsSkipped: 0,
  };
  if (projects.length === 0) return result;

  const existing = await db
    .select()
    .from(grantProjects)
    .where(
      inArray(
        grantProjects.gtrProjectId,
        projects.map((project) => project.id),
      ),
    );
  const existingByGtrId = new Map(
    existing.map((row) => [row.gtrProjectId, row]),
  );

  for (const project of projects) {
    const values = projectValues(sourceId, project);
    const row = existingByGtrId.get(project.id);
    let projectId: number;

    if (!row) {
      const [inserted] = await db
        .insert(grantProjects)
        .values({ gtrProjectId: project.id, ...values })
        .returning({ id: grantProjects.id });
      if (!inserted) throw new Error("Grant project insert returned no row");
      projectId = inserted.id;
      result.projectsInserted += 1;
    } else {
      projectId = row.id;
      if (hasChanged(values, row)) {
        await db
          .update(grantProjects)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(grantProjects.id, projectId));
        result.projectsUpdated += 1;
      }
    }

    const abstract = cutAbstract(project.abstractText);
    await db
      .insert(grantProjectTexts)
      .values({ projectId, abstract })
      .onConflictDoUpdate({
        target: grantProjectTexts.projectId,
        set: { abstract },
      });

    await storeParticipants(db, projectId, project, result);
  }
  return result;
}

async function storeParticipants(
  db: Db,
  projectId: number,
  project: GtrProject,
  result: StoreProjectsResult,
): Promise<void> {
  const existing = await db
    .select()
    .from(grantParticipants)
    .where(eq(grantParticipants.projectId, projectId));
  const existingByOrg = new Map(existing.map((row) => [row.gtrOrgId, row]));
  const seen = new Set<string>();

  for (const participant of project.participantValues?.participant ?? []) {
    // The registration number is only known after the organisation fetch, so
    // at this stage the rule rests on the company form in the name.
    if (!isOrganisation(participant.organisationName, null)) {
      result.participantsSkipped += 1;
      continue;
    }
    if (seen.has(participant.organisationId)) continue;
    seen.add(participant.organisationId);

    const values = participantValues(participant);
    const row = existingByOrg.get(participant.organisationId);
    if (!row) {
      await db.insert(grantParticipants).values({
        projectId,
        gtrOrgId: participant.organisationId,
        ...values,
      });
      result.participantsInserted += 1;
    } else if (hasChanged(values, row)) {
      await db
        .update(grantParticipants)
        .set(values)
        .where(eq(grantParticipants.id, row.id));
      result.participantsUpdated += 1;
    }
  }
}
