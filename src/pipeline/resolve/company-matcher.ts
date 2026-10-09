import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, companyAliases, companyTags, tags } from "@/db/schema";
import { normaliseCompanyName, normaliseTag } from "@/lib/normalise";
import { addMergeCandidate } from "./merge-candidates";
import { allocateSlug } from "./slugs";
import type {
  CompanyFacts,
  CompanyMatchedBy,
  CompanyResolution,
  ResolveCompanyOptions,
} from "./types";

const FUZZY_THRESHOLD = 0.6;
const FUZZY_LIMIT = 5;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_MERGE_DEPTH = 32;

type CompanyRow = typeof companies.$inferSelect;

interface CleanFacts {
  name: string;
  normalisedName: string;
  websiteDomain: string | null;
  description: string | null;
  countryCode: string | null;
  city: string | null;
  foundedYear: number | null;
  tags: Array<{ slug: string; label: string }>;
}

interface ScoredCompany {
  company: CompanyRow;
  score: number;
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanFacts(facts: CompanyFacts): CleanFacts {
  const description = blankToNull(facts.description);
  const country = blankToNull(facts.countryCode);
  const seen = new Map<string, string>();
  for (const tag of facts.tags) {
    const slug = normaliseTag(tag);
    if (slug && !seen.has(slug)) seen.set(slug, tag.trim());
  }
  return {
    name: facts.name.trim(),
    normalisedName: normaliseCompanyName(facts.name),
    websiteDomain: blankToNull(facts.websiteDomain)?.toLowerCase() ?? null,
    description: description
      ? Array.from(description).slice(0, MAX_DESCRIPTION_LENGTH).join("")
      : null,
    countryCode:
      country && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
    city: blankToNull(facts.city),
    foundedYear: facts.foundedYear,
    tags: Array.from(seen, ([slug, label]) => ({ slug, label })),
  };
}

/** The company itself, or the company it was merged into, followed to the end of the chain. */
async function survivorOf(db: Db, companyId: number): Promise<CompanyRow> {
  let id = companyId;
  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
    const [row] = await db.select().from(companies).where(eq(companies.id, id));
    if (!row) throw new Error(`Company ${id} does not exist`);
    if (row.mergedIntoId === null) return row;
    id = row.mergedIntoId;
  }
  throw new Error(
    `Merge chain from company ${companyId} is cyclic or too deep`,
  );
}

async function survivorsOf(db: Db, ids: number[]): Promise<CompanyRow[]> {
  const byId = new Map<number, CompanyRow>();
  for (const id of new Set(ids)) {
    const survivor = await survivorOf(db, id);
    byId.set(survivor.id, survivor);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Reasons the incoming facts contradict an existing company; empty when nothing conflicts. */
function conflictsWith(company: CompanyRow, facts: CleanFacts): string[] {
  const conflicts: string[] = [];
  if (
    company.countryCode &&
    facts.countryCode &&
    company.countryCode !== facts.countryCode
  ) {
    conflicts.push(`country ${company.countryCode} vs ${facts.countryCode}`);
  }
  if (
    company.websiteDomain &&
    facts.websiteDomain &&
    company.websiteDomain !== facts.websiteDomain
  ) {
    conflicts.push(`domain ${company.websiteDomain} vs ${facts.websiteDomain}`);
  }
  return conflicts;
}

async function findByDomain(
  db: Db,
  domain: string,
): Promise<CompanyRow | null> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.websiteDomain, domain))
    .limit(1);
  return row ? survivorOf(db, row.id) : null;
}

async function exactNameCandidates(
  db: Db,
  normalisedName: string,
): Promise<CompanyRow[]> {
  const byName = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.normalisedName, normalisedName),
        isNull(companies.mergedIntoId),
      ),
    );
  const byAlias = await db
    .select({ id: companyAliases.companyId })
    .from(companyAliases)
    .where(eq(companyAliases.normalisedAlias, normalisedName));
  return survivorsOf(
    db,
    [...byName, ...byAlias].map((row) => row.id),
  );
}

