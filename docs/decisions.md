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
- **Trade-off:** cron start times are best-effort, and GitHub disables schedules after 60 days of repo inactivity (A13). The schedule is hourly because EU-Startups only keeps about a day of items (A3). That still fits Neon's free compute allowance.

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
- **Why:** each layer covers a different failure: a logic bug, a runaway loop, a leaked key. The default cap is £3. Measured volume puts normal spend at about £0.10-£0.80 a month, so the cap is headroom rather than the expected bill. Ingestion pauses if spend reaches it, and the status page shows that.

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

## D26. Which feeds are on in Phase 1
- **Chosen:** TechCrunch Venture, Crunchbase News, Tech.eu, EU-Startups and UKTN. Sifted is off. Ingest runs hourly.
- **Why:** Sifted's RSS feed has no article summary, and its terms ban using the content to develop or validate AI. Crunchbase's terms ban training models on its content; the maintainer decided on 8 October 2026 that fact extraction is not training, so that feed stays on. Commercial reuse is still a Phase 4 question for every publisher. Hourly polling is required because EU-Startups only keeps about a day of items.

## D27. Collect without an LLM key, and start early
- **Chosen:** `pnpm ingest run` works with no `OPENAI_API_KEY`. It collects, prefilters and keeps items pending, and `/status` says extraction is off.
- **Why:** RSS has no backfill, so each day without collecting is history lost for good. Collecting is free and items can be extracted later, so spending and collecting should not have to start together.

## D28. Country is scored only where the model states one
- **Chosen:** in the extraction eval, a model that returns null for a country counts as abstaining, reported as coverage. A stated country is right or wrong.
- **Why:** 7 of the 22 expected countries are not in the fixture text, and the prompt says not to guess. Scoring null as wrong would cap an obedient model at 68% against an 80% target, and reward guessing. Guessed countries also cause harm downstream, because a country conflict can split a company.

## D29. Fuzzy company matches need amounts that agree
- **Chosen:** this narrows spec section 7. A fuzzy name is confirmed only by agreeing amounts, not by a shared round type alone. Separately, an exact name with a differing country still matches if the event agrees. Differing domains never match.
- **Why:** seed is the most common round, so a shared round type within 45 days is weak evidence. A wrong merge corrupts two companies and is hard to spot, while a missed one waits in the review queue (D11). Countries are often inferred, so they should not outweigh matching event facts.

## D30. The run lock has its own direct connection
- **Chosen:** the lock lives on a dedicated connection, separate from the query pool. The pipeline refuses a Neon `-pooler` URL.
- **Why:** session advisory locks belong to one connection. Through a pool the unlock can reach another backend, and an idle-connection close can drop the lock mid-run. The in-process test database has a single connection and would hide this, so it was also tested against real Postgres with a competing session.

## D31. The script is `pnpm ingest`, not `pnpm pipeline`
- **Why:** pnpm 12 has a built-in `pipeline` command that takes priority over the script, so `pnpm pipeline run` fails. Task files written earlier still say `pnpm pipeline`.

## D32. Roundups count as events, with an approximate date
- **Chosen:** a roundup that names completed raises gives one event per raise. With no stated date, those events are marked `month` precision.
- **Why:** this matches the fixtures. A roundup can recap older rounds, so its publish date is only approximate, and the company page says "Around".

## D33. Extraction v2 adds `regionText` and tighter city and tag rules
- **Chosen:** one new nullable field, `company.regionText`, copied as the text states it ("Scottish", "Yorkshire"). Code maps it to an ITL1 region. The prompt (`v2`) also asks for a plain town name and for specific, industry-standard tags, with generic words banned. The change lands in wave 1, before any paid extraction.
- **Alternatives:** no change; a fixed `sector` field; an ITL1 code chosen by the model; extra fields such as employee count or B2B/B2C.
- **Why:** UK news often names a nation or region without a town, and V1 would lose it for good unless items were re-extracted. Copying text and mapping it in code follows D8. A sector field would make the model classify, which themes and the sector map do in code (D34, D35). Employee counts are rarely stated. Doing this before the first paid run means no re-extraction is needed.

