import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { RoundType } from "@/core/enums";
import type { EarlyMomentumRow, RisingThemeRow } from "@/core/read-models";
import {
  lateShare,
  rankEarlyMomentum,
  rankRising,
  RECENT_WEEKS,
  risingScore,
  windows,
  type WeekWindow,
} from "@/lib/rising-score";
import { addWeeks, lastCompleteWeek, weekRange } from "@/lib/weeks";
import type { Db } from "../client";
import {
  companies,
  companyThemes,
  events,
  fundingRounds,
  themes,
  themeWeeklyStats,
  weeklyTotals,
} from "../schema";
import { toThemeRef } from "./themes";

/** Weeks in each row's sparkline. */
export const SPARKLINE_WEEKS = 26;
/** Themes need this many companies to appear in trend views (spec section 7.3). */
export const MIN_THEME_COMPANIES = 3;

export interface TrendList<T> {
  rows: T[];
  /**
   * True when the baseline holds fewer than 8 collected weeks. Rows then have
   * no score, because a score from so little history would mislead.
   */
  notEnoughHistory: boolean;
  /** The first week with collected data (a Monday), or null when there is none. */
  firstWeek: string | null;
}

interface ThemeWeekCounts {
  rounds: number;
  earlyRounds: number;
  totalGbpMinor: number;
}

interface TrendData {
  firstWeek: string | null;
  notEnoughHistory: boolean;
  recent: WeekWindow;
  baseline: WeekWindow | null;
  sparkWeeks: string[];
  totals: Map<string, { rounds: number; earlyRounds: number }>;
  eligible: Array<{
    id: number;
    slug: string;
    name: string;
    sector: string | null;
  }>;
  byTheme: Map<number, Map<string, ThemeWeekCounts>>;
}

function sum(
  weeks: ReadonlyMap<string, ThemeWeekCounts> | undefined,
  window: WeekWindow | null,
  pick: (counts: ThemeWeekCounts) => number,
): number {
  if (!weeks || !window) return 0;
  let total = 0;
  for (const [week, counts] of weeks) {
    if (week >= window.from && week <= window.to) total += pick(counts);
  }
  return total;
}

async function loadTrendData(db: Db, now: Date): Promise<TrendData> {
  const last = lastCompleteWeek(now);
  const [first] = await db
    .select({ week: sql<string | null>`min(${weeklyTotals.weekStart})` })
    .from(weeklyTotals);
  const firstWeek = first?.week ?? null;

  const found = firstWeek ? windows(last, firstWeek) : null;
  const recent: WeekWindow = {
    from: addWeeks(last, -(RECENT_WEEKS - 1)),
    to: last,
    weeks: RECENT_WEEKS,
  };
  const sparkFrom = addWeeks(last, -(SPARKLINE_WEEKS - 1));
  const from =
    [sparkFrom, found?.baseline.from ?? sparkFrom].sort()[0] ?? sparkFrom;

  const [totalRows, statRows, eligible] = await Promise.all([
    db
      .select()
      .from(weeklyTotals)
      .where(
        and(
          gte(weeklyTotals.weekStart, from),
          lte(weeklyTotals.weekStart, last),
        ),
      ),
    db
      .select()
      .from(themeWeeklyStats)
      .where(
        and(
          gte(themeWeeklyStats.weekStart, from),
          lte(themeWeeklyStats.weekStart, last),
        ),
      ),
    db
      .select({
        id: themes.id,
        slug: themes.slug,
        name: themes.name,
        sector: themes.sector,
      })
      .from(themes)
      .innerJoin(companyThemes, eq(companyThemes.themeId, themes.id))
      .innerJoin(companies, eq(companies.id, companyThemes.companyId))
      .where(and(eq(themes.status, "active"), isNull(companies.mergedIntoId)))
      .groupBy(themes.id)
      .having(sql`count(distinct ${companies.id}) >= ${MIN_THEME_COMPANIES}`),
  ]);

  const byTheme = new Map<number, Map<string, ThemeWeekCounts>>();
  for (const row of statRows) {
    const weeks =
      byTheme.get(row.themeId) ?? new Map<string, ThemeWeekCounts>();
    weeks.set(row.weekStart, {
      rounds: row.rounds,
      earlyRounds: row.earlyRounds,
      totalGbpMinor: row.totalGbpMinor,
    });
    byTheme.set(row.themeId, weeks);
  }

  return {
    firstWeek,
    notEnoughHistory: found === null,
    recent,
    baseline: found?.baseline ?? null,
    sparkWeeks: weekRange(sparkFrom, last),
    totals: new Map(
      totalRows.map((row) => [
        row.weekStart,
        { rounds: row.rounds, earlyRounds: row.earlyRounds },
      ]),
    ),
    eligible,
    byTheme,
  };
}

