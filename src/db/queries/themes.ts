import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import type { RoundType } from "@/core/enums";
import { ROUND_TYPES } from "@/core/enums";
import type {
  TagRef,
  ThemeDetail,
  ThemeRef,
  ThemeSummary,
  WeeklyPoint,
} from "@/core/read-models";
import { isSector, SECTORS, type Sector } from "@/core/sectors";
import { lastCompleteWeek, weekRange, addWeeks } from "@/lib/weeks";
import type { Db } from "../client";
import {
  companies,
  companyTags,
  companyThemes,
  events,
  fundingRounds,
  tags,
  tagThemes,
  themes,
  themeWeeklyStats,
} from "../schema";

const TOP_TAGS = 10;
const DETAIL_WEEKS = 52;
const MAX_MERGE_HOPS = 10;

export function toThemeRef(row: {
  slug: string;
  name: string;
  sector: string | null;
}): ThemeRef {
  return {
    slug: row.slug,
    name: row.name,
    sector: isSector(row.sector) ? row.sector : null,
  };
}

/**
 * Follows `merged_into_id` for each slug and returns the surviving active
 * slugs, without repeats, in input order. Unknown slugs are dropped.
 */
export async function resolveThemeSlugs(
  db: Db,
  slugs: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(slugs.map((slug) => slug.trim()))].filter(
    (slug) => slug.length > 0,
  );
  if (wanted.length === 0) return [];
  const rows = await db
    .select({
      id: themes.id,
      slug: themes.slug,
      mergedIntoId: themes.mergedIntoId,
    })
    .from(themes);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const resolved: string[] = [];
  for (const slug of wanted) {
    let current = bySlug.get(slug);
    for (
      let hop = 0;
      current?.mergedIntoId != null && hop < MAX_MERGE_HOPS;
      hop += 1
    ) {
      current = byId.get(current.mergedIntoId);
    }
    if (current && current.mergedIntoId == null) resolved.push(current.slug);
  }
  return [...new Set(resolved)];
}

export interface ThemeScope {
  /** Theme slug. A merged slug follows `merged_into_id`. */
  theme?: string;
  sector?: Sector;
}

/**
 * A condition that keeps rows whose company is in the theme and in a theme of
 * the sector. Returns null when the scope is empty. An unknown theme or sector
 * matches nothing.
 */
export async function themeScopeCondition(
  db: Db,
  scope: ThemeScope,
  companyId: AnyColumn,
): Promise<SQL | null> {
  const conditions: SQL[] = [];
  const column = companyId;
  if (scope.theme && scope.theme.trim().length > 0) {
    const resolved = await resolveThemeSlugs(db, [scope.theme]);
    if (resolved.length === 0) return sql`false`;
    conditions.push(sql`exists (
      select 1
      from ${companyThemes}
      inner join ${themes} on ${themes.id} = ${companyThemes.themeId}
      where ${companyThemes.companyId} = ${column}
        and ${inArray(themes.slug, resolved)}
    )`);
  }
  if (scope.sector) {
    if (!isSector(scope.sector)) return sql`false`;
    conditions.push(sql`exists (
      select 1
      from ${companyThemes}
      inner join ${themes} on ${themes.id} = ${companyThemes.themeId}
      where ${companyThemes.companyId} = ${column}
        and ${themes.status} = 'active'
        and ${themes.sector} = ${scope.sector}
    )`);
  }
  if (conditions.length === 0) return null;
  return and(...conditions) ?? null;
}

function isReviewed(row: {
  nameSource: string;
  reviewedAt: Date | string | null;
}): boolean {
  return row.nameSource === "manual" || row.reviewedAt != null;
}

/** Live companies in each theme (merged companies are left out). */
async function companyCounts(db: Db): Promise<Map<number, number>> {
  const rows = await db
    .select({
      themeId: companyThemes.themeId,
      count: sql<number>`count(distinct ${companyThemes.companyId})::int`,
    })
    .from(companyThemes)
    .innerJoin(companies, eq(companies.id, companyThemes.companyId))
    .where(isNull(companies.mergedIntoId))
    .groupBy(companyThemes.themeId);
  return new Map(rows.map((row) => [row.themeId, row.count]));
}

/**
 * Active themes with company and tag counts, grouped by sector in the order
 * of `SECTORS` (themes with no sector last) and A-Z by name within a sector.
 */
