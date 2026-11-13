// Review of registry link candidates (spec-phase3 section 7.2, D53, D61).
// Reads the local database and calls the link store. It never calls an API and
// never reads a full postcode or any personal data.

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { RegistryKind, RegistryLinkStatus } from "@/core/enums";
import {
  companiesHouseUrl,
  edgarCompanyUrl,
  normaliseCompanyNumber,
} from "@/core/registry";
import type { Db } from "@/db/client";
import {
  chCompanies,
  companies,
  companyLocations,
  eventSources,
  events,
  formDFilings,
  fundingRounds,
  registryLinks,
} from "@/db/schema";
import { normaliseCompanyName } from "@/lib/normalise";
import {
  normaliseRegistryId,
  recordLink,
  rejectLink,
  unlink,
} from "./link-store";

export interface ReviewEvent {
  type: string;
  roundType: string | null;
  amountMinor: number | null;
  currency: string | null;
  announcedOn: string;
}

export interface ReviewCandidate {
  /** The `registry_links` id, used by `approve` and `reject`. */
  id: number;
  registry: RegistryKind;
  registryId: string;
  registryName: string;
  status: RegistryLinkStatus;
  reason: string;
  url: string;
  company: {
    id: number;
    slug: string;
    name: string;
    country: string | null;
    town: string | null;
    earliest: ReviewEvent | null;
    latest: ReviewEvent | null;
    headlines: number;
  };
  registryFacts: {
    /** Registry status, for example `active`. Null when no profile is stored. */
    status: string | null;
    /** Incorporation date (Companies House) or first sale date (Form D). */
    date: string | null;
    /** Office postcode district only. */
    outcode: string | null;
  };
  evidenceFor: string[];
  evidenceAgainst: string[];
}

export interface ReviewResult {
  id: number | string;
  ok: boolean;
  message: string;
}

export function registryUrl(
  registry: RegistryKind,
  registryId: string,
): string {
  return registry === "companies_house"
    ? companiesHouseUrl(registryId)
    : edgarCompanyUrl(registryId);
}

async function eventsFor(db: Db, companyId: number): Promise<ReviewEvent[]> {
  const rows = await db
    .select({
      type: events.type,
      announcedOn: events.announcedOn,
      roundType: fundingRounds.roundType,
      amountMinor: fundingRounds.amountMinor,
      currency: fundingRounds.currency,
    })
    .from(events)
    .leftJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(eq(events.companyId, companyId))
    .orderBy(asc(events.announcedOn), asc(events.id));
  return rows;
}

async function headlineCount(db: Db, companyId: number): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`count(distinct ${eventSources.sourceItemId})::int`,
    })
    .from(eventSources)
    .innerJoin(events, eq(events.id, eventSources.eventId))
    .where(eq(events.companyId, companyId));
  return row?.n ?? 0;
}

async function holderName(
  db: Db,
  registry: RegistryKind,
  registryId: string,
  companyId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: companies.name, slug: companies.slug })
    .from(registryLinks)
    .innerJoin(companies, eq(companies.id, registryLinks.companyId))
    .where(
      and(
        eq(registryLinks.registry, registry),
        eq(registryLinks.registryId, registryId),
        eq(registryLinks.status, "linked"),
      ),
    );
  if (!row) return null;
  const [self] = await db
    .select({ slug: companies.slug })
    .from(companies)
    .where(eq(companies.id, companyId));
  return self?.slug === row.slug ? null : `${row.name} (${row.slug})`;
}