function totalIn(
  data: TrendData,
  window: WeekWindow | null,
  pick: (row: { rounds: number; earlyRounds: number }) => number,
): number {
  if (!window) return 0;
  let total = 0;
  for (const [week, row] of data.totals) {
    if (week >= window.from && week <= window.to) total += pick(row);
  }
  return total;
}

/**
 * The rising list (spec section 8.1): themes with at least 3 companies and at
 * least 3 recent rounds, by score. Grants are never counted. Each row has a
 * 26-week sparkline of rounds a week.
 */
export async function listRisingThemes(
  db: Db,
  options: { now: Date },
): Promise<TrendList<RisingThemeRow>> {
  const data = await loadTrendData(db, options.now);
  const totalRecent = totalIn(data, data.recent, (row) => row.rounds);
  const totalBaseline = totalIn(data, data.baseline, (row) => row.rounds);

  const rows = data.eligible.map((theme) => {
    const weeks = data.byTheme.get(theme.id);
    const recent = sum(weeks, data.recent, (c) => c.rounds);
    const baseline = sum(weeks, data.baseline, (c) => c.rounds);
    const result = data.baseline
      ? risingScore({ recent, baseline, totalRecent, totalBaseline })
      : { expected: 0, score: null };
    return {
      slug: theme.slug,
      recent,
      score: result.score,
      row: {
        theme: toThemeRef(theme),
        recentRounds: recent,
        baselineRounds: baseline,
        expected: result.expected,
        score: result.score,
        recentGbpMinor: sum(weeks, data.recent, (c) => c.totalGbpMinor),
        sparkline: data.sparkWeeks.map((week) => weeks?.get(week)?.rounds ?? 0),
      } satisfies RisingThemeRow,
    };
  });

  return {
    rows: rankRising(rows).map((entry) => entry.row),
    notEnoughHistory: data.notEnoughHistory,
    firstWeek: data.firstWeek,
  };
}

/** Round types per company, over all history, for the late share. Grants are left out. */
async function roundTypesByTheme(db: Db): Promise<Map<number, RoundType[][]>> {
  const rows = await db
    .select({
      themeId: companyThemes.themeId,
      companyId: companies.id,
      roundType: fundingRounds.roundType,
    })
    .from(companyThemes)
    .innerJoin(companies, eq(companies.id, companyThemes.companyId))
    .innerJoin(events, eq(events.companyId, companies.id))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        isNull(companies.mergedIntoId),
        eq(events.type, "funding_round"),
        sql`${fundingRounds.roundType} <> 'grant'`,
      ),
    );
  const perTheme = new Map<number, Map<number, RoundType[]>>();
  for (const row of rows) {
    const companyMap =
      perTheme.get(row.themeId) ?? new Map<number, RoundType[]>();
    const types = companyMap.get(row.companyId) ?? [];
    types.push(row.roundType);
    companyMap.set(row.companyId, types);
    perTheme.set(row.themeId, companyMap);
  }
  return new Map(
    [...perTheme].map(([themeId, companyMap]) => [
      themeId,
      [...companyMap.values()],
    ]),
  );
}

/**
 * The early-momentum list (spec section 8.2): at least 3 recent early rounds,
 * a positive early score and a late share of 0.25 or less.
 */
export async function listEarlyMomentum(
  db: Db,
  options: { now: Date },
): Promise<TrendList<EarlyMomentumRow>> {
  const data = await loadTrendData(db, options.now);
  const totalRecent = totalIn(data, data.recent, (row) => row.earlyRounds);
  const totalBaseline = totalIn(data, data.baseline, (row) => row.earlyRounds);
  const typesByTheme = await roundTypesByTheme(db);

  const rows = data.eligible.map((theme) => {
    const weeks = data.byTheme.get(theme.id);
    const recent = sum(weeks, data.recent, (c) => c.earlyRounds);
    const baseline = sum(weeks, data.baseline, (c) => c.earlyRounds);
    const result = data.baseline
      ? risingScore({ recent, baseline, totalRecent, totalBaseline })
      : { expected: 0, score: null };
    return {
      slug: theme.slug,
      theme: toThemeRef(theme),
      recent,
      score: result.score,
      lateShare: lateShare(typesByTheme.get(theme.id) ?? []),
    };
  });

  const ranked: EarlyMomentumRow[] = [];
  for (const row of rankEarlyMomentum(rows)) {
    if (row.score === null) continue;
    ranked.push({
      theme: row.theme,
      recentEarlyRounds: row.recent,
      score: row.score,
      lateShare: row.lateShare,
    });
  }
  return {
    rows: ranked,
    notEnoughHistory: data.notEnoughHistory,
    firstWeek: data.firstWeek,
  };
}
