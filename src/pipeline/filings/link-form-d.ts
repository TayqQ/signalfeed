// Links stored Form D filings to news companies (spec-phase3 section 8.3,
// D51, D53, D61). The decision is `decideFormDLink` from the registry link
// rules, applied as it stands: this file gathers the facts and writes the
// outcome through `link-store.ts`.
//
// Form D confirms only. It links a US company to its CIK and never creates a
// company or an event. Rules, in order:
// - a company already linked to the CIK takes every filing of that CIK;
// - otherwise the companies with the issuer's exact name go to the rules;
// - a company whose name is only a prefix of the issuer name (a trading name)
//   is never linked. It goes to review, and only when the filing would have
//   linked it on an exact name (D61);
// - a filing that matches no name is skipped after one query by name, and is
//   looked at again only when a company or alias with that name appears.

import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { FormDStats } from "@/core/domain";
import type { FormDFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  eventSources,
  events,
  formDFilings,
  fundingRounds,
  registryLinks,
  sourceItems,
  sources,
} from "@/db/schema";
import { normaliseCompanyName } from "@/lib/normalise";
import type { ConfirmableEvent } from "@/pipeline/registry/confirm-rules";
import {
  MIN_NAME_LENGTH,
  decideFormDLink,
  registryNameMatchDetail,
  registryNormalise,
  type FormDLinkCompany,
  type FormDLinkResult,
} from "@/pipeline/registry/link-rules";
import { recordCandidate, recordLink } from "@/pipeline/registry/link-store";
import {
  formDHints,
  formDSearchNote,
  sourceSlugsFor,
} from "@/pipeline/registry/search-hints";
import { emptyFormDStats } from "./store-form-d";

const REGISTRY = "sec_edgar" as const;
const CHUNK = 1_000;
const MAX_MERGE_DEPTH = 32;

export interface LinkFormDOptions {
  db: Db;
  now: Date;
  /** Added to in place. A new one when missing. */
  stats?: FormDStats;
  log?: (message: string) => void;
}

type FilingRow = typeof formDFilings.$inferSelect;

