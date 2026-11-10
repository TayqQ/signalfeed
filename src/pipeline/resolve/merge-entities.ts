import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { MergeEntity } from "@/core/enums";
import type { Db } from "@/db/client";
import {
  acquisitions,
  companies,
  companyAliases,
  companyTags,
  entityMerges,
  eventInvestors,
  events,
  fundingRounds,
  investorAliases,
  investors,
  mergeCandidates,
} from "@/db/schema";
import { normaliseCompanyName, normaliseInvestorName } from "@/lib/normalise";
import {
  recomputeEventsForCompany,
  storedFx,
  type FxLookup,
} from "./canonicalise";

export interface MergeResult {
  keptId: number;
  mergedId: number;
  /** Pairs of the kept company's events that now look alike. Never merged automatically. */
  possibleDuplicateEvents: Array<[number, number]>;
}

export interface MergePreview {
  events: number;
  aliases: number;
  tags: number;
  investments: number;
}

export interface MergeOptions {
  note?: string;
  fx?: FxLookup;
}

async function assertMergeable<T extends { mergedIntoId: number | null }>(
  load: (id: number) => Promise<T | undefined>,
  label: string,
  keepId: number,
  mergeId: number,
): Promise<{ keep: T; merge: T }> {
  if (keepId === mergeId) {
    throw new Error(`Cannot merge ${label} ${keepId} into itself`);
  }
  const [keep, merge] = await Promise.all([load(keepId), load(mergeId)]);
  if (!keep) throw new Error(`${label} ${keepId} does not exist`);
  if (!merge) throw new Error(`${label} ${mergeId} does not exist`);
  if (keep.mergedIntoId !== null) {
    throw new Error(
      `${label} ${keepId} was already merged into ${keep.mergedIntoId}; merge into that instead`,
    );
  }
  if (merge.mergedIntoId !== null) {
    throw new Error(
      `${label} ${mergeId} was already merged into ${merge.mergedIntoId}`,
    );
  }
  return { keep, merge };
}

async function resolveCandidates(
  db: Db,
  entityType: MergeEntity,
  keepId: number,
  mergeId: number,
): Promise<void> {
  await db
    .update(mergeCandidates)
    .set({ status: "merged", resolvedAt: new Date() })
    .where(
      and(
        eq(mergeCandidates.entityType, entityType),
        eq(mergeCandidates.status, "open"),
        eq(mergeCandidates.leftId, Math.min(keepId, mergeId)),
        eq(mergeCandidates.rightId, Math.max(keepId, mergeId)),
      ),
    );
}

async function findDuplicateRounds(
  db: Db,
  companyId: number,
): Promise<Array<[number, number]>> {
  const rows = await db
    .select({
      id: events.id,
      announcedOn: events.announcedOn,
      roundType: fundingRounds.roundType,
    })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(eq(events.companyId, companyId))
    .orderBy(asc(events.id));

  const pairs: Array<[number, number]> = [];
  rows.forEach((left, index) => {
    for (const right of rows.slice(index + 1)) {
      const days =
        Math.abs(
          new Date(left.announcedOn).getTime() -
            new Date(right.announcedOn).getTime(),
        ) / 86_400_000;
      if (days <= 45 && left.roundType === right.roundType) {
        pairs.push([left.id, right.id]);
      }
    }
  });
  return pairs;
}

/** Everything `mergeCompanies` would move. Changes nothing. */
export async function previewCompanyMerge(
  db: Db,
  mergeId: number,
): Promise<MergePreview> {
  const [eventRows, aliasRows, tagRows] = await Promise.all([
    db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.companyId, mergeId)),
    db
      .select({ id: companyAliases.id })
      .from(companyAliases)
      .where(eq(companyAliases.companyId, mergeId)),
    db
      .select({ id: companyTags.tagId })
      .from(companyTags)
      .where(eq(companyTags.companyId, mergeId)),
  ]);
  return {
    events: eventRows.length,
    aliases: aliasRows.length,
    tags: tagRows.length,
    investments: 0,
  };
}

/** Everything `mergeInvestors` would move. Changes nothing. */
export async function previewInvestorMerge(
  db: Db,
  mergeId: number,
): Promise<MergePreview> {
  const [investmentRows, aliasRows] = await Promise.all([
    db
      .select({ id: eventInvestors.eventId })
      .from(eventInvestors)
      .where(eq(eventInvestors.investorId, mergeId)),
    db
      .select({ id: investorAliases.id })
      .from(investorAliases)
      .where(eq(investorAliases.investorId, mergeId)),
  ]);
  return {
    events: 0,
    aliases: aliasRows.length,
    tags: 0,
    investments: investmentRows.length,
  };
}