async function factsFor(
  db: Db,
  registry: RegistryKind,
  registryId: string,
): Promise<{
  status: string | null;
  date: string | null;
  endedOn: string | null;
  outcode: string | null;
  state: string | null;
}> {
  if (registry === "companies_house") {
    const [row] = await db
      .select()
      .from(chCompanies)
      .where(eq(chCompanies.companyNumber, registryId));
    return {
      status: row?.status ?? null,
      date: row?.incorporatedOn ?? null,
      endedOn: row?.ceasedOn ?? null,
      outcode: row?.officeOutcode ?? null,
      state: null,
    };
  }
  const [row] = await db
    .select()
    .from(formDFilings)
    .where(eq(formDFilings.cik, registryId))
    .orderBy(desc(formDFilings.filedOn))
    .limit(1);
  return {
    status: null,
    date: row?.dateOfFirstSale ?? row?.filedOn ?? null,
    endedOn: null,
    outcode: null,
    state: row?.issuerState ?? null,
  };
}

/** Open candidates, newest companies first. Companies merged away are left out. */
export async function listCandidates(
  db: Db,
  options: { registry?: RegistryKind; limit: number },
): Promise<ReviewCandidate[]> {
  const rows = await db
    .select({ link: registryLinks, company: companies })
    .from(registryLinks)
    .innerJoin(companies, eq(companies.id, registryLinks.companyId))
    .where(
      and(
        eq(registryLinks.status, "candidate"),
        isNull(companies.mergedIntoId),
        options.registry
          ? eq(registryLinks.registry, options.registry)
          : undefined,
      ),
    )
    .orderBy(
      desc(companies.firstSeenAt),
      desc(companies.id),
      asc(registryLinks.id),
    )
    .limit(options.limit);

  const result: ReviewCandidate[] = [];
  for (const { link, company } of rows) {
    const [evs, headlines, facts, locationRows, holder] = await Promise.all([
      eventsFor(db, company.id),
      headlineCount(db, company.id),
      factsFor(db, link.registry, link.registryId),
      db
        .select({ outcode: companyLocations.outcode })
        .from(companyLocations)
        .where(eq(companyLocations.companyId, company.id)),
      holderName(db, link.registry, link.registryId, company.id),
    ]);
    const earliest = evs[0] ?? null;
    const latest = evs[evs.length - 1] ?? null;

    const evidenceFor: string[] = [];
    const evidenceAgainst: string[] = [];
    const registryName = normaliseCompanyName(link.registryName);
    if (registryName === company.normalisedName) {
      evidenceFor.push("name matches exactly");
    } else if (registryName.startsWith(`${company.normalisedName} `)) {
      evidenceFor.push("name starts with the company name only");
    } else {
      evidenceAgainst.push("name differs");
    }
    const locationOutcode = locationRows[0]?.outcode ?? null;
    if (facts.outcode && locationOutcode === facts.outcode) {
      evidenceFor.push(`office district ${facts.outcode} matches location`);
    }
    if (facts.date && earliest) {
      if (link.registry === "companies_house") {
        if (facts.date > earliest.announcedOn) {
          evidenceAgainst.push("incorporated after the first event");
        } else {
          evidenceFor.push("incorporated before the first event");
        }
      } else {
        const days = Math.round(
          Math.abs(Date.parse(facts.date) - Date.parse(earliest.announcedOn)) /
            86_400_000,
        );
        if (days <= 365)
          evidenceFor.push(`Form D within ${days} days of an event`);
        else
          evidenceAgainst.push(`Form D is ${days} days from the first event`);
      }
    }
    if (facts.endedOn && latest && facts.endedOn < latest.announcedOn) {
      evidenceAgainst.push("closed before the latest event");
    }
    if (facts.status && facts.status !== "active") {
      evidenceAgainst.push(`registry status is ${facts.status}`);
    }
    if (
      facts.state === null &&
      link.registry === "companies_house" &&
      !facts.date
    ) {
      evidenceAgainst.push("no stored registry profile");
    }
    if (
      link.registry === "sec_edgar" &&
      company.countryCode !== null &&
      company.countryCode !== "US"
    ) {
      evidenceAgainst.push(`company country is ${company.countryCode}`);
    }
    if (holder) evidenceAgainst.push(`number already linked to ${holder}`);

    result.push({
      id: link.id,
      registry: link.registry,
      registryId: link.registryId,
      registryName: link.registryName,
      status: link.status,
      reason: link.reason,
      url: registryUrl(link.registry, link.registryId),
      company: {
        id: company.id,
        slug: company.slug,
        name: company.name,
        country: company.countryCode,
        town: company.city,
        earliest,
        latest,
        headlines,
      },
      registryFacts: {
        status: facts.status,
        date: facts.date,
        outcode: facts.outcode,
      },
      evidenceFor,
      evidenceAgainst,
    });
  }
  return result;
}