async function fuzzyCandidates(
  db: Db,
  normalisedName: string,
): Promise<ScoredCompany[]> {
  const nameScore = sql<number>`similarity(${companies.normalisedName}, ${normalisedName})`;
  const byName = await db
    .select({ id: companies.id, score: nameScore.mapWith(Number) })
    .from(companies)
    .where(and(isNull(companies.mergedIntoId), gte(nameScore, FUZZY_THRESHOLD)))
    .orderBy(desc(nameScore), asc(companies.id))
    .limit(FUZZY_LIMIT);

  const aliasScore = sql<number>`similarity(${companyAliases.normalisedAlias}, ${normalisedName})`;
  const byAlias = await db
    .select({ id: companyAliases.companyId, score: aliasScore.mapWith(Number) })
    .from(companyAliases)
    .where(gte(aliasScore, FUZZY_THRESHOLD))
    .orderBy(desc(aliasScore), asc(companyAliases.companyId))
    .limit(FUZZY_LIMIT);

  const best = new Map<number, ScoredCompany>();
  for (const { id, score } of [...byName, ...byAlias]) {
    const company = await survivorOf(db, id);
    const current = best.get(company.id);
    if (!current || score > current.score) {
      best.set(company.id, { company, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.company.id - b.company.id)
    .slice(0, FUZZY_LIMIT);
}

async function addAlias(
  db: Db,
  companyId: number,
  facts: CleanFacts,
): Promise<void> {
  if (!facts.normalisedName || !facts.name) return;
  await db
    .insert(companyAliases)
    .values({
      companyId,
      alias: facts.name,
      normalisedAlias: facts.normalisedName,
      source: "extraction",
    })
    .onConflictDoNothing({
      target: [companyAliases.companyId, companyAliases.normalisedAlias],
    });
}

async function upsertTags(
  db: Db,
  companyId: number,
  facts: CleanFacts,
  now: Date,
): Promise<void> {
  if (facts.tags.length === 0) return;
  await db
    .insert(tags)
    .values(
      facts.tags.map(({ slug, label }) => ({ slug, label, firstSeenAt: now })),
    )
    .onConflictDoNothing({ target: tags.slug });
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      inArray(
        tags.slug,
        facts.tags.map((tag) => tag.slug),
      ),
    );
  await db
    .insert(companyTags)
    .values(
      rows.map((row) => ({
        companyId,
        tagId: row.id,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [companyTags.companyId, companyTags.tagId],
      set: {
        mentionCount: sql`${companyTags.mentionCount} + 1`,
        lastSeenAt: now,
      },
    });
}

async function domainClaimed(db: Db, domain: string): Promise<boolean> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.websiteDomain, domain))
    .limit(1);
  return row !== undefined;
}

/** Adds the alias and tags, and fills only fields that are still empty. */
async function applyMatch(
  db: Db,
  company: CompanyRow,
  facts: CleanFacts,
  matchedBy: Exclude<CompanyMatchedBy, "new">,
  now: Date,
): Promise<CompanyResolution> {
  await addAlias(db, company.id, facts);

  const patch: Partial<typeof companies.$inferInsert> = { updatedAt: now };
  if (!company.countryCode && facts.countryCode) {
    patch.countryCode = facts.countryCode;
  }
  if (!company.city && facts.city) patch.city = facts.city;
  if (company.foundedYear === null && facts.foundedYear !== null) {
    patch.foundedYear = facts.foundedYear;
    patch.foundedYearSource = "news";
  }
  if (!company.description && facts.description) {
    patch.description = facts.description;
  }
  if (
    !company.websiteDomain &&
    facts.websiteDomain &&
    !(await domainClaimed(db, facts.websiteDomain))
  ) {
    patch.websiteDomain = facts.websiteDomain;
  }
  await db.update(companies).set(patch).where(eq(companies.id, company.id));

  await upsertTags(db, company.id, facts, now);
  return { companyId: company.id, created: false, matchedBy };
}

async function createCompany(
  db: Db,
  facts: CleanFacts,
  now: Date,
): Promise<number> {
  const slug = await allocateSlug(db, companies, facts.name);
  const websiteDomain =
    facts.websiteDomain && !(await domainClaimed(db, facts.websiteDomain))
      ? facts.websiteDomain
      : null;
  const [row] = await db
    .insert(companies)
    .values({
      slug,
      name: facts.name,
      normalisedName: facts.normalisedName,
      websiteDomain,
      description: facts.description,
      countryCode: facts.countryCode,
      city: facts.city,
      foundedYear: facts.foundedYear,
      foundedYearSource: facts.foundedYear === null ? null : "news",
      firstSeenAt: now,
      updatedAt: now,
    })
    .returning({ id: companies.id });
  if (!row) throw new Error("Company insert returned no row");
  await addAlias(db, row.id, facts);
  await upsertTags(db, row.id, facts, now);
  return row.id;
}

type ExactOutcome =
  | { kind: "none" }
  | { kind: "match"; company: CompanyRow }
  | { kind: "ambiguous"; candidates: ScoredCompany[]; reason: string };

function chooseExact(
  candidates: CompanyRow[],
  facts: CleanFacts,
): ExactOutcome {
  if (candidates.length === 0) return { kind: "none" };
  const label = `exact name "${facts.normalisedName}"`;
  const fitting = candidates.filter(
    (company) => conflictsWith(company, facts).length === 0,
  );
  if (fitting.length === 0) {
    const conflicts = candidates.flatMap((company) =>
      conflictsWith(company, facts),
    );
    return {
      kind: "ambiguous",
      candidates: candidates.map((company) => ({ company, score: 1 })),
      reason: `${label}; ${[...new Set(conflicts)].join(", ")}`,
    };
  }
  const byActivity = [...fitting].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id - b.id,
  );
  const [latest, runnerUp] = byActivity;
  if (
    latest &&
    (!runnerUp || latest.updatedAt.getTime() > runnerUp.updatedAt.getTime())
  ) {
    return { kind: "match", company: latest };
  }
  const tied = byActivity.filter(
    (company) => company.updatedAt.getTime() === latest?.updatedAt.getTime(),
  );
  return {
    kind: "ambiguous",
    candidates: tied.map((company) => ({ company, score: 1 })),
    reason: `${label}; several equally recent companies`,
  };
}

