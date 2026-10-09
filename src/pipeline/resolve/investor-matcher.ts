import { and, asc, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { investorAliases, investors } from "@/db/schema";
import { normaliseInvestorName } from "@/lib/normalise";
import { addMergeCandidate } from "./merge-candidates";
import { allocateSlug } from "./slugs";
import type {
  InvestorFacts,
  InvestorMatchedBy,
  InvestorResolution,
} from "./types";

const FUZZY_THRESHOLD = 0.7;
const FUZZY_LIMIT = 5;
const MAX_MERGE_DEPTH = 32;

type InvestorRow = typeof investors.$inferSelect;

interface CleanFacts {
  name: string;
  normalisedName: string;
  kind: InvestorFacts["kind"];
  websiteDomain: string | null;
}

function cleanFacts(facts: InvestorFacts): CleanFacts {
  const domain = facts.websiteDomain?.trim().toLowerCase();
  return {
    name: facts.name.trim(),
    normalisedName: normaliseInvestorName(facts.name),
    kind: facts.kind,
    websiteDomain: domain ? domain : null,
  };
}

async function survivorOf(db: Db, investorId: number): Promise<InvestorRow> {
  let id = investorId;
  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
    const [row] = await db.select().from(investors).where(eq(investors.id, id));
    if (!row) throw new Error(`Investor ${id} does not exist`);
    if (row.mergedIntoId === null) return row;
    id = row.mergedIntoId;
  }
  throw new Error(
    `Merge chain from investor ${investorId} is cyclic or too deep`,
  );
}

/** Lowest surviving id first, so repeated runs pick the same investor. */
async function firstSurvivor(
  db: Db,
  ids: number[],
): Promise<InvestorRow | null> {
  let first: InvestorRow | null = null;
  for (const id of new Set(ids)) {
    const survivor = await survivorOf(db, id);
    if (!first || survivor.id < first.id) first = survivor;
  }
  return first;
}

async function findByDomain(
  db: Db,
  domain: string,
): Promise<InvestorRow | null> {
  const rows = await db
    .select({ id: investors.id })
    .from(investors)
    .where(eq(investors.websiteDomain, domain));
  return firstSurvivor(
    db,
    rows.map((row) => row.id),
  );
}

async function findByExactName(
  db: Db,
  normalisedName: string,
): Promise<InvestorRow | null> {
  const byName = await db
    .select({ id: investors.id })
    .from(investors)
    .where(
      and(
        eq(investors.normalisedName, normalisedName),
        isNull(investors.mergedIntoId),
      ),
    );
  const byAlias = await db
    .select({ id: investorAliases.investorId })
    .from(investorAliases)
    .where(eq(investorAliases.normalisedAlias, normalisedName));
  return firstSurvivor(
    db,
    [...byName, ...byAlias].map((row) => row.id),
  );
}

async function similarInvestors(
  db: Db,
  normalisedName: string,
  excludeId: number,
): Promise<Array<{ investor: InvestorRow; score: number }>> {
  const nameScore = sql<number>`similarity(${investors.normalisedName}, ${normalisedName})`;
  const byName = await db
    .select({ id: investors.id, score: nameScore.mapWith(Number) })
    .from(investors)
    .where(
      and(
        isNull(investors.mergedIntoId),
        ne(investors.id, excludeId),
        gte(nameScore, FUZZY_THRESHOLD),
      ),
    )
    .orderBy(desc(nameScore), asc(investors.id))
    .limit(FUZZY_LIMIT);

  const aliasScore = sql<number>`similarity(${investorAliases.normalisedAlias}, ${normalisedName})`;
  const byAlias = await db
    .select({
      id: investorAliases.investorId,
      score: aliasScore.mapWith(Number),
    })
    .from(investorAliases)
    .where(
      and(
        ne(investorAliases.investorId, excludeId),
        gte(aliasScore, FUZZY_THRESHOLD),
      ),
    )
    .orderBy(desc(aliasScore), asc(investorAliases.investorId))
    .limit(FUZZY_LIMIT);

  const best = new Map<number, { investor: InvestorRow; score: number }>();
  for (const { id, score } of [...byName, ...byAlias]) {
    const investor = await survivorOf(db, id);
    if (investor.id === excludeId) continue;
    const current = best.get(investor.id);
    if (!current || score > current.score) {
      best.set(investor.id, { investor, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.investor.id - b.investor.id)
    .slice(0, FUZZY_LIMIT);
}

async function addAlias(
  db: Db,
  investorId: number,
  facts: CleanFacts,
): Promise<void> {
  if (!facts.normalisedName || !facts.name) return;
  await db
    .insert(investorAliases)
    .values({
      investorId,
      alias: facts.name,
      normalisedAlias: facts.normalisedName,
      source: "extraction",
    })
    .onConflictDoNothing({
      target: [investorAliases.investorId, investorAliases.normalisedAlias],
    });
}

async function applyMatch(
  db: Db,
  investor: InvestorRow,
  facts: CleanFacts,
  matchedBy: Exclude<InvestorMatchedBy, "new">,
): Promise<InvestorResolution> {
  await addAlias(db, investor.id, facts);
  const patch: Partial<typeof investors.$inferInsert> = {};
  if (investor.kind === "unknown" && facts.kind !== "unknown") {
    patch.kind = facts.kind;
  }
  if (!investor.websiteDomain && facts.websiteDomain) {
    patch.websiteDomain = facts.websiteDomain;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(investors).set(patch).where(eq(investors.id, investor.id));
  }
  return { investorId: investor.id, created: false, matchedBy };
}

/**
 * Finds or creates an investor organisation: domain, then exact normalised
 * name or alias. Similar names never merge automatically; they create a new
 * investor and a merge candidate for review.
 */
export async function resolveInvestor(
  db: Db,
  input: InvestorFacts,
): Promise<InvestorResolution> {
  const facts = cleanFacts(input);

  if (facts.websiteDomain) {
    const investor = await findByDomain(db, facts.websiteDomain);
    if (investor) return applyMatch(db, investor, facts, "domain");
  }
  if (facts.normalisedName) {
    const investor = await findByExactName(db, facts.normalisedName);
    if (investor) return applyMatch(db, investor, facts, "exact_name");
  }

  const slug = await allocateSlug(db, investors, facts.name);
  const [row] = await db
    .insert(investors)
    .values({
      slug,
      name: facts.name,
      normalisedName: facts.normalisedName,
      kind: facts.kind,
      websiteDomain: facts.websiteDomain,
    })
    .returning({ id: investors.id });
  if (!row) throw new Error("Investor insert returned no row");
  await addAlias(db, row.id, facts);

  if (facts.normalisedName) {
    const similar = await similarInvestors(db, facts.normalisedName, row.id);
    for (const { investor, score } of similar) {
      await addMergeCandidate(db, {
        entityType: "investor",
        leftId: investor.id,
        rightId: row.id,
        score,
        reason: `trigram ${score.toFixed(2)} to "${investor.normalisedName}"`,
      });
    }
  }
  return { investorId: row.id, created: true, matchedBy: "new" };
}
