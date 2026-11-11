# SignalFeed specification: Phase 2 (trends plus targeting)

Phase 2 builds on the Phase 1 data foundation in `docs/spec.md`. Everything in that spec still holds unless this document says otherwise. Tasks are in `docs/tasks/024-*.md` onwards. Decisions D33-D44 in `docs/decisions.md` record the choices made here.

Scope was set by the maintainer as "trends plus targeting": answer the founder's trend questions, and lay the data groundwork for a later paid tier that helps small businesses find companies to sell to. Accounts, saved searches, alerts and payments stay in Phase 4.

## 1. Users and the questions they ask

**Primary user: a founder deciding what to build** (unchanged from Phase 1). Phase 2 answers:

- Which themes are attracting funding, and are they rising?
- Where is early momentum: seed rounds increasing while few companies in the theme have reached Series A?
- Who acquires young startups, in which themes, and how old were the targets?
- Which investors lead first cheques in each theme, and how big are those rounds?
- Which companies are raising again quickly, and by how much more?

**Groundwork user: a small UK business selling to newly funded companies**, for example a local web agency. They will pay (Phase 4) to filter precisely:

- small raises and grants, not £50M rounds;
- in or near their town, or in their part of the UK;
- recent;
- in a sector they know;
- ideally the company's first funding, when it most needs suppliers.

Phase 2 builds the data and filters for this user on the public site. It does not build accounts, saved searches, alerts or anything paid. Before Phase 4, the interviews in `docs/spec.md` section 3 still apply.

## 2. Scope

In scope:

1. **Extraction v2.** A small schema and prompt change (section 4), landed first so extraction on the hosted database can start.
2. **Themes.** Tag embeddings in pgvector, incremental clustering into themes, LLM-suggested names a person can rename, and a fixed list of sectors that themes map to.
3. **Weekly stats.** `theme_weekly_stats` and `weekly_totals`, rebuilt idempotently from events.
4. **Rising score.** A documented, tested score that shrinks small counts towards zero (section 8.1).
5. **Views.** Rising themes, early momentum, acquisitions with target age, and investor activity per theme.
6. **Company momentum.** Months since the previous round, step-up from the previous round, and rounds in the last 24 months, from each company's own timeline with no LLM.
7. **Targeting groundwork.** UK sub-region (ITL1), town or city, "near a place" by distance, sector and theme filters, momentum filters, and a versioned filter model that Phase 4 can reuse unchanged.
8. **UKRI grants.** Innovate UK grant recipients from Gateway to Research (GtR), as companies with grant events, location from postcode, and tags from a small LLM tagging call.
9. **Charts.** Server-rendered, accessible SVG charts with no chart library.
10. **Demand-signal collectors (last waves, cuttable).** Hacker News Show HN and Launch HN, and GitHub star snapshots.

## 3. Non-goals for Phase 2

- Accounts, saved searches, alerts, email digests, payments, the leads view (Phase 4).
- Companies House and SEC filings, including company size from accounts (Phase 3).
- Y Combinator directory data. Its only practical source, the unofficial yc-oss mirror, still has no licence (A25). The batch is read from Launch HN titles instead (section 11).
- Street-level location, or any personal address. Location is town or postcode-district level.
- Grants from research councils other than Innovate UK. Those mostly go to universities.
- A full re-cluster of all themes, or switching the embedding model. Both would need their own plan.
- Inferring round type from amount (`docs/spec.md` section 3 still holds).
- Showing grant abstracts, article text or any personal names. GtR person records are never fetched.

## 4. Extraction changes (v2)

Real data is being collected with every item left `pending`. Extraction will run on the hosted database once Phase 2 lands. Phase 2 needs one small extraction change, so it sits in wave 1 (Task 024). Extraction can start as soon as 024 is merged and its live eval passes. Nothing else in Phase 2 changes the extraction schema or prompt.

### 4.1 Schema change

`EXTRACTION_SCHEMA_V2` (schema name `extraction_v2`) is V1 plus one field:

```ts
company: {
  ...V1 fields,
  regionText: string | null, // sub-national region the text states, e.g. "Scotland", "Yorkshire", "Bavaria"
}
```

Why: UK news often says "Scottish startup", "Welsh fintech" or "Yorkshire-based" without a town. V1 would keep only `countryCode: GB` and lose the part of the UK, which is the most useful location fact for the targeting user. The LLM copies the region as stated; code maps it to an ITL1 region (D8, "the LLM finds, code computes").

Stored V1 results stay valid. `upgradeExtraction()` turns a V1 result into V2 by adding `regionText: null`, so replay, re-resolution and the recorded eval keep working.

### 4.2 Prompt change (prompt version `v2`)

- **City:** "city is the town or city where the company is based, when the text states it (for example 'Leeds-based' gives 'Leeds'). Use its common English name only, with no county, region or country."
- **Region:** "regionText is the region, nation or county the text states when it gives one, such as 'Scotland', 'Wales', 'Yorkshire' or 'Bavaria', copied as written. Otherwise null. Do not derive it from the city."
- **Tags:** "tags are zero to five short lowercase phrases for what the company makes or does and who it serves, most specific first. Prefer common industry terms ('insurtech', 'ai agents', 'heat pumps'). Do not use generic words ('startup', 'technology', 'innovation', 'funding'), places, round types or company names."

The tag rule makes tags cleaner for clustering and sector filtering. It costs nothing at extraction time.

Rejected: a fixed `sector` field (themes and the sector map do this without asking the LLM to classify, D34 and D35); `employeeCount` (rarely stated); B2B or B2C (not needed yet).

### 4.3 Eval

Fixtures gain optional `city` and `regionText` expectations. Two new metrics:

| Metric | Target |
|---|---|
| City, when stated by the model | ≥ 90% |
| UK region (ITL1 after mapping), when stated | ≥ 90% |

All Phase 1 targets must still pass on `gpt-5.6-luna`. Coverage for city and region is reported but has no target, as for country (D28). The maintainer runs `pnpm eval --live` once (about $0.02).

### 4.4 Effect on collection now