/**
 * Finds or creates the company for extracted facts using the rules in spec
 * section 7: domain, then exact normalised name or alias without conflicts,
 * then a fuzzy name confirmed by `corroborates`, otherwise a new company.
 * Ambiguous and unconfirmed fuzzy cases are recorded as merge candidates.
 */
export async function resolveCompany(
  db: Db,
  input: CompanyFacts,
  options: ResolveCompanyOptions,
): Promise<CompanyResolution> {
  const facts = cleanFacts(input);
  const now = options.clock?.now() ?? new Date();

  if (facts.websiteDomain) {
    const company = await findByDomain(db, facts.websiteDomain);
    if (company) return applyMatch(db, company, facts, "domain", now);
  }

  let review: { candidates: ScoredCompany[]; reason: string } | null = null;

  if (facts.normalisedName) {
    const exact = chooseExact(
      await exactNameCandidates(db, facts.normalisedName),
      facts,
    );
    if (exact.kind === "match") {
      return applyMatch(db, exact.company, facts, "exact_name", now);
    }
    if (exact.kind === "ambiguous") {
      review = { candidates: exact.candidates, reason: exact.reason };
    } else {
      const fuzzy = await fuzzyCandidates(db, facts.normalisedName);
      for (const { company } of fuzzy) {
        if (conflictsWith(company, facts).length > 0) continue;
        if (await options.corroborates(company.id)) {
          return applyMatch(db, company, facts, "fuzzy_corroborated", now);
        }
      }
      const [best] = fuzzy;
      if (best) {
        const conflicts = conflictsWith(best.company, facts);
        const detail =
          conflicts.length > 0
            ? conflicts.join(", ")
            : "no corroborating event";
        review = {
          candidates: [best],
          reason: `trigram ${best.score.toFixed(2)} to "${best.company.normalisedName}"; ${detail}`,
        };
      }
    }
  }

  const companyId = await createCompany(db, facts, now);
  if (review) {
    for (const { company, score } of review.candidates) {
      await addMergeCandidate(db, {
        entityType: "company",
        leftId: company.id,
        rightId: companyId,
        score,
        reason: review.reason,
      });
    }
  }
  return { companyId, created: true, matchedBy: "new" };
}
