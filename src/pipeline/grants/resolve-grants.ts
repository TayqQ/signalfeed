import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import type { GrantResolveStats } from "@/core/domain";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  companyTags,
  eventInvestors,
  eventRecordSources,
  events,
  fundingRounds,
  grantParticipants,
  grantProjects,
  grantTaggings,
  mergeCandidates,
  tags,
} from "@/db/schema";
import { normaliseCompanyName, normaliseTag } from "@/lib/normalise";
import { convert, storedFx, type FxLookup } from "../resolve/canonicalise";
import { resolveCompany } from "../resolve/company-matcher";
import { resolveInvestor } from "../resolve/investor-matcher";

export const GRANT_FUNDER = {
  name: "Innovate UK",
  kind: "government",
} as const;
export const SKIPPED_NO_GRANT_OFFER = "no grant offer";
export const SKIPPED_NO_START_DATE = "no start date";

const MAX_MERGE_DEPTH = 32;

export interface ResolveGrantsArgs {
  db: Db;
  /** Defaults to the stored ECB rates. */
  fx?: FxLookup;
  now?: () => Date;
}

export type ResolveGrantsResult = Pick<
  GrantResolveStats,
  | "participantsResolved"
  | "participantsSkipped"
  | "companiesCreated"
  | "companiesMatchedByNumber"
  | "eventsCreated"
  | "mergeCandidatesCreated"
> & {
  /** Company tag links added from grant taggings. */
  tagsApplied: number;
};

interface PendingParticipant {
  id: number;
  projectId: number;
  organisationName: string;
  regNumber: string | null;
  grantOfferMinor: number | null;
  startOn: string | null;
  grantCategory: string;
}

/** Companies House numbers are compared without spaces and in upper case. */
export function normaliseRegNumber(value: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, "").toUpperCase();
  return cleaned ? cleaned : null;
}

async function survivorId(db: Db, companyId: number): Promise<number> {
  let id = companyId;
  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
    const [row] = await db
      .select({ mergedIntoId: companies.mergedIntoId })
      .from(companies)
      .where(eq(companies.id, id));
    if (!row) throw new Error(`Company ${id} does not exist`);
    if (row.mergedIntoId === null) return id;
    id = row.mergedIntoId;
  }
  throw new Error(
    `Merge chain from company ${companyId} is cyclic or too deep`,
  );
}

async function companyByNumber(
  db: Db,
  regNumber: string,
): Promise<number | null> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.ukCompanyNumber, regNumber))
    .limit(1);
  return row ? survivorId(db, row.id) : null;
}

async function countMergeCandidates(db: Db): Promise<number> {
  const [row] = await db.select({ total: count() }).from(mergeCandidates);
  return row?.total ?? 0;
}

async function addGrantAlias(
  db: Db,
  companyId: number,
  name: string,
): Promise<void> {
  const alias = name.trim();
  const normalisedAlias = normaliseCompanyName(alias);
  if (!alias || !normalisedAlias) return;
  await db
    .insert(companyAliases)
    .values({ companyId, alias, normalisedAlias, source: "grant" })
    .onConflictDoNothing({
      target: [companyAliases.companyId, companyAliases.normalisedAlias],
    });
}

/** Company ids that already have this name as an alias. */
async function aliasHolders(
  db: Db,
  normalisedAlias: string,
): Promise<Set<number>> {
  if (!normalisedAlias) return new Set();
  const rows = await db
    .select({ companyId: companyAliases.companyId })
    .from(companyAliases)
    .where(eq(companyAliases.normalisedAlias, normalisedAlias));
  return new Set(rows.map((row) => row.companyId));
}

interface FoundCompany {
  companyId: number;
  created: boolean;
  byNumber: boolean;
}

/**
 * The company number first, then the Phase 1 name rules with no domain and no
 * corroboration, so a similar name becomes a merge candidate, never a merge.
 */
