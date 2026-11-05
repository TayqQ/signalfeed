import { sql } from "drizzle-orm";
import { Client } from "pg";
import { ConfigError } from "@/core/errors";
import type { Db } from "@/db/client";

/** Constant key for `pg_try_advisory_lock`. Only one ingest run may hold it. */
export const INGEST_LOCK_KEY = BigInt("7242031906");

export interface IngestLock {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}

export type LockedResult<T> = { ran: false } | { ran: true; result: T };

export async function withIngestLock<T>(
  lock: IngestLock,
  fn: () => Promise<T>,
): Promise<LockedResult<T>> {
  if (!(await lock.tryAcquire())) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await lock.release();
  }
}

/**
 * Session advisory locks belong to one connection, so a pooler breaks them:
 * the unlock can reach another backend, and the lock can vanish when an idle
 * connection is closed. Neon marks pooled hosts with `-pooler`.
 */
export function assertDirectConnection(databaseUrl: string): void {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new ConfigError([], ["DATABASE_URL"]);
  }
  if (host.includes("-pooler")) {
    throw new Error(
      "The pipeline needs a direct database URL: advisory locks do not work through a connection pooler. Remove '-pooler' from the host.",
    );
  }
}

/** Holds the lock on its own connection, separate from the query pool, for the whole run. */
export function dedicatedConnectionLock(databaseUrl: string): IngestLock {
  assertDirectConnection(databaseUrl);
  const client = new Client({
    connectionString: databaseUrl,
    keepAlive: true,
    application_name: "signalfeed-ingest-lock",
  });
  // A dropped lock connection must not crash the process mid-run with an
  // unhandled 'error' event; the workflow's concurrency group is the backstop.
  client.on("error", (error) => {
    console.error(`Ingest lock connection lost: ${error.message}`);
  });
  let connected = false;

  return {
    async tryAcquire() {
      await client.connect();
      connected = true;
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1::bigint) as locked",
        [INGEST_LOCK_KEY.toString()],
      );
      const locked = result.rows[0]?.locked === true;
      // An open connection keeps the process alive, so close it if we lost out.
      if (!locked) await this.release();
      return locked;
    },
    async release() {
      if (!connected) return;
      connected = false;
      // Closing the connection releases a session lock.
      await client.end().catch(() => undefined);
    },
  };
}

/** For single-connection databases, which is what PGlite tests use. */
export function singleConnectionLock(db: Db): IngestLock {
  return {
    async tryAcquire() {
      const result = await db.execute(
        sql`select pg_try_advisory_lock(${INGEST_LOCK_KEY.toString()}::bigint) as locked`,
      );
      const rows = (result as { rows: Array<{ locked: boolean }> }).rows;
      return rows[0]?.locked === true;
    },
    async release() {
      await db.execute(
        sql`select pg_advisory_unlock(${INGEST_LOCK_KEY.toString()}::bigint)`,
      );
    },
  };
}
