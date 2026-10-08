# 021 Deployment [maintainer does account steps]

- **Tier:** 1 (config and documentation; the maintainer performs the account actions). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 016, 017, 018, 019, 020. **Wave:** 7.

## Goal
Deploy the site publicly on Vercel, backed by Neon, with least-privilege database roles. Add a workflow that applies migrations on `main`, and document every step so anyone can self-host.

## Why it matters
The site is a portfolio piece only once it's live. History only starts accumulating once the database exists. The role split guarantees that the public site can't write data or read article summaries.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 5 "Database roles", 8, 11, 12)
- `docs/decisions.md` (D4, D5, D10, D22)
- `docs/sources.md` (A10-A13 results)
- `src/core/env.ts`, `src/db/migrate.ts`, `.env.example`

## Files you may create or change
- `docs/deployment.md`
- `scripts/sql/roles.sql`
- `.github/workflows/migrate.yml`

## Requirements
- **`scripts/sql/roles.sql`** (run once by the owner with `psql -v ingest_password=... -v web_password=...`):
  - creates `signalfeed_ingest` and `signalfeed_web` with `LOGIN`;
  - grants `USAGE` on schema `public`;
  - ingest gets `SELECT, INSERT, UPDATE, DELETE` on all tables and `USAGE, SELECT` on all sequences;
  - web gets `SELECT` on all tables, then `REVOKE SELECT ON source_item_texts`;
  - `ALTER DEFAULT PRIVILEGES` so future tables get the same grants for both roles. This means the web role can read every new table by default, so document in a SQL comment that any future table holding article text or other sensitive data must revoke web access in the task that creates it;
  - is idempotent where Postgres allows it (`DO $$ ... IF NOT EXISTS ... $$`).
- **`.github/workflows/migrate.yml`:**
  - triggers on push to `main` when `drizzle/**` changes, and on `workflow_dispatch`;
  - runs `pnpm db:migrate` with `DATABASE_URL: ${{ secrets.DATABASE_URL_OWNER }}`;
  - `concurrency: migrate`, `permissions: contents: read`.
- **`docs/deployment.md`**, step by step for self-hosters:
  1. create the Neon project (region near the Vercel region) and note the pooled and direct URLs;
  2. run migrations locally once with the owner URL;
  3. run `roles.sql`;
  4. **OpenAI:** create a project key, buy prepaid credits, turn auto-recharge **off**, and set any available project budget limit;
  5. **GitHub secrets:** `DATABASE_URL` (ingest role), `DATABASE_URL_OWNER`, `OPENAI_API_KEY`; **variables:** `INGEST_ENABLED=true`, `EXTRACTION_MODEL`, `LLM_MONTHLY_CAP_GBP`, `HTTP_CONTACT`;
  6. **Vercel:** import the repo with the Next.js preset and set `DATABASE_URL` (web role) for Production and Preview. No other secrets;
  7. verify: the site loads, `/status` shows the empty state, and the web role cannot `INSERT` or read `source_item_texts` (give the `psql` commands);
  8. costs and free-tier limits, from `docs/sources.md`;
  9. a note that Vercel Hobby is non-commercial.

## Maintainer steps
Do steps 1-7 above. Paste the production URL into the pull request. Confirm the two role checks in step 7 fail as expected.

## Acceptance criteria
- `pnpm check` passes. `migrate.yml` is valid: run `pnpm dlx @action-validator/cli .github/workflows/migrate.yml`, or `actionlint` if available.
- The production URL serves `/`, `/about` and `/status`.
- The role checks are recorded in the pull request: the web role's insert is denied, and its select on `source_item_texts` is denied.

## Out of scope
- The ingest schedule (022), a custom domain, README (023).
