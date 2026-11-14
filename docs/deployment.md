# Deployment

SignalFeed runs on three free tiers: Neon for the database, GitHub Actions for ingestion and Vercel for the site. The only cost is LLM usage, which stays well under the £3 monthly cap at measured volumes (`docs/spec.md`, section 12).

You can run steps 1 to 3 and 5 without an LLM key. Ingestion then collects and keeps items, resolves grants and rebuilds locations, stats, confirmations and sectors. Extraction, grant tagging, tag embedding and theme naming all need `OPENAI_API_KEY`, and start once a key is added. Because feeds only expose recent items, start collecting as early as you can.

Phase 3 (Companies House and SEC Form D) costs nothing and needs no LLM key. Its setup is in section 10.

## 1. Create the database

Create a Neon project in a region near your Vercel region. Note both connection strings:

- the **direct** URL, whose host has no `-pooler`. The pipeline needs this, because its run lock does not work through a connection pooler, and it refuses a pooled URL.
- the **pooled** URL, for the website.

## 2. Apply migrations

```bash
DATABASE_URL="<owner direct url>" pnpm db:migrate
```

## 3. Create the roles

Run this once as the owner, with two strong passwords you generate:

```bash
psql "<owner direct url>" -v ingest_password='...' -v web_password='...' -f scripts/sql/roles.sql
```

## 4. Set up the LLM key

Create an OpenAI project key. Buy prepaid credit ($5 is the minimum), turn auto-recharge **off**, and set a project budget limit if one is available. Prepaid credit is the outer spend limit: when it runs out, the provider stops serving requests.

## 5. Configure GitHub

Secrets:

| Name | Value |
|---|---|
| `DATABASE_URL` | Direct URL, `signalfeed_ingest` role |
| `DATABASE_URL_OWNER` | Direct URL, owner role. Used only by the migrate workflow |
| `OPENAI_API_KEY` | Optional until you want extraction, grant tagging, embedding and theme naming |
| `COMPANIES_HOUSE_API_KEY` | Optional. Companies House API key for the daily registry step (section 10). Never add it to Vercel |

Variables:

| Name | Value |
|---|---|
| `INGEST_ENABLED` | `true`. Anything else stops ingestion |
| `EXTRACTION_MODEL` | The model chosen in `docs/eval-results.md` |
| `LLM_MONTHLY_CAP_GBP` | `3` |
| `HTTP_CONTACT` | An email address where publishers and the SEC can reach you, sent in every User-Agent as `SignalFeed/<version> (+<HTTP_CONTACT>)`. SEC EDGAR needs an email address, so `pnpm ingest formd` refuses a URL |

Optional variables, with their defaults: `GTR_REQUESTS_PER_SECOND` (3), `MAX_GRANT_ORG_FETCHES_PER_RUN` (1500), `EMBEDDING_MODEL` (`text-embedding-3-small`), `MAX_EXTRACTIONS_PER_RUN` (150), `MAX_EMBEDDINGS_PER_RUN` (2000), `MAX_THEME_NAMES_PER_RUN` (20) and `MAX_GRANT_TAGGINGS_PER_RUN` (200). The hourly workflow does not pass the Phase 2 ones yet, so their defaults apply. The daily workflow passes the two grants settings when set.

Two workflows use these settings:

- **Ingest** (`.github/workflows/ingest.yml`), hourly at minute 17. It runs `pnpm ingest run`: collect, prefilter, extract, resolve and FX, then grant tagging and resolution, tag embedding, theme assignment and naming, locations and stats. Paid steps skip cleanly with no key, and a budget pause stops the paid steps that follow it.
- **Daily** (`.github/workflows/daily.yml`), at 05:41 UTC. The job has 75 minutes, and each step has its own timeout (grants 25, Companies House 25, Form D 15), so a slow grants step cannot starve the later ones. It runs three steps in order: `pnpm ingest grants`, which fetches new Innovate UK projects and organisations from UKRI Gateway to Research; `pnpm ingest registry` (Companies House); and `pnpm ingest formd` (SEC Form D). All three are free and need no LLM key. A failing step does not skip the ones after it. The next hourly run tags and resolves the grants.

Both share the `ingest` concurrency group, so they never overlap, and the database run lock is a second guard. `INGEST_ENABLED` stops both.

Run the **Ingest** and **Daily** workflows once by hand from the Actions tab and check the step summaries.

## 6. Deploy the site

Import the repository into Vercel with the Next.js preset. `vercel.json` pins functions to London (`lhr1`), next to the Neon London database.

The web environment needs only:

| Name | Value |
|---|---|
| `DATABASE_URL` | The pooled URL with the `signalfeed_web` role, for Production and Preview |
| `SITE_INDEXING` | Optional. Leave it unset until launch. See below |

