import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Money } from "@/core/domain";
import type {
  AcquirerCount,
  AcquirerSummary,
  AcquisitionRow,
  CompanyRef,
  Page,
  ThemeRef,
} from "@/core/read-models";
import type { Sector } from "@/core/sectors";
import { median, targetAge } from "@/lib/trend-stats";
import type { Db } from "../client";
import {
  acquisitions,
  companies,
  companyThemes,
  events,
  themes,
} from "../schema";
import { resolveThemeSlugs, themeScopeCondition, toThemeRef } from "./themes";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const TOP_ACQUIRERS = 5;
/** Fewest known target ages before a median is shown (spec section 8.4). */
const MIN_AGES_FOR_MEDIAN = 3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AcquisitionFilters {
  /** Theme slug. A merged slug follows `merged_into_id`. */
  theme?: string;
  sector?: Sector;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  /** 1-based. */
  page: number;
  pageSize?: number;
}

/** Name and slug for acquirers that resolved to a company record. */
async function acquirerRefs(
  db: Db,
  ids: ReadonlyArray<number | null>,
): Promise<Map<number, CompanyRef>> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: companies.id, slug: companies.slug, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, wanted));
  return new Map(
    rows.map((row) => [row.id, { slug: row.slug, name: row.name }]),
  );
}

function money(amount: number | null, currency: string | null): Money | null {
  if (amount == null || currency == null) return null;
  return { amountMinor: amount, currency };
}

/**
 * Acquisitions, newest first, with target age. Targets that were merged into
 * another company are left out. Age is null without a founded year.
 */
