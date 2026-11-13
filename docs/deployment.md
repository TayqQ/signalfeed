# Deployment

SignalFeed runs on three free tiers: Neon for the database, GitHub Actions for ingestion and Vercel for the site. The only cost is LLM usage, which stays well under the £3 monthly cap at measured volumes (`docs/spec.md`, section 12).

You can run steps 1 to 3 and 5 without an LLM key. Ingestion then collects and keeps items, resolves grants and rebuilds locations and stats. Extraction, grant tagging, tag embedding and theme naming all need `OPENAI_API_KEY`, and start once a key is added. Because feeds only expose recent items, start collecting as early as you can.

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

Variables:

| Name | Value |
|---|---|
| `INGEST_ENABLED` | `true`. Anything else stops ingestion |
| `EXTRACTION_MODEL` | The model chosen in `docs/eval-results.md` |
| `LLM_MONTHLY_CAP_GBP` | `3` |
| `HTTP_CONTACT` | A URL where publishers can reach you, sent in the User-Agent |

Optional variables, with their defaults: `EMBEDDING_MODEL` (`text-embedding-3-small`), `MAX_EXTRACTIONS_PER_RUN` (150), `MAX_EMBEDDINGS_PER_RUN` (2000), `MAX_THEME_NAMES_PER_RUN` (20) and `MAX_GRANT_TAGGINGS_PER_RUN` (200). The workflows do not pass them yet, so the defaults apply.

Two workflows use these settings:

- **Ingest** (`.github/workflows/ingest.yml`), hourly at minute 17. It runs `pnpm ingest run`: collect, prefilter, extract, resolve and FX, then grant tagging and resolution, tag embedding, theme assignment and naming, locations and stats. Paid steps skip cleanly with no key, and a budget pause stops the paid steps that follow it.
- **Daily** (`.github/workflows/daily.yml`), at 05:41 UTC. It runs `pnpm ingest grants`, which fetches new Innovate UK projects and organisations from UKRI Gateway to Research. It is free and needs no key. The next hourly run tags and resolves what it collects.

Both share the `ingest` concurrency group, so they never overlap, and the database run lock is a second guard. `INGEST_ENABLED` stops both.

Run the **Ingest** and **Daily** workflows once by hand from the Actions tab and check the step summaries.

## 6. Deploy the site

Import the repository into Vercel with the Next.js preset. Set `DATABASE_URL` to the pooled URL with the `signalfeed_web` role, for Production and Preview. The site needs no other secrets, and must never be given an LLM key.

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

That is about 6,000 projects. One run walks every page back to the `--since` date; this takes about a minute, at one request a second. The organisation details are the slow part: each run fetches at most 1,500 organisations (`--max-orgs`), about 25 minutes. Run the same command again until `orgsFetched` is 0. Later runs stop after 3 pages with no new project, so they go straight to the organisations.

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

## Limits to keep in mind

- **Neon Free:** 1 GB of storage and 100 CU-hours a month. Measured growth is about 10 MB a month, and hourly runs fit the allowance.
- **GitHub Actions:** free for public repositories. Start times are best-effort, and schedules stop after 60 days without repository activity. Re-enable both workflows from the Actions tab.
- **Gateway to Research:** SignalFeed stays at one request a second. Project data is updated monthly.
- **Vercel Hobby:** non-commercial use only. A paid product needs another plan or host.
