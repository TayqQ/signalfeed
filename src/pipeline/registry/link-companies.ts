// Links companies to Companies House (spec-phase3 section 7.2, D53, D61).
// The decision is `decideChLink` from `link-rules.ts`, applied as it stands:
// this file only gathers the facts, makes the requests the rules ask for, and
// writes the outcome through `link-store.ts`.

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import type { RegistryStats } from "@/core/domain";
import type { RegistrySearchOutcome } from "@/core/enums";
import { upgradeExtraction } from "@/core/extraction-schema";
import {
  normaliseCompanyNumber,
  type RegistryCompanyFacts,
} from "@/core/registry";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  companyLocations,
  eventSources,
  events,
  extractions,
  fundingRounds,
  grantParticipants,
  registryLinks,
} from "@/db/schema";
import { addMergeCandidate } from "@/pipeline/resolve/merge-candidates";
import { ChApiError, RateLimitedError, type ChClient } from "./ch-client";
import type { ConfirmableEvent } from "./confirm-rules";
import {
  TAKEN_MERGE_REASONS,
  recordCandidate,
  recordLink,
  recordSearch,
  searchIsDue,
} from "./link-store";
import {
  MAX_PREFIX_CANDIDATES,
  chConflicts,
  decideChLink,
  registryNameMatchDetail,
  registryNormalise,
  usableNames,
  type ChLinkCandidate,
  type ChLinkCompany,
  type ChLinkResult,
  type LinkLocation,
} from "./link-rules";
import {
  chHints,
  chSearchNote,
  chSearchTier,
  hintsApply,
  isUkPlaceText,
  searchedOnHintsOnly,
  sourceSlugsFor,
  type ChSearchReason,
} from "./search-hints";
import { freshAddressCount, isSharedAddress } from "./shared-address";
import {
  fillFoundedYear,
  storeChCompany,
  storeChFilings,
} from "./store-registry";

/** The company name and at most this many aliases are searched. */
export const MAX_SEARCH_ALIASES = 2;
/** Capital filings are read from this many years before the earliest event. */
export const FILINGS_YEARS_BEFORE = 3;

const REGISTRY = "companies_house" as const;
const ID_CHUNK = 500;
const MAX_MERGE_DEPTH = 32;

// ---------------------------------------------------------------------------
// Request limit

/** Thrown when the next request would go over the run's request limit. */
export class RequestLimitReached extends Error {
  constructor() {
    super("Companies House request limit for this run reached");
    this.name = "RequestLimitReached";
  }
}

/** Counts requests through the client, shared by linking and refreshing. */
export class RequestBudget {
  private readonly start: number;

  constructor(
    private readonly client: Pick<ChClient, "requestsMade">,
    readonly max: number,
  ) {
    this.start = client.requestsMade();
  }

  used(): number {
    return this.client.requestsMade() - this.start;
  }

  remaining(): number {
    return Math.max(0, this.max - this.used());
  }

  /** Throws `RequestLimitReached` when fewer than `n` requests are left. */
  require(n = 1): void {
    if (this.remaining() < n) throw new RequestLimitReached();
  }
}

export function emptyRegistryStats(): RegistryStats {
  return {
    companiesSearched: 0,
    linkedByMethod: {},
    candidates: 0,
    none: 0,
    companiesSkipped: 0,
    profilesFetched: 0,
    profilesRefreshed: 0,
    filingsStored: 0,
    addressChecks: 0,
    requests: 0,
    rateLimited: false,
    stoppedAtLimit: false,
  };
}

/**
 * Sets the stop flags for the two errors that end the step. Returns false for
 * any other error, which the caller rethrows.
 */
export function markStopped(stats: RegistryStats, error: unknown): boolean {
  if (error instanceof RateLimitedError) {
    stats.rateLimited = true;
    return true;
  }
  if (error instanceof RequestLimitReached) {
    stats.stoppedAtLimit = true;
    return true;
  }
  return false;
}

/** A log-safe description: never the key, a URL or a postcode. */
export function describeError(error: unknown): string {
  if (error instanceof ChApiError) return error.message;
  return error instanceof Error ? error.name : "unknown error";
}