async function companyBySlug(db: Db, slug: string) {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, slug));
  if (!company) throw new Error(`No company with slug "${slug}"`);
  if (company.mergedIntoId !== null) {
    const [kept] = await db
      .select({ slug: companies.slug })
      .from(companies)
      .where(eq(companies.id, company.mergedIntoId));
    throw new Error(
      `"${slug}" was merged into "${kept?.slug ?? company.mergedIntoId}". Use that slug`,
    );
  }
  return company;
}

export interface ShownLink {
  id: number;
  registry: RegistryKind;
  registryId: string;
  registryName: string;
  status: RegistryLinkStatus;
  method: string | null;
  decidedBy: string;
  reason: string;
  decidedAt: Date;
  url: string;
}

/** Every registry row for one company, in any status. */
export async function showCompany(
  db: Db,
  slug: string,
): Promise<{ name: string; slug: string; links: ShownLink[] }> {
  const company = await companyBySlug(db, slug);
  const rows = await db
    .select()
    .from(registryLinks)
    .where(eq(registryLinks.companyId, company.id))
    .orderBy(asc(registryLinks.registry), asc(registryLinks.id));
  return {
    name: company.name,
    slug: company.slug,
    links: rows.map((row) => ({
      id: row.id,
      registry: row.registry,
      registryId: row.registryId,
      registryName: row.registryName,
      status: row.status,
      method: row.method,
      decidedBy: row.decidedBy,
      reason: row.reason,
      decidedAt: row.decidedAt,
      url: registryUrl(row.registry, row.registryId),
    })),
  };
}

async function describeCompany(db: Db, id: number): Promise<string> {
  const [row] = await db
    .select({ name: companies.name, slug: companies.slug })
    .from(companies)
    .where(eq(companies.id, id));
  return row ? `${row.name} (${row.slug})` : `company ${id}`;
}

async function linkOutcome(
  db: Db,
  result: Awaited<ReturnType<typeof recordLink>>,
  registryId: string,
): Promise<{ ok: boolean; message: string }> {
  switch (result.outcome) {
    case "linked":
      return {
        ok: true,
        message: result.changed
          ? `linked to ${registryId}`
          : `already linked to ${registryId}`,
      };
    case "taken":
      return {
        ok: false,
        message: `refused: ${registryId} is held by ${await describeCompany(db, result.holderCompanyId)}. Merge the two companies first`,
      };
    case "already_linked":
      return {
        ok: false,
        message: `refused: already linked to ${result.linkedRegistryId}. Unlink it first`,
      };
    case "blocked":
      return { ok: false, message: "blocked by an earlier decision" };
  }
}

/** Confirms candidates by `registry_links` id, as manual links. Each id is independent. */
export async function approveLinks(
  db: Db,
  ids: number[],
  now: Date,
): Promise<ReviewResult[]> {
  const rows = ids.length
    ? await db
        .select()
        .from(registryLinks)
        .where(inArray(registryLinks.id, ids))
    : [];
  const results: ReviewResult[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      results.push({ id, ok: false, message: "no such row" });
      continue;
    }
    if (row.status !== "candidate") {
      results.push({
        id,
        ok: false,
        message: `skipped: the row is ${row.status}, not a candidate`,
      });
      continue;
    }
    const outcome = await linkOutcome(
      db,
      await recordLink(db, {
        companyId: row.companyId,
        registry: row.registry,
        registryId: row.registryId,
        registryName: row.registryName,
        method: "manual",
        reason: `approved in review; was: ${row.reason}`,
        decidedBy: "manual",
        now,
      }),
      row.registryId,
    );
    results.push({ id, ...outcome });
  }
  return results;
}

