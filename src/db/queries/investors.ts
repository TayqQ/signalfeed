import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ROUND_TYPES, type RoundType } from "@/core/enums";
import type { InvestorDetail, InvestorRoundRow } from "@/core/read-models";
import type { Db } from "../client";
import {
  companies,
  eventInvestors,
  events,
  fundingRounds,
  investors,
} from "../schema";
import { fundingColumns, toFundingRow } from "./funding";

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

function trimOrNull(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyRoundCounts(): Record<RoundType, number> {
  const counts = {} as Record<RoundType, number>;
  for (const roundType of ROUND_TYPES) counts[roundType] = 0;
  return counts;
}

async function redirectSlug(
  db: Db,
  mergedIntoId: number | null,
): Promise<string | null> {
  let current = mergedIntoId;
  const seen = new Set<number>();
  while (current != null && !seen.has(current)) {
    seen.add(current);
    const [row] = await db
      .select({
        id: investors.id,
        slug: investors.slug,
        mergedIntoId: investors.mergedIntoId,
      })
      .from(investors)
      .where(eq(investors.id, current))
      .limit(1);
    if (!row) return null;
    if (row.mergedIntoId == null) return row.slug;
    current = row.mergedIntoId;
  }
  return null;
}

async function loadRounds(
  db: Db,
  investorId: number,
): Promise<InvestorRoundRow[]> {
  const rows = await db
    .select({
      ...fundingColumns(),
      role: eventInvestors.role,
    })
    .from(eventInvestors)
    .innerJoin(events, eq(events.id, eventInvestors.eventId))
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        eq(eventInvestors.investorId, investorId),
        eq(events.type, "funding_round"),
        isNull(companies.mergedIntoId),
      ),
    )
    .orderBy(desc(events.announcedOn), asc(events.id));

  return rows.map((row) => ({
    ...toFundingRow(row),
    role: row.role,
  }));
}

export async function getInvestorDetail(
  db: Db,
  slug: string,
): Promise<InvestorDetail | null> {
  const [investor] = await db
    .select({
      id: investors.id,
      slug: investors.slug,
      name: investors.name,
      kind: investors.kind,
      countryCode: investors.countryCode,
      websiteDomain: investors.websiteDomain,
      mergedIntoId: investors.mergedIntoId,
      firstSeenAt: investors.firstSeenAt,
    })
    .from(investors)
    .where(eq(investors.slug, slug))
    .limit(1);
  if (!investor) return null;

  const [redirectToSlug, rounds] = await Promise.all([
    redirectSlug(db, investor.mergedIntoId),
    loadRounds(db, investor.id),
  ]);

  const roundTypeCounts = emptyRoundCounts();
  for (const round of rounds) roundTypeCounts[round.roundType] += 1;

  return {
    id: investor.id,
    slug: investor.slug,
    name: investor.name,
    kind: investor.kind,
    countryCode: trimOrNull(investor.countryCode),
    websiteDomain: investor.websiteDomain,
    firstSeenAt: requiredTimestamp(investor.firstSeenAt),
    redirectToSlug,
    rounds,
    roundTypeCounts,
  };
}
