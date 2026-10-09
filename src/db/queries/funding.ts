import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { RoundType } from "@/core/enums";
import { ROUND_TYPES } from "@/core/enums";
import type { Money } from "@/core/domain";
import type {
  FundingFilters,
  FundingRow,
  FundingSort,
  InvestorRef,
  Page,
  TagRef,
} from "@/core/read-models";
import { normaliseCompanyName } from "@/lib/normalise";
import { countriesInRegion, REGIONS, type Region } from "@/lib/regions";
import type { Db } from "../client";
import {
  companies,
  companyAliases,
  companyTags,
  eventInvestors,
  events,
  fundingRounds,
  investors,
  tags,
} from "../schema";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

function isRoundType(value: string): value is RoundType {
  return (ROUND_TYPES as readonly string[]).includes(value);
}

function clampPage(page: number): number {
  if (!Number.isInteger(page) || page < 1) return 1;
  return page;
}

function clampPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalisedQuery(q: string | undefined): string | null {
  if (q == null) return null;
  const normalised = normaliseCompanyName(q);
  return normalised.length > 0 ? normalised : null;
}

/** Name similarity, or the best alias similarity when that is higher. */
function relevanceExpr(normalisedQ: string): SQL {
  return sql`greatest(
    similarity(${companies.normalisedName}, ${normalisedQ}),
    coalesce((
      select max(similarity(${companyAliases.normalisedAlias}, ${normalisedQ}))
      from ${companyAliases}
      where ${companyAliases.companyId} = ${companies.id}
    ), 0)
  )`;
}

function textMatch(normalisedQ: string): SQL {
  const pattern = `%${escapeLike(normalisedQ)}%`;
  return sql`(
    ${relevanceExpr(normalisedQ)} >= 0.2
    or ${companies.normalisedName} ilike ${pattern} escape '\\'
    or exists (
      select 1
      from ${companyAliases}
      where ${companyAliases.companyId} = ${companies.id}
        and ${companyAliases.normalisedAlias} ilike ${pattern} escape '\\'
    )
  )`;
}

function regionCodes(regions: readonly string[]): string[] {
  const codes = new Set<string>();
  for (const region of regions) {
    if (!isRegion(region)) continue;
    for (const code of countriesInRegion(region)) codes.add(code);
  }
  return [...codes];
}

function fundingWhere(filters: FundingFilters, query: string | null): SQL {
  const conditions: SQL[] = [
    eq(events.type, "funding_round"),
    isNull(companies.mergedIntoId),
  ];

  if (query) conditions.push(textMatch(query));

  if (filters.roundTypes && filters.roundTypes.length > 0) {
    const rounds = filters.roundTypes.filter(isRoundType);
    conditions.push(
      rounds.length === 0
        ? sql`false`
        : inArray(fundingRounds.roundType, rounds),
    );
  }

  if (filters.regions && filters.regions.length > 0) {
    const codes = regionCodes(filters.regions);
    conditions.push(
      codes.length === 0 ? sql`false` : inArray(companies.countryCode, codes),
    );
  }

  if (filters.countryCodes && filters.countryCodes.length > 0) {
    const codes = [
      ...new Set(filters.countryCodes.map((code) => code.trim().toUpperCase())),
    ].filter((code) => code.length > 0);
    conditions.push(
      codes.length === 0 ? sql`false` : inArray(companies.countryCode, codes),
    );
  }

  if (filters.tag && filters.tag.trim().length > 0) {
    const tag = filters.tag.trim();
    conditions.push(sql`exists (
      select 1
      from ${companyTags}
      inner join ${tags} on ${tags.id} = ${companyTags.tagId}
      where ${companyTags.companyId} = ${companies.id}
        and ${tags.slug} = ${tag}
    )`);
  }

  if (filters.investorSlug && filters.investorSlug.trim().length > 0) {
    const investorSlug = filters.investorSlug.trim();
    conditions.push(sql`exists (
      select 1
      from ${eventInvestors}
      inner join ${investors} on ${investors.id} = ${eventInvestors.investorId}
      where ${eventInvestors.eventId} = ${events.id}
        and ${investors.slug} = ${investorSlug}
    )`);
  }

  if (filters.from && DATE.test(filters.from)) {
    conditions.push(gte(events.announcedOn, filters.from));
  }
  if (filters.to && DATE.test(filters.to)) {
    conditions.push(lte(events.announcedOn, filters.to));
  }
  if (
    typeof filters.minGbpMinor === "number" &&
    Number.isFinite(filters.minGbpMinor)
  ) {
    conditions.push(gte(fundingRounds.amountGbpMinor, filters.minGbpMinor));
  }
  if (
    typeof filters.maxGbpMinor === "number" &&
    Number.isFinite(filters.maxGbpMinor)
  ) {
    conditions.push(lte(fundingRounds.amountGbpMinor, filters.maxGbpMinor));
  }

  const where = and(...conditions);
  if (!where) throw new Error("Funding query is missing a filter");
  return where;
}

/**
 * Relevance is the primary key when a query is present and no explicit sort
 * was chosen. Announced date only breaks those ties (D24).
 */
function chosenSort(
  filters: FundingFilters,
  query: string | null,
): FundingSort {
  if (filters.sort === "announced" || filters.sort === "amount") {
    return filters.sort;
  }
  if (query && (filters.sort == null || filters.sort === "relevance")) {
    return "relevance";
  }
  return "announced";
}