export async function mergeCompanies(
  db: Db,
  keepId: number,
  mergeId: number,
  options: MergeOptions = {},
): Promise<MergeResult> {
  return db.transaction(async (tx) => {
    const { keep, merge } = await assertMergeable(
      async (id) =>
        (await tx.select().from(companies).where(eq(companies.id, id)))[0],
      "Company",
      keepId,
      mergeId,
    );

    await tx
      .update(events)
      .set({ companyId: keepId })
      .where(eq(events.companyId, mergeId));
    await tx
      .update(acquisitions)
      .set({ acquirerCompanyId: keepId })
      .where(eq(acquisitions.acquirerCompanyId, mergeId));

    // Move aliases, dropping any the kept company already has.
    const aliases = await tx
      .select()
      .from(companyAliases)
      .where(eq(companyAliases.companyId, mergeId));
    await tx
      .delete(companyAliases)
      .where(eq(companyAliases.companyId, mergeId));
    const moved = [
      ...aliases.map((alias) => ({
        companyId: keepId,
        alias: alias.alias,
        normalisedAlias: alias.normalisedAlias,
        source: alias.source,
      })),
      {
        companyId: keepId,
        alias: merge.name,
        normalisedAlias: merge.normalisedName,
        source: "merge" as const,
      },
    ];
    await tx
      .insert(companyAliases)
      .values(moved)
      .onConflictDoNothing({
        target: [companyAliases.companyId, companyAliases.normalisedAlias],
      });

    // Merge tags: counts add up, and the seen dates widen.
    const tagRows = await tx
      .select()
      .from(companyTags)
      .where(eq(companyTags.companyId, mergeId));
    await tx.delete(companyTags).where(eq(companyTags.companyId, mergeId));
    for (const tag of tagRows) {
      await tx
        .insert(companyTags)
        .values({ ...tag, companyId: keepId })
        .onConflictDoUpdate({
          target: [companyTags.companyId, companyTags.tagId],
          set: {
            mentionCount: sql`${companyTags.mentionCount} + ${tag.mentionCount}`,
            firstSeenAt: sql`least(${companyTags.firstSeenAt}, ${tag.firstSeenAt.toISOString()}::timestamptz)`,
            lastSeenAt: sql`greatest(${companyTags.lastSeenAt}, ${tag.lastSeenAt.toISOString()}::timestamptz)`,
          },
        });
    }

    // A unique value must leave the merged row before the kept row can take it.
    const domain = keep.websiteDomain ?? merge.websiteDomain;
    const ukNumber = keep.ukCompanyNumber ?? merge.ukCompanyNumber;
    const cik = keep.secCik ?? merge.secCik;
    await tx
      .update(companies)
      .set({
        mergedIntoId: keepId,
        websiteDomain: null,
        ukCompanyNumber: null,
        secCik: null,
      })
      .where(eq(companies.id, mergeId));
    await tx
      .update(companies)
      .set({
        websiteDomain: domain,
        ukCompanyNumber: ukNumber,
        secCik: cik,
        description: keep.description ?? merge.description,
        countryCode: keep.countryCode ?? merge.countryCode,
        city: keep.city ?? merge.city,
        foundedYear: keep.foundedYear ?? merge.foundedYear,
        foundedYearSource: keep.foundedYearSource ?? merge.foundedYearSource,
        ycBatch: keep.ycBatch ?? merge.ycBatch,
        githubOrg: keep.githubOrg ?? merge.githubOrg,
        status: keep.status === "active" ? merge.status : keep.status,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, keepId));

    await resolveCandidates(tx, "company", keepId, mergeId);
    await tx.insert(entityMerges).values({
      entityType: "company",
      keptId: keepId,
      mergedId: mergeId,
      note: options.note,
    });
    await recomputeEventsForCompany(tx, keepId, options.fx ?? storedFx);

    return {
      keptId: keepId,
      mergedId: mergeId,
      possibleDuplicateEvents: await findDuplicateRounds(tx, keepId),
    };
  });
}

export async function mergeInvestors(
  db: Db,
  keepId: number,
  mergeId: number,
  options: MergeOptions = {},
): Promise<MergeResult> {
  return db.transaction(async (tx) => {
    const { keep, merge } = await assertMergeable(
      async (id) =>
        (await tx.select().from(investors).where(eq(investors.id, id)))[0],
      "Investor",
      keepId,
      mergeId,
    );

    const rows = await tx
      .select()
      .from(eventInvestors)
      .where(eq(eventInvestors.investorId, mergeId));
    await tx
      .delete(eventInvestors)
      .where(eq(eventInvestors.investorId, mergeId));
    for (const row of rows) {
      await tx
        .insert(eventInvestors)
        .values({ eventId: row.eventId, investorId: keepId, role: row.role })
        .onConflictDoUpdate({
          target: [eventInvestors.eventId, eventInvestors.investorId],
          set: {
            role: sql`case when ${eventInvestors.role} = 'lead' or ${row.role} = 'lead' then 'lead'::investor_role else ${eventInvestors.role} end`,
          },
        });
    }

    const aliases = await tx
      .select()
      .from(investorAliases)
      .where(eq(investorAliases.investorId, mergeId));
    await tx
      .delete(investorAliases)
      .where(eq(investorAliases.investorId, mergeId));
    await tx
      .insert(investorAliases)
      .values([
        ...aliases.map((alias) => ({
          investorId: keepId,
          alias: alias.alias,
          normalisedAlias: alias.normalisedAlias,
          source: alias.source,
        })),
        {
          investorId: keepId,
          alias: merge.name,
          normalisedAlias: merge.normalisedName,
          source: "merge" as const,
        },
      ])
      .onConflictDoNothing({
        target: [investorAliases.investorId, investorAliases.normalisedAlias],
      });

    await tx
      .update(investors)
      .set({
        kind: keep.kind === "unknown" ? merge.kind : keep.kind,
        countryCode: keep.countryCode ?? merge.countryCode,
        websiteDomain: keep.websiteDomain ?? merge.websiteDomain,
      })
      .where(eq(investors.id, keepId));
    await tx
      .update(investors)
      .set({ mergedIntoId: keepId })
      .where(eq(investors.id, mergeId));

    await resolveCandidates(tx, "investor", keepId, mergeId);
    await tx.insert(entityMerges).values({
      entityType: "investor",
      keptId: keepId,
      mergedId: mergeId,
      note: options.note,
    });
    return { keptId: keepId, mergedId: mergeId, possibleDuplicateEvents: [] };
  });
}