None. Collection already stores the headline, link and feed summary, which is everything v2 reads. No collector needs changing before Phase 2 lands. The Phase 2 sources (GtR, Hacker News) support backfill, so starting them later loses nothing. GitHub star snapshots are the only new data that cannot be backfilled, and they only concern repositories found through launches (section 11).

## 5. Data model additions

New tables only, plus appended enum values. No existing column changes type, and no existing row is rewritten. Filling the reserved, empty `tags.embedding`, `tags.embedding_model` and `companies.yc_batch` columns is the use Phase 1 reserved them for.

### 5.1 Enums

Appended to existing enums (values are only ever appended):

| Enum | New values |
|---|---|
| `source_kind` | `ukri_gtr` |
| `llm_purpose` | `theme_naming`, `tagging` |
| `alias_source` | `grant` |

New enums:

| Enum | Values |
|---|---|
| `theme_status` | `active`, `merged` |
| `theme_name_source` | `tag`, `llm`, `manual` |
| `theme_assigned_by` | `auto`, `manual` |
| `location_precision` | `outcode`, `town`, `region` |
| `location_source` | `grant_postcode`, `news_city`, `news_region` |
| `grant_role` | `lead`, `participant` |
| `record_kind` | `ukri_grant` |

### 5.2 Themes

- `themes`: `id`, `slug` (unique, never changes), `name`, `name_source`, `sector` (text, nullable, one of the slugs in `src/core/sectors.ts`), `status`, `merged_into_id` (self FK, nullable), `seed_tag_id` (FK `tags`), `centroid` (vector 512), `embedding_model`, `created_at`, `named_at`, `reviewed_at`. Index on `status`.
- `tag_themes`: `tag_id` (PK, FK `tags`), `theme_id` (FK `themes`, **nullable**: null means a person decided the tag belongs to no theme), `similarity` (real, null for manual), `assigned_by`, `embedding_model`, `assigned_at`. Index on `theme_id`.

Raw tags and `company_tags` are untouched.

### 5.3 Derived tables

These are rebuilt from source tables by the stats and location steps (D37). They hold no information that cannot be recomputed, so the rebuild may replace their rows.

- `company_themes`: `company_id`, `theme_id`, `tag_count`. PK (`company_id`, `theme_id`). Index on `theme_id`. A company is in a theme when any of its tags is.
- `theme_weekly_stats`: `theme_id`, `week_start` (date, a Monday), `rounds` (funding rounds excluding grants), `rounds_with_amount`, `total_gbp_minor`, `early_rounds` (`pre_seed` + `seed`), `later_rounds` (`series_a` to `series_d_plus`, `growth`), `unknown_stage_rounds`, `grants`, `grant_gbp_minor`, `acquisitions`, `launches`, `companies` (distinct companies with any event that week). PK (`theme_id`, `week_start`). Index on `week_start`. Only weeks with at least one event get a row.
- `weekly_totals`: `week_start` (PK), `rounds`, `early_rounds`, `grants`, `acquisitions`, `launches`. Counts distinct events across all companies, so an event in two themes is counted once.
- `funding_round_momentum`: `event_id` (PK, FK cascade), `company_id`, `equity_round_number` (smallint, 1 = first recorded), `previous_event_id`, `months_since_previous` (smallint), `step_up_basis_event_id`, `step_up_ratio` (real), `rounds_in_24m_to_date` (smallint). Index on `company_id`. Equity rounds only (section 8.3).
- `company_locations`: `company_id` (PK), `country_code`, `itl1_code` (char 3, nullable), `place_slug` (nullable), `outcode` (nullable), `latitude`, `longitude` (real, nullable), `precision`, `source`, `computed_at`. Indexes on `itl1_code`, `place_slug`, and (`latitude`, `longitude`). One row per company with at least a UK region or a non-UK city. Section 9.1 sets the rules.
- `derived_rebuilds`: `name` (PK, for example `stats` or `locations`), `input_fingerprint` (text), `rebuilt_at`. The fingerprint is built from row counts and latest timestamps of the inputs. A rebuild is skipped when it has not changed.

### 5.4 Grants (UKRI Gateway to Research)

- `grant_projects`: `id`, `source_id` (FK `sources`), `gtr_project_id` (unique), `title`, `grant_category` (for example "Collaborative R&D"), `lead_funder`, `status`, `start_on`, `end_on` (dates, nullable), `gtr_url`, `first_seen_at`, `updated_at`.
- `grant_project_texts`: `project_id` (PK, FK cascade), `abstract` (text, at most 1,500 characters). LLM input only, never displayed. **The web role is revoked**, as for `source_item_texts`.
- `grant_participants`: `id`, `project_id` (FK), `gtr_org_id`, `organisation_name`, `reg_number` (nullable), `postcode` (nullable), `outcode` (nullable), `region_text` (nullable), `role`, `grant_offer_minor` (GBP pence, nullable), `project_cost_minor` (nullable), `org_fetched_at`, `company_id` (nullable FK), `event_id` (nullable FK), `resolved_at`, `skipped_reason` (nullable text). Unique (`project_id`, `gtr_org_id`). Index on `resolved_at`.
- `grant_taggings`: `id`, `project_id` (FK), `prompt_version`, `model`, `tags` (text array), `input_tokens`, `output_tokens`, `cost_usd_micros`, `created_at`. Unique (`project_id`, `prompt_version`, `model`). Tagging is paid for once per project.
- `event_record_sources`: `event_id` (FK cascade), `record_kind`, `record_id` (integer). PK (`event_id`, `record_kind`, `record_id`). Links an event to an official record instead of an extraction.

Participants whose name is not an organisation are never stored (section 10.3).

### 5.5 Unchanged tables with new uses

- `tags.embedding`, `tags.embedding_model`: filled by the embed step.
- `launch_metric_snapshots`: filled by the Hacker News and GitHub snapshot steps (cuttable).
- `companies.yc_batch`: filled from Launch HN titles when empty (cuttable).
- `companies.uk_company_number`: filled from a grant participant's `reg_number` when empty and not used by another company.

### 5.6 Storage

