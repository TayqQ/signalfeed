import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  investorAliases,
  investors,
} from "@/db/schema";
import { normaliseCompanyName, normaliseInvestorName } from "@/lib/normalise";
import { allocateSlug } from "./slugs";
import type { CompanyFacts, Corroboration, InvestorFacts } from "./types";

// Test builders shared by the resolve tests and Task 015. Not for production code.

export function companyFacts(
  overrides: Partial<CompanyFacts> = {},
): CompanyFacts {
  return {
    name: "Acme",
    websiteDomain: null,
    description: null,
    countryCode: null,
    city: null,
    foundedYear: null,
    tags: [],
    ...overrides,
  };
}

export function investorFacts(
  overrides: Partial<InvestorFacts> = {},
): InvestorFacts {
  return {
    name: "Example Ventures",
    kind: "vc",
    websiteDomain: null,
    ...overrides,
  };
}

export const neverCorroborates: Corroboration = () => Promise.resolve(false);

/** Corroborates only the given company ids. */
export function corroboratesOnly(...companyIds: number[]): Corroboration {
  const allowed = new Set(companyIds);
  return (candidateCompanyId) =>
    Promise.resolve(allowed.has(candidateCompanyId));
}

/** A clock that starts at `start` and moves forward one second per call. */
export function steppingClock(start = new Date("2026-01-01T00:00:00Z")): Clock {
  let next = start.getTime();
  return {
    now() {
      const value = new Date(next);
      next += 1000;
      return value;
    },
  };
}

export type CompanyInsert = typeof companies.$inferInsert;
export type InvestorInsert = typeof investors.$inferInsert;

/** Inserts a company row and its name alias directly, bypassing the matcher. */
export async function insertCompany(
  db: Db,
  values: Partial<CompanyInsert> & { name: string },
): Promise<typeof companies.$inferSelect> {
  const normalisedName =
    values.normalisedName ?? normaliseCompanyName(values.name);
  const [row] = await db
    .insert(companies)
    .values({
      ...values,
      slug: values.slug ?? (await allocateSlug(db, companies, values.name)),
      normalisedName,
    })
    .returning();
  if (!row) throw new Error("Company insert returned no row");
  await db.insert(companyAliases).values({
    companyId: row.id,
    alias: values.name,
    normalisedAlias: normalisedName,
    source: "extraction",
  });
  return row;
}

/** Inserts an investor row and its name alias directly, bypassing the matcher. */
export async function insertInvestor(
  db: Db,
  values: Partial<InvestorInsert> & { name: string },
): Promise<typeof investors.$inferSelect> {
  const normalisedName =
    values.normalisedName ?? normaliseInvestorName(values.name);
  const [row] = await db
    .insert(investors)
    .values({
      ...values,
      slug: values.slug ?? (await allocateSlug(db, investors, values.name)),
      normalisedName,
    })
    .returning();
  if (!row) throw new Error("Investor insert returned no row");
  await db.insert(investorAliases).values({
    investorId: row.id,
    alias: values.name,
    normalisedAlias: normalisedName,
    source: "extraction",
  });
  return row;
}
