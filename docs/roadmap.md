# Roadmap

Phase 1 (the funding core) is specified in `docs/spec.md` and broken into tasks in `docs/tasks/`. Each later phase gets its own planning pass, with its own spec section and task files, once the previous phase ships. Later phases add tables; they never rewrite existing rows.

## Phase 2: trends
Goal: answer "which themes are attracting funding, and are they rising?"

- **Themes.** Embed tags with pgvector (deterministic model, stored with the model name). Cluster them into themes, with LLM-suggested names a person can rename. New `themes` and `tag_themes` tables. Raw tags stay untouched.
- **Weekly stats.** A `theme_weekly_stats` table (rounds, total GBP, seed vs Series A counts, acquisitions, launches), rebuilt idempotently from events.
- **Rising score.** Compare the last 4-8 weeks with a longer baseline, shrinking towards zero for small counts so a single round can't top the chart. A tested, documented formula.
- **Views:**
  - *early momentum*: seed counts rising, with a low share of companies at Series A or beyond;
  - *acquisitions*: acquirers by theme, and target age from `founded_year` (sparse until Phase 3);
  - *investor activity*: first-cheque leaders per theme by count and median round size. Individual cheque sizes are rarely reported, so round size is used instead.
- **Demand-signal collectors:** Hacker News Show HN / Launch HN (Algolia API, backfill possible), GitHub star snapshots into `launch_metric_snapshots`, and Y Combinator directory data if its terms allow (A5).
- **Charts:** server-rendered and accessible, with a lightweight library chosen in that planning pass.
- **Likely Tier 3 work:** theme clustering, rising score.

## Phase 3: confirmed raises from filings
Goal: mark raises as `confirmed` with official data, and fill gaps that news misses.

- **SEC Form D.** Daily EDGAR indexes, Form D XML parsing (structured, no PDFs), descriptive User-Agent, rate limiting below 10 requests/second. Link to companies by name and state. Ignore the "related persons" names.
- **UK Companies House.**
  - SH01 share allotments via filing history and the Document API. These are PDFs, often scanned, so the work involves OCR or vision-model cost estimates and a per-document spend limit.
  - Link to companies via `uk_company_number`, and backfill `founded_year` from incorporation dates, which improves acquisition-age data.
  - Ignore officer and shareholder personal names (UK GDPR).
- **Matching.** Filing-to-news matching rules, and an `evidence_level` upgrade from `reported` to `confirmed`.

## Phase 4: accounts, alerts and the UK leads view
Goal: personal workflows, and a possible small paid product.

- Authentication, watchlists (companies, themes, investors), and alert rules.
- A weekly email digest (a transactional email provider's free tier). Scheduled jobs stay outside web requests.
- **UK leads view:** UK companies that recently raised, with company-level data only (Companies House number, SIC codes, registered office, website). No personal contact details without a separate decision.
- **If paid:**
  - payments;
  - move off Vercel Hobby (non-commercial terms);
  - check RSS publisher terms for commercial use (A2);
  - privacy policy and terms;
  - a CLA if dual licensing is wanted.