function fundingOrder(filters: FundingFilters, query: string | null): SQL[] {
  const direction = filters.direction === "asc" ? "asc" : "desc";
  const idTieBreak = sql`${events.id} asc`;
  const sort = chosenSort(filters, query);

  if (sort === "relevance" && query) {
    const score = relevanceExpr(query);
    return [
      direction === "asc" ? sql`${score} asc` : sql`${score} desc`,
      sql`${events.announcedOn} desc`,
      idTieBreak,
    ];
  }

  if (sort === "amount") {
    return [
      direction === "asc"
        ? sql`${fundingRounds.amountGbpMinor} asc nulls last`
        : sql`${fundingRounds.amountGbpMinor} desc nulls last`,
      idTieBreak,
    ];
  }

  return [
    direction === "asc"
      ? sql`${events.announcedOn} asc`
      : sql`${events.announcedOn} desc`,
    idTieBreak,
  ];
}

function leadInvestorsSql(): SQL<unknown> {
  return sql<unknown>`coalesce((
    select json_agg(
      json_build_object('slug', ${investors.slug}, 'name', ${investors.name})
      order by ${investors.name}
    )
    from ${eventInvestors}
    inner join ${investors} on ${investors.id} = ${eventInvestors.investorId}
    where ${eventInvestors.eventId} = ${events.id}
      and ${eventInvestors.role} = 'lead'
  ), '[]'::json)`;
}

function investorCountSql(): SQL<number> {
  return sql<number>`(
    select count(*)::int
    from ${eventInvestors}
    where ${eventInvestors.eventId} = ${events.id}
  )`;
}

function tagsSql(): SQL<unknown> {
  return sql<unknown>`coalesce((
    select json_agg(
      json_build_object('slug', ${tags.slug}, 'label', ${tags.label})
      order by ${tags.label}
    )
    from ${companyTags}
    inner join ${tags} on ${tags.id} = ${companyTags.tagId}
    where ${companyTags.companyId} = ${companies.id}
  ), '[]'::json)`;
}

export interface FundingRowSource {
  eventId: number;
  companySlug: string;
  companyName: string;
  countryCode: string | null;
  city: string | null;
  roundType: RoundType;
  roundLabel: string | null;
  amountMinor: number | null;
  currency: string | null;
  amountGbpMinor: number | null;
  amountUsdMinor: number | null;
  announcedOn: string;
  sourceCount: number;
  leadInvestors: unknown;
  investorCount: unknown;
  tags: unknown;
}

export function fundingColumns() {
  return {
    eventId: events.id,
    companySlug: companies.slug,
    companyName: companies.name,
    countryCode: companies.countryCode,
    city: companies.city,
    roundType: fundingRounds.roundType,
    roundLabel: fundingRounds.roundLabel,
    amountMinor: fundingRounds.amountMinor,
    currency: fundingRounds.currency,
    amountGbpMinor: fundingRounds.amountGbpMinor,
    amountUsdMinor: fundingRounds.amountUsdMinor,
    announcedOn: events.announcedOn,
    sourceCount: events.sourceCount,
    leadInvestors: leadInvestorsSql(),
    investorCount: investorCountSql(),
    tags: tagsSql(),
  };
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

function asMinor(value: unknown): number | null {
  if (value == null) return null;
  return asCount(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readObjects(value: unknown): Array<Record<string, unknown>> {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is Record<string, unknown> =>
      item != null && typeof item === "object" && !Array.isArray(item),
  );
}

function readInvestorRefs(value: unknown): InvestorRef[] {
  const refs: InvestorRef[] = [];
  for (const item of readObjects(value)) {
    if (typeof item.slug === "string" && typeof item.name === "string") {
      refs.push({ slug: item.slug, name: item.name });
    }
  }
  return refs;
}

function readTagRefs(value: unknown): TagRef[] {
  const refs: TagRef[] = [];
  for (const item of readObjects(value)) {
    if (typeof item.slug === "string" && typeof item.label === "string") {
      refs.push({ slug: item.slug, label: item.label });
    }
  }
  return refs;
}

function trimOrNull(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function money(amount: unknown, currency: string | null): Money | null {
  const amountMinor = asMinor(amount);
  const code = trimOrNull(currency);
  if (amountMinor == null || code == null) return null;
  return { amountMinor, currency: code };
}

export function toFundingRow(row: FundingRowSource): FundingRow {
  return {
    eventId: row.eventId,
    companySlug: row.companySlug,
    companyName: row.companyName,
    countryCode: trimOrNull(row.countryCode),
    city: row.city,
    roundType: row.roundType,
    roundLabel: row.roundLabel,
    amount: money(row.amountMinor, row.currency),
    amountGbpMinor: asMinor(row.amountGbpMinor),
    amountUsdMinor: asMinor(row.amountUsdMinor),
    announcedOn: row.announcedOn,
    leadInvestors: readInvestorRefs(row.leadInvestors),
    investorCount: asCount(row.investorCount),
    sourceCount: asCount(row.sourceCount),
    tags: readTagRefs(row.tags),
  };
}

export async function listFundingRounds(
  db: Db,
  filters: FundingFilters,
): Promise<Page<FundingRow>> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);
  const query = normalisedQuery(filters.q);
  const where = fundingWhere(filters, query);
  const order = fundingOrder(filters, query);

  const [counted, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(events)
      .innerJoin(companies, eq(companies.id, events.companyId))
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(where),
    db
      .select(fundingColumns())
      .from(events)
      .innerJoin(companies, eq(companies.id, events.companyId))
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return {
    items: rows.map((row) => toFundingRow(row)),
    total: asCount(counted[0]?.total),
    page,
    pageSize,
  };
}
