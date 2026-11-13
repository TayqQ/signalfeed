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

**Planned in `docs/spec-phase3.md`, with tasks 048-067 in `docs/tasks/README.md`** (planning pass of 12 November 2026). No extraction change, and no paid calls outside the cuttable last wave.

- **UK Companies House first** (the paying user's priority). REST API with a free key, 600 requests in five minutes, kept at 500 (D52). The bulk snapshot is not needed.
  - **Linking** to `uk_company_number` by exact name plus a supporting fact: a grant postcode, a nearby registered office, or an SH01 near a reported round. Ambiguous cases go to an optional review queue (`pnpm registry`) or stay unlinked (D53).
  - **Facts:** incorporation date (fills an empty `founded_year`, so company and target ages fill in), status, SIC codes (a fallback sector for companies with no theme), registered office postcode district (a new location rule, ignoring formation-agent addresses), and a size band from the last accounts type (D57, D59).
  - **SH01:** filing metadata only, which confirms that shares were issued near a round but not the amount. Reading the image-only PDFs is a cuttable last wave, recommended to defer (D55).
  - Officers, PSCs and shareholders are never fetched or stored (D58).
- **SEC Form D.** Daily EDGAR indexes and Form D XML, User-Agent with a contact email, at most 5 requests a second. Non-fund filings stored with organisation facts only; issuers linked by CIK or name plus a matching round. Related persons are never read. No events from Form D alone in Phase 3 (D51).
- **Confirmation.** A news round is `confirmed` when an SH01 or a Form D falls in its date window (and, for Form D, amounts agree). Derived and rebuilt like other stats; amounts stay as reported (D54). Phase 2's guard for grant events changes to "created from a record" first.
- **Grants matched to news.** A news report of an Innovate UK grant attaches to the grant event instead of duplicating it (D56).
- **UI, minimal.** A "Confirmed" marker and filter, a company size filter (filter criteria version 3, D60), and registry facts on company pages. The full UX/UI overhaul comes after the functionality is complete.
- **Cost and storage:** £0 a month added; about 20 MB one-off and 2 MB a month.

## Phase 4: accounts, alerts and the UK leads view
Goal: personal workflows, and a possible small paid product.

- Authentication, watchlists (companies, themes, investors), and alert rules.
- A weekly email digest (a transactional email provider's free tier). Scheduled jobs stay outside web requests.
- **UK leads view:** UK companies that recently raised or won a grant, with company-level data only (Companies House number, SIC codes, registered office district and size band from Phase 3, plus website). No personal contact details without a separate decision. Saved searches and alerts reuse the filter model (D41; version 3 since D60) unchanged.
- **If paid:**
  - payments;
  - move off Vercel Hobby (non-commercial terms);
  - check RSS publisher terms for commercial use (A2), confirm commercial reuse of GtR data with UKRI (A17), and of Companies House data (A32);
  - Northern Ireland postcode data carries a separate licence for commercial use (A22);
  - privacy policy and terms;
  - a CLA if dual licensing is wanted.

## Later options (not scheduled)

- **Standalone US Form D offerings as events.** Phase 3 uses Form D only to confirm news raises (D61). Adding the roughly 17,000 non-fund US offerings a year as events of their own would be considered only if both hold:
  1. users, especially paying ones, show interest in US companies; and
  2. the offerings are significant enough for the likely paying user, for example above a size floor or in their sectors, rather than thousands of very small raises.
- **SH01 amounts via a vision model** (deferred Task 067, D61).
- **Hacker News and GitHub demand signals** (deferred Tasks 046 and 047, D45).