interface CompanyFacts {
  company: FormDLinkCompany;
  /** The raw names, for prefix checks: the company name first. */
  names: string[];
  /** Added to link and candidate reasons when the country is not stated (D62). */
  searchNote: string | null;
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

/** Spaces ignored, as the link rules compare names. */
function nameKey(normalised: string): string {
  return normalised.replace(/ /g, "");
}

/**
 * Keys a company name must have to match this issuer exactly. Both
 * normalisers are used, because stored names do not read "&" as "and".
 */
function exactKeys(issuerName: string): string[] {
  const keys = new Set<string>();
  for (const normalised of [
    registryNormalise(issuerName),
    normaliseCompanyName(issuerName),
  ]) {
    if (normalised.length >= MIN_NAME_LENGTH) keys.add(nameKey(normalised));
  }
  return [...keys];
}

/** Keys of the issuer name's leading words ("orbital" for "orbital forge labs"). */
function prefixKeys(issuerName: string): string[] {
  const words = registryNormalise(issuerName).split(" ").filter(Boolean);
  const keys: string[] = [];
  for (let n = 1; n < words.length; n += 1) {
    const prefix = words.slice(0, n).join(" ");
    if (prefix.length >= MIN_NAME_LENGTH) keys.push(nameKey(prefix));
  }
  return keys;
}

function toFacts(row: FilingRow): FormDFacts {
  return {
    accessionNumber: row.accessionNumber,
    cik: row.cik,
    issuerName: row.issuerName,
    entityType: row.entityType,
    issuerState: row.issuerState,
    issuerCity: row.issuerCity,
    yearOfInc: row.yearOfInc,
    industryGroup: row.industryGroup,
    isAmendment: row.isAmendment,
    dateOfFirstSale: row.dateOfFirstSale,
    totalOfferingUsdMinor: row.totalOfferingUsdMinor,
    totalSoldUsdMinor: row.totalSoldUsdMinor,
    filedOn: row.filedOn,
  };
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

/** The company holding each CIK: a `linked` row, else the `sec_cik` column. */
async function cikHolders(
  db: Db,
  ciks: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const chunk of chunks(ciks, CHUNK)) {
    const [linked, columns] = await Promise.all([
      db
        .select({
          registryId: registryLinks.registryId,
          companyId: registryLinks.companyId,
        })
        .from(registryLinks)
        .where(
          and(
            eq(registryLinks.registry, REGISTRY),
            eq(registryLinks.status, "linked"),
            inArray(registryLinks.registryId, chunk),
          ),
        ),
      db
        .select({ secCik: companies.secCik, id: companies.id })
        .from(companies)
        .where(inArray(companies.secCik, chunk)),
    ]);
    for (const row of columns) {
      if (row.secCik !== null) out.set(row.secCik, row.id);
    }
    // A link row wins over the column.
    for (const row of linked) out.set(row.registryId, row.companyId);
  }
  for (const [cik, id] of out) out.set(cik, await survivorOf(db, id));
  return out;
}

/**
 * Non-merged companies whose name or alias (not one a registry added) has one
 * of these keys, by key. One query on names and one on aliases per chunk.
 */
async function companiesByKey(
  db: Db,
  keys: readonly string[],
): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  const add = (key: string, id: number) => {
    const set = out.get(key) ?? new Set<number>();
    set.add(id);
    out.set(key, set);
  };
  const nameKeySql = sql<string>`replace(${companies.normalisedName}, ' ', '')`;
  const aliasKeySql = sql<string>`replace(${companyAliases.normalisedAlias}, ' ', '')`;
  for (const chunk of chunks([...new Set(keys)], CHUNK)) {
    const [byName, byAlias] = await Promise.all([
      db
        .select({ key: nameKeySql, id: companies.id })
        .from(companies)
        .where(and(isNull(companies.mergedIntoId), inArray(nameKeySql, chunk))),
      db
        .select({ key: aliasKeySql, id: companies.id })
        .from(companyAliases)
        .innerJoin(companies, eq(companies.id, companyAliases.companyId))
        .where(
          and(
            isNull(companies.mergedIntoId),
            ne(companyAliases.source, "registry"),
            inArray(aliasKeySql, chunk),
          ),
        ),
    ]);
    for (const row of [...byName, ...byAlias]) add(row.key, row.id);
  }
  return out;
}

/**
 * The link rules' view of each company. Aliases a registry added are left
 * out, so a demoted link cannot match on its own name. A founded year from a
 * registry is left out: the rules compare news years.
 */