The site needs no other secrets, and must never be given an LLM key or the Companies House key.

**Indexing.** While `SITE_INDEXING` is unset, or anything other than `true`, every page carries `noindex, nofollow` and `/robots.txt` disallows everything. That is right for a `vercel.app` preview in the old design. At launch, set `SITE_INDEXING` to `true` and redeploy (the value is read at build time) to allow indexing.

## 7. Verify

The site loads, and `/status` shows the latest run within about a minute.

Both of these commands must fail with a permission error:

```bash
psql "<web url>" -c "insert into tags (slug, label) values ('x', 'x')"
```

```bash
psql "<web url>" -c "select * from source_item_texts limit 1"
```

## 8. Backfill grants

The daily workflow only fetches recent projects. To load older grants, run the backfill by hand from your machine, with the same settings as the workflows in `.env`:

```bash
pnpm ingest grants --since 2024-04-01 --max-pages 400
```

That is about 6,000 projects. One run walks every page back to the `--since` date; this takes about a minute, at 3 requests a second (`GTR_REQUESTS_PER_SECOND`). The organisation details are the slow part: each run fetches at most 1,500 organisations (`--max-orgs`, or `MAX_GRANT_ORG_FETCHES_PER_RUN`), about 9 minutes. The whole backfill is roughly 13 minutes, down from about 40. Run the same command again until `orgsFetched` is 0. Later runs stop after 3 pages with no new project, so they go straight to the organisations.

Let the first walk finish. If it stops part way, later runs also stop after 3 pages with nothing new, so the older pages are not reached.

Then run `pnpm ingest run` by hand once. It turns the backlog of participants into companies and grant events, which can take longer than the hourly workflow's 20-minute limit. Grant tagging continues at up to 200 projects a run. A grant event gets its USD amount on the run after it is created, because FX runs before grant resolution.

## 9. Review themes

Themes are created and named automatically. Review them from your machine with `pnpm themes`. It never calls an LLM, and the web app cannot run it.

| Command | What it does |
|---|---|
| `pnpm themes list [--unreviewed]` | Active themes with companies, tags, name source and sector |
| `pnpm themes rename <slug> "<name>"` | Sets the name. The naming step never changes it again |
| `pnpm themes sector <slug> <sector-slug>` | Sets the sector (`src/core/sectors.ts` lists them) |
| `pnpm themes merge <from-slug> <into-slug>` | Moves every tag into the second theme. The old slug redirects |
| `pnpm themes move <tag-slug> <theme-slug\|none>` | Puts a tag in a theme, or in none. Automatic assignment never changes it |
| `pnpm themes suggest-merges` | Lists pairs of themes that look alike. Changes nothing |

Names and sectors show on the site at once. Merges and moves reach company themes and trends after the next stats rebuild, which the hourly run does when anything changed. To rebuild now, run `pnpm ingest stats`.

Single steps can also be run by hand, each under the run lock: `pnpm ingest embed`, `pnpm ingest themes` and `pnpm ingest stats [--force]`. The first two need `OPENAI_API_KEY` for anything that costs money.

## 10. Phase 3: Companies House and SEC Form D

Phase 3 links companies to Companies House and SEC filings and marks news rounds as confirmed (`docs/spec-phase3.md`). It adds no cost. Steps marked **[maintainer]** need you.

### What runs where

- **Hourly** (`pnpm ingest run`): after the Phase 2 steps, it rebuilds confirmations (`event_confirmations` and `events.evidence`) and then sectors (`company_sectors`). Both use the database only, and skip when nothing changed. The locations step also uses registered offices. `run` never calls Companies House or EDGAR.
- **Daily**, after grants:
  - `pnpm ingest registry`: links companies to Companies House, refreshes linked profiles and fetches SH01 filings, at most `MAX_CH_REQUESTS_PER_RUN` (2,000) requests. Then it rebuilds confirmations, locations and sectors, so new links show at once. About 21 minutes at 2,000 requests. Without `COMPANIES_HOUSE_API_KEY` the run is recorded as skipped and the step succeeds.
  - `pnpm ingest formd`: fetches the EDGAR daily indexes for days not yet done (up to yesterday, US Eastern time), stores each non-fund Form D and D/A, links issuers to companies, then rebuilds confirmations. At most `MAX_EDGAR_DAYS_PER_RUN` (10) days and `MAX_EDGAR_REQUESTS_PER_RUN` (3,000) requests, about 10 minutes. If `HTTP_CONTACT` has no email address it refuses, fetches nothing and the step fails.

Each command is recorded as a run under the run lock, and its stats show on `/status`. A failing step is recorded in the run's error and never loses what earlier steps stored.

### Set up