## D34. Themes by greedy centroid assignment
- **Chosen:** tags are processed in a fixed order (mentions, then slug). Each joins the most similar theme centroid if cosine similarity is at least τ, otherwise it starts a new theme. τ is chosen by a labelled eval (Task 039). People can merge, move and rename.
- **Alternatives:** k-means (needs k, reshuffles themes on every run); HDBSCAN (no maintained TypeScript implementation, and also reshuffles); agglomerative clustering (O(n²) memory and a full rebuild each time); asking an LLM to group tags (costly, not reproducible).
- **Why:** the method is incremental and stable. Old themes never move when new tags arrive, so theme slugs can be stored in saved searches. It is deterministic given stored embeddings, and each link records its similarity. The cost is order dependence, which the manual tools correct.

## D35. Theme slugs come from the seed tag; names belong to people
- **Chosen:** a theme's slug is its first tag's slug and never changes. The LLM suggests a name and a sector once. Manual names and sectors are never overwritten. Merged themes redirect.
- **Why:** an LLM name is a guess, and a slug derived from it would freeze the guess into URLs. The seed tag is meaningful and stable. Keeping the human decision final avoids an automated step undoing a review.

## D36. Rising score: a shrunk log ratio against the baseline share
- **Chosen:** *s* = ln((*r* + 3) / (*e* + 3)), where *e* is the theme's baseline share of rounds applied to the recent total. 8 recent weeks, up to 26 baseline weeks, at least 8 weeks of baseline. Counts, not money. Grants excluded. Themes need at least 3 recent rounds to be listed.
- **Alternatives:** a raw growth ratio (explodes on tiny counts); a z-score (unstable when expected counts are near 0); a Bayesian model with a fitted prior (harder to explain and test).
- **Why:** the pseudo-count shrinks small counts towards 0, so one round cannot top the chart, and leaves large counts almost untouched. Comparing shares, not raw counts, cancels growth in overall coverage. The score reads simply as "about 2× its usual share". Money is excluded because round sizes are heavy-tailed.

## D37. Derived tables are rebuilt as diffs, and only when inputs change
- **Chosen:** `company_themes`, `theme_weekly_stats`, `weekly_totals`, `funding_round_momentum` and `company_locations` are recomputed from source tables. Only changed rows are written, and the rebuild is skipped when an input fingerprint is unchanged.
- **Why:** full recomputation is simple and always correct, like canonical event fields (D12). Writing only differences keeps hourly runs from churning Neon storage and compute. These tables hold nothing that cannot be recomputed, so replacing their rows does not break "never delete historical data".

## D38. Charts are hand-written server-side SVG
- **Alternatives:** Recharts, Chart.js, Nivo (client-side or DOM-dependent); Observable Plot (needs a DOM shim on the server); visx (server-safe but many packages).
- **Why:** three simple chart types need about 300 lines of code we own. Rendering on the server means no client JavaScript and charts that work without it. Each chart has a caption and a data table for screen readers. There is no dependency to update.

## D39. UK location: ITL1 regions, towns and postcode districts from static open data
- **Chosen:** ITL1 (12 areas) for sub-regions. A committed gazetteer of UK towns and postcode-district centroids, built once from OGL data. "Near" is the distance between centroids.
- **Alternatives:** ITL2 or ITL3 (too fine for news, unfamiliar names); counties (inconsistent, overlapping); postcodes.io, OS Names API or Nominatim at run time (network dependency, keys or share-alike terms).
- **Why:** ITL1 is the official regional scheme and matches GtR's region names. Static data is deterministic, testable offline and free. Town-level precision is the best the news data supports, and the pages say what distance search cannot do.

## D40. Innovate UK grants from the Gateway to Research API
- **Chosen:** the GtR-2 JSON API, filtered to Innovate UK, collected daily. Organisations only (a legal-form suffix or a company number). Each kept participant becomes a company and a `confirmed` grant event, linked by `event_record_sources`, and is never matched to or overwritten by news events. Grant projects are tagged by a small batched LLM call so they join themes.
- **Alternatives:** the Innovate UK funded-projects spreadsheets (24 MB `.xlsx`, irregular updates, ukri.org content mostly CC BY-NC-SA 4.0); the GtR bulk download (885 MB); leaving grants to Phase 3 or 4.
- **Why:** grant recipients are the small UK companies the targeting user wants, with postcode, amount and date. The API is free and keyless, its terms allow use for any purpose, and it supports backfill. Storing organisations only keeps sole traders' names out (D19). Keeping grant events apart from the news resolver avoids corrupting either until Phase 3 builds proper matching.