| Data | One-off | Growth / month |
|---|---|---|
| Tag embeddings (512 × 4 bytes, about 2.3 KB a tag with overhead), themes, tag links | none | about 1.2 MB at first, falling as the tag vocabulary saturates |
| Derived tables | none | about 0.5 MB |
| Grants backfill from April 2024 (about 6,000 projects, 9,000 participants, plus their companies, events and tags) | about 25 MB | about 1 MB |
| Hacker News items and snapshots (cuttable) | about 2 MB for a 12-month backfill | about 0.3 MB |
| **Phase 2 total** | **about 25-30 MB** | **about 3 MB** |

Phase 1 grows by about 10 MB a month, so the total is about 13 MB a month. Neon Free's 1 GB lasts more than five years. Derived tables are written as a diff (only changed rows), so hourly runs with no new events write nothing. That also keeps WAL and compute use low.

## 6. Pipeline additions

`pnpm ingest run` gains these steps after FX, in this order. Each is idempotent and safe to rerun, and each runs only on rows that need it.

8. **Grant resolution.** Turn new `grant_participants` into companies and grant events, and tag new grant projects in batches of up to 20 (purpose `tagging`, through `BudgetGuard`). Section 10. This runs first so that grant tags are embedded in the same run.
9. **Embed.** Tags with no embedding, or an embedding from another model, are embedded with `EMBEDDING_MODEL` (default `text-embedding-3-small`, `dimensions: 512`). Batches of up to 256 tags, at most 2,000 tags a run. Every call goes through `BudgetGuard` with purpose `embedding`. Without an OpenAI key the step is skipped.
10. **Themes.** Assign each newly embedded tag to a theme or start a new one (section 7). Then name up to 20 unnamed themes a run in batched LLM calls (purpose `theme_naming`, through `BudgetGuard`).
11. **Locations.** Rebuild `company_locations` (section 9.1).
12. **Stats.** Rebuild `company_themes`, `theme_weekly_stats`, `weekly_totals` and `funding_round_momentum` (section 8). Skipped when no event, tag link or theme changed since the last rebuild.

A daily workflow (`.github/workflows/daily.yml`) runs:

- `pnpm ingest grants`: fetch new Innovate UK projects and organisations from GtR (section 10).
- `pnpm ingest github` (cuttable): GitHub star snapshots (section 11).

The Hacker News collector (cuttable) is a normal collector inside `collect`, and its points snapshots run inside `run`.

`pnpm themes <list|rename|sector|merge|move|suggest-merges>` is the manual theme tool (section 7.3). Like `pnpm entities`, it runs only from a maintainer's machine or a manual workflow, never from the web app.

New ports in `src/core/ports.ts`:

```ts
interface EmbeddingClient {
  embed(request: { inputs: string[]; dimensions: number }): Promise<{
    vectors: number[][];          // same order as inputs, each of length `dimensions`
    usage: { inputTokens: number };
    model: string;
  }>;
}
```

The OpenAI LLM adapter becomes schema-generic: it sends the JSON schema of `request.schema` in strict mode, instead of always sending the extraction schema. Theme naming and grant tagging need this. Task 024 makes the change and proves the extraction request body is unchanged.

## 7. Themes

### 7.1 Clustering method (D34, D47)

Greedy centroid assignment with an LLM check in a similarity band, in a fixed order:

1. Take embedded tags that have no `tag_themes` row and are not in the generic stoplist (`src/pipeline/themes/stoplist.ts`, for words such as "startup" and "technology").
2. Order them by total mentions (`sum(company_tags.mention_count)`) descending, then by slug.
3. For each tag, compute cosine similarity with the centroid of every active theme.
4. If the best similarity is at least **τ_high** (`DEFAULT_THEME_BANDS.high`, 0.88), assign the tag to that theme.
5. If it is below **τ_low** (`DEFAULT_THEME_BANDS.low`, 0.72), start a new theme. Its slug is the tag's slug (with `-2` and so on if taken), its name is the tag's label (`name_source = tag`), and its centroid is the tag's embedding.
6. In between, the LLM check decides. It sees the tag and up to 3 candidate themes, best first, each at least τ_low, each shown by its top 6 member tags by mentions. It answers with one candidate or none. None starts a new theme.
7. A joined theme's centroid becomes the normalised mean of its members' embeddings.

The check (`src/pipeline/themes/theme-check.ts`):

- **Batched and repeated.** The greedy pass runs with the verdicts known so far. Band tags with no verdict are asked, 20 to a call, and the pass runs again, until a pass asks nothing new (at most 6 passes). A verdict is reused while the tag's set of candidate themes stays the same.
- **Strict output.** `{ verdicts: [{ id, match }] }`, where `match` is the candidate number or 0. No string length keywords.
- **Paid and guarded.** Every call goes through `LlmClient` and `BudgetGuard`, with purpose `theme_naming`, the existing purpose for theme LLM calls. The model is the pipeline's `EXTRACTION_MODEL` (default `gpt-5.6-luna`).
- **Never loses the run.** On a budget refusal or a provider error, the asking stops, and the remaining band tags fall back to the embedding-only rule at **τ** (`DEFAULT_THEME_THRESHOLD`, 0.76): join the best theme if it is at least τ, otherwise start a new one. A budget refusal sets `budgetPaused` on the step's stats; an error sets `providerError` and is listed in the run's errors. Theme naming then waits for the next run.
- **Optional.** With no LLM key the step runs embedding-only at τ, as before.
- Manual links are never overridden: tags that already have a `tag_themes` row are never asked about.

Why this method:

- **Stable.** New tags join existing themes without reshuffling old ones. Theme slugs are safe to store in saved searches (Phase 4).
- **Incremental.** Each run only touches new tags, so the cost is small and constant: about $0.04 for 300 new tags (D47).
- **Explainable.** Every assignment has one similarity score, stored on the link.
- **Deterministic** given stored embeddings and LLM verdicts, because order and ties are fixed. The eval replays recorded verdicts.
- **Precise.** On the labelled tags, precision rises from 0.54 to 0.93. Wrong merges are worse than missed ones, because a person can merge two themes later.

