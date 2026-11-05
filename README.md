# SignalFeed

SignalFeed reads public startup news, uses a language model to extract funding rounds, acquisitions and launches, and merges duplicate reports into one record per company and event. Every figure on the site links back to the articles it came from. It is open source and designed to run at close to zero cost.

**Status:** not yet deployed, so there is no live site. The pipeline has collected real feeds locally, but no real article has been through the language model yet, and accuracy on real data is unmeasured. See [Limitations](#limitations).

## Screenshots

These show invented seed data, not real companies.

![Funding table with filters, showing rounds with amounts and lead investors](docs/images/funding-table.png)

![Company page with a timeline of events and linked sources](docs/images/company-page.png)

![Status page with recent runs and spend against the cap](docs/images/status.png)

![Funding table on a phone](docs/images/funding-table-mobile.png)

## Features

- Hourly collection from five startup news feeds, keeping the headline, link and feed summary
- One model call per likely item, returning validated JSON
- Merging of reports into companies, investors and events, with a review queue for doubtful matches
- Amounts kept as reported, and converted to USD and GBP at that day's ECB rate
- A read-only site: a filterable funding table, company and investor pages, a methodology page and a status page

## Architecture

```mermaid
flowchart LR
  subgraph GH[GitHub Actions, hourly]
    C[Collect RSS] --> P[Prefilter] --> X[Extract with LLM] --> R[Resolve entities] --> F[FX conversion]
    B[(Budget guard)] -.checks.- X
  end
  X <--> O[OpenAI API]
  F <--> E[Frankfurter, ECB rates]
  GH -- ingest role: read and write --> DB[(Neon Postgres)]
  W[Next.js on Vercel] -- web role: read only --> DB
  U[Visitors] --> W
```

Key design choices, with reasoning in [`docs/decisions.md`](docs/decisions.md):

- **The model finds, code computes.** Amounts come back as verbatim text and are parsed by tested code. Domains and links are kept only if they appear in the source text (D8).
- **Events are derived.** Each event is rebuilt from all its reports, so arrival order does not matter and new evidence can correct old values (D12).
- **Wrong merges are worse than missed ones.** Rules merge only on solid evidence, and everything else goes to a review queue (D11, D29).
- **Visitors cannot cause spend.** No web route can start the pipeline, and the site's database role cannot write or read feed summaries (D5).
- **Collecting does not depend on the model.** Feeds have no backfill, so runs without a key still keep items for later (D27).

## How extraction is measured

Two evals, both run with `pnpm eval`:

- **Extraction** scores model output against 30 real headlines with hand-checked answers. It has not been run yet, because it needs an API key. See [`docs/eval-results.md`](docs/eval-results.md).
- **Merging** runs hand-written reports through the real resolver and checks every pair. It tests known failure patterns on invented names and does not estimate accuracy on real news. See [`docs/resolution-eval-results.md`](docs/resolution-eval-results.md).

## Cost controls

Spend is limited in three layers, each covering a different failure (D10):

1. A monthly cap, £3 by default, checked against worst-case cost before every call. Unknown model prices are refused.
2. A limit on calls per run.
3. Prepaid provider credit with auto-recharge off.

## Tech stack

TypeScript, Next.js, Tailwind CSS, Postgres on Neon, Drizzle ORM, Zod, the OpenAI API, GitHub Actions, Vitest and PGlite.

## Run it locally

You need Node 24, pnpm and Docker.

```bash
pnpm install
```

```bash
docker run -d --name signalfeed-pg -e POSTGRES_USER=signalfeed -e POSTGRES_PASSWORD=signalfeed -e POSTGRES_DB=signalfeed -p 127.0.0.1:5432:5432 pgvector/pgvector:pg17
```

Copy `.env.example` to `.env`, then set `DATABASE_URL` to `postgres://signalfeed:signalfeed@localhost:5432/signalfeed` and `HTTP_CONTACT` to a URL where publishers can reach you.

```bash
pnpm db:migrate
```

To browse invented sample data:

```bash
pnpm db:seed
```

```bash
pnpm dev
```

To collect real feeds instead, use a fresh database, because the seed data would mix with real data. This needs no API key:

```bash
pnpm ingest run
```

To run the tests:

```bash
pnpm check
```

Deployment is covered in [`docs/deployment.md`](docs/deployment.md).

## Limitations

- **News only.** Coverage favours English-language and well-covered startups, and depends on what five publishers put in their feeds.
- **Headlines and summaries only.** Extraction never reads the full article, so investors and locations are often missing.
- **Amounts are as reported,** not checked against filings. Filings are planned for Phase 3.
- **History starts at the first collection.** Feeds do not go back in time.
- **Merging is conservative,** so some duplicates remain until reviewed. Two different companies with the same name and no country in the text are merged wrongly. The merging eval shows this case.
- **The extraction fixtures paraphrase summaries,** so live accuracy may be lower.
- **Vercel Hobby is non-commercial,** and publisher terms were reviewed for free, non-commercial use only.

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md). Next comes themes and trends, which need weeks of collected history.

## Data and attribution

The site shows headlines, links and extracted facts, always credited to the source. Feed summaries go to the language model and are never displayed. SignalFeed keeps no records of individual people, although a publisher's headline may name someone. See [`docs/sources.md`](docs/sources.md) for the terms reviewed for each feed.

## Licence

[AGPL-3.0](LICENSE).