async function findCompany(
  db: Db,
  participant: PendingParticipant,
  regNumber: string | null,
  now: Date,
): Promise<FoundCompany> {
  if (regNumber) {
    const companyId = await companyByNumber(db, regNumber);
    if (companyId !== null) {
      await addGrantAlias(db, companyId, participant.organisationName);
      await db
        .update(companies)
        .set({
          countryCode: sql`coalesce(${companies.countryCode}, 'GB')`,
          updatedAt: now,
        })
        .where(eq(companies.id, companyId));
      return { companyId, created: false, byNumber: true };
    }
  }

  const normalisedName = normaliseCompanyName(participant.organisationName);
  const holders = await aliasHolders(db, normalisedName);
  // Grant tags are added separately with source `grant`, so none are passed here.
  const resolution = await resolveCompany(
    db,
    {
      name: participant.organisationName,
      websiteDomain: null,
      description: null,
      countryCode: "GB",
      city: null,
      foundedYear: null,
      tags: [],
    },
    { corroborates: () => Promise.resolve(false), clock: { now: () => now } },
  );
  // The matcher records new aliases as `extraction`; this one came from a grant.
  if (normalisedName && !holders.has(resolution.companyId)) {
    await db
      .update(companyAliases)
      .set({ source: "grant" })
      .where(
        and(
          eq(companyAliases.companyId, resolution.companyId),
          eq(companyAliases.normalisedAlias, normalisedName),
        ),
      );
  }
  return {
    companyId: resolution.companyId,
    created: resolution.created,
    byNumber: false,
  };
}

/** Fills an empty company number when no other company holds it. */
async function fillCompanyNumber(
  db: Db,
  companyId: number,
  regNumber: string,
): Promise<void> {
  const holder = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.ukCompanyNumber, regNumber))
    .limit(1);
  if (holder.length > 0) return;
  await db
    .update(companies)
    .set({ ukCompanyNumber: regNumber })
    .where(and(eq(companies.id, companyId), isNull(companies.ukCompanyNumber)));
}

async function createGrantEvent(
  db: Db,
  participant: PendingParticipant & { startOn: string },
  companyId: number,
  grantOfferMinor: number,
  fx: FxLookup,
  now: Date,
): Promise<number> {
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId,
      announcedOn: participant.startOn,
      datePrecision: "month",
      evidence: "confirmed",
      sourceCount: 0,
      firstSeenAt: now,
      updatedAt: now,
    })
    .returning({ id: events.id });
  if (!event) throw new Error("Grant event insert returned no row");

  const money = { amountMinor: grantOfferMinor, currency: "GBP" };
  const converted = await convert(db, money, participant.startOn, fx);
  await db.insert(fundingRounds).values({
    eventId: event.id,
    roundType: "grant",
    roundLabel: participant.grantCategory,
    amountMinor: grantOfferMinor,
    currency: "GBP",
    amountUsdMinor: converted.usd,
    amountGbpMinor: grantOfferMinor,
    fxRateDate: converted.rateDate,
  });

  const { investorId } = await resolveInvestor(db, {
    ...GRANT_FUNDER,
    websiteDomain: null,
  });
  await db
    .insert(eventInvestors)
    .values({ eventId: event.id, investorId, role: "lead" });
  await db.insert(eventRecordSources).values({
    eventId: event.id,
    recordKind: "ukri_grant",
    recordId: participant.id,
  });
  return event.id;
}

/**
 * Links tags to a company with source `grant`. An existing link is left alone,
 * so repeated runs never inflate `mention_count`. Returns the links added.
 */
