// Shared registered offices (spec-phase3 section 7.3, D57, D61, A37, A47).
// Many companies register at a formation agent or an accountant. Such an
// address says nothing about where a company works, so it is not used as a
// location or as the S2 signal.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { chAddressCounts, chCompanies, registryLinks } from "@/db/schema";
import { parseUkPostcode } from "@/lib/geo/postcode";
import type { ChClient } from "./ch-client";

/** At this many active companies or more, a postcode is a shared address. */
export const SHARED_ADDRESS_THRESHOLD = 20;
/** A stored count is reused for this many days. */
export const ADDRESS_COUNT_MAX_AGE_DAYS = 180;
/**
 * When Companies House cannot count a postcode, this many of SignalFeed's own
 * linked companies at the same full postcode make it shared.
 */
export const LINKED_FALLBACK_THRESHOLD = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "ec2a4ne" gives "EC2A 4NE". Null for text that is not a full postcode. */
export function formatPostcode(postcode: string): string | null {
  const parsed = parseUkPostcode(postcode);
  return parsed ? `${parsed.outcode} ${parsed.incode}` : null;
}

/** The stored count for a postcode when it is under 180 days old, else null. */
export async function freshAddressCount(
  db: Db,
  postcode: string,
  now: Date,
): Promise<number | null> {
  const key = formatPostcode(postcode);
  if (key === null) return null;
  const [row] = await db
    .select()
    .from(chAddressCounts)
    .where(eq(chAddressCounts.postcode, key));
  if (!row) return null;
  const age = now.getTime() - row.checkedAt.getTime();
  return age < ADDRESS_COUNT_MAX_AGE_DAYS * DAY_MS ? row.activeCompanies : null;
}

/** Linked companies whose registered office has this full postcode. */
async function linkedCompaniesAt(db: Db, postcode: string): Promise<number> {
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${registryLinks.companyId})::int` })
    .from(registryLinks)
    .innerJoin(
      chCompanies,
      eq(chCompanies.companyNumber, registryLinks.registryId),
    )
    .where(
      and(
        eq(registryLinks.registry, "companies_house"),
        eq(registryLinks.status, "linked"),
        sql`upper(replace(${chCompanies.officePostcode}, ' ', '')) = ${compact}`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * True when the full postcode is a shared address: 20 or more active companies
 * (from the cache, or one request to Companies House, then cached). When
 * Companies House cannot count it, 3 or more of SignalFeed's linked companies
 * there. A text that is not a full postcode is never shared.
 */
export async function isSharedAddress(
  db: Db,
  client: Pick<ChClient, "countActiveAtPostcode">,
  postcode: string,
  now: Date,
): Promise<boolean> {
  const key = formatPostcode(postcode);
  if (key === null) return false;

  const cached = await freshAddressCount(db, key, now);
  if (cached !== null) return cached >= SHARED_ADDRESS_THRESHOLD;

  const count = await client.countActiveAtPostcode(key);
  if (count === null) {
    return (await linkedCompaniesAt(db, key)) >= LINKED_FALLBACK_THRESHOLD;
  }
  const values = { activeCompanies: Math.max(0, count), checkedAt: now };
  await db
    .insert(chAddressCounts)
    .values({ postcode: key, ...values })
    .onConflictDoUpdate({ target: chAddressCounts.postcode, set: values });
  return count >= SHARED_ADDRESS_THRESHOLD;
}