export async function listAcquisitions(
  db: Db,
  filters: AcquisitionFilters,
): Promise<Page<AcquisitionRow>> {
  const page =
    Number.isInteger(filters.page) && filters.page >= 1 ? filters.page : 1;
  const requested = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize =
    Number.isInteger(requested) && requested >= 1
      ? Math.min(requested, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const conditions: SQL[] = [
    eq(events.type, "acquisition"),
    isNull(companies.mergedIntoId),
  ];
  const scope = await themeScopeCondition(db, filters, companies.id);
  if (scope) conditions.push(scope);
  if (filters.from && DATE.test(filters.from)) {
    conditions.push(gte(events.announcedOn, filters.from));
  }
  if (filters.to && DATE.test(filters.to)) {
    conditions.push(lte(events.announcedOn, filters.to));
  }
  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .where(where);

  const rows = await db
    .select({
      eventId: events.id,
      announcedOn: events.announcedOn,
      datePrecision: events.datePrecision,
      targetId: companies.id,
      targetSlug: companies.slug,
      targetName: companies.name,
      foundedYear: companies.foundedYear,
      acquirerCompanyId: acquisitions.acquirerCompanyId,
      acquirerName: acquisitions.acquirerName,
      priceMinor: acquisitions.priceMinor,
      currency: acquisitions.currency,
      priceGbpMinor: acquisitions.priceGbpMinor,
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(acquisitions, eq(acquisitions.eventId, events.id))
    .where(where)
    .orderBy(desc(events.announcedOn), desc(events.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const themesByCompany = new Map<number, ThemeRef[]>();
  if (rows.length > 0) {
    const links = await db
      .select({
        companyId: companyThemes.companyId,
        slug: themes.slug,
        name: themes.name,
        sector: themes.sector,
      })
      .from(companyThemes)
      .innerJoin(themes, eq(themes.id, companyThemes.themeId))
      .where(
        and(
          inArray(companyThemes.companyId, [
            ...new Set(rows.map((row) => row.targetId)),
          ]),
          eq(themes.status, "active"),
        ),
      )
      .orderBy(themes.name);
    for (const link of links) {
      const list = themesByCompany.get(link.companyId) ?? [];
      list.push(toThemeRef(link));
      themesByCompany.set(link.companyId, list);
    }
  }

  const refs = await acquirerRefs(
    db,
    rows.map((row) => row.acquirerCompanyId),
  );
  return {
    items: rows.map((row) => ({
      eventId: row.eventId,
      target: { slug: row.targetSlug, name: row.targetName },
      acquirer:
        row.acquirerCompanyId === null
          ? null
          : (refs.get(row.acquirerCompanyId) ?? null),
      acquirerName: row.acquirerName,
      price: money(row.priceMinor, row.currency),
      priceGbpMinor: row.priceGbpMinor,
      announcedOn: row.announcedOn,
      datePrecision: row.datePrecision,
      targetAgeYears: targetAge(row.foundedYear, row.announcedOn),
      themes: themesByCompany.get(row.targetId) ?? [],
    })),
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
}

/**
 * Acquisitions per theme of the target: top acquirers by count, the median
 * target age, and how many ages are known. A target in two themes counts in
 * both. Themes with no acquisitions are left out. Most acquisitions first.
 */
export async function acquirersByTheme(
  db: Db,
  scope: { theme?: string; sector?: Sector } = {},
): Promise<AcquirerSummary[]> {
  const conditions: SQL[] = [
    eq(events.type, "acquisition"),
    isNull(companies.mergedIntoId),
    eq(themes.status, "active"),
  ];
  if (scope.theme) {
    const resolved = await resolveThemeSlugs(db, [scope.theme]);
    conditions.push(
      resolved.length === 0 ? sql`false` : inArray(themes.slug, resolved),
    );
  }
  if (scope.sector) conditions.push(eq(themes.sector, scope.sector));

  const rows = await db
    .select({
      themeSlug: themes.slug,
      themeName: themes.name,
      themeSector: themes.sector,
      announcedOn: events.announcedOn,
      foundedYear: companies.foundedYear,
      acquirerCompanyId: acquisitions.acquirerCompanyId,
      acquirerName: acquisitions.acquirerName,
      eventId: events.id,
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(acquisitions, eq(acquisitions.eventId, events.id))
    .innerJoin(companyThemes, eq(companyThemes.companyId, companies.id))
    .innerJoin(themes, eq(themes.id, companyThemes.themeId))
    .where(and(...conditions));

  const refs = await acquirerRefs(
    db,
    rows.map((row) => row.acquirerCompanyId),
  );
  interface Group {
    theme: ThemeRef;
    acquisitions: number;
    ages: number[];
    acquirers: Map<string, AcquirerCount>;
  }
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const group = groups.get(row.themeSlug) ?? {
      theme: toThemeRef({
        slug: row.themeSlug,
        name: row.themeName,
        sector: row.themeSector,
      }),
      acquisitions: 0,
      ages: [],
      acquirers: new Map<string, AcquirerCount>(),
    };
    groups.set(row.themeSlug, group);
    group.acquisitions += 1;
    const age = targetAge(row.foundedYear, row.announcedOn);
    if (age !== null) group.ages.push(age);

    const ref =
      row.acquirerCompanyId === null
        ? null
        : (refs.get(row.acquirerCompanyId) ?? null);
    const key = ref
      ? `company:${ref.slug}`
      : `name:${row.acquirerName.trim().toLowerCase()}`;
    const existing = group.acquirers.get(key);
    if (existing) {
      existing.acquisitions += 1;
    } else {
      group.acquirers.set(key, {
        acquirer: ref,
        acquirerName: ref ? ref.name : row.acquirerName,
        acquisitions: 1,
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      theme: group.theme,
      acquisitions: group.acquisitions,
      topAcquirers: [...group.acquirers.values()]
        .sort(
          (a, b) =>
            b.acquisitions - a.acquisitions ||
            a.acquirerName.localeCompare(b.acquirerName, "en-GB"),
        )
        .slice(0, TOP_ACQUIRERS),
      medianTargetAgeYears:
        group.ages.length >= MIN_AGES_FOR_MEDIAN ? median(group.ages) : null,
      targetAgesKnown: group.ages.length,
    }))
    .sort(
      (a, b) =>
        b.acquisitions - a.acquisitions ||
        a.theme.name.localeCompare(b.theme.name, "en-GB"),
    );
}