/** Rejects candidates by `registry_links` id. Automatic linking never proposes them again. */
export async function rejectCandidates(
  db: Db,
  ids: number[],
  now: Date,
): Promise<ReviewResult[]> {
  const rows = ids.length
    ? await db
        .select()
        .from(registryLinks)
        .where(inArray(registryLinks.id, ids))
    : [];
  const results: ReviewResult[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      results.push({ id, ok: false, message: "no such row" });
    } else if (row.status !== "candidate") {
      results.push({
        id,
        ok: false,
        message: `skipped: the row is ${row.status}, not a candidate${row.status === "linked" ? ". Use unlink" : ""}`,
      });
    } else {
      await rejectLink(db, {
        companyId: row.companyId,
        registry: row.registry,
        registryId: row.registryId,
        reason: `rejected in review; was: ${row.reason}`,
        now,
      });
      results.push({ id, ok: true, message: `rejected ${row.registryId}` });
    }
  }
  return results;
}

/**
 * A manual link by number, including a number that was never a candidate.
 * Fetches nothing: the registry name is the one given, a stored one, or the
 * company's own name.
 */
export async function link(
  db: Db,
  input: {
    slug: string;
    registry: RegistryKind;
    registryId: string;
    registryName?: string;
    now: Date;
  },
): Promise<ReviewResult> {
  const company = await companyBySlug(db, input.slug);
  const registryId = normaliseRegistryId(input.registry, input.registryId);
  const [existing] = await db
    .select({ name: registryLinks.registryName })
    .from(registryLinks)
    .where(
      and(
        eq(registryLinks.companyId, company.id),
        eq(registryLinks.registry, input.registry),
        eq(registryLinks.registryId, registryId),
      ),
    );
  let registryName = input.registryName ?? existing?.name;
  if (!registryName && normaliseCompanyNumber(registryId)) {
    const [profile] = await db
      .select({ name: chCompanies.name })
      .from(chCompanies)
      .where(eq(chCompanies.companyNumber, registryId));
    registryName = profile?.name;
  }
  const outcome = await linkOutcome(
    db,
    await recordLink(db, {
      companyId: company.id,
      registry: input.registry,
      registryId,
      registryName: registryName ?? company.name,
      method: "manual",
      reason: "linked by hand",
      decidedBy: "manual",
      now: input.now,
    }),
    registryId,
  );
  return { id: company.slug, ...outcome };
}

/** Rejects a number for a company, even if it was never a candidate. */
export async function reject(
  db: Db,
  input: {
    slug: string;
    registry: RegistryKind;
    registryId: string;
    registryName?: string;
    now: Date;
  },
): Promise<ReviewResult> {
  const company = await companyBySlug(db, input.slug);
  const registryId = normaliseRegistryId(input.registry, input.registryId);
  await rejectLink(db, {
    companyId: company.id,
    registry: input.registry,
    registryId,
    registryName: input.registryName ?? company.name,
    reason: "rejected by hand",
    now: input.now,
  });
  return { id: company.slug, ok: true, message: `rejected ${registryId}` };
}

/** Unlinks the company's linked number. The number is then rejected for it. */
export async function unlinkCompany(
  db: Db,
  input: { slug: string; registry: RegistryKind; now: Date },
): Promise<ReviewResult> {
  const company = await companyBySlug(db, input.slug);
  const number = await unlink(db, {
    companyId: company.id,
    registry: input.registry,
    reason: "unlinked by hand",
    now: input.now,
  });
  return number === null
    ? { id: company.slug, ok: false, message: "no link to remove" }
    : { id: company.slug, ok: true, message: `unlinked ${number}` };
}