async function loadCompanies(
  db: Db,
  companyIds: readonly number[],
): Promise<Map<number, CompanyFacts>> {
  const out = new Map<number, CompanyFacts>();
  for (const ids of chunks([...new Set(companyIds)], CHUNK)) {
    if (ids.length === 0) continue;
    const usSlugs = sourceSlugsFor("US");
    const [base, aliases, eventRows, links, usReports] = await Promise.all([
      db
        .select({
          id: companies.id,
          name: companies.name,
          countryCode: companies.countryCode,
          foundedYear: companies.foundedYear,
          foundedYearSource: companies.foundedYearSource,
          secCik: companies.secCik,
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
          currency: fundingRounds.currency,
        })
        .from(events)
        .leftJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
        .where(inArray(events.companyId, ids))
        .orderBy(asc(events.announcedOn), asc(events.id)),
      db
        .select({
          companyId: registryLinks.companyId,
          registryId: registryLinks.registryId,
          status: registryLinks.status,
        })
        .from(registryLinks)
        .where(
          and(
            inArray(registryLinks.companyId, ids),
            eq(registryLinks.registry, REGISTRY),
            or(
              eq(registryLinks.status, "linked"),
              eq(registryLinks.status, "rejected"),
            ),
          ),
        ),
      // Reports from US-only sources (D62). None are configured today.
      usSlugs.length === 0
        ? Promise.resolve([])
        : db
            .selectDistinct({ companyId: events.companyId, slug: sources.slug })
            .from(eventSources)
            .innerJoin(events, eq(events.id, eventSources.eventId))
            .innerJoin(
              sourceItems,
              eq(sourceItems.id, eventSources.sourceItemId),
            )
            .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
            .where(
              and(
                inArray(events.companyId, ids),
                inArray(sources.slug, usSlugs),
              ),
            ),
    ]);

    const aliasesBy = new Map<number, string[]>();
    for (const row of aliases) pushTo(aliasesBy, row.companyId, row.alias);
    const eventsBy = new Map<number, ConfirmableEvent[]>();
    const currenciesBy = new Map<number, (string | null)[]>();
    const slugsBy = new Map<number, string[]>();
    for (const row of usReports) pushTo(slugsBy, row.companyId, row.slug);
    for (const row of eventRows) {
      pushTo(currenciesBy, row.companyId, row.currency ?? null);
      pushTo(eventsBy, row.companyId, {
        id: row.id,
        type: row.type,
        roundType: row.roundType ?? null,
        announcedOn: row.announcedOn,
        datePrecision: row.datePrecision,
        amountUsdMinor: row.amountUsdMinor ?? null,
      });
    }
    const linkedBy = new Map<number, string>();
    const rejectedBy = new Map<number, string[]>();
    for (const row of links) {
      if (row.status === "linked") linkedBy.set(row.companyId, row.registryId);
      else pushTo(rejectedBy, row.companyId, row.registryId);
    }

    for (const row of base) {
      const names = [row.name, ...(aliasesBy.get(row.id) ?? [])];
      const newsYear =
        row.foundedYearSource === "companies_house" ||
        row.foundedYearSource === "sec_form_d"
          ? null
          : row.foundedYear;
      const hints = formDHints({
        countryCode: row.countryCode,
        currencies: currenciesBy.get(row.id) ?? [],
        sourceSlugs: slugsBy.get(row.id) ?? [],
      });
      out.set(row.id, {
        names,
        searchNote: formDSearchNote(row.countryCode, hints),
        company: {
          companyId: row.id,
          names,
          countryCode: row.countryCode,
          secCik: linkedBy.get(row.id) ?? row.secCik,
          foundedYear: newsYear,
          events: eventsBy.get(row.id) ?? [],
          rejectedCiks: rejectedBy.get(row.id) ?? [],
        },
      });
    }
  }
  return out;
}

/**
 * Gives every filing of the CIK to the company, and fills an empty founded
 * year from the latest stated year of incorporation. Returns the number of
 * filings that changed hands.
 */
async function attachFilings(
  db: Db,
  cik: string,
  companyId: number,
  now: Date,
): Promise<number> {
  const updated = await db
    .update(formDFilings)
    .set({ companyId, linkedAt: now })
    .where(
      and(
        eq(formDFilings.cik, cik),
        or(
          isNull(formDFilings.companyId),
          ne(formDFilings.companyId, companyId),
        ),
      ),
    )
    .returning({ id: formDFilings.id });

  const [withYear] = await db
    .select({ yearOfInc: formDFilings.yearOfInc })
    .from(formDFilings)
    .where(
      and(
        eq(formDFilings.cik, cik),
        sql`${formDFilings.yearOfInc} is not null`,
      ),
    )
    .orderBy(sql`${formDFilings.filedOn} desc`, sql`${formDFilings.id} desc`)
    .limit(1);
  if (withYear?.yearOfInc != null) {
    await db
      .update(companies)
      .set({ foundedYear: withYear.yearOfInc, foundedYearSource: "sec_form_d" })
      .where(and(eq(companies.id, companyId), isNull(companies.foundedYear)));
  }
  return updated.length;
}

interface LinkContext {
  db: Db;
  now: Date;
  stats: FormDStats;
  log: (message: string) => void;
  holders: Map<string, number>;
  facts: Map<number, CompanyFacts>;
}

/** The reason with the company's search note, if it has one (D62). */
function withNote(ctx: LinkContext, companyId: number, reason: string): string {
  const note = ctx.facts.get(companyId)?.searchNote ?? null;
  return note === null ? reason : `${reason}; ${note}`;
}

