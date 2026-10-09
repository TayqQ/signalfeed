import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FxRates } from "@/core/domain";
import type { Db } from "@/db/client";
import { fxRates } from "@/db/schema";

export interface LatestRate {
  date: string;
  perEur: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function shiftIsoDate(isoDate: string, days: number): string {
  const match = ISO_DATE.exec(isoDate);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (!yearText || !monthText || !dayText) {
    throw new Error(
      `Invalid FX rate date: expected YYYY-MM-DD, got ${isoDate}`,
    );
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`Invalid FX rate date: ${isoDate}`);
  }

  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Insert or replace every currency in this ECB rate set. */
export async function upsertRates(db: Db, rates: FxRates): Promise<void> {
  const rows = Object.entries(rates.perEur).map(([currency, perEur]) => ({
    rateDate: rates.date,
    currency,
    perEur,
  }));
  if (rows.length === 0) return;

  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.rateDate, fxRates.currency],
      set: { perEur: sql`excluded.per_eur` },
    });
}

/**
 * Rates for `date`, or the nearest earlier stored day within `maxDaysBack`.
 * Returns null when nothing in that window exists.
 */
export async function getRatesOnOrBefore(
  db: Db,
  date: string,
  maxDaysBack = 7,
): Promise<FxRates | null> {
  const earliest = shiftIsoDate(date, -maxDaysBack);
  const rows = await db
    .select()
    .from(fxRates)
    .where(and(lte(fxRates.rateDate, date), gte(fxRates.rateDate, earliest)));
  const first = rows[0];
  if (!first) return null;

  let bestDate = first.rateDate;
  for (const row of rows) {
    if (row.rateDate > bestDate) bestDate = row.rateDate;
  }

  const perEur: Record<string, number> = {};
  for (const row of rows) {
    if (row.rateDate !== bestDate) continue;
    perEur[row.currency.trim()] = row.perEur;
  }

  return { date: bestDate, perEur };
}

/** The newest stored ECB rate for one currency. */
export async function latestRate(
  db: Db,
  currency: string,
): Promise<LatestRate | null> {
  const [row] = await db
    .select({
      rateDate: fxRates.rateDate,
      perEur: fxRates.perEur,
    })
    .from(fxRates)
    .where(eq(fxRates.currency, currency))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);

  if (!row) return null;
  return { date: row.rateDate, perEur: row.perEur };
}

/** Dates in `dates` that have no stored rate, in first-seen order. */
export async function missingRateDates(
  db: Db,
  dates: readonly string[],
): Promise<string[]> {
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const date of dates) {
    if (seen.has(date)) continue;
    seen.add(date);
    wanted.push(date);
  }
  if (wanted.length === 0) return [];

  const rows = await db
    .selectDistinct({ rateDate: fxRates.rateDate })
    .from(fxRates)
    .where(inArray(fxRates.rateDate, wanted));
  const present = new Set(rows.map((row) => row.rateDate));
  return wanted.filter((date) => !present.has(date));
}
