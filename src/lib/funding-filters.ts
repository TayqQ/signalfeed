import { z } from "zod";
import { FUNDING_SORTS, SORT_DIRECTIONS } from "@/core/read-models";
import type {
  FundingFilters,
  FundingSort,
  SortDirection,
} from "@/core/read-models";
import { ROUND_TYPES } from "@/core/enums";
import type { RoundType } from "@/core/enums";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import { COUNTRY_REGIONS, REGIONS } from "@/lib/regions";
import type { Region } from "@/lib/regions";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const roundSchema = z.enum(ROUND_TYPES);
const sortSchema = z.enum(FUNDING_SORTS);
const directionSchema = z.enum(SORT_DIRECTIONS);
const regionSchema = z.enum(REGIONS);
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

/**
 * Validates URL search params for the funding table.
 * Invalid values are dropped; `min` and `max` are GBP converted to minor units.
 */
export function parseFundingFilters(
  searchParams: FundingSearchParams,
): FundingFilters {
  const filters: FundingFilters = {
    page: parsePage(readFirst(searchParams, "page")),
    pageSize: parsePageSize(readFirst(searchParams, "pageSize")),
  };

  const q = parseQuery(readFirst(searchParams, "q"));
  if (q) filters.q = q;

  const roundTypes = uniqueParsed(readMany(searchParams, "round"), parseRound);
  if (roundTypes) filters.roundTypes = roundTypes;

  const regions = uniqueParsed(readMany(searchParams, "region"), parseRegion);
  if (regions) filters.regions = regions;

  const countryCodes = uniqueParsed(
    readMany(searchParams, "country"),
    parseCountry,
  );
  if (countryCodes) filters.countryCodes = countryCodes;

  const tag = parseSlug(readFirst(searchParams, "tag"));
  if (tag) filters.tag = tag;

  const investorSlug = parseSlug(readFirst(searchParams, "investor"));
  if (investorSlug) filters.investorSlug = investorSlug;

  const from = parseDate(readFirst(searchParams, "from"));
  if (from) filters.from = from;

  const to = parseDate(readFirst(searchParams, "to"));
  if (to) filters.to = to;

  const minGbpMinor = parseGbpMinor(readFirst(searchParams, "min"));
  if (minGbpMinor != null) filters.minGbpMinor = minGbpMinor;

  const maxGbpMinor = parseGbpMinor(readFirst(searchParams, "max"));
  if (maxGbpMinor != null) filters.maxGbpMinor = maxGbpMinor;

  const sort = parseSort(readFirst(searchParams, "sort"));
  if (sort) filters.sort = sort;

  const direction = parseDirection(readFirst(searchParams, "dir"));
  if (direction) filters.direction = direction;

  return filters;
}

/** Query string without a leading `?`. Defaults (`page=1`, page size 25) are omitted. */
export function serialiseFundingFilters(filters: FundingFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const round of filters.roundTypes ?? []) params.append("round", round);
  for (const region of filters.regions ?? []) params.append("region", region);
  for (const country of filters.countryCodes ?? []) {
    params.append("country", country);
  }
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.investorSlug) params.set("investor", filters.investorSlug);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.minGbpMinor != null) {
    params.set("min", formatGbpMajor(filters.minGbpMinor));
  }
  if (filters.maxGbpMinor != null) {
    params.set("max", formatGbpMajor(filters.maxGbpMinor));
  }
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.direction) params.set("dir", filters.direction);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(filters.pageSize));
  }
  return params.toString();
}
