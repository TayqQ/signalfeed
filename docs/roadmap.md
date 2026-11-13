# Roadmap

Phase 1 (the funding core) is specified in `docs/spec.md` and broken into tasks in `docs/tasks/`. Each later phase gets its own planning pass, with its own spec section and task files, once the previous phase ships. Later phases add tables; they never rewrite existing rows.

## Phase 2: trends plus targeting
Goal: answer "which themes are attracting funding, and are they rising?", and lay the data groundwork for a paid targeting tier.

**Planned in `docs/spec-phase2.md`, with tasks 024-047 in `docs/tasks/README.md`.** Scope set by the maintainer on 11 November 2026: "Trends plus targeting".

- **Extraction v2 first.** A new `regionText` field and tighter city and tag rules (D33), in wave 1, so paid extraction can start on the hosted database before the rest of Phase 2 lands.
- **Themes.** Tags embedded with pgvector (`text-embedding-3-small`, 512 dimensions, stored with the model name), assigned to themes by greedy centroid clustering (D34), with LLM-suggested names a person can rename and a fixed sector list (D35). New `themes` and `tag_themes` tables. Raw tags stay untouched.
- **Weekly stats.** `theme_weekly_stats` and `weekly_totals`, rebuilt idempotently from events, writing only changed rows (D37).
- **Rising score.** A shrunk log ratio against the theme's baseline share (D36), with worked examples as tests.
- **Views:**
  - *early momentum*: early rounds rising, with a low share of companies at Series A or beyond;
  - *acquisitions*: acquirers by theme, and target age from `founded_year` (sparse until Phase 3);
  - *investor activity*: first-cheque leaders per theme by count and median round size. Individual cheque sizes are rarely reported, so round size is used instead.
- **Company momentum.** Months since the previous round, step-up, and rounds in the last 24 months, from each company's own timeline (D43).
- **Targeting groundwork (added in planning).** ITL1 sub-regions, town or city, "near a place" by distance, sector and theme filters, momentum filters, and a versioned, canonical filter model that Phase 4 saved searches and alerts can reuse unchanged (D39, D41). No accounts, alerts or payments.
- **UKRI grants (added in planning).** Innovate UK grant recipients from the Gateway to Research API, organisations only, as `confirmed` grant events with postcode locations (D40). Grants are hidden by default and excluded from trend scores (D44).
- **Charts:** hand-written, server-rendered, accessible SVG with no chart library (D38).
- **Demand-signal collectors, last and cuttable:** Hacker News Show HN and Launch HN (Algolia API, backfill possible) and GitHub star snapshots into `launch_metric_snapshots`. Y Combinator directory data is not collected, because the only mirror has no licence; the batch comes from Launch HN titles (D42).
- **Tier 3 work:** extraction v2, contracts, schema, trend maths, theme clustering, derived stats, grant resolution.

## Phase 3: confirmed raises from filings
Goal: mark raises as `confirmed` with official data, and fill gaps that news misses.

- **SEC Form D.** Daily EDGAR indexes, Form D XML parsing (structured, no PDFs), descriptive User-Agent, rate limiting below 10 requests/second. Link to companies by name and state. Ignore the "related persons" names.
- **UK Companies House.**
  - SH01 share allotments via filing history and the Document API. These are PDFs, often scanned, so the work involves OCR or vision-model cost estimates and a per-document spend limit.
  - Link to companies via `uk_company_number` (Phase 2 already fills it from grant records where known), and backfill `founded_year` from incorporation dates, which improves acquisition-age data.
  - Company size from the accounts category (micro, small and so on), which the targeting filters need and Phase 2 cannot get.
  - Ignore officer and shareholder personal names (UK GDPR).
- **Matching.** Filing-to-news matching rules, and an `evidence_level` upgrade from `reported` to `confirmed`. This should also match Phase 2's `confirmed` grant events to news reports of the same grant.

## Phase 4: accounts, alerts and the UK leads view
Goal: personal workflows, and a possible small paid product.

- Authentication, watchlists (companies, themes, investors), and alert rules.
- A weekly email digest (a transactional email provider's free tier). Scheduled jobs stay outside web requests.
- **UK leads view:** UK companies that recently raised or won a grant, with company-level data only (Companies House number, SIC codes, registered office, website). No personal contact details without a separate decision. Saved searches and alerts reuse the Phase 2 filter model (D41) unchanged.
- **If paid:**
  - payments;
  - move off Vercel Hobby (non-commercial terms);
  - check RSS publisher terms for commercial use (A2), and confirm commercial reuse of GtR data with UKRI (A17);
  - Northern Ireland postcode data carries a separate licence for commercial use (A22);
  - privacy policy and terms;
  - a CLA if dual licensing is wanted.
