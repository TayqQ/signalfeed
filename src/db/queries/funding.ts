import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { EvidenceLevel, RecordKind, RoundType } from "@/core/enums";
import { RECORD_KINDS, ROUND_TYPES } from "@/core/enums";
import type { Money } from "@/core/domain";
import type {
  EventConfirmation,
  FundingFilters,
  FundingRow,
  FundingSort,
  InvestorRef,
  Page,
  RoundMomentum,
  TagRef,
} from "@/core/read-models";
import type { CompanySizeBand } from "@/core/registry";
import { effectiveRoundTypes } from "@/lib/funding-filters";
import { boundingBox } from "@/lib/geo/distance";
import { findPlaceBySlug, normalisePlaceName } from "@/lib/geo/uk-places";
import { ukRegionBySlug } from "@/lib/geo/uk-regions";
import { normaliseCompanyName } from "@/lib/normalise";
import { confirmationText } from "@/lib/registry/confirmation-text";
import {
  knownAccountsTypes,
  sizeBandForAccounts,
} from "@/lib/registry/company-size";
import { countriesInRegion, REGIONS, type Region } from "@/lib/regions";
import { SIZE_BAND_RANGES, SIZE_BANDS } from "@/lib/size-bands";
import type { Db } from "../client";
import {
  chCompanies,
  companies,
  companyAliases,
  companyLocations,
  companySectors,
  companyTags,
  companyThemes,
  eventConfirmations,
  eventInvestors,
  events,
  formDFilings,
  fundingRoundMomentum,
  fundingRounds,
  investors,
  registryLinks,
  tags,
  themes,
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

const DIACRITICS_FROM =
  "àáâãäåāăąçćčďéèêëēęěìíîïīłñńňòóôõöøōőŕřśšşťùúûüūůűýÿźżž";
const DIACRITICS_TO =
  "aaaaaaaaaccc" + "deeeeeeeiiiiilnnn" + "oooooooo" + "rrsssttuuuuuuuyyzzz";
const EARTH_RADIUS_KM = 6371;

/**
 * SQL mirror of `normalisePlaceName`: lower case, no diacritics, words
 * separated by single spaces, and "st" written as "saint".
 */
function normalisedCitySql(column: SQL | typeof companies.city): SQL {
  const from = DIACRITICS_FROM + DIACRITICS_FROM.toUpperCase();
  const to = DIACRITICS_TO + DIACRITICS_TO.toUpperCase();
  return sql`regexp_replace(
    btrim(regexp_replace(
      lower(translate(
        replace(replace(replace(${column}, 'ß', 'ss'), 'æ', 'ae'), 'Æ', 'AE'),
        ${from}, ${to}
      )),
      '[^a-z0-9]+', ' ', 'g'
    )),
    '\\mst\\M', 'saint', 'g'
  )`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** `accounts_type` as `sizeBandForAccounts` reads it: trimmed, lower case, never null. */
const ACCOUNTS_KEY = sql`lower(btrim(coalesce(${chCompanies.accountsType}, '')))`;

/**
 * The company's size band, mapped in SQL from the table in `company-size.ts`,
 * so the two cannot drift. The lists come from `knownAccountsTypes()` grouped
 * by `sizeBandForAccounts`. A blank type is `no_accounts_yet` and an unknown
 * type is `full_accounts`, as in TypeScript. Companies with no linked
 * Companies House record never match.
 */
function companySizeCondition(bands: readonly CompanySizeBand[]): SQL {
  const known = knownAccountsTypes();
  const wanted = new Set(bands);
  const alternatives: SQL[] = [];
  for (const band of wanted) {
    const types = known.filter((type) => sizeBandForAccounts(type) === band);
    const inList: SQL | null =
      types.length > 0 ? sql`${ACCOUNTS_KEY} in ${types}` : null;
    if (band === "no_accounts_yet") {
      alternatives.push(
        inList
          ? sql`(${ACCOUNTS_KEY} = '' or ${inList})`
          : sql`${ACCOUNTS_KEY} = ''`,
      );
    } else if (band === "full_accounts") {
      const unknown = sql`(${ACCOUNTS_KEY} <> '' and ${ACCOUNTS_KEY} not in ${known})`;
      alternatives.push(inList ? sql`(${inList} or ${unknown})` : unknown);
    } else if (inList) {
      alternatives.push(inList);
    }
  }
  const any = or(...alternatives);
  if (!any) return sql`false`;
  return sql`exists (
    select 1
    from ${registryLinks}
    inner join ${chCompanies}
      on ${chCompanies.companyNumber} = ${registryLinks.registryId}
    where ${registryLinks.companyId} = ${companies.id}
      and ${registryLinks.registry} = 'companies_house'
      and ${registryLinks.status} = 'linked'
      and (${any})
  )`;
}

/** Theme and location filters, and momentum (spec sections 9.2 and 8.3). */
function targetingConditions(filters: FundingFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.themes && filters.themes.length > 0) {
    const slugs = uniqueStrings(filters.themes);
    if (slugs.length === 0) {
      conditions.push(sql`false`);
    } else {
      // Resolve merged slugs to their survivors in the same statement.
      conditions.push(sql`exists (
        select 1
        from ${companyThemes}
        where ${companyThemes.companyId} = ${companies.id}
          and ${companyThemes.themeId} in (
            with recursive chain(id, merged_into_id) as (
              select ${themes.id}, ${themes.mergedIntoId}
              from ${themes}
              where ${inArray(themes.slug, slugs)}
              union
              select t.id, t.merged_into_id
              from ${themes} as t
              inner join chain on t.id = chain.merged_into_id
            )
            select id from chain where merged_into_id is null
          )
      )`);
    }
  }

  if (filters.sectors && filters.sectors.length > 0) {
    // company_sectors or the theme join, so a sector filter never returns
    // fewer rows while company_sectors is still empty (spec-phase3 section 11).
    const sectors = [...filters.sectors];
    conditions.push(sql`(
      exists (
        select 1
        from ${companySectors}
        where ${companySectors.companyId} = ${companies.id}
          and ${inArray(companySectors.sector, sectors)}
      )
      or exists (
        select 1
        from ${companyThemes}
        inner join ${themes} on ${themes.id} = ${companyThemes.themeId}
        where ${companyThemes.companyId} = ${companies.id}
          and ${inArray(themes.sector, sectors)}
      )
    )`);
  }

  if (filters.companySizes && filters.companySizes.length > 0) {
    conditions.push(companySizeCondition(filters.companySizes));
  }

  if (filters.ukRegions && filters.ukRegions.length > 0) {
    const codes = uniqueStrings(
      filters.ukRegions.flatMap((slug) => {
        const region = ukRegionBySlug(slug);
        return region ? [region.code] : [];
      }),
    );
    conditions.push(
      codes.length === 0
        ? sql`false`
        : sql`exists (
            select 1
            from ${companyLocations}
            where ${companyLocations.companyId} = ${companies.id}
              and ${inArray(companyLocations.itl1Code, codes)}
          )`,
    );
  }

  if (filters.cities && filters.cities.length > 0) {
    const alternatives: SQL[] = [];
    for (const value of uniqueStrings(filters.cities)) {
      if (findPlaceBySlug(value)) {
        alternatives.push(sql`exists (
          select 1
          from ${companyLocations}
          where ${companyLocations.companyId} = ${companies.id}
            and ${companyLocations.placeSlug} = ${value}
        )`);
        continue;
      }
      const name = normalisePlaceName(value);
      if (name.length === 0) continue;
      alternatives.push(sql`${normalisedCitySql(companies.city)} = ${name}`);
    }
    const any = or(...alternatives);
    conditions.push(any ? sql`(${any})` : sql`false`);
  }

  if (filters.near) {
    const place = findPlaceBySlug(filters.near.placeSlug);
    const km = filters.near.km;
    if (!place || !Number.isFinite(km) || km < 0) {
      conditions.push(sql`false`);
    } else {
      const box = boundingBox({ lat: place.lat, lon: place.lon }, km);
      const lat = sql`${companyLocations.latitude}::float8`;
      const lon = sql`${companyLocations.longitude}::float8`;
      // Bounding box first, so the index narrows rows before the exact test.
      conditions.push(sql`exists (
        select 1
        from ${companyLocations}
        where ${companyLocations.companyId} = ${companies.id}
          and ${companyLocations.latitude} is not null
          and ${companyLocations.longitude} is not null
          and ${companyLocations.latitude} between ${box.minLat} and ${box.maxLat}
          and ${companyLocations.longitude} between ${box.minLon} and ${box.maxLon}
          and ${2 * EARTH_RADIUS_KM} * asin(least(1, sqrt(
            power(sin(radians(${lat} - ${place.lat}) / 2), 2)
            + cos(radians(${place.lat})) * cos(radians(${lat}))
              * power(sin(radians(${lon} - ${place.lon}) / 2), 2)
          ))) <= ${km}
      )`);
    }
  }

  if (filters.momentum === "first") {
    conditions.push(sql`exists (
      select 1
      from ${fundingRoundMomentum}
      where ${fundingRoundMomentum.eventId} = ${events.id}
        and ${fundingRoundMomentum.equityRoundNumber} = 1
    )`);
  } else if (filters.momentum === "repeat") {
    conditions.push(sql`exists (
      select 1
      from ${fundingRoundMomentum}
      where ${fundingRoundMomentum.eventId} = ${events.id}
        and ${fundingRoundMomentum.equityRoundNumber} > 1
        and ${fundingRoundMomentum.monthsSincePrevious} <= 24
    )`);
  }

  return conditions;
}

function momentumSql(): SQL<unknown> {
  return sql<unknown>`(
    select json_build_object(
      'equityRoundNumber', ${fundingRoundMomentum.equityRoundNumber},
      'monthsSincePrevious', ${fundingRoundMomentum.monthsSincePrevious},
      'stepUpRatio', ${fundingRoundMomentum.stepUpRatio},
      'stepUpBasisOn', case
        when ${fundingRoundMomentum.stepUpRatio} is null then null
        else (
          select basis.announced_on
          from ${events} as basis
          where basis.id = ${fundingRoundMomentum.stepUpBasisEventId}
        )
      end
    )
    from ${fundingRoundMomentum}
    where ${fundingRoundMomentum.eventId} = ${events.id}
  )`;
}

function fundingWhere(filters: FundingFilters, query: string | null): SQL {
  const conditions: SQL[] = [
    eq(events.type, "funding_round"),
    isNull(companies.mergedIntoId),
  ];

  if (query) conditions.push(textMatch(query));

  if (filters.evidence === "confirmed") {
    conditions.push(eq(events.evidence, "confirmed"));
  }

  // Grants are hidden unless `grant` is selected (D44).
  const rounds = effectiveRoundTypes(filters).filter(isRoundType);
  conditions.push(
    rounds.length === 0 ? sql`false` : inArray(fundingRounds.roundType, rounds),
  );

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
  if (filters.sizeBands && filters.sizeBands.length > 0) {
    const ranges = SIZE_BANDS.filter((band) =>
      filters.sizeBands?.includes(band),
    ).map((band) => {
      const { minGbpMinor, maxGbpMinor } = SIZE_BAND_RANGES[band];
      const lower = gte(fundingRounds.amountGbpMinor, minGbpMinor);
      return maxGbpMinor === null
        ? lower
        : and(lower, lt(fundingRounds.amountGbpMinor, maxGbpMinor));
    });
    // Rounds with no reported amount have no band, so they drop out here.
    conditions.push(
      ranges.length === 0 ? sql`false` : (or(...ranges) ?? sql`false`),
    );
  }

  conditions.push(...targetingConditions(filters));

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
  momentum: unknown;
  evidence: EvidenceLevel;
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
    momentum: momentumSql(),
    evidence: events.evidence,
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

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Equity rounds only; debt and grant rounds have no momentum row. */
export function readMomentum(value: unknown): RoundMomentum | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const item = parsed as Record<string, unknown>;
  const number = num(item.equityRoundNumber);
  if (number == null) return null;
  const basis = item.stepUpBasisOn;
  return {
    equityRoundNumber: number,
    monthsSincePrevious: num(item.monthsSincePrevious),
    stepUpRatio: num(item.stepUpRatio),
    stepUpBasisOn: typeof basis === "string" ? basis.slice(0, 10) : null,
  };
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
    momentum: readMomentum(row.momentum),
    evidence: row.evidence,
  };
}