1. **[maintainer]** Keep the `COMPANIES_HOUSE_API_KEY` repository **secret** (already set). The daily workflow gives it to the registry step only. Never add it to Vercel or to any web environment.
2. **[maintainer]** Change the repository **variable** `HTTP_CONTACT` from a URL to `signalfeed@taylorhallin.com`. One variable serves every request: RSS feeds and Gateway to Research get the same User-Agent, which is fine for them. Do this before the first daily run with Phase 3, or set `FORMD_ENABLED` to `false` until you do.
3. **[maintainer]** Apply the migration (`drizzle/0003_phase3.sql`). The **Migrate** workflow runs it when the change reaches `main`; you can also run it from the Actions tab. Until it has run, the hourly confirm, sectors and locations steps fail and say so in the run error, but collection and the other steps still work.
4. **[maintainer]** Re-run the roles script as the owner, so the web role can read the new tables:

   ```bash
   psql "<owner direct url>" -v ingest_password='...' -v web_password='...' -f scripts/sql/roles.sql
   ```

5. **[maintainer]** Run the **Daily** workflow once by hand and check the step summary: the Companies House table should show requests, and the Form D table filings stored.
6. Run the one-off grant relink once, from your machine. List the pairs first, then move them:

   ```bash
   pnpm ingest relink-grants --dry-run
   pnpm ingest relink-grants
   ```

Optional variables, with their defaults: `MAX_CH_REQUESTS_PER_RUN` (2000), `MAX_EDGAR_DAYS_PER_RUN` (10) and `MAX_EDGAR_REQUESTS_PER_RUN` (3000). The daily workflow passes them when set. Keep the daily job under its 75-minute limit: grants has 25 minutes, the registry step 25 and Form D 15.

In short, you must set:

| Kind | Name | Value |
|---|---|---|
| Secret | `COMPANIES_HOUSE_API_KEY` | Your Companies House API key (already set) |
| Variable | `HTTP_CONTACT` | `signalfeed@taylorhallin.com` |

### Backfill

The daily steps only move forward a little each day. To load history (`docs/spec-phase3.md` section 13.1), run these from your machine with the workflow settings and `COMPANIES_HOUSE_API_KEY` in `.env`. Each takes the run lock, so it never overlaps a workflow run. If it prints `{"ran":false}`, a workflow holds the lock: try again later. While a backfill holds the lock, hourly runs skip, which is safe for a few hours.

- **Companies House:** about 6,000 companies, about 30,000 requests. Run in chunks, for example:

  ```bash
  pnpm ingest registry --max-requests 6000
  ```

  At 500 requests in 5 minutes, 6,000 requests take about an hour. Repeat until `companiesSearched` is near 0. Left alone, the daily step does the same in about 15 days.
- **SEC Form D:** six months is about 26,000 requests. Run, and repeat until `daysFetched` is 0:

  ```bash
  pnpm ingest formd --since 2026-05-01 --max-days 200 --max-requests 8000
  ```

  At 5 requests a second, 8,000 requests take about 27 minutes. Days already done are skipped, so a stopped run resumes where it left off.

### Pause a step

| To pause | Do this |
|---|---|
| The registry step | Set the variable `REGISTRY_ENABLED` to `false`, or delete the `COMPANIES_HOUSE_API_KEY` secret (runs are then recorded as skipped) |
| The Form D step | Set the variable `FORMD_ENABLED` to `false` |
| Everything | Set `INGEST_ENABLED` to anything but `true` |

Remove the variable, or set it to anything else, to resume. Nothing is lost while paused: both registries keep full history. The hourly confirm and sectors steps cannot be paused on their own; they are free and skip when nothing changed.

### Review links

Automatic links are strict, so some companies wait for review. Review them from your machine with `pnpm registry` (`list`, `show`, `approve`, `reject`, `link`, `unlink`). It never calls an API, and the web app cannot run it. Manual decisions are final. Confirmations and sectors catch up on the next hourly run.

## Limits to keep in mind

- **Neon Free:** 1 GB of storage and 100 CU-hours a month. Measured growth is about 10 MB a month, and hourly runs fit the allowance.
- **GitHub Actions:** free for public repositories. Start times are best-effort, and schedules stop after 60 days without repository activity. Re-enable both workflows from the Actions tab.
- **Gateway to Research:** UKRI documents up to 10 requests a second ("to be confirmed"). SignalFeed asks for 3 by default. Project data is updated monthly.
- **Companies House:** the limit is 600 requests in 5 minutes. SignalFeed stays at 500, and at most `MAX_CH_REQUESTS_PER_RUN` a run.
- **SEC EDGAR:** the limit is 10 requests a second. SignalFeed stays at 5, with an email address in the User-Agent.
- **Vercel Hobby:** non-commercial use only. A paid product needs another plan or host.
