# 004 Database schema and migrations

- **Tier:** 3 (the data model; mistakes here cost migrations later). **Suggested model:** Claude Opus.
- **Depends on:** 003. **Wave:** 3.

## Goal
Implement the full Phase 1 data model in Drizzle and generate the first migration. Provide database clients for the web, the pipeline and tests, a migration runner, and a test-database helper.

## Why it matters
Every later task reads or writes these tables. The schema must already hold acquisitions, launches, investors, location, tags and filing identifiers, so that Phases 2-4 only add tables.

## Read first
- `AGENTS.md`
- `docs/spec.md` (section 5 in full, section 10)
- `docs/decisions.md` (D2, D3, D11, D13, D15, D16, D17)
- `src/core/enums.ts`, `src/core/domain.ts`
- `package.json`, `.github/workflows/ci.yml`

## Files you may create or change
- `src/db/schema.ts`
- `src/db/client.ts`
- `src/db/migrate.ts`
- `src/db/testing.ts`
- `src/db/schema.test.ts`
- `drizzle.config.ts`
- `drizzle/**` (generated migration plus one custom SQL migration if needed)
- `.github/workflows/ci.yml` (add the `migrations` job only)

## Requirements
1. **`schema.ts`:**
   - every table, column, enum, constraint and index from spec section 5, with Postgres enums built from the `src/core/enums.ts` arrays;
   - `bigint` money columns use `{ mode: 'number' }`; timestamps are `timestamp({ withTimezone: true })`;
   - `vector('embedding', { dimensions: 512 })`;
   - GIN trigram indexes use `gin_trgm_ops`;
   - the partial unique index on `extractions(source_item_id) WHERE is_current`;
   - FKs to `events` cascade on delete from detail tables, `event_sources` and `event_investors`;
   - export Drizzle `relations` where useful for queries.
2. **Extensions:** the first migration must run `CREATE EXTENSION IF NOT EXISTS vector;` and `CREATE EXTENSION IF NOT EXISTS pg_trgm;` before the tables are created. Use a custom migration (`drizzle-kit generate --custom`) or edit the generated SQL before it is merged.
3. **`client.ts`:**
   - `export type Db`: a driver-agnostic Drizzle Postgres database type parameterised by the schema, so query code accepts web, pipeline and test clients.
   - `createWebDb(url)` uses the Neon HTTP driver (read-only use, no transactions).
   - `createPipelineDb(url)` uses node-postgres `Pool` and returns `{ db, close() }`.
4. **`migrate.ts`:** loads `.env` if present (`process.loadEnvFile` inside try/catch), runs Drizzle's node-postgres migrator against `DATABASE_URL`, and exits non-zero on failure.
5. **`testing.ts`:** `createTestDb(): Promise<{ db: Db; close(): Promise<void> }>`. It creates a PGlite instance with the `vector` and `pg_trgm` extensions loaded and applies `drizzle/` with Drizzle's PGlite migrator. Each call returns an isolated database. If PGlite cannot load `pg_trgm`, stop and report; don't drop trigram indexes.
6. **CI:** add a `migrations` job using a `pgvector/pgvector:pg17` service container (or the newest available tag). It runs `pnpm db:migrate` against it, then runs it again to prove migrations are idempotent.

## Acceptance criteria
- `pnpm check` passes. `pnpm db:generate` reports no changes (the schema and migrations are in sync).
- `schema.test.ts`, using `createTestDb()`, proves:
  - all tables exist;
  - inserting a company, an investor, a funding-round event with detail, an event investor and an event source works;
  - inserting two `source_items` with the same `canonical_url` fails;
  - a second `is_current` extraction for the same item fails;
  - deleting an event cascades to its detail and link rows;
  - `similarity('acme robotics', 'acme robotic') > 0.6` runs (trigram works);
  - a 512-dimension vector can be stored and read back.
- The CI `migrations` job passes on the task branch.

## Out of scope
- Roles and grants (021), seed data (013), any repository or query functions beyond the test helper.