/** Errors that would repeat for every company, so the step must stop. */
export function isFatal(error: unknown): boolean {
  return (
    error instanceof ChApiError &&
    (error.status === 401 || error.status === 403)
  );
}

// ---------------------------------------------------------------------------
// Company facts

export interface CompanyLinkFacts {
  companyId: number;
  /** Raw names for searching: the company name first, then aliases. */
  searchNames: string[];
  company: ChLinkCompany;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Builds the link rules' view of each company from the database. Aliases the
 * registry added are left out, so a demoted link cannot match on its own name.
 * A founded year from a registry is left out: the rules compare news years.
 * A location from the registered office is left out for the same reason.
 */
export async function loadCompanyLinkFacts(
  db: Db,
  companyIds: readonly number[],
): Promise<Map<number, CompanyLinkFacts>> {
  const out = new Map<number, CompanyLinkFacts>();
  for (const ids of chunks([...new Set(companyIds)], ID_CHUNK)) {
    if (ids.length === 0) continue;
    const [base, aliases, eventRows, locations, participants, rejected] =
      await Promise.all([
        db
          .select({
            id: companies.id,
            name: companies.name,
            countryCode: companies.countryCode,
            foundedYear: companies.foundedYear,
            foundedYearSource: companies.foundedYearSource,
            ukCompanyNumber: companies.ukCompanyNumber,
          })
          .from(companies)
          .where(inArray(companies.id, ids)),
        db
          .select({
            companyId: companyAliases.companyId,
            alias: companyAliases.alias,
          })
          .from(companyAliases)
          .where(
            and(
              inArray(companyAliases.companyId, ids),
              ne(companyAliases.source, "registry"),
            ),
          )
          .orderBy(asc(companyAliases.id)),
        db
          .select({
            companyId: events.companyId,
            id: events.id,
            type: events.type,
            announcedOn: events.announcedOn,
            datePrecision: events.datePrecision,
            roundType: fundingRounds.roundType,
            amountUsdMinor: fundingRounds.amountUsdMinor,
          })
          .from(events)
          .leftJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
          .where(inArray(events.companyId, ids))
          .orderBy(asc(events.announcedOn), asc(events.id)),
        db
          .select()
          .from(companyLocations)
          .where(inArray(companyLocations.companyId, ids)),
        db
          .select({
            companyId: grantParticipants.companyId,
            postcode: grantParticipants.postcode,
            regNumber: grantParticipants.regNumber,
          })
          .from(grantParticipants)
          .where(inArray(grantParticipants.companyId, ids))
          .orderBy(asc(grantParticipants.id)),
        db
          .select({
            companyId: registryLinks.companyId,
            registryId: registryLinks.registryId,
          })
          .from(registryLinks)
          .where(
            and(
              inArray(registryLinks.companyId, ids),
              eq(registryLinks.registry, REGISTRY),
              eq(registryLinks.status, "rejected"),
            ),
          ),
      ]);

    const aliasesBy = new Map<number, string[]>();
    for (const row of aliases) pushTo(aliasesBy, row.companyId, row.alias);
    const eventsBy = new Map<number, ConfirmableEvent[]>();
    for (const row of eventRows) {
      pushTo(eventsBy, row.companyId, {
        id: row.id,
        type: row.type,
        roundType: row.roundType ?? null,
        announcedOn: row.announcedOn,
        datePrecision: row.datePrecision,
        amountUsdMinor: row.amountUsdMinor ?? null,
      });
    }
    const locationBy = new Map<number, LinkLocation>();
    for (const row of locations) {
      if (row.source === "registered_office") continue;
      if (row.precision === "region") continue;
      const label = row.placeSlug ?? row.outcode;
      if (label === null) continue;
      locationBy.set(row.companyId, {
        label,
        lat: row.latitude,
        lon: row.longitude,
        outcode: row.outcode,
      });
    }
    const postcodesBy = new Map<number, string[]>();
    const regNumbersBy = new Map<number, string[]>();
    for (const row of participants) {
      if (row.companyId === null) continue;
      if (row.postcode) {
        const list = postcodesBy.get(row.companyId) ?? [];
        if (!list.includes(row.postcode)) list.push(row.postcode);
        postcodesBy.set(row.companyId, list);
      }
      const number = normaliseCompanyNumber(row.regNumber);
      if (number !== null) pushTo(regNumbersBy, row.companyId, number);
    }
    const rejectedBy = new Map<number, string[]>();
    for (const row of rejected) {
      pushTo(rejectedBy, row.companyId, row.registryId);
    }

    for (const row of base) {
      const names = [row.name, ...(aliasesBy.get(row.id) ?? [])];
      const searchNames: string[] = [];
      const seen = new Set<string>();
      for (const name of names) {
        const key = registryNormalise(name);
        if (usableNames([name]).length === 0 || seen.has(key)) continue;
        seen.add(key);
        searchNames.push(name);
      }
      // A number we trust comes from a grant record: the one the company
      // column holds when a grant gives it, else the first a grant gives.
      const grantNumbers = regNumbersBy.get(row.id) ?? [];
      const column = normaliseCompanyNumber(row.ukCompanyNumber);
      const grantCompanyNumber =
        column !== null && grantNumbers.includes(column)
          ? column
          : (grantNumbers[0] ?? null);
      const newsYear =
        row.foundedYearSource === "companies_house" ||
        row.foundedYearSource === "sec_form_d"
          ? null
          : row.foundedYear;
      out.set(row.id, {
        companyId: row.id,
        searchNames: searchNames.slice(0, 1 + MAX_SEARCH_ALIASES),
        company: {
          names,
          countryCode: row.countryCode,
          foundedYear: newsYear,
          events: eventsBy.get(row.id) ?? [],
          location: locationBy.get(row.id) ?? null,
          grantPostcodes: postcodesBy.get(row.id) ?? [],
          grantCompanyNumber,
          rejectedNumbers: rejectedBy.get(row.id) ?? [],
        },
      });
    }
  }
  return out;
}

/**
 * A hash of the names and events a search uses, plus the other facts the rules
 * read. Manual rejections are left out: they never make a search due.
 */
export function chLinkFingerprint(company: ChLinkCompany): string {
  const input = {
    names: company.names.map(registryNormalise),
    countryCode: company.countryCode,
    foundedYear: company.foundedYear,
    events: company.events.map((e) => [
      e.id,
      e.type,
      e.roundType,
      e.announcedOn,
      e.datePrecision,
      e.amountUsdMinor,
    ]),
    location: company.location
      ? [
          company.location.label,
          company.location.outcode ?? null,
          company.location.lat ?? null,
          company.location.lon ?? null,
        ]
      : null,
    grantPostcodes: [...company.grantPostcodes].sort(),
    grantCompanyNumber: company.grantCompanyNumber,
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** `since` for capital filings: three years before the earliest event. */
export function filingsSince(
  events: readonly ConfirmableEvent[],
): string | undefined {
  const earliest = events
    .map((e) => e.announcedOn)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()[0];
  if (earliest === undefined) return undefined;
  const year = Number(earliest.slice(0, 4)) - FILINGS_YEARS_BEFORE;
  return `${String(year).padStart(4, "0")}${earliest.slice(4)}`;
}

/** A company due for a Companies House search, and why. */
export interface EligibleCompany {
  id: number;
  /** Evidence and hints that put the company in the queue (D62). */
  reasons: ChSearchReason[];
  tier: number;
  latestEvent: string | null;
}

/**
 * Towns and regions that current extractions give for the companies' events,
 * by company. Read only for companies with no country, to find UK places.
 */
async function extractedPlaces(
  db: Db,
  companyIds: readonly number[],
): Promise<Map<number, { cities: string[]; regions: string[] }>> {
  const out = new Map<number, { cities: string[]; regions: string[] }>();
  for (const ids of chunks(companyIds, ID_CHUNK)) {
    if (ids.length === 0) continue;
    const rows = await db
      .select({
        companyId: events.companyId,
        eventIndex: eventSources.eventIndex,
        result: extractions.result,
      })
      .from(eventSources)
      .innerJoin(events, eq(events.id, eventSources.eventId))
      .innerJoin(extractions, eq(extractions.id, eventSources.extractionId))
      .where(
        and(eq(extractions.isCurrent, true), inArray(events.companyId, ids)),
      );
    for (const row of rows) {
      const company = upgradeExtraction(row.result).events[row.eventIndex]
        ?.company;
      if (!company) continue;
      const places = out.get(row.companyId) ?? { cities: [], regions: [] };
      if (company.city) places.cities.push(company.city);
      if (company.regionText) places.regions.push(company.regionText);
      out.set(row.companyId, places);
    }
  }
  return out;
}

/**
 * Companies to search, in order (spec-phase3 section 7.2, D62): not merged,
 * not linked yet, and either with evidence (GB, a grant participant, a UK
 * location row) or, when the country is null or GB, with a hint: a GBP
 * round, a report from a UK-only source, or a UK town or region in the
 * extractions. A known country other than GB never takes a hint. The queue
 * runs by tier (`chSearchTier`), then newest event first.
 */
export async function eligibleCompanies(db: Db): Promise<EligibleCompany[]> {
  const ukSlugs = sourceSlugsFor("GB");
  // Written with table names: in a single-table select Drizzle leaves column
  // names unqualified, which the subqueries would read as their own columns.
  const hasGrant = sql<boolean>`exists (select 1 from grant_participants gp where gp.company_id = companies.id)`;
  const ukLocation = sql<boolean>`exists (select 1 from company_locations cl where cl.company_id = companies.id and cl.country_code = 'GB')`;
  const gbpRound = sql<boolean>`exists (select 1 from funding_rounds fr inner join events e on e.id = fr.event_id where e.company_id = companies.id and fr.currency = 'GBP')`;
  const ukSource =
    ukSlugs.length === 0
      ? sql<boolean>`false`
      : sql<boolean>`exists (select 1 from event_sources es inner join events e on e.id = es.event_id inner join source_items si on si.id = es.source_item_id inner join sources s on s.id = si.source_id where e.company_id = companies.id and s.slug in (${sql.join(
          ukSlugs.map((slug) => sql`${slug}`),
          sql`, `,
        )}))`;
  const linked = sql`exists (select 1 from registry_links rl where rl.company_id = companies.id and rl.registry = ${REGISTRY} and rl.status = 'linked')`;
  const latestEvent = sql<
    string | null
  >`(select max(e.announced_on)::text from events e where e.company_id = companies.id)`;
  const rows = await db
    .select({
      id: companies.id,
      countryCode: companies.countryCode,
      city: companies.city,
      ukCompanyNumber: companies.ukCompanyNumber,
      hasGrant,
      ukLocation,
      gbpRound,
      ukSource,
      latestEvent,
    })
    .from(companies)
    .where(
      and(
        isNull(companies.mergedIntoId),
        or(
          isNull(companies.countryCode),
          eq(companies.countryCode, "GB"),
          hasGrant,
          ukLocation,
        ),
        not(linked),
      ),
    );

  const unknownCountry = rows
    .filter((row) => row.countryCode === null)
    .map((row) => row.id);
  const places = await extractedPlaces(db, unknownCountry);

  const out: EligibleCompany[] = [];
  for (const row of rows) {
    const reasons: ChSearchReason[] = [];
    if (row.hasGrant && row.ukCompanyNumber !== null) {
      reasons.push("grant_number");
    }
    if (row.hasGrant) reasons.push("grant");
    if (row.countryCode?.toUpperCase() === "GB") reasons.push("country_gb");
    if (row.ukLocation) reasons.push("uk_location");
    if (hintsApply(row.countryCode)) {
      if (row.gbpRound) reasons.push("gbp");
      if (row.ukSource) reasons.push("uk_source");
      const extracted = places.get(row.id);
      if (
        row.countryCode === null &&
        (isUkPlaceText(row.city, "city") ||
          extracted?.cities.some((city) => isUkPlaceText(city, "city")) ||
          extracted?.regions.some((text) => isUkPlaceText(text, "region")))
      ) {
        reasons.push("uk_place");
      }
    }
    const tier = chSearchTier(reasons);
    if (tier === null) continue;
    out.push({ id: row.id, reasons, tier, latestEvent: row.latestEvent });
  }
  return out.sort(
    (a, b) =>
      a.tier - b.tier ||
      (b.latestEvent ?? "").localeCompare(a.latestEvent ?? "") ||
      a.id - b.id,
  );
}

/** The ids of `eligibleCompanies`, in queue order. */
export async function eligibleCompanyIds(db: Db): Promise<number[]> {
  return (await eligibleCompanies(db)).map((company) => company.id);
}

/** Numbers `linked` in Companies House, with the company holding each. */
async function linkedHolders(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({
      registryId: registryLinks.registryId,
      companyId: registryLinks.companyId,
    })
    .from(registryLinks)
    .where(
      and(
        eq(registryLinks.registry, REGISTRY),
        eq(registryLinks.status, "linked"),
      ),
    );
  return new Map(rows.map((row) => [row.registryId, row.companyId]));
}

async function survivorOf(db: Db, companyId: number): Promise<number> {
  let id = companyId;
  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
    const [row] = await db
      .select({ mergedIntoId: companies.mergedIntoId })
      .from(companies)
      .where(eq(companies.id, id));
    if (!row || row.mergedIntoId === null) return id;
    id = row.mergedIntoId;
  }
  return id;
}

// ---------------------------------------------------------------------------
// One company

interface LinkContext {
  db: Db;
  client: ChClient;
  now: Date;
  budget: RequestBudget;
  stats: RegistryStats;
  /** Numbers linked in Companies House, kept current through the run. */
  holders: Map<string, number>;
  /** Why each company was searched, when only hints put it in the queue (D62). */
  searchNotes: Map<number, string>;
}

async function fetchProfile(
  ctx: LinkContext,
  number: string,
): Promise<RegistryCompanyFacts | null> {
  ctx.budget.require(1);
  const profile = await ctx.client.getCompany(number);
  if (profile === null) return null;
  await storeChCompany(ctx.db, profile, ctx.now);
  ctx.stats.profilesFetched += 1;
  return profile;
}

/** Marks a candidate's office postcode as shared, so S1 and S2 treat it as such. */
async function markShared(
  ctx: LinkContext,
  company: ChLinkCompany,
  candidate: ChLinkCandidate,
): Promise<void> {
  const postcode = candidate.profile.officePostcode;
  if (postcode === null) return;
  // Only S1 by district and S2 read the flag; skip the request otherwise.
  if (company.location === null && company.grantPostcodes.length === 0) return;
  if (chConflicts(company, candidate.profile).length > 0) return;
  if ((await freshAddressCount(ctx.db, postcode, ctx.now)) === null) {
    ctx.budget.require(1);
  }
  ctx.stats.addressChecks += 1;
  candidate.officePostcodeShared = await isSharedAddress(
    ctx.db,
    ctx.client,
    postcode,
    ctx.now,
  );
}

function decide(
  facts: CompanyLinkFacts,
  candidates: ChLinkCandidate[],
  holders: Map<string, number>,
): ChLinkResult {
  const linkedToOthers = candidates
    .map((c) => c.profile.companyNumber)
    .filter((number) => {
      const holder = holders.get(number);
      return holder !== undefined && holder !== facts.companyId;
    });
  return decideChLink({ company: facts.company, candidates, linkedToOthers });
}

/** Fetches the capital filings the rules ask for, then decides again. */
async function decideWithFilings(
  ctx: LinkContext,
  facts: CompanyLinkFacts,
  candidates: ChLinkCandidate[],
): Promise<ChLinkResult> {
  let result = decide(facts, candidates, ctx.holders);
  const since = filingsSince(facts.company.events);
  for (let round = 0; round < 2 && result.needsFilings.length > 0; round += 1) {
    for (const number of result.needsFilings) {
      const candidate = candidates.find(
        (c) => c.profile.companyNumber === number,
      );
      if (!candidate || candidate.filings !== null) continue;
      ctx.budget.require(1);
      const filings = await ctx.client.getCapitalFilings(
        number,
        since === undefined ? {} : { since },
      );
      ctx.stats.filingsStored += await storeChFilings(
        ctx.db,
        number,
        filings,
        ctx.now,
      );
      candidate.filings = filings;
    }
    result = decide(facts, candidates, ctx.holders);
  }
  return result;
}

/** Writes the decision through the link store. Returns the search outcome. */
async function applyResult(
  ctx: LinkContext,
  facts: CompanyLinkFacts,
  candidates: ChLinkCandidate[],
  result: ChLinkResult,
): Promise<RegistrySearchOutcome> {
  const { db, now, stats } = ctx;
  const byNumber = new Map(
    candidates.map((c) => [c.profile.companyNumber, c.profile]),
  );
  let outcome = result.outcome;
  const note = ctx.searchNotes.get(facts.companyId);
  const withNote = (reason: string) =>
    note === undefined ? reason : `${reason}; ${note}`;

  for (const decision of result.decisions) {
    const profile = byNumber.get(decision.registryId);
    if (!profile) continue;
    if (decision.outcome === "linked") {
      const linked = await recordLink(db, {
        companyId: facts.companyId,
        registry: REGISTRY,
        registryId: decision.registryId,
        registryName: profile.name,
        method: decision.method,
        reason: withNote(decision.reason),
        decidedBy: "auto",
        now,
      });
      if (linked.outcome === "linked") {
        ctx.holders.set(decision.registryId, linked.companyId);
        stats.linkedByMethod[decision.method] =
          (stats.linkedByMethod[decision.method] ?? 0) + 1;
        await fillFoundedYear(db, linked.companyId, profile.incorporatedOn);
      } else if (linked.outcome === "blocked") {
        outcome = "none";
      } else {
        // The store recorded a candidate (and a merge candidate when taken).
        stats.candidates += 1;
        outcome = "candidates";
      }
    } else if (decision.outcome === "candidate") {
      const inserted = await recordCandidate(db, {
        companyId: facts.companyId,
        registry: REGISTRY,
        registryId: decision.registryId,
        registryName: profile.name,
        reason: withNote(decision.reason),
        now,
      });
      if (inserted) stats.candidates += 1;
    }
  }

  for (const merge of result.mergeCandidates) {
    const holder = ctx.holders.get(merge.registryId);
    if (holder === undefined) continue;
    const right = await survivorOf(db, holder);
    if (right === facts.companyId) continue;
    await addMergeCandidate(db, {
      entityType: "company",
      leftId: facts.companyId,
      rightId: right,
      score: 1,
      reason: TAKEN_MERGE_REASONS[REGISTRY],
    });
  }
  return outcome;
}

/** Searches, decides and records one company. Throws the stop errors. */
async function linkOne(
  ctx: LinkContext,
  facts: CompanyLinkFacts,
  fingerprint: string,
): Promise<void> {
  const { company } = facts;
  if (facts.searchNames.length === 0) {
    await recordSearch(ctx.db, {
      companyId: facts.companyId,
      registry: REGISTRY,
      outcome: "skipped",
      inputFingerprint: fingerprint,
      now: ctx.now,
    });
    ctx.stats.companiesSkipped += 1;
    return;
  }

  const rejected = new Set(company.rejectedNumbers);
  const candidates: ChLinkCandidate[] = [];
  const fetched = new Set<string>();

  // Step 0: a number from a grant record. When it links, nothing else is asked.
  const grantNumber = normaliseCompanyNumber(company.grantCompanyNumber);
  if (grantNumber !== null && !rejected.has(grantNumber)) {
    fetched.add(grantNumber);
    const profile = await fetchProfile(ctx, grantNumber);
    if (profile !== null) {
      const candidate = { profile, filings: null, officePostcodeShared: false };
      candidates.push(candidate);
      const early = decide(facts, candidates, ctx.holders);
      if (early.outcome === "linked") {
        const outcome = await applyResult(ctx, facts, candidates, early);
        await finishSearch(ctx, facts, fingerprint, outcome);
        return;
      }
    }
  }

  // Step 1: search the name and up to two aliases; keep exact and prefix matches.
  let prefixFetched = 0;
  for (const name of facts.searchNames) {
    ctx.budget.require(1);
    const hits = await ctx.client.searchCompanies(name);
    for (const hit of hits) {
      if (fetched.has(hit.companyNumber) || rejected.has(hit.companyNumber)) {
        continue;
      }
      const match = registryNameMatchDetail(company.names, hit.name).match;
      if (match === "none") continue;
      if (match === "prefix") {
        if (prefixFetched >= MAX_PREFIX_CANDIDATES) continue;
        prefixFetched += 1;
      }
      fetched.add(hit.companyNumber);
      const profile = await fetchProfile(ctx, hit.companyNumber);
      if (profile === null) continue;
      candidates.push({ profile, filings: null, officePostcodeShared: false });
    }
  }

  for (const candidate of candidates) {
    await markShared(ctx, company, candidate);
  }

  const result = await decideWithFilings(ctx, facts, candidates);
  const outcome = await applyResult(ctx, facts, candidates, result);
  await finishSearch(ctx, facts, fingerprint, outcome);
}

async function finishSearch(
  ctx: LinkContext,
  facts: CompanyLinkFacts,
  fingerprint: string,
  outcome: RegistrySearchOutcome,
): Promise<void> {
  await recordSearch(ctx.db, {
    companyId: facts.companyId,
    registry: REGISTRY,
    outcome,
    inputFingerprint: fingerprint,
    now: ctx.now,
  });
  ctx.stats.companiesSearched += 1;
  if (outcome === "none") ctx.stats.none += 1;
}

// ---------------------------------------------------------------------------
// The linking pass

export interface LinkCompaniesOptions {
  db: Db;
  client: ChClient;
  now: Date;
  maxRequests: number;
  /** Shared with the refresh pass. Made from `maxRequests` when missing. */
  budget?: RequestBudget;
  /** Added to in place. A new one when missing. */
  stats?: RegistryStats;
  log?: (message: string) => void;
}

/**
 * Links due companies to Companies House, within the request limit. Stops
 * before the limit would be passed, or at a rate limit, leaving the rest due
 * for the next run. A company stopped part way is not recorded as searched.
 */
export async function linkCompanies(
  options: LinkCompaniesOptions,
): Promise<RegistryStats> {
  const { db, client, now } = options;
  const stats = options.stats ?? emptyRegistryStats();
  const budget =
    options.budget ?? new RequestBudget(client, options.maxRequests);
  const log = options.log ?? (() => undefined);
  const startUsed = budget.used();
  const ctx: LinkContext = {
    db,
    client,
    now,
    budget,
    stats,
    holders: await linkedHolders(db),
    searchNotes: new Map(),
  };
  const hintCounts = new Map<string, number>();
  let hintOnly = 0;

  try {
    const queue = await eligibleCompanies(db);
    const reasonsById = new Map(queue.map((c) => [c.id, c.reasons]));
    for (const company of queue) {
      const note = chSearchNote(company.reasons);
      if (note !== null) ctx.searchNotes.set(company.id, note);
    }
    const ids = queue.map((company) => company.id);
    for (const batch of chunks(ids, ID_CHUNK)) {
      const factsById = await loadCompanyLinkFacts(db, batch);
      for (const id of batch) {
        const facts = factsById.get(id);
        if (!facts) continue;
        const fingerprint = chLinkFingerprint(facts.company);
        if (!(await searchIsDue(db, id, REGISTRY, fingerprint, now))) continue;
        if (budget.remaining() === 0 && facts.searchNames.length > 0) {
          throw new RequestLimitReached();
        }
        try {
          await linkOne(ctx, facts, fingerprint);
          const reasons = reasonsById.get(id) ?? [];
          if (searchedOnHintsOnly(reasons)) {
            hintOnly += 1;
            for (const hint of chHints(reasons)) {
              hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
            }
          }
        } catch (error) {
          if (
            error instanceof RateLimitedError ||
            error instanceof RequestLimitReached ||
            isFatal(error)
          ) {
            throw error;
          }
          // Left due, so the next run tries again.
          log(`registry: company ${id} not linked: ${describeError(error)}`);
        }
      }
    }
  } catch (error) {
    if (!markStopped(stats, error)) throw error;
  }
  if (hintOnly > 0) {
    const counts = [...hintCounts].map(([hint, n]) => `${hint} ${n}`);
    log(
      `registry: ${hintOnly} companies searched on hints only (${counts.join(", ")})`,
    );
  }
  stats.requests += budget.used() - startUsed;
  return stats;
}
