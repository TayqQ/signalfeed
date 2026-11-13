import { eq, isNull } from "drizzle-orm";
import type { EventType, RoundType } from "@/core/enums";
import type { Db } from "@/db/client";
import { companies, events, fundingRounds } from "@/db/schema";
import { EARLY_ROUND_TYPES, LATE_ROUND_TYPES } from "@/lib/rising-score";
import { weekStart } from "@/lib/weeks";
import type { CompanyThemeRow } from "./company-themes";

/**
 * `theme_weekly_stats` and `weekly_totals` (docs/spec-phase2.md section 5.3).
 * Every event of a non-merged company falls in the ISO week (Monday, UTC)
 * of its `announced_on`. Grants are counted only as grants (D44). Only weeks
 * with at least one event get a row.
 */

export interface StatEvent {
  eventId: number;
  companyId: number;
  type: EventType;
  announcedOn: string;
  /** Null for events that are not funding rounds. */
  roundType: RoundType | null;
  amountGbpMinor: number | null;
}

export type ThemeWeeklyRow = {
  themeId: number;
  weekStart: string;
  rounds: number;
  roundsWithAmount: number;
  totalGbpMinor: number;
  earlyRounds: number;
  laterRounds: number;
  unknownStageRounds: number;
  grants: number;
  grantGbpMinor: number;
  acquisitions: number;
  launches: number;
  companies: number;
};

export type WeeklyTotalRow = {
  weekStart: string;
  rounds: number;
  earlyRounds: number;
  grants: number;
  acquisitions: number;
  launches: number;
};

/** Every event of a non-merged company, with its round type and GBP amount. */
export async function loadStatEvents(db: Db): Promise<StatEvent[]> {
  const rows = await db
    .select({
      eventId: events.id,
      companyId: events.companyId,
      type: events.type,
      announcedOn: events.announcedOn,
      roundType: fundingRounds.roundType,
      amountGbpMinor: fundingRounds.amountGbpMinor,
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .leftJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(isNull(companies.mergedIntoId));
  return rows.map((row) => ({
    ...row,
    // A funding round without its detail row counts as an unknown stage.
    roundType:
      row.type === "funding_round" ? (row.roundType ?? "unknown") : null,
    amountGbpMinor: row.type === "funding_round" ? row.amountGbpMinor : null,
  }));
}

type Counted = Omit<ThemeWeeklyRow, "themeId" | "weekStart" | "companies">;

function emptyCounts(): Counted {
  return {
    rounds: 0,
    roundsWithAmount: 0,
    totalGbpMinor: 0,
    earlyRounds: 0,
    laterRounds: 0,
    unknownStageRounds: 0,
    grants: 0,
    grantGbpMinor: 0,
    acquisitions: 0,
    launches: 0,
  };
}

function knownAmount(event: StatEvent): number | null {
  const amount = event.amountGbpMinor;
  return amount !== null && Number.isFinite(amount) ? amount : null;
}

/** Adds one event to a set of counts. */
function count(counts: Counted, event: StatEvent): void {
  if (event.type === "acquisition") {
    counts.acquisitions += 1;
    return;
  }
  if (event.type === "launch") {
    counts.launches += 1;
    return;
  }
  const roundType = event.roundType ?? "unknown";
  const amount = knownAmount(event);
  if (roundType === "grant") {
    counts.grants += 1;
    if (amount !== null) counts.grantGbpMinor += amount;
    return;
  }
  counts.rounds += 1;
  if (amount !== null) {
    counts.roundsWithAmount += 1;
    counts.totalGbpMinor += amount;
  }
  if (EARLY_ROUND_TYPES.includes(roundType)) counts.earlyRounds += 1;
  else if (LATE_ROUND_TYPES.includes(roundType)) counts.laterRounds += 1;
  else if (roundType === "unknown") counts.unknownStageRounds += 1;
}

/**
 * Weekly counts per theme. An event counts once in each theme its company
 * is in. Rows are ordered by theme, then week.
 */
export function computeThemeWeekly(
  statEvents: readonly StatEvent[],
  companyThemes: readonly CompanyThemeRow[],
): ThemeWeeklyRow[] {
  const themesByCompany = new Map<number, number[]>();
  for (const { companyId, themeId } of companyThemes) {
    const list = themesByCompany.get(companyId) ?? [];
    list.push(themeId);
    themesByCompany.set(companyId, list);
  }

  const rows = new Map<
    string,
    { row: Omit<ThemeWeeklyRow, "companies">; companies: Set<number> }
  >();
  for (const event of statEvents) {
    const themeIds = themesByCompany.get(event.companyId);
    if (!themeIds) continue;
    const week = weekStart(event.announcedOn);
    for (const themeId of themeIds) {
      const key = `${themeId}:${week}`;
      let entry = rows.get(key);
      if (!entry) {
        entry = {
          row: { themeId, weekStart: week, ...emptyCounts() },
          companies: new Set(),
        };
        rows.set(key, entry);
      }
      count(entry.row, event);
      entry.companies.add(event.companyId);
    }
  }

  return [...rows.values()]
    .map(({ row, companies: ids }) => ({ ...row, companies: ids.size }))
    .sort(
      (a, b) => a.themeId - b.themeId || a.weekStart.localeCompare(b.weekStart),
    );
}

/**
 * Weekly counts across all companies, themed or not. Each event counts
 * once, however many themes its company is in. Rows are ordered by week.
 */
export function computeWeeklyTotals(
  statEvents: readonly StatEvent[],
): WeeklyTotalRow[] {
  const byWeek = new Map<string, Counted>();
  const seen = new Set<number>();
  for (const event of statEvents) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const week = weekStart(event.announcedOn);
    const counts = byWeek.get(week) ?? emptyCounts();
    count(counts, event);
    byWeek.set(week, counts);
  }
  return [...byWeek.entries()]
    .map(([week, counts]) => ({
      weekStart: week,
      rounds: counts.rounds,
      earlyRounds: counts.earlyRounds,
      grants: counts.grants,
      acquisitions: counts.acquisitions,
      launches: counts.launches,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
