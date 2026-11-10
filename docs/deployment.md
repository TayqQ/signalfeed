# Deployment

SignalFeed runs on three free tiers: Neon for the database, GitHub Actions for ingestion and Vercel for the site. The only cost is LLM usage, which stays well under the £3 monthly cap at measured volumes (`docs/spec.md`, section 12).

You can run steps 1 to 3 and 5 without an LLM key. Ingestion then collects and keeps items, and extracts them once a key is added. Because feeds only expose recent items, start collecting as early as you can.

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
| `OPENAI_API_KEY` | Optional until you want extraction |

Variables:

| Name | Value |
|---|---|
| `INGEST_ENABLED` | `true`. Anything else stops ingestion |
| `EXTRACTION_MODEL` | The model chosen in `docs/eval-results.md` |
| `LLM_MONTHLY_CAP_GBP` | `3` |
| `HTTP_CONTACT` | A URL where publishers can reach you, sent in the User-Agent |

Run the **Ingest** workflow once by hand from the Actions tab and check the step summary.

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

## Limits to keep in mind

- **Neon Free:** 1 GB of storage and 100 CU-hours a month. Measured growth is about 10 MB a month, and hourly runs fit the allowance.
- **GitHub Actions:** free for public repositories. Start times are best-effort, and schedules stop after 60 days without repository activity. Re-enable them from the Actions tab.
- **Vercel Hobby:** non-commercial use only. A paid product needs another plan or host.
