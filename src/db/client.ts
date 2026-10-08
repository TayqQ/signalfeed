import { neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;

/** Any Drizzle Postgres client over this schema: web (Neon HTTP), pipeline (node-postgres) or tests (PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** Read-only web client over Neon's HTTP driver. It does not support interactive transactions. */
export function createWebDb(url: string): Db {
  return drizzleNeonHttp({ client: neon(url), schema });
}

export interface PipelineDb {
  db: Db;
  close(): Promise<void>;
}

export function createPipelineDb(url: string): PipelineDb {
  const pool = new Pool({ connectionString: url });
  const db = drizzleNodePg({ client: pool, schema });
  return {
    db,
    close: () => pool.end(),
  };
}
