import { z } from "zod";
import {
  DEFAULT_NEAR_KM,
  FUNDING_SORTS,
  MOMENTUM_FILTERS,
  NEAR_RADII_KM,
  SORT_DIRECTIONS,
} from "@/core/read-models";
import type {
  FundingCriteria,
  FundingFilters,
  FundingSort,
  FundingView,
  MomentumFilter,
  NearRadiusKm,
  SortDirection,
} from "@/core/read-models";
import { ROUND_TYPES } from "@/core/enums";
import {
  COMPANY_SIZE_BANDS,
  companySizeBandFromSlug,
  companySizeBandSlug,
} from "@/core/registry";
import type { CompanySizeBand } from "@/core/registry";
import type { RoundType } from "@/core/enums";
import { isSector, SECTOR_LABELS, SECTORS } from "@/core/sectors";
import type { Sector } from "@/core/sectors";
import { findPlaceBySlug, matchUkCity } from "@/lib/geo/uk-places";
import { ukRegionBySlug } from "@/lib/geo/uk-regions";
import { formatDate, formatMoneyShort, formatRoundType } from "@/lib/format";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import { COUNTRY_REGIONS, REGIONS } from "@/lib/regions";
import { SIZE_BAND_RANGES, SIZE_BANDS, type SizeBand } from "@/lib/size-bands";
import type { Region } from "@/lib/regions";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_CITY_LENGTH = 80;
const MAX_CITIES = 10;

/**
 * Version of the criteria model and its canonical serialisation. Phase 4
 * stores it next to a saved search.
 *
 * - 1: Phase 1 parameters. Every round type was shown by default.
 * - 2: grants are excluded unless `round=grant` is selected (D44), and the
 *   targeting parameters `theme`, `sector`, `ukregion`, `city`, `near`, `km`
 *   and `momentum` were added. Serialisation became canonical.
 * - 3: Phase 3 added `evidence` (only `confirmed`) and `cosize` (company size
 *   bands, D60). Both default to "no filter", so version 2 URLs parse to the
 *   same criteria. The new keys come after the version 2 keys.
 */
export const FUNDING_CRITERIA_VERSION = 3;

const roundSchema = z.enum(ROUND_TYPES);
const sortSchema = z.enum(FUNDING_SORTS);
const directionSchema = z.enum(SORT_DIRECTIONS);
const regionSchema = z.enum(REGIONS);
const sizeBandSchema = z.enum(SIZE_BANDS);
const positiveIntSchema = z.coerce.number().int().positive();
const gbpMajorSchema = z.coerce.number().finite().nonnegative();
const querySchema = z.string().min(1).max(200);
const slugSchema = z.string().min(1).max(80);

/** Next.js `searchParams` or a `URLSearchParams` instance. */
export type FundingSearchParams =
  URLSearchParams | Record<string, string | string[] | undefined>;

function asStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function rawValues(params: FundingSearchParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  return asStrings(params[key]);
}