/** Exact-name companies for a filing, or prefix-name companies when none. */
function namedCompanies(
  ctx: LinkContext,
  byKey: Map<string, Set<number>>,
  filing: FormDFacts,
  keys: (name: string) => string[],
  exclude: number | undefined,
): FormDLinkCompany[] {
  const ids = new Set<number>();
  for (const key of keys(filing.issuerName)) {
    for (const id of byKey.get(key) ?? []) ids.add(id);
  }
  if (exclude !== undefined) ids.delete(exclude);
  return [...ids]
    .map((id) => ctx.facts.get(id)?.company)
    .filter((company): company is FormDLinkCompany => company !== undefined)
    .sort((a, b) => a.companyId - b.companyId);
}

/** Writes an automatic link. Returns true when the CIK is now linked. */
async function applyLink(
  ctx: LinkContext,
  filing: FormDFacts,
  result: Extract<FormDLinkResult, { outcome: "linked" }>,
): Promise<boolean> {
  const linked = await recordLink(ctx.db, {
    companyId: result.companyId,
    registry: REGISTRY,
    registryId: filing.cik,
    registryName: filing.issuerName,
    method: result.method,
    reason: withNote(ctx, result.companyId, result.reason),
    decidedBy: "auto",
    now: ctx.now,
  });
  if (linked.outcome === "linked") {
    ctx.holders.set(filing.cik, linked.companyId);
    const facts = ctx.facts.get(linked.companyId);
    if (facts) facts.company.secCik = filing.cik;
    await attachFilings(ctx.db, filing.cik, linked.companyId, ctx.now);
    ctx.stats.linkedByName += 1;
    return true;
  }
  if (linked.outcome === "taken" || linked.outcome === "already_linked") {
    // The store recorded a candidate, and a merge candidate when taken.
    ctx.stats.candidates += 1;
  }
  return false;
}

async function applyCandidate(
  ctx: LinkContext,
  filing: FormDFacts,
  companyId: number,
  reason: string,
): Promise<void> {
  const inserted = await recordCandidate(ctx.db, {
    companyId,
    registry: REGISTRY,
    registryId: filing.cik,
    registryName: filing.issuerName,
    reason: withNote(ctx, companyId, reason),
    now: ctx.now,
  });
  if (inserted) ctx.stats.candidates += 1;
}

/**
 * A trading-name prefix never links (D61). When exactly one company's name is
 * a prefix of the issuer name and the filing would have linked it on an exact
 * name, it becomes a review candidate.
 */
async function reviewPrefix(
  ctx: LinkContext,
  filing: FormDFacts,
  prefixCompanies: readonly FormDLinkCompany[],
): Promise<void> {
  const matched = prefixCompanies.filter(
    (company) =>
      registryNameMatchDetail(company.names, filing.issuerName).match ===
      "prefix",
  );
  const [company] = matched;
  if (matched.length !== 1 || company === undefined) return;
  const detail = registryNameMatchDetail(company.names, filing.issuerName);
  if (detail.companyName === null) return;
  const asExact = decideFormDLink(
    { ...filing, issuerName: detail.companyName },
    [company],
  );
  if (asExact.outcome !== "linked") return;
  const rest = asExact.reason.replace(/^exact name; /, "");
  await applyCandidate(
    ctx,
    filing,
    company.companyId,
    `prefix name "${detail.companyName}" of "${registryNormalise(filing.issuerName)}", for review; ${rest}`,
  );
}

