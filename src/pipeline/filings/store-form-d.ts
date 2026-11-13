// Storage for SEC Form D (spec-phase3 sections 5.4 and 8.2, D51, D58).
//
// Invariants:
// - pooled investment funds are counted, never stored;
// - only issuer, offering and filing fields are written. The parser has
//   already removed related persons, sales recipients and signatures, and
//   this file maps named fields only, so nothing else can reach a column;
// - filings never change, so a known accession number is left as it is.

import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { FormDStats } from "@/core/domain";
import type { Db } from "@/db/client";
import { edgarIndexDays, formDFilings, sources } from "@/db/schema";
import type { ParsedFormD } from "./form-d-xml";

export const EDGAR_SOURCE_SLUG = "sec-edgar";
const EDGAR_SOURCE_URL = "https://www.sec.gov/Archives/edgar";
const ACCESSION_CHUNK = 1_000;

export type IndexDayStatus = "done" | "missing";

export type StoreFormDOutcome =
  /** A new row was inserted. */
  | "stored"
  /** The accession number was already stored. */
  | "exists"
  /** A pooled investment fund. Nothing was written. */
  | "fund";

export interface IndexDayRecord {
  /** `yyyy-mm-dd`. */
  day: string;
  status: IndexDayStatus;
  formDFound: number;
  formDStored: number;
  fundSkipped: number;
  now: Date;
}

export function emptyFormDStats(): FormDStats {
  return {
    daysFetched: 0,
    daysMissing: 0,
    filingsFound: 0,
    filingsStored: 0,
    fundsSkipped: 0,
    parseFailures: 0,
    linkedByCik: 0,
    linkedByName: 0,
    candidates: 0,
    requests: 0,
  };
}

/** The `sec-edgar` source row, created on first use. */
export async function ensureEdgarSource(db: Db): Promise<number> {
  await db
    .insert(sources)
    .values({
      slug: EDGAR_SOURCE_SLUG,
      name: "SEC EDGAR",
      kind: "sec_edgar",
      url: EDGAR_SOURCE_URL,
    })
    .onConflictDoNothing({ target: sources.slug });
  const [row] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.slug, EDGAR_SOURCE_SLUG));
  if (!row) throw new Error("Could not create the sec-edgar source");
  return row.id;
}

/**
 * Stores one parsed filing. A fund is refused here as well as in the
 * collector, so no caller can store one by mistake.
 */
export async function storeFormDFiling(
  db: Db,
  sourceId: number,
  parsed: ParsedFormD,
  now: Date,
): Promise<StoreFormDOutcome> {
  if (parsed.isFund) return "fund";
  const { facts } = parsed;
  const inserted = await db
    .insert(formDFilings)
    .values({
      sourceId,
      accessionNumber: facts.accessionNumber,
      cik: facts.cik,
      issuerName: facts.issuerName,
      entityType: facts.entityType,
      jurisdiction: facts.jurisdiction ?? null,
      issuerState: facts.issuerState,
      issuerCity: facts.issuerCity,
      yearOfInc: facts.yearOfInc,
      incOverFiveYears: facts.incOverFiveYears ?? false,
      industryGroup: facts.industryGroup,
      isAmendment: facts.isAmendment,
      previousAccessionNumber:
        facts.previousAccessionNumber ?? parsed.previousAccessionNumber,
      dateOfFirstSale: facts.dateOfFirstSale,
      firstSaleYetToOccur: facts.firstSaleYetToOccur ?? false,
      totalOfferingUsdMinor: facts.totalOfferingUsdMinor,
      totalSoldUsdMinor: facts.totalSoldUsdMinor,
      investorCount: facts.investorCount ?? null,
      securities: facts.securities ?? [],
      exemptions: facts.exemptions ?? [],
      filedOn: facts.filedOn,
      fetchedAt: now,
    })
    .onConflictDoNothing({ target: formDFilings.accessionNumber })
    .returning({ id: formDFilings.id });
  return inserted.length > 0 ? "stored" : "exists";
}

/** The accession numbers of this list that are already stored. */
export async function storedAccessions(
  db: Db,
  accessionNumbers: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(accessionNumbers)];
  for (let i = 0; i < unique.length; i += ACCESSION_CHUNK) {
    const chunk = unique.slice(i, i + ACCESSION_CHUNK);
    const rows = await db
      .select({ accessionNumber: formDFilings.accessionNumber })
      .from(formDFilings)
      .where(inArray(formDFilings.accessionNumber, chunk));
    for (const row of rows) out.add(row.accessionNumber);
  }
  return out;
}

/** Records a processed day. A day already recorded is left as it is. */
export async function recordIndexDay(
  db: Db,
  record: IndexDayRecord,
): Promise<void> {
  await db
    .insert(edgarIndexDays)
    .values({
      day: record.day,
      status: record.status,
      formDFound: record.formDFound,
      formDStored: record.formDStored,
      fundSkipped: record.fundSkipped,
      fetchedAt: record.now,
    })
    .onConflictDoNothing({ target: edgarIndexDays.day });
}

/** The latest day with status `done`, or null before the first run. */
export async function latestDoneDay(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ day: edgarIndexDays.day })
    .from(edgarIndexDays)
    .where(eq(edgarIndexDays.status, "done"))
    .orderBy(desc(edgarIndexDays.day))
    .limit(1);
  return row?.day ?? null;
}

/** The earliest recorded day, in any status, or null before the first run. */
export async function earliestRecordedDay(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ day: edgarIndexDays.day })
    .from(edgarIndexDays)
    .orderBy(asc(edgarIndexDays.day))
    .limit(1);
  return row?.day ?? null;
}

/** Days from `from` to `to` (inclusive) already recorded, in any status. */
export async function recordedDays(
  db: Db,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ day: edgarIndexDays.day })
    .from(edgarIndexDays)
    .where(and(gte(edgarIndexDays.day, from), lte(edgarIndexDays.day, to)));
  return new Set(rows.map((row) => row.day));
}
