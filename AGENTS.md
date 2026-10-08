# AGENTS.md

SignalFeed collects startup news, extracts structured facts with an LLM, merges them into companies and events, and shows them on a read-only website. Spec: `docs/spec.md`. Decisions: `docs/decisions.md`.

## Stack
- TypeScript (strict), Node LTS, pnpm
- Next.js App Router + Tailwind CSS (web, `src/app`)
- Postgres on Neon + pgvector + pg_trgm, Drizzle ORM, drizzle-kit migrations
- Zod for every external boundary (env, LLM output, feeds, URL params)
- OpenAI API behind the `LlmClient` port; pipeline runs as a CLI on GitHub Actions
- Vitest + PGlite for tests; ESLint + Prettier

## Commands
- `pnpm install` / `pnpm dev`
- `pnpm check`: lint, typecheck and test. This must pass before you finish.
- `pnpm build`: must pass without a database
- `pnpm db:generate` (only the task that owns `src/db/schema.ts`) / `pnpm db:migrate`
- `pnpm pipeline <run|collect|extract|resolve|fx|reextract>`
- `pnpm entities <candidates|merge|dismiss|alias>`
- `pnpm eval --replay | --live`

## Layout
- `src/core/`: shared types, enums, Zod schemas, port interfaces, env schemas. No I/O.
- `src/db/`: schema, clients, test DB helper (`testing.ts`), read queries (`queries/`)
- `src/lib/`: pure helpers (normalise, money, format, regions) + HTTP fetcher
- `src/pipeline/`: collect, extract, budget, resolve, fx, store, run
- `src/cli/`: CLI entry points
- `src/eval/`: extraction accuracy eval
- `src/app/`, `src/components/`: web UI
- `fixtures/`: test and eval fixtures (synthetic feeds, extraction cases)
- `drizzle/`: generated migrations, never edited by hand once merged
- `docs/tasks/`: one file per task

## Conventions
- Import via `@/` (maps to `src/`). `src/app` and `src/components` must not import `src/pipeline`, and vice versa.
- Money is integer minor units (`number`), with an ISO 4217 currency next to it. Dates are UTC.
- Prefer pure functions that take ports (`HttpFetcher`, `LlmClient`, `BudgetGuard`, `Clock`) as arguments.
- Tests sit next to their code as `*.test.ts(x)`. DB tests use `createTestDb()` from `src/db/testing.ts`.
- Tests never touch the network or real APIs. `fetch` throws in tests.
- Every LLM call goes through `BudgetGuard`. No web route may trigger ingestion or LLM calls.
- Never display `source_item_texts.summary` or any article text. Show headlines, links and extracted facts only.
- Never store names of individual people or contact details.
- No special cases for specific headlines or company names. Fix rules and add a test.
- Never delete historical data in code paths.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Task rules
- Work from one task file in `docs/tasks/`. Read only the files it lists, plus this file.
- **Edit only the files your task lists under "Files you may create or change".** If you need another file, stop and explain why instead of editing it.
- Do not add dependencies unless your task says so.
- Finish with `pnpm check` (and `pnpm build` if you touched `src/app` or config) passing, and report the commands you ran.