/** Links one CIK's unlinked filings, newest first. */
async function linkCik(
  ctx: LinkContext,
  byKey: Map<string, Set<number>>,
  filings: readonly FormDFacts[],
): Promise<void> {
  const cik = filings[0]?.cik;
  if (cik === undefined) return;

  const owner = ctx.holders.get(cik);
  if (owner !== undefined) {
    ctx.stats.linkedByCik += await attachFilings(ctx.db, cik, owner, ctx.now);
    // Another company with the name and a confirmed round is likely the same
    // company: the store turns the link into a candidate and a merge candidate.
    for (const filing of filings) {
      const others = namedCompanies(ctx, byKey, filing, exactKeys, owner);
      if (others.length === 0) continue;
      const result = decideFormDLink(filing, others);
      if (result.outcome === "linked") {
        await applyLink(ctx, filing, result);
        return;
      }
    }
    return;
  }

  for (const filing of filings) {
    const exact = namedCompanies(ctx, byKey, filing, exactKeys, undefined);
    if (exact.length === 0) {
      const prefix = namedCompanies(ctx, byKey, filing, prefixKeys, undefined);
      if (prefix.length > 0) await reviewPrefix(ctx, filing, prefix);
      continue;
    }
    const result = decideFormDLink(filing, exact);
    if (result.outcome === "linked") {
      if (await applyLink(ctx, filing, result)) return;
    } else if (result.outcome === "candidate") {
      await applyCandidate(ctx, filing, result.companyId, result.reason);
    } else if (result.outcome === "owned") {
      ctx.stats.linkedByCik += await attachFilings(
        ctx.db,
        cik,
        result.companyId,
        ctx.now,
      );
      return;
    }
  }
}

/**
 * Links stored filings that have no company yet (spec-phase3 section 8.3).
 * `linkedByCik` counts filings given to a company already linked to their
 * CIK. `linkedByName` counts CIKs linked by name this run. `candidates` counts
 * new review rows.
 */
export async function linkFormDFilings(
  options: LinkFormDOptions,
): Promise<FormDStats> {
  const { db, now } = options;
  const stats = options.stats ?? emptyFormDStats();
  const log = options.log ?? (() => undefined);

  const unlinked = await db
    .select({
      id: formDFilings.id,
      cik: formDFilings.cik,
      issuerName: formDFilings.issuerName,
    })
    .from(formDFilings)
    .where(isNull(formDFilings.companyId));
  if (unlinked.length === 0) return stats;

  // Cheap first pass: CIK holders and companies by name, nothing else.
  const holders = await cikHolders(db, [
    ...new Set(unlinked.map((r) => r.cik)),
  ]);
  const keys = new Set<string>();
  for (const row of unlinked) {
    for (const key of exactKeys(row.issuerName)) keys.add(key);
    for (const key of prefixKeys(row.issuerName)) keys.add(key);
  }
  const byKey = await companiesByKey(db, [...keys]);

  const wanted = unlinked.filter(
    (row) =>
      holders.has(row.cik) ||
      [...exactKeys(row.issuerName), ...prefixKeys(row.issuerName)].some(
        (key) => byKey.has(key),
      ),
  );
  if (wanted.length === 0) return stats;

  const companyIds = new Set<number>();
  for (const ids of byKey.values()) for (const id of ids) companyIds.add(id);
  const ctx: LinkContext = {
    db,
    now,
    stats,
    log,
    holders,
    facts: await loadCompanies(db, [...companyIds]),
  };

  const rows: FilingRow[] = [];
  for (const ids of chunks(
    wanted.map((row) => row.id),
    CHUNK,
  )) {
    rows.push(
      ...(await db
        .select()
        .from(formDFilings)
        .where(inArray(formDFilings.id, ids))),
    );
  }
  const byCik = new Map<string, FormDFacts[]>();
  rows
    .sort(
      (a, b) =>
        b.filedOn.localeCompare(a.filedOn) ||
        b.accessionNumber.localeCompare(a.accessionNumber),
    )
    .forEach((row) => pushTo(byCik, row.cik, toFacts(row)));

  for (const cik of [...byCik.keys()].sort()) {
    const filings = byCik.get(cik) ?? [];
    try {
      await linkCik(ctx, byKey, filings);
    } catch (error) {
      // Left unlinked, so the next run tries again.
      const message = error instanceof Error ? error.message : "unknown error";
      log(`formd: CIK ${cik} not linked: ${message}`);
    }
  }
  return stats;
}
