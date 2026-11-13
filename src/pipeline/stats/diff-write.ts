import { and, eq, getTableColumns, inArray, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DiffCounts } from "@/core/domain";
import type { Db } from "@/db/client";
import {
  companyLocations,
  companyThemes,
  fundingRoundMomentum,
  themeWeeklyStats,
  weeklyTotals,
} from "@/db/schema";

/**
 * Diff writes for derived tables (docs/spec-phase2.md sections 5.3 and 5.6,
 * D37). Only rows that changed are written, so a rebuild with nothing new
 * writes nothing.
 *
 * This is the only place derived rows are deleted, and only from the
 * derived tables below. They hold nothing that cannot be recomputed.
 */

/** The tables in spec section 5.3 that a rebuild may replace rows in. */
export const DERIVED_TABLES = [
  companyThemes,
  themeWeeklyStats,
  weeklyTotals,
  fundingRoundMomentum,
  companyLocations,
] as const;

export type DerivedTable = (typeof DERIVED_TABLES)[number];

/** Rows per insert statement, well under Postgres' 65,535 parameter limit. */
const INSERT_CHUNK = 500;
/** Keys per delete statement. */
const DELETE_CHUNK = 200;

export function emptyDiffCounts(): DiffCounts {
  return { inserted: 0, updated: 0, deleted: 0 };
}

/**
 * A value in a form that compares equal when Postgres would store the same
 * thing. `real` columns hold 32-bit floats, so both sides are rounded to
 * float32 first; otherwise a ratio such as 16 / 3 would never match what
 * was read back.
 */
function comparable(column: PgColumn, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.getTime();
  if (column.columnType === "PgReal" && typeof value === "number") {
    return Math.fround(value);
  }
  return value;
}

function keyOf(
  row: Record<string, unknown>,
  keyColumns: readonly string[],
): string {
  return JSON.stringify(
    keyColumns.map((key) => {
      const value = row[key];
      if (value === undefined || value === null) {
        throw new Error(`Derived row is missing key column ${key}`);
      }
      return value instanceof Date ? value.getTime() : value;
    }),
  );
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Makes `table` hold exactly `rows`: inserts new keys, updates rows whose
 * values changed, and deletes keys no longer produced. Returns the counts.
 *
 * Every row must carry its key columns. A column left `undefined` in a row
 * is not compared, and takes its default on insert (for example a
 * `computed_at` timestamp). Run it inside a transaction so readers never
 * see a half-written table.
 */
export async function writeDiff<T extends DerivedTable>(
  db: Db,
  table: T,
  keyColumns: readonly (keyof T["$inferSelect"] & string)[],
  rows: readonly T["$inferInsert"][],
): Promise<DiffCounts> {
  if (!(DERIVED_TABLES as readonly PgTable[]).includes(table)) {
    throw new Error("writeDiff only writes the derived tables in spec 5.3");
  }
  if (keyColumns.length === 0) {
    throw new Error("writeDiff needs at least one key column");
  }

  const anyTable = table as PgTable;
  const columns = getTableColumns(anyTable) as Record<string, PgColumn>;
  for (const key of keyColumns) {
    if (!columns[key]) throw new Error(`Unknown key column ${key}`);
  }
  const valueColumns = Object.keys(columns).filter(
    (name) => !keyColumns.includes(name as never),
  );

  const wanted = new Map<string, Record<string, unknown>>();
  for (const row of rows as readonly Record<string, unknown>[]) {
    const key = keyOf(row, keyColumns);
    if (wanted.has(key)) throw new Error(`Duplicate derived row key ${key}`);
    wanted.set(key, row);
  }

  const current = new Map<string, Record<string, unknown>>();
  const existing = (await db.select().from(anyTable)) as Record<
    string,
    unknown
  >[];
  for (const row of existing) current.set(keyOf(row, keyColumns), row);

  const keyCondition = (row: Record<string, unknown>): SQL => {
    const conditions = keyColumns.map((key) =>
      eq(columns[key] as PgColumn, row[key]),
    );
    return (
      conditions.length === 1 ? conditions[0] : and(...conditions)
    ) as SQL;
  };

  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{
    row: Record<string, unknown>;
    set: Record<string, unknown>;
  }> = [];
  for (const [key, row] of wanted) {
    const before = current.get(key);
    if (!before) {
      inserts.push(row);
      continue;
    }
    const set: Record<string, unknown> = {};
    for (const name of valueColumns) {
      const value = row[name];
      if (value === undefined) continue;
      const column = columns[name] as PgColumn;
      if (comparable(column, value) !== comparable(column, before[name])) {
        set[name] = value;
      }
    }
    if (Object.keys(set).length > 0) updates.push({ row, set });
  }
  const deletes = [...current]
    .filter(([key]) => !wanted.has(key))
    .map(([, row]) => row);

  for (const batch of chunks(deletes, DELETE_CHUNK)) {
    const condition =
      keyColumns.length === 1
        ? inArray(
            columns[keyColumns[0] as string] as PgColumn,
            batch.map((row) => row[keyColumns[0] as string]),
          )
        : or(...batch.map(keyCondition));
    await db.delete(anyTable).where(condition);
  }
  for (const { row, set } of updates) {
    await db.update(anyTable).set(set).where(keyCondition(row));
  }
  for (const batch of chunks(inserts, INSERT_CHUNK)) {
    await db.insert(anyTable).values(batch);
  }

  return {
    inserted: inserts.length,
    updated: updates.length,
    deleted: deletes.length,
  };
}
