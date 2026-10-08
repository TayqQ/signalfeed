# Decisions

Each entry records the decision, the alternatives considered, and why. New decisions are appended. Superseded entries are marked, not deleted.

## D1. One TypeScript package for the web app and the pipeline
- **Chosen:** a single Next.js project. The pipeline lives in `src/pipeline` and runs as a CLI. Lint rules enforce the boundaries between folders.
- **Alternatives:** a pnpm monorepo (`apps/web`, `packages/pipeline`); a separate Python pipeline.
- **Why:** one install, one tsconfig and one test runner make each task cheaper for a fresh agent. Shared types need no publishing step. Import-restriction lint rules give most of the isolation a monorepo would. We can split later if the pipeline outgrows this.

## D2. Drizzle ORM with drizzle-kit migrations
- **Alternatives:** Prisma; Kysely plus a separate migration tool.
- **Why:** schema-as-TypeScript with SQL-like queries. It has first-class `vector` column support and no native engine binary. It works with the Neon HTTP driver, node-postgres and PGlite through one API. Prisma needs raw SQL for pgvector and is heavier in serverless.

## D3. Neon Postgres with pgvector and pg_trgm
- **Alternatives:** Supabase; SQLite/Turso.
- **Why:** real Postgres with a free tier that suspends when idle. `pg_trgm` gives fuzzy name matching inside the database, and pgvector supports theme clustering in Phase 2. Supabase is also good but bundles auth and storage we don't need yet. SQLite would make vectors and concurrent writes harder.

## D4. Scheduled ingestion on GitHub Actions cron
- **Alternatives:** Vercel Cron; Trigger.dev or Inngest; a small VPS.
- **Why:** free for public repos, with long run times. Secrets stay out of the web host, and logs are public and inspectable. Vercel Hobby cron is limited and runs inside short function timeouts. A hosted job service adds an account and another free tier to watch.
- **Trade-off:** cron start times are best-effort, and GitHub disables schedules after 60 days of repo inactivity (A13). Both are acceptable for a 3-hourly batch.

## D5. The web app cannot trigger ingestion or spend money
- **Chosen:** no HTTP route starts any pipeline step. The web app uses a read-only Postgres role that cannot read `source_item_texts`, and its environment has no LLM key.
- **Why:** this is least privilege. A previous design let page visits trigger paid LLM calls. Making that impossible by construction is stronger than guarding it with checks.

## D6. OpenAI behind our own `LlmClient` port, paid with prepaid credits
- **Alternatives:** Google Gemini (free tier, postpaid billing with alert-only budgets); Anthropic Haiku (prepaid, but several times the price per token and no embeddings); the Vercel AI SDK as a provider abstraction.
- **Why:** prepaid credits with auto-recharge off give a provider-enforced ceiling on top of our own cap. OpenAI's cheap models support strict JSON-schema output, and the same account covers embeddings. A small interface that we own (`complete({system, user, schema})`) keeps the provider swappable in one adapter file and easy to fake in tests, without coupling to a fast-moving SDK abstraction.
- **Model choice:** we don't fix a model here. The eval (Task 014) picks the cheapest model that meets the accuracy targets.

## D7. Extract from headline and feed summary only
- **Alternatives:** fetch and parse each article page.
- **Why:** this avoids scraping and publisher-terms risk, keeps tokens low, and needs no HTML parsing per site. The cost is lower recall for investor lists and locations. That limitation is documented in the README.

## D8. The LLM finds facts; code computes values
- **Chosen:** the LLM returns `amountText` verbatim ("€3.5M"), and `src/lib/money.ts` parses it. Domains are kept only if they appear in the source text. Tags are normalised in code.
- **Why:** models are unreliable at unit scaling and invent plausible domains. Deterministic parsing is unit-tested and can be re-run without paying again.

## D9. Process each item once; re-extraction is explicit
- **Chosen:** extractions are unique on (item, prompt version, model). Pipeline steps select only pending or unresolved rows. Re-extraction is a separate command with a dry-run cost estimate and a required `--yes`.
- **Why:** a previous design reprocessed every row with paid calls on each server start. Idempotent steps make reruns free and safe.

## D10. Spend cap in three layers that fail closed
- **Chosen:**
  1. An app-level monthly guard checked before every call, using worst-case cost. Unknown model prices are refused.
  2. A per-run item limit.
  3. Provider prepaid credits.
- **Why:** each layer covers a different failure: a logic bug, a runaway loop, a leaked key. The default cap is £3, just above the estimated £0.25-£2.50 a month. That keeps the worst case close to normal spend, at the cost of pausing ingestion if volume or model price comes in higher than estimated. The status page shows when that happens.