/**
 * How many companies in these results have no coordinates, so a `near` filter
 * drops them. Counts the results as they would be without `near`.
 */
export async function countUnlocatedCompanies(
  db: Db,
  filters: FundingFilters,
): Promise<number> {
  const where = fundingWhere(
    { ...filters, near: undefined },
    normalisedQuery(filters.q),
  );
  const [counted] = await db
    .select({ total: sql<number>`count(distinct ${companies.id})::int` })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        where,
        sql`not exists (
          select 1
          from ${companyLocations}
          where ${companyLocations.companyId} = ${companies.id}
            and ${companyLocations.latitude} is not null
            and ${companyLocations.longitude} is not null
        )`,
      ),
    );
  return asCount(counted?.total);
}

// Confirmation markers (spec-phase3 section 9).

export interface ConfirmationTarget {
  eventId: number;
  /** The date the record is measured against. */
  announcedOn: string;
  evidence: EvidenceLevel;
  isGrant: boolean;
}

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

function kindRank(kind: RecordKind): number {
  return RECORD_KINDS.indexOf(kind);
}

/**
 * The confirmations of each event, closest first: record date nearest the
 * event's date, then record kind, then record id. Wording comes from
 * `confirmationText`, built here from the row's fields. A confirmed grant
 * event with no confirmation row gets a grant confirmation. Events with
 * nothing to show are left out of the map.
 */
