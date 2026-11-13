// Links companies to Companies House (spec-phase3 section 7.2, D53, D61).
// The decision is `decideChLink` from `link-rules.ts`, applied as it stands:
// this file only gathers the facts, makes the requests the rules ask for, and
// writes the outcome through `link-store.ts`.

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import type { RegistryStats } from "@/core/domain";
import type { RegistrySearchOutcome } from "@/core/enums";
import {
  normaliseCompanyNumber,
  type RegistryCompanyFacts,
} from "@/core/registry";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  companyLocations,
  events,
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

/**
 * Companies to search, in order (spec-phase3 section 7.2): not merged, not
 * linked yet, and GB, or with a grant participant, or with a UK location.
 * Grant companies with a company number come first, then newest events.
 */
export async function eligibleCompanyIds(db: Db): Promise<number[]> {
  const hasGrant = sql`exists (select 1 from ${grantParticipants} where ${grantParticipants.companyId} = ${companies.id})`;
  const ukLocation = sql`exists (select 1 from ${companyLocations} where ${companyLocations.companyId} = ${companies.id} and ${companyLocations.countryCode} = 'GB')`;
  const linked = sql`exists (select 1 from ${registryLinks} where ${registryLinks.companyId} = ${companies.id} and ${registryLinks.registry} = ${REGISTRY} and ${registryLinks.status} = 'linked')`;
  const latestEvent = sql`(select max(${events.announcedOn}) from ${events} where ${events.companyId} = ${companies.id})`;
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        isNull(companies.mergedIntoId),
        or(eq(companies.countryCode, "GB"), hasGrant, ukLocation),
        not(linked),
      ),
    )
    .orderBy(
      sql`case when ${hasGrant} and ${companies.ukCompanyNumber} is not null then 0 else 1 end`,
      sql`${latestEvent} desc nulls last`,
      asc(companies.id),
    );
  return rows.map((row) => row.id);
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
        reason: decision.reason,
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
        reason: decision.reason,
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
  };

  try {
    const ids = await eligibleCompanyIds(db);
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
  stats.requests += budget.used() - startUsed;
  return stats;
}
