import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

/** A fresh in-memory Postgres with every migration applied. Each call is isolated. */
export async function createTestDb(): Promise<TestDb> {
  const client = await PGlite.create({ extensions: { vector, pg_trgm } });
  const db = drizzle({ client, schema });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    await client.close();
    throw error;
  }
  return { db, close: () => client.close() };
}