export async function loadConfirmations(
  db: Db,
  targets: readonly ConfirmationTarget[],
): Promise<Map<number, EventConfirmation[]>> {
  const result = new Map<number, EventConfirmation[]>();
  if (targets.length === 0) return result;
  const byEvent = new Map(targets.map((target) => [target.eventId, target]));

  const rows = await db
    .select({
      eventId: eventConfirmations.eventId,
      kind: eventConfirmations.recordKind,
      recordId: eventConfirmations.recordId,
      recordDate: eventConfirmations.recordDate,
      confirmsAmount: eventConfirmations.confirmsAmount,
      soldUsdMinor: formDFilings.totalSoldUsdMinor,
    })
    .from(eventConfirmations)
    .leftJoin(
      formDFilings,
      and(
        eq(eventConfirmations.recordKind, "sec_form_d"),
        eq(formDFilings.id, eventConfirmations.recordId),
      ),
    )
    .where(inArray(eventConfirmations.eventId, [...byEvent.keys()]));

  const grouped = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.eventId);
    if (list) list.push(row);
    else grouped.set(row.eventId, [row]);
  }

  for (const target of targets) {
    const own = grouped.get(target.eventId) ?? [];
    const eventDay = dayNumber(target.announcedOn);
    own.sort(
      (a, b) =>
        Math.abs(dayNumber(a.recordDate) - eventDay) -
          Math.abs(dayNumber(b.recordDate) - eventDay) ||
        kindRank(a.kind) - kindRank(b.kind) ||
        a.recordId - b.recordId,
    );
    const list: EventConfirmation[] = own.map((row) => ({
      kind: row.kind,
      recordDate: row.recordDate.slice(0, 10),
      confirmsAmount: row.confirmsAmount,
      text: confirmationText({
        kind: row.kind,
        recordDate: row.recordDate.slice(0, 10),
        confirmsAmount: row.confirmsAmount,
        amountUsdMinor: row.kind === "sec_form_d" ? row.soldUsdMinor : null,
      }),
    }));
    if (
      list.length === 0 &&
      target.isGrant &&
      target.evidence === "confirmed"
    ) {
      const recordDate = target.announcedOn.slice(0, 10);
      list.push({
        kind: "ukri_grant",
        recordDate,
        confirmsAmount: true,
        text: confirmationText({
          kind: "ukri_grant",
          recordDate,
          confirmsAmount: true,
        }),
      });
    }
    if (list.length > 0) result.set(target.eventId, list);
  }
  return result;
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

  const confirmations = await loadConfirmations(
    db,
    rows.map((row) => ({
      eventId: row.eventId,
      announcedOn: row.announcedOn,
      evidence: row.evidence,
      isGrant: row.roundType === "grant",
    })),
  );

  return {
    items: rows.map((row) => ({
      ...toFundingRow(row),
      confirmation: confirmations.get(row.eventId)?.[0] ?? null,
    })),
    total: asCount(counted[0]?.total),
    page,
    pageSize,
  };
}