async function addGrantTags(
  db: Db,
  companyId: number,
  slugs: readonly string[],
  now: Date,
): Promise<number> {
  const unique = [
    ...new Set(slugs.map(normaliseTag).filter((slug) => slug.length > 0)),
  ];
  if (unique.length === 0) return 0;
  await db
    .insert(tags)
    .values(unique.map((slug) => ({ slug, label: slug, firstSeenAt: now })))
    .onConflictDoNothing({ target: tags.slug });
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(inArray(tags.slug, unique));
  const added = await db
    .insert(companyTags)
    .values(
      rows.map((row) => ({
        companyId,
        tagId: row.id,
        source: "grant",
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    )
    .onConflictDoNothing({ target: [companyTags.companyId, companyTags.tagId] })
    .returning({ tagId: companyTags.tagId });
  return added.length;
}

async function projectTags(db: Db, projectId: number): Promise<string[]> {
  const rows = await db
    .select({ tags: grantTaggings.tags })
    .from(grantTaggings)
    .where(eq(grantTaggings.projectId, projectId))
    .orderBy(asc(grantTaggings.id));
  return rows.flatMap((row) => row.tags);
}

async function resolveParticipant(
  db: Db,
  participantId: number,
  fx: FxLookup,
  now: Date,
  result: ResolveGrantsResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [participant] = await tx
      .select({
        id: grantParticipants.id,
        projectId: grantParticipants.projectId,
        organisationName: grantParticipants.organisationName,
        regNumber: grantParticipants.regNumber,
        grantOfferMinor: grantParticipants.grantOfferMinor,
        resolvedAt: grantParticipants.resolvedAt,
        startOn: grantProjects.startOn,
        grantCategory: grantProjects.grantCategory,
      })
      .from(grantParticipants)
      .innerJoin(
        grantProjects,
        eq(grantProjects.id, grantParticipants.projectId),
      )
      .where(eq(grantParticipants.id, participantId));
    if (!participant || participant.resolvedAt !== null) return;

    const { grantOfferMinor, startOn } = participant;
    // A participant with no money offered (often a partner paying its own way)
    // received no grant, so it gets no event.
    if (grantOfferMinor === null || grantOfferMinor <= 0 || startOn === null) {
      await tx
        .update(grantParticipants)
        .set({
          skippedReason:
            grantOfferMinor === null || grantOfferMinor <= 0
              ? SKIPPED_NO_GRANT_OFFER
              : SKIPPED_NO_START_DATE,
          resolvedAt: now,
        })
        .where(eq(grantParticipants.id, participant.id));
      result.participantsSkipped += 1;
      return;
    }

    const regNumber = normaliseRegNumber(participant.regNumber);
    const found = await findCompany(tx, participant, regNumber, now);
    if (found.created) result.companiesCreated += 1;
    if (found.byNumber) result.companiesMatchedByNumber += 1;
    if (regNumber) await fillCompanyNumber(tx, found.companyId, regNumber);

    const eventId = await createGrantEvent(
      tx,
      { ...participant, startOn },
      found.companyId,
      grantOfferMinor,
      fx,
      now,
    );
    result.eventsCreated += 1;

    result.tagsApplied += await addGrantTags(
      tx,
      found.companyId,
      await projectTags(tx, participant.projectId),
      now,
    );

    await tx
      .update(grantParticipants)
      .set({ companyId: found.companyId, eventId, resolvedAt: now })
      .where(eq(grantParticipants.id, participant.id));
    result.participantsResolved += 1;
  });
}

/**
 * Tags from projects tagged after their participants were resolved. Only
 * missing links are returned, so a settled database does no work here.
 */
async function applyLateTags(db: Db, now: Date): Promise<number> {
  const target = sql<number>`coalesce(${companies.mergedIntoId}, ${companies.id})`;
  const slug = sql<string>`tag_slug`;
  const rows = await db
    .selectDistinct({
      companyId: target.mapWith(Number),
      slug,
    })
    .from(grantParticipants)
    .innerJoin(companies, eq(companies.id, grantParticipants.companyId))
    .innerJoin(
      grantTaggings,
      eq(grantTaggings.projectId, grantParticipants.projectId),
    )
    .crossJoin(sql`unnest(${grantTaggings.tags}) as tag_slug`)
    .where(
      and(
        isNotNull(grantParticipants.resolvedAt),
        notExists(
          db
            .select({ tagId: companyTags.tagId })
            .from(companyTags)
            .innerJoin(tags, eq(tags.id, companyTags.tagId))
            .where(and(eq(companyTags.companyId, target), eq(tags.slug, slug))),
        ),
      ),
    )
    .orderBy(target, slug);

  const byCompany = new Map<number, string[]>();
  for (const row of rows) {
    const companyId = await survivorId(db, row.companyId);
    const list = byCompany.get(companyId) ?? [];
    list.push(row.slug);
    byCompany.set(companyId, list);
  }
  let added = 0;
  for (const [companyId, slugs] of byCompany) {
    added += await addGrantTags(db, companyId, slugs, now);
  }
  return added;
}

/**
 * Part of pipeline step 8 (spec-phase2 section 10.4): turns each unresolved,
 * fetched grant participant into a company and a new `confirmed` grant event,
 * one transaction per participant. Then applies tags from projects tagged
 * since their participants were resolved. Running it twice changes nothing.
 */
export async function resolveGrantsStep({
  db,
  fx = storedFx,
  now = () => new Date(),
}: ResolveGrantsArgs): Promise<ResolveGrantsResult> {
  const result: ResolveGrantsResult = {
    participantsResolved: 0,
    participantsSkipped: 0,
    companiesCreated: 0,
    companiesMatchedByNumber: 0,
    eventsCreated: 0,
    mergeCandidatesCreated: 0,
    tagsApplied: 0,
  };
  const candidatesBefore = await countMergeCandidates(db);

  const pending = await db
    .select({ id: grantParticipants.id })
    .from(grantParticipants)
    .where(
      and(
        isNull(grantParticipants.resolvedAt),
        isNotNull(grantParticipants.orgFetchedAt),
      ),
    )
    .orderBy(asc(grantParticipants.id));
  for (const { id } of pending) {
    await resolveParticipant(db, id, fx, now(), result);
  }

  result.tagsApplied += await db.transaction((tx) => applyLateTags(tx, now()));
  result.mergeCandidatesCreated =
    (await countMergeCandidates(db)) - candidatesBefore;
  return result;
}