The cost is order dependence: an early, specific tag can become a theme that a later, broader tag would have described better. Manual merge, move and rename fix those cases (7.3). `suggest-merges` lists pairs of active themes whose centroids are within τ + 0.10 of each other.

### 7.2 Names and sectors

A theme is named by the LLM once it has at least 2 companies. Each call names up to 20 themes. The input for each theme is its top 8 tags by mentions. The output (strict schema) is:

- `name`: 2-4 words, sentence case, British English, at most 40 characters, no company names;
- `sector`: one slug from the fixed sector list.

Names with `name_source = manual` are never overwritten. Sector stays editable by a person.

Sectors (`src/core/sectors.ts`, append-only):

| Slug | Label |
|---|---|
| `software-ai` | Software, AI and data |
| `financial-services` | Financial services |
| `health-life-sciences` | Health and life sciences |
| `climate-energy` | Climate and energy |
| `transport-mobility` | Transport and mobility |
| `property-construction` | Property and construction |
| `retail-consumer` | Retail and consumer |
| `food-agriculture` | Food and agriculture |
| `manufacturing-industrial` | Manufacturing and industrial |
| `media-creative` | Media, creative and gaming |
| `education` | Education |
| `business-services` | Professional and business services |
| `security-defence` | Security and defence |
| `space-deep-tech` | Space and deep tech |
| `public-social` | Public sector and social impact |
| `other` | Other |

**How tags, themes and sectors serve filtering.** Tags are fine-grained but noisy ("ai", "artificial intelligence"). Themes group them into stable, renameable clusters, for trend analysis and specific filters. Sectors are a short fixed list, for the broad filters a paying user wants ("health companies near Leeds"). A company's sectors are the sectors of its themes, so a company can be in more than one sector.

### 7.3 Manual tools

`pnpm themes`:

- `list [--unreviewed]`: themes with companies, tags, name source and sector;
- `rename <slug> "<name>"`: sets `name_source = manual` and `reviewed_at`;
- `sector <slug> <sector-slug>`: sets the sector and `reviewed_at`;
- `merge <from-slug> <into-slug>`: moves all tag links, sets `status = merged` and `merged_into_id`, recomputes the centroid. Merged slugs redirect, and filters on a merged slug follow `merged_into_id`;
- `move <tag-slug> <theme-slug|none>`: a manual assignment that auto-assignment never overrides;
- `suggest-merges`: prints candidate pairs and changes nothing.

Themes with fewer than 3 companies are listed on `/themes` but left out of trend views.

## 8. Formulas

All calculations are pure functions in `src/lib/` with unit tests that lock in the worked examples below. Weeks are ISO weeks starting Monday, UTC. The current, incomplete week is never used.

**Grants** (round type `grant`) are excluded from `rounds`, the rising score and company momentum. Public grants are a different signal from venture rounds, and the grants backfill would otherwise swamp the first months of news data.

### 8.1 Rising score (D36)

For theme *t*, with the last complete week as week 0:

- **Recent window R:** weeks −7 to 0 (8 weeks).
- **Baseline window B:** up to 26 weeks immediately before R. It must contain at least 8 weeks of collected history, otherwise the score is null ("not enough history yet").
- *r* = theme rounds in R; *b* = theme rounds in B.
- *N_R*, *N_B* = all rounds (from `weekly_totals`) in R and B. If *N_B* = 0 the score is null.
- Expected recent count: *e* = *b* × *N_R* / *N_B*. This is the theme's baseline share applied to the recent overall volume, so growth in total coverage (new feeds, a busy month) does not make every theme look like it is rising.
- **Rising score:** *s* = ln((*r* + α) / (*e* + α)), with **α = 3**.

α acts as three imaginary rounds added to both sides. Small counts are pulled towards 0, so a single round cannot top the chart. Large counts barely move. A score of 0 means "as expected", positive means rising and negative means falling. Pages show *s* to two decimals, and "about 2× its usual share" from exp(*s*) rounded to one decimal.

The rising list shows themes with *r* ≥ 3, ordered by *s* descending, then *r* descending, then slug.

**Worked examples** (*N_R* = 400, *N_B* = 1,200, so *e* = *b* / 3):

