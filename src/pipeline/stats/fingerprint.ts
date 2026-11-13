import { createHash } from "node:crypto";
import { eq, getTableName, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import {
  companies,
  companyTags,
  derivedRebuilds,
  events,
  fundingRounds,
  tagThemes,
  themes,
} from "@/db/schema";

/**
 * Input fingerprints for derived rebuilds (docs/spec-phase2.md section 5.3,
 * D37). A fingerprint hashes row counts and latest timestamps of the input
 * tables, plus a few column sums that change when a row is edited without
 * moving a timestamp (a merge, a theme move, an FX backfill). Reading these
 * is far cheaper than rewriting the derived tables.
 */

export interface FingerprintInput {
  table: PgTable;
  /** Columns whose maximum is included, usually timestamps. */
  latest?: readonly PgColumn[];
  /** Expressions whose sum is included, such as a foreign key that a merge moves. */
  sums?: ReadonlyArray<PgColumn | SQL>;
}

/**
 * Bumped when the stats rebuild logic changes, so the next run rebuilds
 * even though no input has changed.
 */
export const STATS_LOGIC_VERSION = "stats-v1";

/** The inputs of the stats rebuild: events, rounds, tags, themes and companies. */
export const STATS_INPUTS: readonly FingerprintInput[] = [
  {
    table: events,
    latest: [events.updatedAt, events.firstSeenAt],
    sums: [
      events.companyId,
      sql`(${events.announcedOn} - date '2000-01-01')`,
      sql`hashtext(${events.type}::text || ${events.datePrecision}::text)`,
    ],
  },
  {
    table: fundingRounds,
    sums: [
      fundingRounds.eventId,
      fundingRounds.amountGbpMinor,
      sql`hashtext(${fundingRounds.roundType}::text)`,
    ],
  },
  {
    table: companyTags,
    latest: [companyTags.lastSeenAt],
    sums: [companyTags.companyId, companyTags.tagId],
  },
  {
    table: tagThemes,
    latest: [tagThemes.assignedAt],
    sums: [tagThemes.tagId, tagThemes.themeId],
  },
  {
    table: themes,
    latest: [themes.createdAt],
    sums: [themes.mergedIntoId, sql`hashtext(${themes.status}::text)`],
  },
  {
    table: companies,
    latest: [companies.updatedAt, companies.firstSeenAt],
    sums: [companies.mergedIntoId],
  },
];

async function describeInput(db: Db, input: FingerprintInput): Promise<string> {
  const fields: Record<string, SQL> = {
    rows: sql`count(*)::text`,
  };
  (input.latest ?? []).forEach((column, index) => {
    fields[`latest${index}`] = sql`max(${column})::text`;
  });
  (input.sums ?? []).forEach((expression, index) => {
    fields[`sum${index}`] = sql`sum(${expression})::text`;
  });
  const [row] = (await db.select(fields).from(input.table)) as Array<
    Record<string, string | null>
  >;
  const values = Object.keys(fields).map((key) => String(row?.[key] ?? ""));
  return `${getTableName(input.table)}:${values.join(",")}`;
}

/** A SHA-256 hex digest of the inputs' counts, latest timestamps and sums. */
export async function computeFingerprint(
  db: Db,
  version: string,
  inputs: readonly FingerprintInput[],
): Promise<string> {
  const parts = [version];
  for (const input of inputs) parts.push(await describeInput(db, input));
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/** The fingerprint of the stats rebuild's inputs. */
export function statsFingerprint(db: Db): Promise<string> {
  return computeFingerprint(db, STATS_LOGIC_VERSION, STATS_INPUTS);
}

/** True when `name` has never been rebuilt, or its inputs have changed since. */
export async function shouldRebuild(
  db: Db,
  name: string,
  fingerprint: string,
): Promise<boolean> {
  const [row] = await db
    .select({ fingerprint: derivedRebuilds.inputFingerprint })
    .from(derivedRebuilds)
    .where(eq(derivedRebuilds.name, name));
  return row?.fingerprint !== fingerprint;
}

/** Stores the fingerprint a rebuild used, so the next identical run is skipped. */
export async function recordRebuild(
  db: Db,
  name: string,
  fingerprint: string,
  rebuiltAt: Date,
): Promise<void> {
  await db
    .insert(derivedRebuilds)
    .values({ name, inputFingerprint: fingerprint, rebuiltAt })
    .onConflictDoUpdate({
      target: derivedRebuilds.name,
      set: { inputFingerprint: fingerprint, rebuiltAt },
    });
}
