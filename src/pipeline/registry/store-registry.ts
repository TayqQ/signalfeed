// Stores what the registry step fetches from Companies House (spec-phase3
// sections 5.3 and 7.3, D57, D58). Organisation facts only: no officers, no
// persons with significant control.

import { and, eq, isNull } from "drizzle-orm";
import type { CapitalFiling, RegistryCompanyFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import { chCompanies, chFilings, companies } from "@/db/schema";

export type StoreProfileResult = "inserted" | "updated" | "unchanged";

/** The `ch_companies` columns a profile sets. `fetched_at` and `first_seen_at` are not here. */
function profileColumns(profile: RegistryCompanyFacts) {
  return {
    name: profile.name,
    status: profile.status,
    statusDetail: profile.statusDetail ?? null,
    companyType: profile.companyType,
    incorporatedOn: profile.incorporatedOn,
    ceasedOn: profile.ceasedOn,
    sicCodes: profile.sicCodes,
    officePostcode: profile.officePostcode,
    officeOutcode: profile.officeOutcode,
    officeLocality: profile.officeLocality ?? null,
    previousNames: profile.previousNames,
    accountsType: profile.accountsType,
    accountsMadeUpTo: profile.accountsMadeUpTo,
    hasInsolvencyHistory: profile.hasInsolvencyHistory ?? false,
    etag: profile.etag ?? null,
  };
}

/**
 * Upserts a profile by company number. The row changes only when the etag
 * changed (or either etag is missing); `fetched_at` is always set.
 */
export async function storeChCompany(
  db: Db,
  profile: RegistryCompanyFacts,
  now: Date,
): Promise<StoreProfileResult> {
  const [existing] = await db
    .select({ etag: chCompanies.etag })
    .from(chCompanies)
    .where(eq(chCompanies.companyNumber, profile.companyNumber));

  if (!existing) {
    await db
      .insert(chCompanies)
      .values({
        companyNumber: profile.companyNumber,
        ...profileColumns(profile),
        fetchedAt: now,
        firstSeenAt: now,
      })
      .onConflictDoUpdate({
        target: chCompanies.companyNumber,
        set: { ...profileColumns(profile), fetchedAt: now },
      });
    return "inserted";
  }

  const etag = profile.etag ?? null;
  if (etag !== null && existing.etag === etag) {
    await db
      .update(chCompanies)
      .set({ fetchedAt: now })
      .where(eq(chCompanies.companyNumber, profile.companyNumber));
    return "unchanged";
  }

  await db
    .update(chCompanies)
    .set({ ...profileColumns(profile), fetchedAt: now })
    .where(eq(chCompanies.companyNumber, profile.companyNumber));
  return "updated";
}

/**
 * Upserts SH01 filings by transaction id. Other capital filing types are not
 * stored. Returns the number of new rows.
 */
export async function storeChFilings(
  db: Db,
  companyNumber: string,
  filings: readonly CapitalFiling[],
  now: Date,
): Promise<number> {
  let inserted = 0;
  for (const filing of filings) {
    if (filing.type.toUpperCase() !== "SH01") continue;
    const values = {
      companyNumber,
      type: filing.type.toUpperCase(),
      category: "capital",
      filedOn: filing.filedOn,
      actionDate: filing.actionDate,
      capital: filing.capital,
      documentId: filing.documentId ?? null,
      fetchedAt: now,
    };
    const [existing] = await db
      .select({ id: chFilings.id })
      .from(chFilings)
      .where(eq(chFilings.transactionId, filing.transactionId));
    if (existing) {
      await db
        .update(chFilings)
        .set(values)
        .where(eq(chFilings.id, existing.id));
      continue;
    }
    const rows = await db
      .insert(chFilings)
      .values({ ...values, transactionId: filing.transactionId })
      .onConflictDoNothing({ target: chFilings.transactionId })
      .returning({ id: chFilings.id });
    inserted += rows.length;
  }
  return inserted;
}

/**
 * Sets `founded_year` to the incorporation year, with source `companies_house`,
 * only when it is empty (D57). A news year is never replaced. No other company
 * column is touched. Returns true when the year was filled.
 */
export async function fillFoundedYear(
  db: Db,
  companyId: number,
  incorporatedOn: string,
): Promise<boolean> {
  const year = Number(incorporatedOn.slice(0, 4));
  if (!/^\d{4}-/.test(incorporatedOn) || !Number.isInteger(year)) return false;
  const rows = await db
    .update(companies)
    .set({ foundedYear: year, foundedYearSource: "companies_house" })
    .where(and(eq(companies.id, companyId), isNull(companies.foundedYear)))
    .returning({ id: companies.id });
  return rows.length > 0;
}