export async function dismissCandidate(db: Db, id: number): Promise<void> {
  const updated = await db
    .update(mergeCandidates)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(and(eq(mergeCandidates.id, id), eq(mergeCandidates.status, "open")))
    .returning({ id: mergeCandidates.id });
  if (updated.length === 0) throw new Error(`No open candidate ${id}`);
}

export async function addAlias(
  db: Db,
  entityType: MergeEntity,
  id: number,
  alias: string,
): Promise<void> {
  const trimmed = alias.trim();
  if (!trimmed) throw new Error("Alias is empty");
  if (entityType === "company") {
    await db
      .insert(companyAliases)
      .values({
        companyId: id,
        alias: trimmed,
        normalisedAlias: normaliseCompanyName(trimmed),
        source: "manual",
      })
      .onConflictDoNothing({
        target: [companyAliases.companyId, companyAliases.normalisedAlias],
      });
  } else {
    await db
      .insert(investorAliases)
      .values({
        investorId: id,
        alias: trimmed,
        normalisedAlias: normaliseInvestorName(trimmed),
        source: "manual",
      })
      .onConflictDoNothing({
        target: [investorAliases.investorId, investorAliases.normalisedAlias],
      });
  }
}

export interface CandidateSide {
  id: number;
  name: string;
  countryCode: string | null;
  websiteDomain: string | null;
  events: number;
}

export interface CandidateRow {
  id: number;
  entityType: MergeEntity;
  score: number;
  reason: string;
  left: CandidateSide | null;
  right: CandidateSide | null;
}

async function sidesFor(
  db: Db,
  entityType: MergeEntity,
  ids: number[],
): Promise<Map<number, CandidateSide>> {
  if (ids.length === 0) return new Map();
  if (entityType === "company") {
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        countryCode: companies.countryCode,
        websiteDomain: companies.websiteDomain,
        // Written out in full: Drizzle drops table names from columns in a
        // single-table select, which would make this subquery compare the wrong id.
        events: sql<number>`(select count(*)::int from "events" e where e."company_id" = "companies"."id")`,
      })
      .from(companies)
      .where(inArray(companies.id, ids));
    return new Map(rows.map((row) => [row.id, row]));
  }
  const rows = await db
    .select({
      id: investors.id,
      name: investors.name,
      countryCode: investors.countryCode,
      websiteDomain: investors.websiteDomain,
      events: sql<number>`(select count(*)::int from "event_investors" ei where ei."investor_id" = "investors"."id")`,
    })
    .from(investors)
    .where(inArray(investors.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listCandidates(
  db: Db,
  options: { entityType?: MergeEntity; limit?: number } = {},
): Promise<CandidateRow[]> {
  const rows = await db
    .select()
    .from(mergeCandidates)
    .where(
      and(
        eq(mergeCandidates.status, "open"),
        options.entityType
          ? eq(mergeCandidates.entityType, options.entityType)
          : or(
              eq(mergeCandidates.entityType, "company"),
              eq(mergeCandidates.entityType, "investor"),
            ),
      ),
    )
    .orderBy(asc(mergeCandidates.id))
    .limit(options.limit ?? 50);

  const companySides = await sidesFor(
    db,
    "company",
    rows
      .filter((row) => row.entityType === "company")
      .flatMap((row) => [row.leftId, row.rightId]),
  );
  const investorSides = await sidesFor(
    db,
    "investor",
    rows
      .filter((row) => row.entityType === "investor")
      .flatMap((row) => [row.leftId, row.rightId]),
  );
  return rows.map((row) => {
    const sides = row.entityType === "company" ? companySides : investorSides;
    return {
      id: row.id,
      entityType: row.entityType,
      score: row.score,
      reason: row.reason,
      left: sides.get(row.leftId) ?? null,
      right: sides.get(row.rightId) ?? null,
    };
  });
}
