import "server-only";

import { parseWebEnv } from "@/core/env";
import { createWebDb, type Db } from "@/db/client";

let webDb: Db | undefined;

/** Lazy Neon client. Parsing env happens on first use so `next build` needs no database. */
export function getWebDb(): Db {
  if (!webDb) {
    const { DATABASE_URL } = parseWebEnv(process.env);
    webDb = createWebDb(DATABASE_URL);
  }
  return webDb;
}