## D11. Deterministic entity resolution plus a review queue (no embeddings in Phase 1)
- **Alternatives:** LLM-judged matching; embedding similarity; hard-coded fixes.
- **Why:** rules are explainable, testable and free. Domain, exact normalised name, and fuzzy name confirmed by a matching event cover the common duplicate patterns. Ambiguous cases go to `merge_candidates` for a person to decide, rather than being guessed. Embedding columns exist in the schema so Phase 2 can add semantic signals without a migration. There is no fallback "embedding" made from a non-deterministic hash.

## D12. Events are derived from extractions
- **Chosen:** canonical event fields are recomputed from every linked extraction each time something changes, using majority vote, then source priority, then the earliest item.
- **Why:** the result doesn't depend on arrival order, new evidence can correct old values, and re-extraction can rebuild events without guesswork.

## D13. Class-table inheritance for events
- **Alternatives:** one wide table with nullable columns; a JSONB details column; fully separate tables.
- **Why:** a shared `events` table gives one timeline query and one `event_sources` link table. Typed detail tables keep constraints and indexes on amounts and round types. JSONB would make Phase 2 aggregations slower and unchecked.

## D14. Free-form tags now, themes later
- **Alternatives:** a fixed sector list.
- **Why:** a fixed list of 7 sectors could not surface new themes. Phase 1 stores 0-5 free-form tags per company. Phase 2 clusters tag embeddings into themes in new tables, leaving raw tags untouched.

## D15. Keep all history
- **Why:** trends need long baselines. Storage grows by about 10 MB/month, which fits the free tier for years. If space ever runs out, we archive rather than delete.

## D16. Money as integer minor units: original, USD and GBP
- **Chosen:** store the original amount and currency, plus USD and GBP converted at the ECB reference rate for the announcement date (via Frankfurter). The UI shows GBP first, with the original amount alongside.
- **Why:** integers avoid floating-point errors. Most funding news and most databases use USD, so storing USD keeps numbers comparable with sources. GBP suits the UK focus and the later UK leads audience. Storing both converted values keeps queries simple (sorting and filtering without joining rates).

## D17. Vitest and PGlite for tests; no network
- **Alternatives:** a Docker Postgres for every test run; mocking the ORM.
- **Why:** PGlite is real Postgres in-process, with `vector` and `pg_trgm`, so tests run anywhere, including several git worktrees at once, with no setup. A CI job still applies migrations to a real Postgres container to catch differences. Making `fetch` throw in tests keeps them deterministic and free.

## D18. Cached server rendering; the build needs no database
- **Why:** caching reads for 10 minutes keeps Neon compute asleep most of the time. Building without a database keeps CI and preview deploys simple.

## D19. No personal data
- **Chosen:** investors are organisations only. Mentions of individual angels become a boolean flag. No founder names and no contact details.
- **Why:** names of individuals are personal data under UK GDPR. They aren't needed for the product's questions, and leaving them out removes the compliance burden. Any change needs a separate, documented decision.

## D20. Eval fixtures use real headlines with summaries written in our own words
- **Why:** headlines and URLs make the test realistic. Feed summaries are publisher text, so we don't commit them to a public repo. Each fixture paraphrases the facts instead. This makes the eval slightly easier than live input, and the README says so.

## D21. AGPL-3.0
- **Why:** anyone running a modified public instance must share their changes. As sole copyright holder, the maintainer can still run a paid hosted version. Outside contributions would need a contributor licence agreement (CLA) if dual licensing is ever wanted. That is noted in `CONTRIBUTING.md`.

## D22. Vercel Hobby for now
- **Why:** it's free and integrates with Next.js. Hobby forbids commercial use (A12). A paid product in Phase 4 means moving to Vercel Pro or to another host (Cloudflare, Netlify, Fly). The app avoids Vercel-only APIs so that move stays easy.

## D23. Tooling: pnpm, Node LTS, ESLint flat config and Prettier
- **Why:** pnpm's shared store makes several worktree installs cheap. ESLint with `eslint-config-next` catches Next.js-specific mistakes and enforces import boundaries. Prettier ends formatting debates. All are widely recognised.

## D24. Explicit sort semantics
- **Chosen:** relevance ordering applies only when a search query is present (and no explicit sort is chosen). Date is a tie-breaker, never the primary key in relevance mode. A test locks this in.
- **Why:** a previous design sorted by date first, so relevance had no effect.

## D25. Task-based development with file ownership
- **Chosen:** work is split into numbered task files. Each lists the files it may touch. Tasks in the same wave never share a file. Shared contracts (`src/core`, `src/db/schema.ts`, `package.json`) each belong to exactly one task.
- **Why:** this allows parallel work in separate git worktrees without merge conflicts, and each task is reviewable on its own.