function readFirst(
  params: FundingSearchParams,
  key: string,
): string | undefined {
  for (const value of rawValues(params, key)) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function readMany(params: FundingSearchParams, key: string): string[] {
  return rawValues(params, key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function uniqueParsed<T extends string>(
  values: string[],
  parse: (value: string) => T | undefined,
): T[] | undefined {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const parsed = parse(value);
    if (parsed == null || seen.has(parsed)) continue;
    seen.add(parsed);
    result.push(parsed);
  }
  return result.length > 0 ? result : undefined;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText == null || monthText == null || dayText == null) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseRound(value: string): RoundType | undefined {
  const parsed = roundSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function parseSizeBand(value: string): SizeBand | undefined {
  const parsed = sizeBandSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

function parseRegion(value: string): Region | undefined {
  const canonical = REGIONS.find(
    (region) => region.toLowerCase() === value.trim().toLowerCase(),
  );
  if (!canonical) return undefined;
  const parsed = regionSchema.safeParse(canonical);
  return parsed.success ? parsed.data : undefined;
}

function parseCountry(value: string): string | undefined {
  const upper = value.trim().toUpperCase();
  const code = upper === "UK" ? "GB" : upper;
  const parsed = z
    .string()
    .regex(/^[A-Z]{2}$/)
    .safeParse(code);
  if (!parsed.success) return undefined;
  if (!(parsed.data in COUNTRY_REGIONS)) return undefined;
  return parsed.data;
}

function parseDate(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const parsed = z.string().refine(isCalendarDate).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseQuery(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const parsed = querySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseSlug(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const parsed = slugSchema.safeParse(value.toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

function parseCity(value: string): string | undefined {
  const city = value.trim().toLowerCase();
  if (city.length === 0 || city.length > MAX_CITY_LENGTH) return undefined;
  return city;
}

function parseUkRegionSlug(value: string): string | undefined {
  const slug = value.trim().toLowerCase();
  return ukRegionBySlug(slug) ? slug : undefined;
}

function parseSector(value: string): Sector | undefined {
  const sector = value.trim().toLowerCase();
  return isSector(sector) ? sector : undefined;
}

function parseThemeSlug(value: string): string | undefined {
  return parseSlug(value.trim());
}

/**
 * Resolves a place slug or a place name (any case) to a canonical slug.
 * Unknown and ambiguous names give undefined.
 */
function resolveNearSlug(value: string): string | undefined {
  const text = value.trim();
  const lower = text.toLowerCase();
  if (findPlaceBySlug(lower)) return lower;
  const match = matchUkCity(text);
  return match && "place" in match ? match.place.slug : undefined;
}

/**
 * The "near" text the visitor typed when it did not resolve to a UK place,
 * so the page can say so. Undefined when `near` is empty or resolved.
 */
export function unresolvedNearName(
  searchParams: FundingSearchParams,
): string | undefined {
  const near = readFirst(searchParams, "near");
  if (near == null || near.length > MAX_CITY_LENGTH) return undefined;
  return resolveNearSlug(near) ? undefined : near;
}

function parseNear(
  near: string | undefined,
  km: string | undefined,
): FundingCriteria["near"] {
  if (near == null) return undefined;
  const placeSlug = resolveNearSlug(near);
  if (!placeSlug) return undefined;
  const radius = km == null ? Number.NaN : Number(km);
  const known = NEAR_RADII_KM.find((value) => value === radius);
  return { placeSlug, km: known ?? DEFAULT_NEAR_KM };
}

function parseEvidence(value: string | undefined): "confirmed" | undefined {
  return value?.toLowerCase() === "confirmed" ? "confirmed" : undefined;
}

function parseCompanySize(value: string): CompanySizeBand | undefined {
  return companySizeBandFromSlug(value.trim().toLowerCase()) ?? undefined;
}

function parseMomentum(value: string | undefined): MomentumFilter | undefined {
  if (value == null) return undefined;
  const lower = value.toLowerCase();
  return MOMENTUM_FILTERS.find((momentum) => momentum === lower);
}

function parseSort(value: string | undefined): FundingSort | undefined {
  if (value == null) return undefined;
  const parsed = sortSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseDirection(value: string | undefined): SortDirection | undefined {
  if (value == null) return undefined;
  const parsed = directionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parsePage(value: string | undefined): number {
  if (value == null) return 1;
  const parsed = positiveIntSchema.safeParse(value);
  return parsed.success ? parsed.data : 1;
}

function parsePageSize(value: string | undefined): number {
  if (value == null) return DEFAULT_PAGE_SIZE;
  const parsed = positiveIntSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed.data, MAX_PAGE_SIZE);
}

/** GBP major units from the URL become integer pence. Invalid input is dropped. */
function parseGbpMinor(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = gbpMajorSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return toMinorUnits(parsed.data, "GBP");
}

function formatGbpMajor(amountMinor: number): string {
  const major = fromMinorUnits(amountMinor, "GBP");
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

/** Position in a fixed list, so multi values sort in domain order. */
function orderBy<T extends string>(
  order: readonly T[],
): (a: T, b: T) => number {
  return (a, b) => order.indexOf(a) - order.indexOf(b);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonical<T extends string>(
  values: readonly T[],
  compare: (a: T, b: T) => number,
): T[] {
  return [...new Set(values)].sort(compare);
}

/**
 * Validates the "what to match" URL params. Invalid values are dropped; `min`
 * and `max` are GBP converted to minor units. Multi values are de-duplicated
 * and put in canonical order, so a parse is always canonical. `km` is ignored
 * without a known `near`.
 */
export function parseFundingCriteria(
  searchParams: FundingSearchParams,
): FundingCriteria {
  const criteria: FundingCriteria = {};

  const q = parseQuery(readFirst(searchParams, "q"));
  if (q) criteria.q = q;

  const roundTypes = uniqueParsed(readMany(searchParams, "round"), parseRound);
  if (roundTypes) {
    criteria.roundTypes = canonical(roundTypes, orderBy(ROUND_TYPES));
  }

  const regions = uniqueParsed(readMany(searchParams, "region"), parseRegion);
  if (regions) criteria.regions = canonical(regions, orderBy(REGIONS));

  const countryCodes = uniqueParsed(
    readMany(searchParams, "country"),
    parseCountry,
  );
  if (countryCodes)
    criteria.countryCodes = canonical(countryCodes, compareText);

  const tag = parseSlug(readFirst(searchParams, "tag"));
  if (tag) criteria.tag = tag;

  const investorSlug = parseSlug(readFirst(searchParams, "investor"));
  if (investorSlug) criteria.investorSlug = investorSlug;

  const from = parseDate(readFirst(searchParams, "from"));
  if (from) criteria.from = from;

  const to = parseDate(readFirst(searchParams, "to"));
  if (to) criteria.to = to;

  const minGbpMinor = parseGbpMinor(readFirst(searchParams, "min"));
  if (minGbpMinor != null) criteria.minGbpMinor = minGbpMinor;

  const maxGbpMinor = parseGbpMinor(readFirst(searchParams, "max"));
  if (maxGbpMinor != null) criteria.maxGbpMinor = maxGbpMinor;

  const sizeBands = uniqueParsed(readMany(searchParams, "size"), parseSizeBand);
  if (sizeBands) criteria.sizeBands = canonical(sizeBands, orderBy(SIZE_BANDS));

  const themes = uniqueParsed(readMany(searchParams, "theme"), parseThemeSlug);
  if (themes) criteria.themes = canonical(themes, compareText);

  const sectors = uniqueParsed(readMany(searchParams, "sector"), parseSector);
  if (sectors) criteria.sectors = canonical(sectors, orderBy(SECTORS));

  const ukRegions = uniqueParsed(
    readMany(searchParams, "ukregion"),
    parseUkRegionSlug,
  );
  if (ukRegions) criteria.ukRegions = canonical(ukRegions, compareText);

  const cities = uniqueParsed(readMany(searchParams, "city"), parseCity);
  if (cities) {
    criteria.cities = canonical(cities.slice(0, MAX_CITIES), compareText);
  }

  const near = parseNear(
    readFirst(searchParams, "near"),
    readFirst(searchParams, "km"),
  );
  if (near) criteria.near = near;

  const momentum = parseMomentum(readFirst(searchParams, "momentum"));
  if (momentum) criteria.momentum = momentum;

  const evidence = parseEvidence(readFirst(searchParams, "evidence"));
  if (evidence) criteria.evidence = evidence;

  const companySizes = uniqueParsed(
    readMany(searchParams, "cosize"),
    parseCompanySize,
  );
  if (companySizes) {
    criteria.companySizes = canonical(
      companySizes,
      orderBy(COMPANY_SIZE_BANDS),
    );
  }

  return criteria;
}

/** Validates the "how to show it" URL params: sort, direction and paging. */
export function parseFundingView(
  searchParams: FundingSearchParams,
): FundingView {
  const view: FundingView = {
    page: parsePage(readFirst(searchParams, "page")),
    pageSize: parsePageSize(readFirst(searchParams, "pageSize")),
  };

  const sort = parseSort(readFirst(searchParams, "sort"));
  if (sort) view.sort = sort;

  const direction = parseDirection(readFirst(searchParams, "dir"));
  if (direction) view.direction = direction;

  return view;
}

/** Criteria and view together, so Phase 1 callers keep working. */
export function parseFundingFilters(
  searchParams: FundingSearchParams,
): FundingFilters {
  return {
    ...parseFundingCriteria(searchParams),
    ...parseFundingView(searchParams),
  };
}

function appendAll<T extends string>(
  params: URLSearchParams,
  key: string,
  values: readonly T[] | undefined,
  compare: (a: T, b: T) => number,
): void {
  for (const value of canonical(values ?? [], compare)) {
    params.append(key, value);
  }
}

function appendCriteria(
  params: URLSearchParams,
  criteria: FundingCriteria,
): void {
  if (criteria.q) params.set("q", criteria.q);
  appendAll(params, "round", criteria.roundTypes, orderBy(ROUND_TYPES));
  appendAll(params, "size", criteria.sizeBands, orderBy(SIZE_BANDS));
  if (criteria.minGbpMinor != null) {
    params.set("min", formatGbpMajor(criteria.minGbpMinor));
  }
  if (criteria.maxGbpMinor != null) {
    params.set("max", formatGbpMajor(criteria.maxGbpMinor));
  }
  if (criteria.from) params.set("from", criteria.from);
  if (criteria.to) params.set("to", criteria.to);
  appendAll(params, "region", criteria.regions, orderBy<string>(REGIONS));
  appendAll(params, "country", criteria.countryCodes, compareText);
  appendAll(params, "ukregion", criteria.ukRegions, compareText);
  appendAll(params, "city", criteria.cities, compareText);
  if (criteria.near) {
    params.set("near", criteria.near.placeSlug);
    if (criteria.near.km !== DEFAULT_NEAR_KM) {
      params.set("km", String(criteria.near.km satisfies NearRadiusKm));
    }
  }
  appendAll(params, "sector", criteria.sectors, orderBy(SECTORS));
  appendAll(params, "theme", criteria.themes, compareText);
  if (criteria.tag) params.set("tag", criteria.tag);
  if (criteria.investorSlug) params.set("investor", criteria.investorSlug);
  if (criteria.momentum) params.set("momentum", criteria.momentum);
  if (criteria.evidence === "confirmed") params.set("evidence", "confirmed");
  for (const band of canonical(
    criteria.companySizes ?? [],
    orderBy(COMPANY_SIZE_BANDS),
  )) {
    params.append("cosize", companySizeBandSlug(band));
  }
}

/**
 * The canonical query string for criteria, without a leading `?`. Keys are in
 * a fixed order, multi values are sorted and de-duplicated, and defaults
 * (`km=25`) are omitted. The same search always gives the same string.
 * Phase 4 keys saved searches and alerts on it.
 */
export function serialiseFundingCriteria(criteria: FundingCriteria): string {
  const params = new URLSearchParams();
  appendCriteria(params, criteria);
  return params.toString();
}

/** Query string without a leading `?`: criteria, then view. Defaults are omitted. */
export function serialiseFundingFilters(filters: FundingFilters): string {
  const params = new URLSearchParams();
  appendCriteria(params, filters);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.direction) params.set("dir", filters.direction);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(filters.pageSize));
  }
  return params.toString();
}

/**
 * The round types a query should match: the selected ones, or every type
 * except `grant` when none are selected (D44).
 */
export function effectiveRoundTypes(criteria: FundingCriteria): RoundType[] {
  const selected = criteria.roundTypes;
  if (selected && selected.length > 0) return [...selected];
  return ROUND_TYPES.filter((type) => type !== "grant");
}

// ---------------------------------------------------------------------------
// Filter bar helpers (task 078). Everything below is additive: it reads
// criteria, it never changes how a parameter parses.

/** A Stage preset in the filter bar, and the round types it selects. */
export interface StagePreset {
  value: string;
  label: string;
  roundTypes: readonly RoundType[];
}

/** The Stage segmented control (research section 2). Grants live in "More". */
export const STAGE_PRESETS: readonly StagePreset[] = [
  { value: "seed", label: "Pre-seed/Seed", roundTypes: ["pre_seed", "seed"] },
  { value: "series-a", label: "Series A", roundTypes: ["series_a"] },
  {
    value: "series-b-plus",
    label: "Series B+",
    roundTypes: ["series_b", "series_c", "series_d_plus", "growth"],
  },
  { value: "debt", label: "Debt", roundTypes: ["debt"] },
];

/** Every round type the default view shows (D44: all but grants). */
export const NON_GRANT_ROUND_TYPES: readonly RoundType[] = ROUND_TYPES.filter(
  (type) => type !== "grant",
);

export const DATE_PRESETS = ["7d", "30d", "90d", "year"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Readonly<Record<DatePreset, string>> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  year: "This year",
};

const PRESET_DAYS: Readonly<Record<Exclude<DatePreset, "year">, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** The `from` date a preset sets, for `today` as YYYY-MM-DD (UTC). */
export function datePresetFrom(preset: DatePreset, today: string): string {
  if (preset === "year") return `${today.slice(0, 4)}-01-01`;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - PRESET_DAYS[preset]);
  return date.toISOString().slice(0, 10);
}

/** The preset the criteria's dates match today, if any. */
export function matchDatePreset(
  criteria: FundingCriteria,
  today: string,
): DatePreset | undefined {
  if (!criteria.from || criteria.to) return undefined;
  return DATE_PRESETS.find(
    (preset) => datePresetFrom(preset, today) === criteria.from,
  );
}

/** Plain-word company size labels (research section 2). */
export const COMPANY_SIZE_FILTER_LABELS: Readonly<
  Record<CompanySizeBand, string>
> = {
  micro: "Tiny",
  small: "Small",
  medium: "Mid-size",
  full_accounts: "Large",
  dormant: "Dormant",
  no_accounts_yet: "Not yet filed",
};

/** Company sizes the bar offers. Dormant shows only when a link sets it. */
export const COMPANY_SIZE_FILTER_OPTIONS: readonly CompanySizeBand[] =
  COMPANY_SIZE_BANDS.filter((band) => band !== "dormant");

/** The renamed momentum filter (research section 2). */
export const MOMENTUM_FILTER_LABELS: Readonly<Record<MomentumFilter, string>> =
  {
    first: "First round",
    repeat: "Repeat raiser",
  };

const COUNTRY_DISPLAY = new Intl.DisplayNames(["en-GB"], { type: "region" });

/** "United States" for "US"; the code itself when the name is not known. */
export function countryName(code: string): string {
  try {
    return COUNTRY_DISPLAY.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country `country=` accepts, by name, for the place box. */
export function countryOptions(): Array<{ code: string; name: string }> {
  return Object.keys(COUNTRY_REGIONS)
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

function titleWords(text: string): string {
  return text
    .split(/([\s-]+)/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** A display name for a `city` value: the UK place name, else title case. */
export function cityLabel(city: string): string {
  const match = matchUkCity(city);
  if (match && "place" in match) return match.place.name;
  return titleWords(city);
}

/** A display name for a UK place slug (used by `near`). */
export function placeLabel(slug: string): string {
  return findPlaceBySlug(slug)?.name ?? titleWords(slug.replace(/-/g, " "));
}

/** One applied value, and the criteria once it is removed. */
export interface AppliedFilter {
  /** Stable and unique within one list, e.g. `sector:education`. */
  id: string;
  label: string;
  without: FundingCriteria;
}

export interface AppliedFilterNames {
  /** Theme slug to display name. */
  themes?: Readonly<Record<string, string>>;
  /** YYYY-MM-DD, so date presets show by name ("Last 30 days"). */
  today?: string;
}

function omit<K extends keyof FundingCriteria>(
  criteria: FundingCriteria,
  key: K,
): FundingCriteria {
  const next = { ...criteria };
  delete next[key];
  return next;
}

function withoutValue<K extends keyof FundingCriteria>(
  criteria: FundingCriteria,
  key: K,
  remove: readonly string[],
): FundingCriteria {
  const values = (criteria[key] as readonly string[] | undefined) ?? [];
  const kept = values.filter((value) => !remove.includes(value));
  if (kept.length === 0) return omit(criteria, key);
  return { ...criteria, [key]: kept };
}

/** Round type chips: whole Stage presets as one chip, the rest one each. */
function roundChips(criteria: FundingCriteria): AppliedFilter[] {
  const types = criteria.roundTypes ?? [];
  if (types.length === 0) return [];
  if (types.length === ROUND_TYPES.length) {
    return [
      {
        id: "round:all",
        label: "All rounds, including grants",
        without: omit(criteria, "roundTypes"),
      },
    ];
  }
  const chips: AppliedFilter[] = [];
  const covered = new Set<RoundType>();
  for (const preset of STAGE_PRESETS) {
    if (preset.roundTypes.length < 2) continue;
    if (!preset.roundTypes.every((type) => types.includes(type))) continue;
    preset.roundTypes.forEach((type) => covered.add(type));
    chips.push({
      id: `round:${preset.value}`,
      label: preset.label,
      without: withoutValue(criteria, "roundTypes", preset.roundTypes),
    });
  }
  for (const type of types) {
    if (covered.has(type)) continue;
    chips.push({
      id: `round:${type}`,
      label: type === "grant" ? "Grants" : formatRoundType(type),
      without: withoutValue(criteria, "roundTypes", [type]),
    });
  }
  return chips;
}

function dateChips(
  criteria: FundingCriteria,
  today: string | undefined,
): AppliedFilter[] {
  const preset = today ? matchDatePreset(criteria, today) : undefined;
  if (preset) {
    return [
      {
        id: `date:${preset}`,
        label: DATE_PRESET_LABELS[preset],
        without: omit(criteria, "from"),
      },
    ];
  }
  const chips: AppliedFilter[] = [];
  if (criteria.from) {
    chips.push({
      id: "from",
      label: `From ${formatDate(criteria.from)}`,
      without: omit(criteria, "from"),
    });
  }
  if (criteria.to) {
    chips.push({
      id: "to",
      label: `Until ${formatDate(criteria.to)}`,
      without: omit(criteria, "to"),
    });
  }
  return chips;
}

/**
 * Every applied value as a removable chip, in filter-bar order. Values with no
 * control of their own (`region`, `tag`) are included, so nothing filters the
 * list without showing. `q` is included too.
 */
export function describeAppliedFilters(
  criteria: FundingCriteria,
  names: AppliedFilterNames = {},
): AppliedFilter[] {
  const chips: AppliedFilter[] = [];
  const many = <K extends keyof FundingCriteria>(
    key: K,
    idPrefix: string,
    label: (value: string) => string,
  ) => {
    for (const value of (criteria[key] as readonly string[] | undefined) ??
      []) {
      chips.push({
        id: `${idPrefix}:${value}`,
        label: label(value),
        without: withoutValue(criteria, key, [value]),
      });
    }
  };

  if (criteria.q) {
    chips.push({
      id: "q",
      label: `Name: ${criteria.q}`,
      without: omit(criteria, "q"),
    });
  }
  many("sectors", "sector", (value) => SECTOR_LABELS[value as Sector]);
  many(
    "themes",
    "theme",
    (value) => names.themes?.[value] ?? titleWords(value.replace(/-/g, " ")),
  );
  chips.push(...roundChips(criteria));
  many(
    "sizeBands",
    "size",
    (value) => SIZE_BAND_RANGES[value as SizeBand].label,
  );
  if (criteria.minGbpMinor != null) {
    chips.push({
      id: "min",
      label: `At least ${formatMoneyShort(criteria.minGbpMinor, "GBP")}`,
      without: omit(criteria, "minGbpMinor"),
    });
  }
  if (criteria.maxGbpMinor != null) {
    chips.push({
      id: "max",
      label: `Up to ${formatMoneyShort(criteria.maxGbpMinor, "GBP")}`,
      without: omit(criteria, "maxGbpMinor"),
    });
  }
  chips.push(...dateChips(criteria, names.today));
  many(
    "ukRegions",
    "ukregion",
    (value) => ukRegionBySlug(value)?.name ?? value,
  );
  many("cities", "city", cityLabel);
  many("countryCodes", "country", countryName);
  many("regions", "region", (value) =>
    value === "Unknown" ? "Region not known" : value,
  );
  if (criteria.near) {
    chips.push({
      id: "near",
      label: `Within ${criteria.near.km} km of ${placeLabel(criteria.near.placeSlug)}`,
      without: omit(criteria, "near"),
    });
  }
  if (criteria.evidence === "confirmed") {
    chips.push({
      id: "evidence",
      label: "Confirmed only",
      without: omit(criteria, "evidence"),
    });
  }
  many(
    "companySizes",
    "cosize",
    (value) =>
      `Company size: ${COMPANY_SIZE_FILTER_LABELS[value as CompanySizeBand]}`,
  );
  if (criteria.momentum) {
    chips.push({
      id: "momentum",
      label: MOMENTUM_FILTER_LABELS[criteria.momentum],
      without: omit(criteria, "momentum"),
    });
  }
  if (criteria.investorSlug) {
    chips.push({
      id: "investor",
      label: `Investor: ${titleWords(criteria.investorSlug.replace(/-/g, " "))}`,
      without: omit(criteria, "investorSlug"),
    });
  }
  if (criteria.tag) {
    chips.push({
      id: "tag",
      label: `Tag: ${titleWords(criteria.tag.replace(/-/g, " "))}`,
      without: omit(criteria, "tag"),
    });
  }
  return chips;
}

/**
 * A link to `path` with these criteria and the sort, direction and page size
 * of `view`. Paging always restarts at page 1.
 */
export function fundingFiltersHref(
  criteria: FundingCriteria,
  view: Partial<FundingView> = {},
  path = "/",
): string {
  const query = serialiseFundingFilters({
    ...criteria,
    sort: view.sort,
    direction: view.direction,
    page: 1,
    pageSize: view.pageSize ?? DEFAULT_PAGE_SIZE,
  });
  return query ? `${path}?${query}` : path;
}