export async function listThemes(
  db: Db,
  options: { sector?: Sector } = {},
): Promise<ThemeSummary[]> {
  if (options.sector && !isSector(options.sector)) return [];
  const conditions: SQL[] = [eq(themes.status, "active")];
  if (options.sector) conditions.push(eq(themes.sector, options.sector));

  const [rows, companyCountByTheme, tagCountRows] = await Promise.all([
    db
      .select({
        id: themes.id,
        slug: themes.slug,
        name: themes.name,
        sector: themes.sector,
        nameSource: themes.nameSource,
        reviewedAt: themes.reviewedAt,
      })
      .from(themes)
      .where(and(...conditions)),
    companyCounts(db),
    db
      .select({
        themeId: tagThemes.themeId,
        count: sql<number>`count(*)::int`,
      })
      .from(tagThemes)
      .groupBy(tagThemes.themeId),
  ]);
  const tagCountByTheme = new Map(
    tagCountRows.map((row) => [row.themeId, row.count]),
  );
  const sectorOrder = (sector: string | null): number => {
    const index = SECTORS.findIndex((candidate) => candidate === sector);
    return index === -1 ? SECTORS.length : index;
  };

  return rows
    .sort(
      (a, b) =>
        sectorOrder(a.sector) - sectorOrder(b.sector) ||
        a.name.localeCompare(b.name, "en-GB") ||
        a.slug.localeCompare(b.slug),
    )
    .map((row) => ({
      ...toThemeRef(row),
      nameIsReviewed: isReviewed(row),
      companyCount: companyCountByTheme.get(row.id) ?? 0,
      tagCount: tagCountByTheme.get(row.id) ?? 0,
    }));
}

function emptyStageMix(): Record<RoundType, number> {
  return Object.fromEntries(ROUND_TYPES.map((type) => [type, 0])) as Record<
    RoundType,
    number
  >;
}

function isRoundType(value: string): value is RoundType {
  return (ROUND_TYPES as readonly string[]).includes(value);
}

/**
 * One theme for its page. Returns null for an unknown slug. A merged theme
 * returns `redirectToSlug` and no data, and the page redirects.
 *
 * The stage mix counts funding rounds by type over all recorded history.
 * Grants are never rounds, so `grant` is always 0.
 */
export async function getThemeDetail(
  db: Db,
  slug: string,
  options: { now: Date },
): Promise<ThemeDetail | null> {
  const [theme] = await db
    .select()
    .from(themes)
    .where(eq(themes.slug, slug))
    .limit(1);
  if (!theme) return null;

  const summaryBase = {
    ...toThemeRef(theme),
    nameIsReviewed: isReviewed(theme),
  };

  if (theme.status === "merged") {
    const [target] = await resolveThemeSlugs(db, [slug]);
    return {
      summary: { ...summaryBase, companyCount: 0, tagCount: 0 },
      tags: [],
      weekly: [],
      stageMix: emptyStageMix(),
      redirectToSlug: target ?? null,
    };
  }

  const lastWeek = lastCompleteWeek(options.now);
  const firstWeek = addWeeks(lastWeek, -(DETAIL_WEEKS - 1));

  const [companyCountByTheme, tagCountRows, tagRows, weekRows, stageRows] =
    await Promise.all([
      companyCounts(db),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tagThemes)
        .where(eq(tagThemes.themeId, theme.id)),
      db
        .select({
          slug: tags.slug,
          label: tags.label,
          mentions: sql<number>`coalesce(sum(${companyTags.mentionCount}), 0)::int`,
        })
        .from(tagThemes)
        .innerJoin(tags, eq(tags.id, tagThemes.tagId))
        .leftJoin(companyTags, eq(companyTags.tagId, tags.id))
        .where(eq(tagThemes.themeId, theme.id))
        .groupBy(tags.id)
        .orderBy(
          desc(sql`coalesce(sum(${companyTags.mentionCount}), 0)`),
          asc(tags.slug),
        )
        .limit(TOP_TAGS),
      db
        .select()
        .from(themeWeeklyStats)
        .where(
          and(
            eq(themeWeeklyStats.themeId, theme.id),
            sql`${themeWeeklyStats.weekStart} >= ${firstWeek}`,
            sql`${themeWeeklyStats.weekStart} <= ${lastWeek}`,
          ),
        ),
      db
        .select({
          roundType: fundingRounds.roundType,
          count: sql<number>`count(*)::int`,
        })
        .from(companyThemes)
        .innerJoin(companies, eq(companies.id, companyThemes.companyId))
        .innerJoin(events, eq(events.companyId, companies.id))
        .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
        .where(
          and(
            eq(companyThemes.themeId, theme.id),
            isNull(companies.mergedIntoId),
            eq(events.type, "funding_round"),
          ),
        )
        .groupBy(fundingRounds.roundType),
    ]);

  const byWeek = new Map(weekRows.map((row) => [row.weekStart, row]));
  const weekly: WeeklyPoint[] = weekRange(firstWeek, lastWeek).map((week) => {
    const row = byWeek.get(week);
    return {
      weekStart: week,
      rounds: row?.rounds ?? 0,
      earlyRounds: row?.earlyRounds ?? 0,
      laterRounds: row?.laterRounds ?? 0,
      unknownStageRounds: row?.unknownStageRounds ?? 0,
      totalGbpMinor: row?.totalGbpMinor ?? 0,
    };
  });

  const stageMix = emptyStageMix();
  for (const row of stageRows) {
    if (isRoundType(row.roundType) && row.roundType !== "grant") {
      stageMix[row.roundType] = row.count;
    }
  }

  const topTags: TagRef[] = tagRows.map((row) => ({
    slug: row.slug,
    label: row.label,
  }));

  return {
    summary: {
      ...summaryBase,
      companyCount: companyCountByTheme.get(theme.id) ?? 0,
      tagCount: tagCountRows[0]?.count ?? 0,
    },
    tags: topTags,
    weekly,
    stageMix,
    redirectToSlug: null,
  };
}
