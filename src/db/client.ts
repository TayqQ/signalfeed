import { neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;

/** Any Drizzle Postgres client over this schema: web (Neon HTTP), pipeline (node-postgres) or tests (PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

function isLocalDatabase(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Read-only web client. Neon's HTTP driver in production, which does not support
 * interactive transactions; plain Postgres for a local database, which Neon's
 * driver cannot reach.
 */
export function createWebDb(url: string): Db {
  if (isLocalDatabase(url)) {
    return drizzleNodePg({
      client: new Pool({ connectionString: url, max: 3 }),
      schema,
    });
  }
  return drizzleNeonHttp({ client: neon(url), schema });
}

export interface PipelineDb {
  db: Db;
  close: () => Promise<void>;
}

export function createPipelineDb(url: string): PipelineDb {
  const pool = new Pool({ connectionString: url });
  const db = drizzleNodePg({ client: pool, schema });
  return {
    db,
    close: () => pool.end(),
  };
}