## D41. A versioned, canonical filter model
- **Chosen:** filters split into criteria and view. Criteria serialise canonically (fixed key order, sorted values, defaults omitted) and carry a version (2). Phase 1 URLs keep their meaning, apart from grants now being hidden by default.
- **Why:** Phase 4 saved searches and alerts need one stable string per search, and old links must not change meaning silently. Building it now, while filters are simple, costs little.

## D42. Demand-signal collectors are last and cuttable; no YC directory
- **Chosen:** Hacker News and GitHub collectors are the final two waves and may be cut. Y Combinator directory data is not collected. The batch is read from Launch HN titles instead.
- **Why:** both sources support backfill or matter only for launches we already track, so delaying them loses little. The only practical YC source, the yc-oss mirror, still has no licence (A25).

## D43. Company momentum uses equity rounds and says "first recorded"
- **Chosen:** months since previous, step-up and rounds in 24 months use funding rounds other than `debt` and `grant`. Step-up compares with the latest earlier round that has an amount, within 36 months. Round numbers mean "recorded by SignalFeed".
- **Why:** debt and grants are not steps in an equity sequence, and would make step-ups meaningless. Amounts are often missing, so skipping back to the last known amount keeps the signal useful, and the 36-month limit keeps it relevant. History starts at collection, so claiming "first round" would be false.

## D44. Grants are hidden by default and excluded from trend counts
- **Chosen:** with no round filter, the funding table shows every round type except `grant`. Trend scores and momentum ignore grants. Grants have their own counts in weekly stats.
- **Why:** the grants backfill would swamp both the home page and the first months of trend data. Public grants are a different signal from venture rounds. Selecting "Grant" brings them back for the targeting user.

## D45: Phase 2 decisions confirmed by the maintainer (11 November 2026)

- Extraction v2 (`company.regionText`, sharper city and tag rules) is approved. The two small paid checks, the extraction eval and the theme clustering eval, are approved.
- The 16-sector list in `docs/spec-phase2.md` section 7.2 is approved as written.
- Grants are hidden on the funding table unless "Grant" is selected. The grants backfill starts on 1 April 2024.
- Tasks 046 (Hacker News) and 047 (GitHub stars) are deferred to a later phase. Hacker News can be backfilled, so nothing is lost. GitHub star history starts only when 047 is built.
- Commercial reuse of Gateway to Research data is to be confirmed with UKRI before Phase 4.