| Theme | *r* | *b* | *e* | Shrunk score *s* | Unshrunk ln(*r*/*e*) |
|---|---|---|---|---|---|
| A: brand-new theme, one round | 1 | 0 | 0 | ln(4/3) = **0.29** (and hidden, since *r* < 3) | infinite |
| B: small and growing | 6 | 6 | 2 | ln(9/5) = **0.59** | 1.10 |
| C: large and steady | 40 | 120 | 40 | ln(43/43) = **0.00** | 0.00 |
| D: large and rising | 60 | 120 | 40 | ln(63/43) = **0.38** | 0.41 |
| E: falling | 2 | 30 | 10 | ln(5/13) = **−0.96** | −1.61 |
| F: mid-sized, tripled | 15 | 9 | 3 | ln(18/6) = **1.10** | 1.61 |

Order on the page: F, B, D, C. E is scored but not listed, because *r* < 3 (the same rule that hides A); once E has 3 recent rounds it is listed below C. Without shrinkage, A would top the list with an infinite score.

Rising is measured on counts, not money. Round sizes are heavy-tailed, and one £200M round would dominate a money-based score. Total GBP is shown next to the score instead.

### 8.2 Early momentum

The same score computed on early rounds only (`pre_seed` + `seed`): *s_early* from *r_early*, *b_early* and the early-round totals.

**Late share** *L*, over all recorded history: of the theme's companies with at least one equity round of known type, the share that has any `series_a`, `series_b`, `series_c`, `series_d_plus` or `growth` round. `unknown`, `debt` and `grant` rounds do not count as known type. *L* is null below 5 such companies.

A theme is on the early-momentum list when *r_early* ≥ 3, *s_early* > 0 and *L* ≤ 0.25, ordered by *s_early*.

**Worked example.** "Agentic accounting": *r_early* = 7, *b_early* = 4, early totals 150 recent and 450 baseline. *e* = 4 × 150 / 450 = 1.33. *s_early* = ln(10 / 4.33) = **0.84**. Of 12 companies with a known round type, 2 have reached Series A, so *L* = 0.17. It is listed.

### 8.3 Company momentum (D43)

Computed per company from its own **equity rounds**: funding rounds whose type is not `debt` or `grant`, ordered by `announced_on`, then event id.

- `equity_round_number`: position in that order. 1 means **the first round SignalFeed has recorded**, not the company's first ever. History starts when collection started, and pages say so.
- `months_since_previous`: whole calendar months from the previous equity round. If both dates have `day` precision: (years × 12 + months), minus 1 if this round's day of the month is earlier than the previous round's. If either has `month` precision, the day is ignored. If either has `year` precision, the value is null.
- `step_up_ratio`: this round's GBP amount divided by the GBP amount of the most recent earlier equity round that has one, if that round is within 36 months. Null if either amount is unknown or no such round exists. Shown to one decimal ("5.3× the round in March 2025").
- `rounds_in_24m_to_date`: equity rounds in the 24 months up to and including this round.
- **Company-level "rounds in the last 24 months"** is counted at read time against today's date, so it never goes stale.

**Worked example.** A company's rounds:

| Date | Round | Amount |
|---|---|---|
| 2025-03-10 | seed | £1.5M |
| 2026-01-20 | seed ("seed extension") | unknown |
| 2026-04-02 | debt | £2.0M |
| 2026-09-05 | series_a | £8.0M |

| Round | Number | Months since previous | Step-up | Rounds in 24 months to date |
|---|---|---|---|---|
| 2025-03-10 seed | 1 | null | null | 1 |
| 2026-01-20 seed | 2 | 12 + (1 − 3) = **10** (20 ≥ 10, no adjustment) | null (no amount) | 2 |
| 2026-04-02 debt | not an equity round | | | |
| 2026-09-05 series A | 3 | 0 + (9 − 1) − 1 = **7** (5 < 20) | 8.0 / 1.5 = **5.3×** (basis: 2025-03-10, the latest earlier round with an amount) | 3 |

On 2026-11-11 the company has had 3 equity rounds in the last 24 months.

### 8.4 Acquisitions and target age

Target age = year of `announced_on` − `founded_year`, only when `founded_year` is known and between 1900 and the announcement year. Pages always show coverage, for example "age known for 4 of 19". Founded years stay sparse until Phase 3 adds Companies House incorporation dates.

Per theme of the target company: number of acquisitions, top acquirers by count (resolved company or the raw `acquirer_name`), and median target age where at least 3 ages are known.

**Example:** founded 2019 and acquired in May 2026 gives an age of 7.

### 8.5 Investor activity

Per theme, over a chosen window (default the last 12 months), for early rounds (`pre_seed`, `seed`):

- `led`: rounds where the investor's role is `lead`;
- `joined`: rounds as `participant` or `unknown`;
- median round size in GBP over rounds with a known amount, with coverage ("3 of 4 with amounts").

Ordered by `led`, then `joined`, then name. Investors need at least 2 rounds in the window to appear. Individual cheque sizes are rarely reported, so round size is used instead, and the page says so.

**Example:** an investor led 4 seed rounds in "Climate fintech" of £1.2M, £2.0M, unknown and £3.5M. The median of the known amounts is **£2.0M**, shown with "3 of 4 with amounts".

## 9. Targeting

### 9.1 Location (D39)

**Sub-region scheme: ITL1** (International Territorial Levels, level 1, ONS, January 2025). Its 12 areas are the 9 English regions plus Wales, Scotland and Northern Ireland. It is the official scheme behind UK regional statistics, its names are familiar ("North West", "Scotland"), and GtR's `region` field already uses the same names. ITL2 (about 40 areas) is too fine for news data at town level and too unfamiliar for a filter.

| Slug | Code | Name |
|---|---|---|
| `north-east` | TLC | North East |
| `north-west` | TLD | North West |
| `yorkshire-and-the-humber` | TLE | Yorkshire and The Humber |
| `east-midlands` | TLF | East Midlands |
| `west-midlands` | TLG | West Midlands |
| `east-of-england` | TLH | East of England |
| `london` | TLI | London |
| `south-east` | TLJ | South East |
| `south-west` | TLK | South West |
| `wales` | TLL | Wales |
| `scotland` | TLM | Scotland |
| `northern-ireland` | TLN | Northern Ireland |

**Static UK data, committed to the repo** (Task 026), built once by a script from open data under the Open Government Licence. There are no geocoding calls at run time.

- `src/lib/geo/uk-places.json`: UK cities and towns with slug, name, ITL1 code, latitude, longitude and population band. Source: OS Open Names (`City` and `Town` types) or the ONS Index of Place Names, plus a Northern Ireland settlement list (A21).
- `src/lib/geo/uk-outcodes.json`: postcode districts ("L35") with centroid and ITL1 code, built from Code-Point Open or the ONS Postcode Directory (A22).
- `src/lib/geo/uk-region-names.ts`: region, nation and county words to ITL1 ("Scottish" to `scotland`, "Cornwall" to `south-west`). Ambiguous words ("the Midlands", "the North") map to nothing.

**Location rules for each company** (`company_locations`, first match wins):

1. **Grant postcode.** The company's latest grant participant with a valid outcode gives precision `outcode`, with that outcode's centroid and ITL1 code.
2. **News city, UK.** `companies.city` with `country_code = GB` matches a gazetteer place by normalised name and aliases ("Greater London" and "City of London" are London). If two places share a name, pick the larger only when its population band is at least two bands higher; otherwise it is ambiguous and this rule does not apply. Precision `town`.
3. **News region, UK.** The most frequent non-null `regionText` across the company's current extractions (ties broken as in canonical fields) maps to an ITL1 code. Precision `region`, no coordinates.
4. **Non-UK city.** `companies.city` is stored as `place_slug = null` with country only, precision `town` and no coordinates, so the free-text `city` filter can still match.

Companies with only a country get no row.

**Is "near a place" feasible? Yes, at town level, with limits.**

- *Possible:* "within 25 km of Leeds" matches companies whose town centroid or postcode-district centroid is within 25 km of Leeds' centroid. Bradford, Wakefield and Harrogate match. Grant recipients, which carry a postcode, are located to about a postcode district (a few km).
- *Not possible:* street-level distance; companies with only a region or only a country, which drop out of distance filters (pages say how many); and telling apart two companies in the same city, which share one centroid. A large city's radius is measured from its centre, so "within 10 km of London" misses outer boroughs.
- *Coverage:* the model gave a city for 6 of 24 events in the recorded eval (A28). Expect about a quarter of news companies to have a town, more with a region, and nearly all grant recipients to have a postcode.
- *Options considered:* postcodes.io (free and keyless, OGL data, but a runtime network dependency, and its place search is the same OS Open Names data); OS Names API (needs an OS Data Hub key); Nominatim (OpenStreetMap, ODbL share-alike, and a usage policy against bulk use). Static files are deterministic, testable without the network, and free.

Distance uses the haversine formula in SQL, after a bounding-box prefilter on (`latitude`, `longitude`).

### 9.2 Filter parameters

New URL parameters on `/`, added to those in `docs/spec.md` section 9:

| Param | Values | Meaning |
|---|---|---|
| `theme` | multi, theme slugs | Company is in any of these themes. Merged slugs follow `merged_into_id`. |
| `sector` | multi, sector slugs | Company is in any theme with any of these sectors. |
| `ukregion` | multi, ITL1 slugs | `company_locations.itl1_code` is any of these. |
| `city` | multi | A UK place slug matches `place_slug`; any other value matches the normalised `companies.city` in any country. |
| `near` | one UK place slug | Located companies within `km` of that place. |
| `km` | `10`, `25`, `50`, `100` | Radius for `near`. Default 25. Ignored without `near`. |
| `momentum` | `first` or `repeat` | `first`: the round is the company's first recorded equity round. `repeat`: the company had an earlier recorded equity round within 24 months. |

Values within one parameter are combined with OR. Different parameters are combined with AND. Invalid values are dropped, as in Phase 1.

**Grants are hidden by default.** With no `round` parameter, every round type except `grant` is shown. Selecting "Grant" (`round=grant`) includes grants. Without this, the grants backfill would fill the home page.

A typical targeting search: `/?round=pre_seed&round=seed&round=grant&size=under-1m&near=leeds&km=25&sector=health-life-sciences&from=2026-06-01&momentum=first`.

### 9.3 Filter model for Phase 4 (D41)

`src/lib/funding-filters.ts` stays the single place that parses and serialises filters. Phase 2 makes it a stable contract:

- `FundingCriteria` (what to match) is split from `FundingView` (`sort`, `dir`, `page`, `pageSize`). `FundingFilters = FundingCriteria & FundingView`, so Phase 1 callers still compile.
- `FUNDING_CRITERIA_VERSION = 2`. Phase 4 stores it next to a saved search.
- `serialiseFundingCriteria()` is **canonical**: fixed key order, multi values sorted and de-duplicated, defaults omitted (`km=25`, `page=1`). The same search always gives the same string, so Phase 4 can de-duplicate saved searches and key alerts on it.
- `parseFundingCriteria(serialiseFundingCriteria(c))` equals `c`, and serialising a parse is idempotent. Property-style tests lock this in.
- Phase 1 URLs still parse to the same criteria, except that grants are now excluded unless asked for.
- `describeFundingCriteria(criteria, names)` gives a plain-English summary ("Seed and grant rounds under £1M, within 25 km of Leeds, in health and life sciences, since 1 June 2026"). Pages use it as a heading. Phase 4 alert emails can reuse it.
- Alerts in Phase 4 run the same query with `from` set to the last alert date. No separate in-memory matcher is needed.

## 10. UKRI grants as a source (D40)

### 10.1 Verdict

**It fits, and it is planned for Phase 2** (Tasks 035 and 038). Innovate UK grants reach exactly the small UK companies the targeting user wants, often years before any news coverage, and every record carries an amount, a date and a postcode.

What was verified on 11 November 2026 (details and links in `docs/sources.md`, A16-A20):

- **API.** The legacy GtR-2 JSON API at `https://gtr.ukri.org/gtr/api/` answers without a key. `projects.json?q=Innovate%20UK&f=pro.lf&sf=pro.sd&so=D&s=100` returned 33,170 Innovate UK projects, newest start first, 100 per page (the maximum; `s=200` is a 400 error). Each project lists participants with organisation id, name, role, `grantOffer` and `projectCost`, plus a `FUND` link with start and end dates. `organisations/{id}` gives `regNumber` (often null), `website` and addresses with `postCode` and `region`.
- **New API.** A beta API under `/api/content/` is documented, but its example URL returned 404 on 11 November 2026, and the page says "If you use the previous API, you will need to update your tools". The client therefore sits behind a small adapter so the endpoint can be swapped (A16).
- **Terms.** The API page says anyone can use it for any purpose, free, with no key or account. The GtR terms page refers to the Open Government Licence. Commercial reuse should be confirmed with `gateway@ukri.org` before Phase 4 (A17).
- **Rate limit.** 10 requests a second per user, marked "to be confirmed". SignalFeed stays at 1 request a second (A18).
- **Updates.** Project data is updated monthly (A19).
- **Personal data.** GtR publishes people linked to projects. SignalFeed never calls person endpoints, never stores abstracts publicly, and stores only organisations (10.3).
- **Not used: the Innovate UK funded-projects spreadsheets** on ukri.org. They have useful columns (enterprise size, sector), but they are 24 MB `.xlsx` files updated irregularly, and ukri.org content is mostly licensed CC BY-NC-SA 4.0, which would block Phase 4 commercial use (A20).

### 10.2 Collection (`pnpm ingest grants`, daily)

- Walk Innovate UK projects newest first, 100 per page, at most 1 request a second. Stop after 3 consecutive pages with no unseen project, or at 30 pages. Upsert `grant_projects`, `grant_project_texts` (abstract cut to 1,500 characters) and `grant_participants`.
- For each participant organisation not yet fetched, fetch `organisations/{id}` once and store `reg_number`, postcode, outcode and region text. At most 1,500 organisation fetches a run; the rest wait for the next run.
- Backfill: `pnpm ingest grants --since 2024-04-01 --max-pages 400`, run by hand in chunks. About 6,000 projects.
- Every response is validated with Zod. Unknown fields are ignored.

### 10.3 Organisations only

A participant is stored only if it is clearly an organisation:

- its name ends in a company form (Ltd, Limited, PLC, LLP, CIC, LP, or "Community Interest Company", with punctuation variants); or
- it has a `regNumber`.

Everything else (universities, councils, NHS bodies, and names that may be sole traders, that is individual people) is skipped, and only the count of skipped participants is kept, in the run stats. This is a rule, not a list of names, and it is tested with invented examples.

### 10.4 Resolution into companies and events

For each unresolved participant, in one transaction:

1. **Company.** If `reg_number` matches `companies.uk_company_number`, use that company. Otherwise call the Phase 1 `resolveCompany` with name, country `GB`, no city and tags from the project's tagging (if done). Fill an empty `uk_company_number` when the number is unused. New aliases use source `grant`.
2. **Event.** Always create a new event. A grant never matches an existing event. Type `funding_round`, `round_type = grant`, `round_label` = the grant category, amount = `grant_offer_minor` in GBP (USD by the FX step), `announced_on` = the fund start date with `month` precision, and `evidence = confirmed`. Investor "Innovate UK" (kind `government`) as `lead`. Link the event with `event_record_sources` (`ukri_grant`, participant id).
3. **Protecting grant events from news logic.** The news event matcher skips candidate events with `evidence = confirmed`, and `deleteOrphanEvents` keeps events that have a record source. So news re-extraction can never overwrite or delete a grant event. A news report of the same grant becomes a separate `reported` event. Phase 3 adds proper matching of official records to news.

**Tagging.** Grant projects have no tags, and GtR research topics are "Unclassified" for most Innovate UK projects. A small LLM call (prompt version `grant-tags-v1`, purpose `tagging`) reads up to 20 projects at a time (title plus abstract), using the same tag rules as extraction v2, and returns `{ projects: [{ id, tags }] }`. Results go to `grant_taggings` and then to `company_tags` with source `grant`. So grant companies join themes and sectors like any other company.

## 11. Demand-signal collectors (cuttable)

These are the last two waves. Phase 2 ships without them.

**Hacker News (Task 046).** Algolia HN Search API, no key (A4, A24).

- Collect Launch HN stories (title query, `tags=story`) and Show HN stories with at least 50 points that are 24-72 hours old, as `source_items` of a new `hn_algolia` source. Title and link only. The author's username is never stored.
- They go through the normal prefilter (which already passes "Show HN" and "Launch HN"), extraction and resolution, so they become `launch` events with tags.
- `(YC W23)` in a Launch HN title fills an empty `companies.yc_batch` with "W23".
- Points and comments are snapshotted into `launch_metric_snapshots` every 6 hours for 7 days after posting.
- Backfill: `pnpm ingest hn-backfill --since <date>`, bounded by the spend cap and `--limit`.

**GitHub stars (Task 047).** For launches whose URL is a `github.com/<owner>/<repo>` repository, take a daily snapshot of `stargazers_count` and `forks_count` with `GITHUB_TOKEN` (A6), at most 500 repositories a day.

**Y Combinator directory: not built.** yc-oss still has no licence (A25). Revisit only if YC or the mirror publishes terms that allow reuse.

## 12. Pages and routes

All pages are server-rendered and read-only, cached through `src/lib/cached.ts`, and must build without a database. Charts are SVG rendered on the server (12.2).

| Route | Content |
|---|---|
| `/` | Funding table with the new filters (9.2). New column "Momentum": "Round 3 · 7 months after the last · 5.3×", or "First recorded round". A heading from `describeFundingCriteria` when filters are set. |
| `/trends` | Rising themes table: name, sector, rounds in the last 8 weeks, rising score, total GBP, and a 26-week sparkline. Below it, the early-momentum list (8.2). A notice while there is not enough history. |
| `/themes` | All active themes A-Z, grouped by sector, with company counts. |
| `/themes/[slug]` | Theme name (and "suggested name" if not reviewed), sector, tags, a 52-week column chart of rounds (early and later stacked), stage mix, recent rounds (the funding table filtered by theme), first-cheque leaders (8.5) and acquisitions (8.4). Merged slugs redirect. |
| `/acquisitions` | Acquisitions table (target, acquirer, price if known, date, target age), filterable by theme, sector and date, with acquirers by theme and median target age with coverage. |
| `/investors` | Investor activity: choose a theme (or all), and see first-cheque leaders with led, joined and median round size. Links to `/investors/[slug]`. |
| `/companies/[slug]` | Adds themes, sectors, UK region and town, momentum facts ("3 rounds in the last 24 months; latest 5.3× the March 2025 round, 7 months after the previous"), and grant events with "Source: UKRI Gateway to Research". |
| `/about` | Adds methodology for themes, the rising score, momentum, locations and grants, with GtR attribution and OGL wording. |
| `/status` | Adds embedding and theme counts, unnamed and unreviewed themes, grant collector state, and spend by purpose. |

The header nav becomes: Funding, Trends, Acquisitions, Investors, About, Status.

### 12.1 Accessibility

Every chart is a `<figure>` with a `<figcaption>` sentence that states the main finding in words ("Rounds in Climate fintech rose from 3 to 9 a month"). The SVG has `role="img"` and an accessible name. A `<details>` element under each chart holds the same data as a `<table>`. Colour is never the only cue: stacked series also differ by pattern or position, and they have a text legend. Everything works without JavaScript.

### 12.2 Chart approach (D38)

Hand-written React server components that output SVG, in `src/components/charts/`: a sparkline, a weekly column chart (stacked), and a horizontal bar chart. The scale, tick and layout maths is pure TypeScript in `src/lib/chart-scale.ts`, unit-tested.

Why not a library:

- Recharts, Chart.js and Nivo render on the client or need a DOM, which means client JavaScript on every page.
- Observable Plot can render on the server only with a DOM shim.
- visx is server-safe but brings many packages for three simple chart types.
- Three chart types need about 300 lines of code that we own and can test, with no dependency and no client bundle.

## 13. Testing

- **Unit:** rising score, early momentum and company momentum (the worked examples in section 8 as tests), ISO weeks, the clustering function on small synthetic vectors, the stoplist, place and region lookup (including ambiguity and aliases), haversine and bounding box, the organisation-name rule, GtR response parsing, filter parse and serialise round-trips, `describeFundingCriteria`, chart scales.
- **Integration (PGlite):** each new step on seeded data, including idempotent reruns (a second run changes nothing), diff writes, manual theme assignments surviving auto-assignment, merged-theme filters, grant events surviving news re-extraction, and every new filter parameter.
- **Components:** chart output has a figure, caption, accessible name and data table, and the funding table shows momentum.
- **No network:** GtR, HN, GitHub and embeddings are tested through fakes of `HttpFetcher`, `EmbeddingClient` and `LlmClient`. Recorded fixtures are synthetic or trimmed public API responses with no personal names.
- **Extraction eval:** section 4.3, run once by the maintainer.
- **Theme eval (Task 039):** a labelled set of about 200 tags in about 25 expected groups (`fixtures/themes/labelled-tags.json`). `pnpm eval --themes --live` embeds them (a fraction of a penny), records the embeddings, sweeps τ from 0.40 to 0.80 in steps of 0.05, and reports pairwise precision, recall and F1. `--replay` scores the recorded embeddings in CI. **Target: pairwise F1 ≥ 0.75 at the chosen τ.** The chosen τ becomes the default.
- **Real-data review (Task 045):** after extraction runs on the hosted database, the maintainer reviews themes, sectors and a sample of 30 company locations, and records the results in `docs/phase2-review.md`.

## 14. Monthly cost estimate

Prices checked on 11 November 2026 on OpenAI's pricing page: `text-embedding-3-small` **$0.02 per M tokens**, `gpt-5.6-luna` $0.20 / $1.20 per M input / output tokens. Conversion $1.30 = £1.

| Item | Volume / month | Estimate / month |
|---|---|---|
| Tag embeddings | 500 tags × about 5 tokens; under 50k tokens even with re-tries | under £0.01 |
| Theme naming | about 50 new themes, in batches of 20 | about £0.01 |
| Grant tagging | about 250 projects × (about 250 input, 40 output tokens) | about £0.02 |
| Extraction v2 overhead | about 10% more tokens than v1 | about £0.02-£0.03 |
| Hacker News extraction (cuttable) | about 180 items | about £0.05-£0.10 |
| Neon, Vercel, GitHub Actions, GtR, HN, GitHub | free tiers | £0 |
| **Phase 2 added** | | **about £0.05-£0.15, or up to £0.25 with HN** |

Phase 1 plus Phase 2 comes to about £0.25-£1.15 a month, well under the £3 cap.

**One-off costs**, each run separately with `--limit` so no month approaches the cap:

| Job | Estimate |
|---|---|
| Extracting the backlog collected before go-live | about £0.20-£0.35 per month of backlog |
| Grant tagging backfill (about 6,000 projects) | about £0.45 |
| Hacker News 12-month backfill (cuttable) | about £0.80 |
| Theme eval and extraction eval | under £0.05 |

All LLM and embedding calls go through `BudgetGuard`. Without an OpenAI key, the embed, naming and tagging steps are skipped and everything else still runs.

## 15. Assumptions for tasks to verify

Continuing from A14 in `docs/spec.md`. "Verified" rows were checked on 11 November 2026 during planning; the named task re-checks them before relying on them.

| # | Assumption | Status | Checked by |
|---|---|---|---|
| A15 | `text-embedding-3-small` costs $0.02 per M input tokens and supports `dimensions: 512` | Verified (price); dimensions from A10 | 031 |
| A16 | The legacy GtR-2 API (`/gtr/api/projects.json`, `/organisations/{id}`) works without a key, pages at most 100, sorts by `pro.sd`, filters Innovate UK with `f=pro.lf`. The beta `/api/content/` API has not replaced it | Verified | 035 |
| A17 | GtR data may be reused freely with attribution (API page: any purpose, free; terms page: OGL). Commercial reuse confirmed with UKRI before Phase 4 | Partly verified | 035, Phase 4 |
| A18 | GtR rate limit is 10 requests a second per user ("to be confirmed") | Documented | 035 |
| A19 | GtR project data updates monthly | Documented | 035 |
| A20 | The Innovate UK spreadsheets are `.xlsx` (24 MB), updated irregularly, under ukri.org's mostly CC BY-NC-SA 4.0 terms | Verified | none (not used) |
| A21 | A UK city and town gazetteer with coordinates and region is available under OGL (OS Open Names or ONS IPN), with a separate OGL source for Northern Ireland towns | To verify | 026 |
| A22 | Postcode district centroids can be built from OGL data (Code-Point Open, GB). Northern Ireland postcodes carry a separate licence for commercial use | To verify | 026 |
| A23 | ITL1 codes as of January 2025 are TLC-TLN as in section 9.1, with TLN Northern Ireland | Mostly verified | 026 |
| A24 | HN Algolia allows about 10,000 requests an hour per IP; `search_by_date` supports `numericFilters` on `points` and `created_at_i`; hits include `author`, which must not be stored | To verify | 046 |
| A25 | yc-oss/api still has no licence (GitHub API `license: null`) | Verified | none (not built) |
| A26 | Some τ in 0.40-0.80 gives pairwise F1 ≥ 0.75 on the labelled tag set | To measure | 039 |
| A27 | About 300-600 new tags a month at first, falling over time | To measure | 045 |
| A28 | The model states a city for about a quarter of events (6 of 24 in the recorded eval), and v2 does not reduce it | To measure | 024 |
| A29 | About 250 new Innovate UK projects and 400 participants a month; about 6,000 projects since April 2024 | To measure | 035 |
| A30 | Most Innovate UK participants that are companies have a legal-form suffix or a `regNumber`, so the organisation rule keeps them | To measure | 035 |