## D46. Tags are embedded in a short template, and the theme eval labels markets
- **Chosen:** each tag is embedded as "Startup market: <tag>" (`tagEmbeddingInput`, template `market-v1`). `tags.embedding_model` and `themes.embedding_model` store `<model>+market-v1` (`tagEmbeddingIdentity`), so tags embedded with another template are embedded again and never mix with new ones. The greedy centroid rule (D34) is unchanged. τ is 0.76. The theme eval's labelled groups now follow a written market rule (`fixtures/themes/README.md`): one group per product or service, sector words only with their synonyms.
- **Alternatives measured** on the market labels (pairwise F1 at each method's best τ): bare tags 0.53; "Startup sector: <tag>" 0.57; "The <tag> market" 0.56; "Startup market: <tag>" 0.60. Joining by the most similar member (0.49 bare, 0.55 templated) or by the mean member similarity (0.52 bare, 0.59 templated) did no better than the centroid. A second pass that merges close theme centroids collapsed themes and lowered F1. Removing the template's own direction from each vector gave 0.59.
- **Why:** the template is the only change that helped, and it costs nothing at run time. The old 27 groups mixed markets with sectors (vector databases with prompt management, cultivated meat with meal kits), so they rewarded merging whole sectors. F1 0.58 on those groups (0.65 with the template) overstated quality.
- **Limits:** F1 is 0.60, below the 0.75 target (A26). Even a perfect clustering of these embeddings could not reach it: a plain cut on pair similarity peaks near 0.55. The model ranks tags by shared words ("prompt management" with "fleet management", the "-tech" sector words with each other) and places jargon far from its meaning ("baas", "black mass processing"). The template also packs similarities into a narrow band, so F1 falls fast below τ (0.49 at 0.74). Manual merge and move (spec 7.3) stay the fix for single errors.
- **text-embedding-3-large at 512 dimensions** (priced at $0.13 per million tokens, against $0.02) did not help: F1 0.55 at τ 0.84 with the template and 0.56 at τ 0.54 on bare tags, against 0.60 for the small model. Its pair similarities rank slightly better (a plain cut peaks at 0.59), but the greedy clustering does not turn that into better themes. The small model stays the default. `pnpm eval --themes --model <id>` scores another model.

## D47. An LLM check places tags in a similarity band
- **Chosen:** two bands around the greedy rule (D34). A tag whose best centroid similarity is at least τ_high = 0.88 joins that theme. Below τ_low = 0.72 it starts a new theme. In between, `gpt-5.6-luna` sees the tag and up to 3 candidate themes (each shown by its top 6 tags) and picks one or none. Calls are batched 20 tags at a time, use a strict schema with no string length keywords, and go through `LlmClient` and `BudgetGuard` with purpose `theme_naming`. A new purpose value would need a database migration, and theme naming is already the purpose for theme LLM calls. On a budget refusal or provider error, the band tags fall back to the embedding-only rule at τ = 0.76, so the assignment run is never lost. With no key, assignment is embedding-only, as before.
- **Measured** on the 215 labelled tags, replaying recorded verdicts (`docs/theme-eval-results.md`): embedding-only 0.604 F1 (precision 0.540, recall 0.685). With the check at 0.72 to 0.88: 0.662 F1 (precision 0.930, recall 0.515). Other bands: 0.72 to 0.84 gave 0.651, 0.74 to 0.88 gave 0.646 and 0.76 to 0.88 gave 0.632. Wrong merges fall from 239 to 16.
- **Prompt:** version `theme-check-v2` states the market rule from `fixtures/themes/README.md` with examples that are not in the labelled set. The first version, which used three labelled tags as examples and a looser wording, reached 0.681 F1 at 0.72 to 0.84, but with precision 0.694. v2 is kept: it is 0.02 lower on F1 but makes far fewer wrong merges, and it does not quote the test set.
- **Merge check between themes: not built.** A trial asked about the 94 pairs of themes from the chosen run whose centroids were at least 0.76 alike ($0.0033). The LLM called none of them the same market, so F1 did not change. A perfect judge on the same pairs would have reached about 0.84, so the gap is the model's narrow reading of "market", not the pairing. The trial's answers are in `fixtures/themes/recorded/merge-trial-gpt-5.6-luna.json`.
- **Cost:** 249 questions in 15 calls for the 215 tags, starting with no themes. That is about 21 calls and $0.037 for 300 new tags, at $0.000106 a question. Most of the cost is reasoning tokens. The first live run cut answers off at 2,600 output tokens and lost 400 questions, so a call now allows 4,000 tokens plus 50 a tag.
- **Limits:** F1 0.662 is below the 0.75 target (A26), and the target test still fails. With perfect verdicts the same bands would reach about 0.87, so the limit is the model's judgement against these labels. It splits finer than the labels in some markets ("threat detection" from "cybersecurity", "cross-border payments" from "payment rails") and joins neighbours in others ("vehicle-to-grid" with electric vehicles, "lettings platform" with estate agency software). Low recall means more small themes. `pnpm themes suggest-merges` and `merge` fix them, and a missed merge is safer than a wrong one.
- **Eval:** verdicts are recorded once per model, prompt version and embedding recording, keyed by the exact question the LLM saw, so a change of prompt, band or embeddings asks again rather than reusing a stale answer. A prompt hash catches unversioned edits. `pnpm eval --themes --check --live` records missing verdicts one pass at a time, as production asks them, with a $0.05 cap a run. This decision used $0.098 of live calls.
