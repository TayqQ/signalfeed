# Verified external sources (Task 001)

Verification date: **8 October 2026** (UTC). Methods: live HTTP fetches of RSS feeds and APIs, plus publisher and vendor documentation linked below.

Statuses: **confirmed** (matches spec), **changed** (fact differs from spec), **unverifiable** (could not confirm from an official source).

---

## A1 — RSS feed candidates

**Status: changed** — all six URLs work, but Sifted omits `<description>` (title and link only). Other feeds match the spec shape.

| Feed | HTTP | Format | Items in feed | Est. items/day | `<description>` | Paywall / partial feed |
|------|------|--------|---------------|----------------|-----------------|-------------------------|
| TechCrunch Venture | 200 | RSS 2.0 | 20 | ~2.2 | Yes (~178 chars avg, HTML stripped) | Site may be paywalled; feed carries short summaries. [Feed](https://techcrunch.com/category/venture/feed/) |
| Crunchbase News | 200 | RSS 2.0 | 10 | ~1.6 | Yes (~273 chars avg) | Full article text not in feed; summaries usable. [Feed](https://news.crunchbase.com/feed/) |
| Sifted | 200 | RSS 2.0 | 24 | ~8.0 | **No** — items are title, link, `pubDate` only | No summary in RSS; extraction is headline-only unless policy changes. [Feed](https://sifted.eu/feed) |
| Tech.eu | 200 | RSS 2.0 | 20 | ~10.7 | Yes (~203 chars avg) | Some pieces are partner/sponsored; feed still has summaries. [Feed](https://tech.eu/feed/) |
| EU-Startups | 200 | RSS 2.0 | 10 | ~9.1 | Yes (~502 chars avg; often promo text) | Shallow feed (~1 day of items at current rate). [Feed](https://www.eu-startups.com/feed/) |
| UKTN | 200 | RSS 2.0 | 10 | ~1.2 | Yes (~482 chars avg) | General UK tech, not funding-only. [Feed](https://www.uktech.news/feed) |

**Field checks:** On feeds that include descriptions, all sampled items had `title`, `link`, and `pubDate`. TechCrunch and Crunchbase also include `content:encoded` on some items (not required for Phase 1).

**Official feed URLs:** All spec URLs resolve without redirect to a different host. No URL corrections needed.

---

## A2 — Publisher terms (headlines, links, extracted facts, commercial use)

**Status: changed** — several publishers restrict AI training or commercial reuse; Phase 1 (free, non-commercial, headlines + links + facts) is mostly acceptable with attribution, except where noted.

### TechCrunch

- **Status:** confirmed for Phase 1 display with attribution.
- **Terms:** [RSS Terms of Use](https://techcrunch.com/rss-terms-of-use/)
- **Summary:** May display feed content with **attribution to TechCrunch** and a **link to the full article**. No ads in the feed; do not remove attribution or modify feed content.
- **Quote:** “you are only permitted to display the content that is provided in the feed, with attribution to TechCrunch, and you must link to the full article on TechCrunch.”
- **Commercial / Phase 4:** General [Terms of Service](https://techcrunch.com/terms-of-service/) govern the site; RSS terms are the relevant syndication rule. Paid/commercial product likely needs separate review.

### Crunchbase (Crunchbase News)

- **Status:** changed — RSS is fine for headlines/links; **LLM extraction may conflict** with data-use rules.
- **Terms:** [Terms of Service](https://about.crunchbase.com/terms-of-service/), [Attribution Instructions](https://about.crunchbase.com/terms-of-service/attribution-instructions/)
- **Summary:** Attribution must state content is from Crunchbase and link to the source page. Crunchbase’s terms restrict automated collection and use of content to **train AI models** (including generative AI). SignalFeed does not train models on article text but does send headlines/summaries to a third-party LLM for extraction — **legal review recommended** before production use.
- **Commercial:** Marketplace / commercial data use is separately licensed.

### Sifted

- **Status:** changed — **high risk for LLM pipeline**; RSS has no summary.
- **Terms:** [Terms of Use](https://sifted.eu/terms-of-use) (last updated 1 February 2026)
- **Summary:** Headlines in RSS with link-back and credit align with §8.11 (“status … as the authors … must always be acknowledged”). **Commercial use** requires a commercial licence (§8.12). **AI:** §7.6–7.7 prohibit text/data mining and using platform content to **develop, train, fine-tune or validate AI systems or models**, and ban automated “scraper” access to the site. RSS polling is not explicitly permitted; treat automated ingestion as needing written permission.
- **Quote (§7.7):** “You must not use … our Content … for the purposes of developing, training, fine-tuning or validating any AI system or model.”

### Tech.eu

- **Status:** unverifiable for syndication — no dedicated RSS or republication terms found at [tech.eu](https://tech.eu/). Privacy policy only: [Privacy Policy](https://tech.eu/privacy-policy).
- **Practical:** Standard RSS consumption with headline, link, and short summary plus clear “Source: Tech.eu” on the site is typical for news aggregators; **confirm with Fores Media Ltd** before commercial Phase 4.

### EU-Startups

- **Status:** unverifiable — no standalone Terms of Use URL found (404 on common paths). Operator: Menlo Media S.L. (see [Privacy Policy](https://www.eu-startups.com/privacy-policy/)).
- **Practical:** RSS is offered publicly; use headline + link + feed summary only; add attribution. Confirm republication rules before commercial use.

### UKTN

- **Status:** confirmed for limited personal / internal-style use; **commercial redistribution restricted**.
- **Terms:** [Terms and conditions](https://www.uktech.news/terms-and-conditions) (also referenced for RSS access in § opening)
- **Summary:** Material may be downloaded/viewed for **personal, non-commercial use** or **internal business purposes** as a personal information source. **Copying or distributing for commercial or business objectives requires written consent.**
- **Quote:** “Any usage beyond this, particularly for copying or distributing material from the Site for commercial or business objectives, requires explicit written consent from UKTN.”

---

## A3 — Polling interval (default spec: every 3 hours)

**Status: changed** — 3 hours is safe for most feeds today, but **EU-Startups** and **Tech.eu** have shallow windows at current publish rates.

| Feed | Feed depth (approx.) | Est. items/day | Miss risk at 3h | Recommended interval |
|------|----------------------|----------------|-----------------|------------------------|
| TechCrunch Venture | ~9 days (20 items) | ~2 | Low | 3h |
| Crunchbase News | ~6 days (10 items) | ~2 | Low | 3h |
| Sifted | ~3 days (24 items) | ~8 | Low | 3h |
| Tech.eu | ~2 days (20 items) | ~11 | Medium if runs fail | **2h** |
| EU-Startups | ~1 day (10 items) | ~9 | **High** if >24h outage | **1h** |
| UKTN | ~8 days (10 items) | ~1 | Low | 3h |

GitHub Actions `schedule` may be delayed at busy times (e.g. top of the hour); see [A13](#a13--github-actions).

---

## A4 — Hacker News Algolia API

**Status: confirmed**

- **Base URL:** `https://hn.algolia.com/api/v1/` (no API key)
- **Show HN:** `GET https://hn.algolia.com/api/v1/search?tags=show_hn` returns hits (verified 8 Oct 2026).
- **Launch HN:** No dedicated tag documented; use search, e.g. `query=Launch%20HN` with `tags=story` (returns Launch HN–style titles; verified).
- **Docs:** [HN Search API on GitHub](https://github.com/HackerNews/API#search) (Algolia-hosted).

---

## A5 — Y Combinator directory

**Status: confirmed** (no official YC API; unofficial mirror exists)

- **Official:** Y Combinator does not publish a supported public directory API.
- **Unofficial mirror:** [yc-oss/api](https://github.com/yc-oss/api) — static JSON at `https://yc-oss.github.io/api/` (e.g. `meta.json`, `companies/all.json`), updated daily from YC’s Algolia index (per project README).
- **Terms:** **unverifiable** — repository has **no LICENSE file** on `main` (GitHub API `license: null`, 8 Oct 2026). Data ultimately originates from YC; comply with [ycombinator.com](https://www.ycombinator.com/) terms if used in Phase 2.

---

## A6 — GitHub REST API

**Status: confirmed** (with nuance for Actions)

| Auth | Primary rate limit | Source |
|------|-------------------|--------|
| Unauthenticated | 60 requests/hour per IP | [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| PAT / OAuth user | **5,000 requests/hour** | Same |
| `GITHUB_TOKEN` in Actions | **1,000 requests/hour per repository** | Same |
| Search endpoints | **30 requests/minute** for authenticated search (separate search quota) | [REST search](https://docs.github.com/en/rest/search/search) |

Secondary limits (concurrency, abuse) also apply.

---

## A7 — Companies House API

**Status: confirmed**

| Item | Fact | Source |
|------|------|--------|
| API key | Free registration | [Getting started](https://developer-specs.company-information.service.gov.uk/guides/gettingStarted) |
| Rate limit | **600 requests / 5 minutes** per API key; HTTP 429 when exceeded | [Rate limiting](https://developer-specs.company-information.service.gov.uk/guides/rateLimiting) |
| Filing history | `GET /company/{number}/filing-history`; `category` includes **`capital`** | [Filing history list](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/filinghistorylist) |
| SH01 | Capital-category filings include type **`SH01`** (share allotments) in CH data model | Filing history item `type` field (API schema) |
| Document API | `GET /document/{id}/content` with `Accept` for PDF (302 to stored document) | [Fetch a document](https://developer-specs.company-information.service.gov.uk/document-api/reference/document-location/fetch-a-document) |
| Streaming API | Available; max **2 concurrent connections**; backoff on 429 | [Streaming overview](https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview) |
| Reuse | UK public register data — reuse under [Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) where applicable | CH / GOV.UK licensing |

---

## A8 — SEC EDGAR

**Status: confirmed**

| Item | Fact | Source |
|------|------|--------|
| Rate limit | **10 requests/second** max; fair access policy | [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) |
| User-Agent | Must declare company name and contact email in `User-Agent` | Same |
| Daily indexes | `index.html`, **`index.xml`**, `index.json` under `/Archives/edgar/daily-index/` | Same |
| Form D | Structured **Form D data sets** (XML-derived); also Form D rows in daily **form** indexes | [Form D data sets](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets) |

---

## A9 — Frankfurter (ECB rates)

**Status: changed** — ECB daily rates are available without a key; **prefer v2 host** documented at [frankfurter.dev](https://frankfurter.dev/).

| Item | Fact | Source |
|------|------|--------|
| API key | **Not required** | [Frankfurter docs](https://frankfurter.dev/) |
| ECB provider | `GET https://api.frankfurter.dev/v2/providers/ecb/rates?from=YYYY-MM-DD&to=YYYY-MM-DD` returns historical daily rates (EUR base) | Verified 8 Oct 2026 |
| Legacy v1 | `https://api.frankfurter.app/{date}?from=EUR&to=USD,GBP` still responds | Verified 8 Oct 2026 |
| GBP / USD | Present in ECB provider set | [ECB provider](https://frankfurter.dev/providers/ecb/) |

---

## A10 — OpenAI API

**Status: confirmed** (model IDs and prices move — snapshot below from OpenAI docs, 10 Nov 2026; first checked 8 Oct 2026)

### Cheap / mid extraction models (per 1M tokens, standard API)

| Model | Input | Output | Notes |
|-------|-------|--------|--------|
| `gpt-5.6-luna` | $0.20 | $1.20 | **Default.** Best score in the 10 Nov 2026 eval; OpenAI's named replacement for the retired small models |
| `gpt-5.4-nano` | $0.20 | $1.25 | Shuts down 1 Apr 2027 |
| `gpt-5.4-mini` | $0.75 | $4.50 | Mid tier; no accuracy gain over luna in the eval |
| `gpt-4o-mini` | $0.15 | $0.60 | Snapshot shuts down 14 Jan 2027 |
| `gpt-4.1-mini` | $0.40 | $1.60 | Snapshot shuts down 14 Jan 2027 |
| `gpt-4.1-nano` | $0.10 | $0.40 | **Shut down 23 Oct 2026** (the API returns 404) |
| `o4-mini` | $1.10 | $4.40 | Reasoning-class; higher cost |

Source: [API pricing](https://developers.openai.com/api/docs/pricing) (embedded price table in page JSON).

### Embeddings

| Model | Price / 1M tokens | `dimensions` parameter |
|-------|-------------------|-------------------------|
| `text-embedding-3-small` | $0.02 | **Supported** — optional `dimensions` (e.g. 512) per [Embeddings guide](https://developers.openai.com/api/docs/guides/embeddings) |

### Structured outputs

**Status: confirmed** — Chat Completions / Responses support JSON schema constrained outputs (`response_format` / structured outputs). See [Structured outputs](https://platform.openai.com/docs/guides/structured-outputs).

### Prepaid billing

| Item | Fact | Source |
|------|------|--------|
| Minimum purchase | **$5** (default checkout $10) | [Prepaid billing](https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing) |
| Auto-recharge | On by default at signup; **can be turned off** | Same |
| Exhausted balance | API requests fail when credits hit $0 (after processing delay) | Same |

---

## A11 — Neon free tier

**Status: confirmed** (limits updated on Neon’s current Free plan — see spec note on storage)

| Resource | Free allowance | Source |
|----------|----------------|--------|
| Projects | 100 | [Neon plans](https://neon.com/docs/introduction/plans) |
| Compute | **100 CU-hours per project / month**; scale to zero after **5 minutes** idle | [Free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas) |
| Autoscale | Up to **2 CU** (~8 GB RAM) | Same |
| Storage | **1 GB Postgres per project**, **20 GB account total** | Same |
| Egress | 5 GB / project / month | Same |
| `vector` (pgvector) | Supported | [pgvector on Neon](https://neon.com/faqs/postgres-databases-vector-embeddings-scale-to-zero) |
| `pg_trgm` | Supported (`CREATE EXTENSION pg_trgm`) | [pg_trgm extension](https://neon.com/docs/extensions/pg_trgm) |
| Custom roles | **confirmed** — standard Postgres `CREATE ROLE` / `GRANT` on Neon (ingest/web roles per spec) | Neon is full Postgres; role DDL via owner connection |

---

## A12 — Vercel Hobby

**Status: confirmed**

| Item | Fact | Source |
|------|------|--------|
| Price | $0 | [Hobby plan](https://vercel.com/docs/plans/hobby) |
| Commercial use | **Not allowed** — personal, non-commercial only | [Fair use guidelines — Commercial usage](https://vercel.com/docs/limits/fair-use-guidelines) |
| SSR / serverless (guideline) | e.g. **1,000,000 Function Invocations** / month (Hobby column) | Fair use table (same doc) |
| Over limit | Feature may be paused until rolling 30-day window resets | [Hobby plan](https://vercel.com/docs/plans/hobby) |

Phase 4 commercial hosting requires Pro/Enterprise or another host.

---

## A13 — GitHub Actions

**Status: confirmed**

| Item | Fact | Source |
|------|------|--------|
| Public repos | **Standard GitHub-hosted runners free** (no minute charge) | [Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) |
| Private repos | 2,000 minutes/month on Free plan | Same |
| Schedule delays | Cron workflows may be **delayed** under load; avoid starting all jobs at `:00` | [schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| 60-day inactivity | In **public** repos, scheduled workflows **disabled** after 60 days without repository activity | [Disable and enable workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) |

---

## A14 — Real headlines and URLs in public fixtures

**Status: changed** — acceptable for most sources **only as headline + URL (no article body)**; **Sifted and Crunchbase need care** because of AI-related terms.

| Publisher | Fixtures (headline + URL) | LLM eval on real headlines |
|-----------|---------------------------|----------------------------|
| TechCrunch | **OK** with attribution; aligns with RSS terms | OK for non-training extraction |
| Crunchbase News | Headline + URL likely OK; **verify** data-use / AI clauses | **Review** — restrictions on using content with AI |
| Sifted | Headline + URL in repo is minor; **automated LLM use is restricted** by §7.7 | **Not recommended** without permission |
| Tech.eu / EU-Startups | Likely OK with attribution; terms not fully verified | Use paraphrased summaries in fixtures where possible (per spec Task 008) |
| UKTN | OK for non-commercial project; commercial redistribution needs consent | OK for Phase 1 scope |

Synthetic RSS XML in unit tests should use invented headlines (Task 006); eval fixtures may use real headlines per project spec.

---

## Spec changes needed

1. **A1 / Sifted:** Feed has **no `<description>`** — update Phase 1 assumption or disable Sifted until headline-only extraction is an explicit product decision.
2. **A2 / Sifted:** Terms **forbid using content to train/validate AI models** (§7.6–7.7) — disable Sifted in Phase 1 or obtain a licence; do not assume RSS implies consent for LLM extraction.
3. **A2 / Crunchbase:** Terms restrict **AI training** on content — clarify whether third-party LLM extraction from headlines/summaries is permitted; may need to disable or get legal sign-off.
4. **A9:** Document **Frankfurter v2** base URL (`https://api.frankfurter.dev/v2/...`) in pipeline code; v1 `api.frankfurter.app` still works but v2 is current.
5. **§12 volume estimate:** Measured **~33 items/day** across all six feeds (8 Oct 2026), not **~100/day** — monthly LLM cost estimate likely **lower** unless more feeds are added.
6. **A11:** Neon Free storage is **1 GB/project (20 GB total)**, not 0.5 GB — still sufficient for spec storage estimate.
7. **A3:** Recommend **1h** poll for EU-Startups and **2h** for Tech.eu in ingest config (Task 022), or accept occasional gaps.

---

## Phase 1 source table

Copied into code by Task 006.

| slug | name | feed_url | format | items_in_feed | items_per_day | summary_quality | recommended_priority | enabled_in_phase_1 | notes |
|------|------|----------|--------|---------------|---------------|-----------------|----------------------|--------------------|-------|
| techcrunch-venture | TechCrunch Venture | https://techcrunch.com/category/venture/feed/ | RSS 2.0 | 20 | ~2 | good | 9 | yes | US venture; RSS terms require attribution + link |
| crunchbase-news | Crunchbase News | https://news.crunchbase.com/feed/ | RSS 2.0 | 10 | ~2 | good | 8 | yes | Strong funding signal; confirm AI/data-use terms |
| tech-eu | Tech.eu | https://tech.eu/feed/ | RSS 2.0 | 20 | ~11 | good | 8 | yes | EU/UK; shallow feed — prefer 2h polling |
| eu-startups | EU-Startups | https://www.eu-startups.com/feed/ | RSS 2.0 | 10 | ~9 | good | 7 | yes | EU; shallow feed — prefer 1h polling |
| uktech-news | UKTN | https://www.uktech.news/feed/ | RSS 2.0 | 10 | ~1 | good | 7 | yes | UK coverage; non-commercial use OK per site terms |
| sifted | Sifted | https://sifted.eu/feed | RSS 2.0 | 24 | ~8 | none | 6 | no | No RSS summary; AI/terms conflict — revisit with legal clearance |

**Phase 1 enabled count:** 5 feeds, including **3** with UK/Europe focus (Tech.eu, EU-Startups, UKTN).

---

## References (quick links)

- TechCrunch RSS terms: https://techcrunch.com/rss-terms-of-use/
- Sifted terms: https://sifted.eu/terms-of-use
- Crunchbase attribution: https://about.crunchbase.com/terms-of-service/attribution-instructions
- UKTN terms: https://www.uktech.news/terms-and-conditions
- Frankfurter: https://frankfurter.dev/
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI prepaid billing: https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing
- Neon plans: https://neon.com/docs/introduction/plans
- Vercel fair use: https://vercel.com/docs/limits/fair-use-guidelines
- GitHub Actions billing: https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions
- SEC EDGAR access: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- Companies House rate limits: https://developer-specs.company-information.service.gov.uk/guides/rateLimiting

---

# Phase 2 sources (planning pass)

Verification date: **11 November 2026** (UTC). Methods: live requests to the APIs and vendor or publisher pages linked below. Assumption numbers are those in `docs/spec-phase2.md` section 15. Tasks 026, 035, 046 and 047 re-check their rows and add their own sections below.

## A15 — OpenAI embeddings

**Status: confirmed**

| Model | Price / 1M input tokens | Notes |
|-------|-------------------------|-------|
| `text-embedding-3-small` | **$0.02** | Chosen. `dimensions: 512` supported (A10) |
| `text-embedding-3-large` | $0.13 | Not needed for short tags |
| `text-embedding-ada-002` | $0.10 | Older, no `dimensions` parameter |

`gpt-5.6-luna` rechecked at the same time: $0.20 input, $1.20 output per M tokens (Batch API $0.10 / $0.60). No batch price is listed for embeddings. Source: [API pricing](https://developers.openai.com/api/docs/pricing).

## A16-A19 — UKRI Gateway to Research (GtR)

**Status: confirmed for the legacy API; the new API is not yet usable. Re-checked 11 Nov 2026 in Task 035.**

| Item | Fact | Source |
|------|------|--------|
| Legacy API | `https://gtr.ukri.org/gtr/api/` answers JSON with no key. `projects.json?q=Innovate%20UK&f=pro.lf&sf=pro.sd&so=D&s=100` returned 200 with `totalSize` 33,170, newest start first | Live request, 11 Nov 2026 |
| Page size | `s=100` works; `s=200` returns HTTP 400 | Live request |
| Project fields | `id`, `title`, `status`, `grantCategory` (for example "Collaborative R&D", "Investment Accelerator", "Vouchers"), `leadFunder` ("Innovate UK"), `abstractText`, `researchTopics` (mostly "Unclassified" for Innovate UK), `participantValues.participant[]` with `organisationId`, `organisationName`, `role`, `projectCost`, `grantOffer`; links `LEAD_ORG`, `PARTICIPANT_ORG`, `FUND` (with start and end in ms) | Live request |
| Organisation fields | `name`, `regNumber` (often null), `website`, `addresses.address[]` with `postCode`, `region` (for example "North West"), `type` (`MAIN_ADDRESS`) | `organisations/{id}`, live request |
| Fund fields | `valuePounds.amount`, `currencyCode` GBP, `start`, `end`, `category` | `funds/{id}`, live request |
| New API | Documented under `/api/content/search/project?term=*`, but that URL returned 404 on 11 Nov 2026. The page says "If you use the previous API, you will need to update your tools" and that changes will be announced in advance | [GTR API](https://gtr.ukri.org/resources/api.html), [Getting started](https://gtr.ukri.org/find-research-and-innovation/getting-started-with-the-gtr-api) |
| Access and terms (A17) | API page: anyone can use it, for any purpose, free; no key or account. The GtR terms page refers to the Open Government Licence (linking v2) for the site and code, and restricts reproducing documents and images for commercial purposes without permission. **Confirm commercial reuse of the data with `gateway@ukri.org` before Phase 4** | [GTR API](https://gtr.ukri.org/resources/api.html), [Terms of use for GtR](https://gtr.ukri.org/terms-of-use-for-gtr) |
| Rate limit (A18) | "10 requests upon the GTR API per second per user", marked "[Frequency to be confirmed]"; excess requests are queued and may time out | [GTR API](https://gtr.ukri.org/resources/api.html) |
| Updates (A19) | Project data monthly, outcomes annually | [Data updates](https://gtr.ukri.org/find-research-and-innovation/data-updates) |
| Coverage | UKRI projects starting on or after 1 January 2006, including Innovate UK. Innovate UK grant offers are only the Innovate UK-funded part. Region is based on the postcode | [Understanding the data](https://gtr.ukri.org/find-research-and-innovation/understanding-the-data-on-gtr) |
| Personal data | GtR publishes people linked to projects, with no unique identifiers. SignalFeed never calls person endpoints and stores organisations only | Same |
| Bulk download | JSON Lines (885 MB zip) or SQLite (1.3 GB zip). Too large for scheduled runs | [Bulk download](https://gtr.ukri.org/find-research-and-innovation/bulk-download) |

**Task 035 re-check and results (11 Nov 2026, 9 requests in all, at most 1 a second)**

- The legacy API still answers (HTTP 200, `totalSize` 33,170, 332 pages of 100). No deprecation or sunset header. The new `/api/content/search/project?term=*` URL still returns 404, so the legacy API stays in use. The base URL is one constant in `src/pipeline/grants/gtr-client.ts`.
- A page past the end (`p=99999`) returns HTTP 500, not an empty list. The collector stops on `totalPages` and on the 3-seen-pages rule, so it never asks for one.
- Fund dates are midnight in London. A summer start such as 1 July arrives as 23:00 UTC on 30 June, so the collector reads them in London time. Project `start` and `end` are null; the dates are on the `FUND` link.
- Roles seen: `LEAD_PARTICIPANT` and `PARTICIPANT`. Statuses seen: `Active`. The project link list includes person links (`PM_PER`); they are ignored and never requested.
- The `gtr.ukri.org/project/{id}` site address answers 308 (a redirect). Its final target was not followed. `grant_projects.gtr_url` uses that address; check it opens before the UI links to it.
- **A29/A30 were not measured with the full run.** The task asks for `--since 2026-06-01 --max-pages 5` against a local database, which needs about 5 page requests and hundreds of organisation requests. The Task 035 limit was about 10 requests, so the measurement is left for a run by hand (Task 043 adds the CLI).
- What was measured from page 1 alone (100 projects, 130 participants): 67 participants have a company form in the name and are kept, 63 are skipped (universities, councils, and names with no company form). Of 4 organisations fetched as a sample, all 4 had `regNumber` null, and the 3 with a postcode checked all had a valid main-address postcode and region. Too small to give a share.
- Limit of the rule: `regNumber` is only known after the organisation fetch, so a participant with no company form in its name is skipped even if it has a registration number. Real companies without "Ltd" (for example a trading name) are lost. Fixing it would mean fetching organisations for every skipped participant, including people's names, which D19 rules out.

## A20 — Innovate UK funded-projects spreadsheets (not used)

**Status: confirmed, rejected as a source**

- Two `.xlsx` files (8 MB for 2004 to 2015-16, 24 MB for 2016-17 onwards), last updated 3 November 2026 at irregular intervals. [Innovate UK funded projects since 2004](https://www.ukri.org/publications/innovate-uk-funded-projects-since-2004/).
- A third-party data dictionary lists columns including `EnterpriseSize`, `Postcode`, `Sector`, `AwardOffered` and `ParticipantName`. [The Data City dictionary](https://docs.thedatacity.com/data-dictionary/innovate-uk-funding-clean).
- ukri.org says most of its content is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0. [UKRI terms of use](https://www.ukri.org/who-we-are/terms-of-use/). That would block Phase 4 commercial use, so the GtR API is used instead.

## A21-A23 — UK geography (verified in Task 026)

**Status: confirmed, with Northern Ireland postcodes left out.** Checked on 11 Nov 2026. Everything committed comes from sources under the Open Government Licence v3.0 (OGL).

| Item | Fact | Source |
|------|------|--------|
| GB places (A21), used | OS Open Names, release 2026-10, GB, CSV (103 MB zip). `LOCAL_TYPE` City (71) and Town (1,355) carry name, BNG coordinates, county or council area and `REGION`. English names with Welsh or Gaelic as a second name. No population field, so the band comes from postcode counts (see below). The `licence.txt` in the zip points to `os.uk/opendata/licence`, which redirects to OGL v3.0. Attribution wording in the zip: "Contains OS data © Crown Copyright and database rights 2026. Contains Royal Mail data © Royal Mail copyright and database right 2026. Contains National Statistics data © Crown copyright and database right 2026." | [OS Open Names](https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-names/os-open-names-overview), [download API](https://api.os.uk/downloads/v1/products/OpenNames), [OS OpenData licence](http://os.uk/opendata/licence) |
| GB places, not used | ONS Index of Place Names (July 2024). The portal default is OGL v3.0, but one catalogue entry says "No Licence Provided". Open Names is clearer on licence and has the postcode records that give each place a size and each outcode its ITL1 area | [Index of Place Names July 2024](https://ckan.publishing.service.gov.uk/dataset/index-of-place-names-july-2024-in-gb) |
| NI places (A21) | NISRA Settlement Development Limits 2015, GeoJSON of 527 settlement boundaries in Irish Grid, with `Band` (A to H) and occupied households (`OccHH_ex`). The dataset is listed as `uk-ogl` (UK Open Government Licence). There is no centroid or population field, so the script takes the area-weighted centroid of the outlines and estimates residents as 2.4 per household. Bands A to F (68 settlements, minus the three "Metropolitan" sub-areas of Belfast) are kept as towns | [Settlement Development Limits 2015 (OpenDataNI)](https://www.opendatani.gov.uk/dataset/settlement-development-limits-2015), [CKAN record](https://admin.opendatani.gov.uk/api/3/action/package_show?id=settlement-development-limits-2015), [NISRA urban-rural geography](https://www.nisra.gov.uk/publications/urban-rural-geography-documents-2015) |
| GB postcode districts (A22), used | Code-Point Open, release 2026-11, GB, CSV (14 MB zip, about 1.7 million postcode units with eastings and northings). The `licence.txt` in the zip points to the OS OpenData licence (OGL v3.0). Attribution wording in the zip: "Contains Ordnance Survey data © Crown copyright and database right 2026. Contains Royal Mail data © Royal Mail copyright and database right 2026. Contains National Statistics data © Crown copyright and database right 2026." The outcode centroid is the mean of its units. ITL1 comes from the most common `REGION` or `COUNTRY` of that outcode's postcode records in Open Names | [Code-Point Open](https://docs.os.uk/os-downloads/products/areas-and-zones-portfolio/code-point-open/code-point-open-overview), [download API](https://api.os.uk/downloads/v1/products/CodePointOpen) |
| NI postcodes (A22), not used | Code-Point Open covers Great Britain only. The ONS Postcode Directory includes BT postcodes, but ONS issues them only under a Northern Ireland End User Licence for internal business use. External commercial use needs a licence from Land and Property Services, with the extra credit "Contains Land and Property Services data © Crown copyright and database right". That is not open for commercial reuse, so no BT centroids are committed. `outcodeItl1("BT1")` still returns `TLN`, because "BT means Northern Ireland" is a fact, not licensed data | [ONS geography licences](https://www.ons.gov.uk/methodology/geography/licences), [postcodes.io licences](https://postcodes.io/docs/licences/) |
| ITL1 (A23) | January 2025 codes TLC to TLN, 12 areas, TLN is Northern Ireland. ONS spells some names "North East (England)" and "East (England)"; the spec names are used, and `ukRegionFromGtrName` accepts both. The data.gov.uk page shows "Licence: Not set"; the site says its content is under OGL v3.0 unless stated, and ONS Open Geography data is published under OGL. Only the 12 codes and names are used | [ITL1 January 2025 names and codes](https://www.data.gov.uk/dataset/international-territorial-levels-level-1-january-2025-names-and-codes-in-the-uk), checked against the ONS ArcGIS service `ITL1_JAN_2025_UK_BGC` |
| Population band (derived) | GB: postcode units whose populated place is the town, times 39 residents (about 67M / 1.7M). NI: households times 2.4. Bands: 1 under 10k, 2 from 10k, 3 from 25k, 4 from 100k, 5 from 250k, 6 from 1M. It is an estimate for ranking places, not a census count. The census-based Newport (Wales) lands in band 4 and Newport (Isle of Wight) in band 3, so "Newport" stays ambiguous | `scripts/geo/build-uk-geo.ts` |
| Coordinates | British and Irish National Grid converted to WGS84 with a seven-parameter Helmert transform (about 5 m, no OSTN15 grid). Checked against Leeds, Belfast and Cardiff centres | `scripts/geo/build-uk-geo.ts` |
| Attribution to show (A26 style notice) | "Contains OS data © Crown copyright and database right 2026. Contains Royal Mail data © Royal Mail copyright and database right 2026. Contains National Statistics data © Crown copyright and database right 2026. Contains public sector information licensed under the Open Government Licence v3.0 (NISRA settlements)." Put it on the About page (Task 044) | Licence files above |

Not committed to the repo: the downloads. Only `src/lib/geo/uk-places.json` (1,489 places, 241 KB) and `src/lib/geo/uk-outcodes.json` (2,863 GB outcodes, 104 KB) are. Steps to rebuild are in `scripts/geo/README.md`.

## A24 — Hacker News Algolia (Phase 2 use)

**Status: partly confirmed** (see also A4). `search_by_date?tags=show_hn` and `query="Launch HN"&tags=story` return hits (1,226 Launch HN stories on 11 Nov 2026). Hits include `author`, which SignalFeed must not store. The rate limit is to be checked in Task 046.

## A25 — Y Combinator directory

**Status: unchanged.** `yc-oss/api` still has no licence (GitHub API `license: null`, last push 11 Nov 2026). No collector is planned.

---

# Phase 3 sources (planning pass)

Verification date: **12 November 2026** (UTC). Methods: official documentation pages, a Companies House forum answer by its service owner, SEC pages and statistics, and OpenAI's pricing and vision pages. The planning pass used no API key; Task 049 later made 14 Companies House calls. Assumption numbers are those in `docs/spec-phase3.md` section 14. Task 049 re-checked the Companies House "to verify" rows with a key on 12 November 2026 (14 requests, below).

## A31 — Companies House API access and rate limit

**Status: confirmed from documentation.** Supersedes A7 for the rate-limit wording.

| Item | Fact | Source |
|------|------|--------|
| Account | A Companies House user account on the Developer Hub is needed to register an application | [Getting started](https://developer-specs.company-information.service.gov.uk/guides/gettingStarted) |
| Key | Register an application of type "API key" to get a key. Sent with HTTP Basic auth: "the Companies House API takes the username as the API key and ignores the password" (curl: `-u my_api_key:`) | [Authorisation](https://developer-specs.company-information.service.gov.uk/guides/authorisation) |
| Cost | Free of charge (the API "provides access to all of the public data we hold on companies free of charge") | [API catalogue entry](https://api.gov.uk/ch/companies-house/) |
| Rate limit headers | **Verified 12 Nov 2026**: every response carried `X-RateLimit-Limit: 600`, `X-RateLimit-Remain` (counts down by one per request: 598, 597 ... 585 over 14 requests), `X-RateLimit-Reset` (a Unix timestamp, the same for the whole window) and `X-RateLimit-Window: 5m`. Header name is `Remain`, not `Remaining`. A 429 was not provoked | [Rate limiting](https://developer-specs.company-information.service.gov.uk/guides/rateLimiting) |
| Rate limit | **600 requests within a five-minute period**, per application. Over it, every request gets HTTP 429 until the window ends. Applications that regularly exceed or try to bypass the limit may be banned without notice. Higher limits on request | [Rate limiting](https://developer-specs.company-information.service.gov.uk/guides/rateLimiting) |
| Key handling | Keep keys out of code and the source tree, restrict by IP or domain where possible, rotate regularly | [Developer guidelines](https://developer-specs.company-information.service.gov.uk/guides/developerGuidelines) |
| Status | The Developer Hub describes itself as a beta release | [Overview](https://developer.company-information.service.gov.uk/overview) |

## A32 — Companies House data reuse

**Status: partly confirmed.** No separate API terms of use page was found.

| Item | Fact | Source |
|------|------|--------|
| Legal basis | Register information is made available "by virtue of approvals issued by the Registrar in accordance with section 47 of the Copyright, Designs and Patents Act 1988 and Schedule 1 of the Database Regulations (SI 1997/3032)" | [Public task, copyright and Crown copyright](https://www.gov.uk/government/publications/companies-house-accreditation-to-information-fair-traders-scheme/public-task-copyright-and-crown-copyright) (updated 9 August 2019) |
| Use | Companies House places no restriction on use, other than: take your own advice on third-party copyright; do not reproduce the Crown insignia; credit Companies House as the source | Same |
| Forum answer | Companies House "imposes no rules or requirements on how the information on the public register is used"; users are responsible for data protection, copyright and other law (service owner, 4 November 2021) | [Forum: is data provided under the OGL?](https://forum.companieshouse.gov.uk/t/is-data-provided-under-the-ocs/4513) |
| SignalFeed use | Credit "Source: Companies House" on company pages and `/about`. Store no officer, PSC or shareholder data (D58). Confirm commercial reuse before Phase 4 | |

## A33 — Free company data product (not used)

**Status: confirmed, rejected as a source (D52).**

- Monthly snapshot of live companies, published "within 5 working days of the previous month end". On 12 November 2026: `BasicCompanyDataAsOneFile-2026-11-01.zip` (471 MB), or seven parts (69-70 MB, the last 50 MB). "Provided free of charge and will not be supported." No licence on the page; the data.gov.uk listing says "License not specified". [Free Company Data Product](https://download.companieshouse.gov.uk/en_output.html), [data.gov.uk listing](https://www.data.gov.uk/dataset/companies-house-free-company-data-product)
- The field list PDF linked from the page (`freeDataProductDataset.pdf`) returned 404. Previous names are not included (forum report).

## A34-A38 — Companies House resources

| # | Item | Fact | Status | Source |
|---|------|------|--------|--------|
| A34 | Enumerations | `account_type`: null, full, small, medium, group, dormant, interim, initial, total-exemption-full, total-exemption-small, partial-exemption, audit-exemption-subsidiary, filing-exemption-subsidiary, micro-entity, no-accounts-type-available, audited-abridged, unaudited-abridged. `company_status`: active, dissolved, liquidation, receivership, converted-closed, voluntary-arrangement, insolvency-proceedings, administration, open, closed, registered, removed. `company_type` includes ltd, plc, llp, private-unlimited, private-limited-guarant-nsc and others | Confirmed | [api-enumerations constants.yml](https://github.com/companieshouse/api-enumerations/blob/master/constants.yml) |
| A34 | Profile fields | `sic_codes`, `date_of_creation`, `date_of_cessation`, `company_status`, `registered_office_address.postal_code`, `accounts.last_accounts.type`, `previous_company_names` and `etag` are documented. `accounts.last_accounts.made_up_to` is deprecated in favour of `period_end_on`, and `has_insolvency_history` in favour of `links.insolvency` | **Verified 12 Nov 2026** with a live key (4 profiles: active, dormant, dissolved, administration). All fields present as listed, except: `date_of_cessation` only on dissolved companies; `previous_company_names` only when the company has had one (it is an array of `{name, effective_from, ceased_on}`); `links.insolvency` only when there is insolvency (administration company had it and `has_insolvency_history: true`; a liquidation company had neither, `has_insolvency_history: false`). `made_up_to` and `has_insolvency_history` are still returned beside `period_end_on` and `links.insolvency`, so the spec's fallback reading is safe. `accounts.last_accounts.type` was `full`, `dormant`, `micro-entity`, `total-exemption-full`; `accounts.last_accounts` is absent for a company with no accounts yet (not seen, not tested). Dissolved profile has no `next_due` | [Company profile](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/companyprofile) |
| A35 | Capital filings | Filing history takes a `category` filter; SH01 `description_values` hold `capital` (`currency`, `figure`) and `date`. A forum post says `description_values` may not be on the list resource | **Verified 12 Nov 2026: holds.** On the list resource (`/company/07386350/filing-history?category=capital&items_per_page=100`, 17 items, 13 SH01) every SH01 item carries `action_date`, `description_values.date` (the allotment date, equal to `action_date`) and `description_values.capital` (array of `{currency, figure}`, figure a string with thousands commas, e.g. `"1,640.64"`). The item `date` is the filing date and can be later than the allotment date. No single-item request is needed. `figure` looks like a nominal-value total, not the money raised, so the confirm step should treat it as a weak amount signal. Non-SH01 capital items (SH19, SH10, SH02, SH20) share the category, so filter on `type = SH01`. SH20 had `description: legacy` and no date values | [Forum: capital-allotment-shares](https://forum.companieshouse.gov.uk/t/capital-allotment-shares-returns-more-data-than-fields/510), [Forum: description_values](https://forum.companieshouse.gov.uk/t/description-values-in-filing-history/306) |
| A36 | Documents | Document PDFs are PDF/A "akin to fax", and "the text itself is not searchable", so reading needs OCR. Content types listed by the API include `application/pdf`, `application/json`, `application/xml`, `application/xhtml+xml` and `text/csv`; accounts are often iXBRL | Community-reported | [OCR processor for Companies House PDFs](https://rmacd.com/posts/ocr-ch-pdfs/), [Forum: XBRL instead of PDF](https://forum.companieshouse.gov.uk/t/solved-xbrl-insead-of-pdf-documents/2292) |
| A37 | Advanced search | `GET /advanced-search/companies` takes `company_name_includes`, `company_status`, `company_type`, `incorporated_from`/`to`, `dissolved_from`/`to`, **`location`**, `sic_codes`, `size` (1-5000) and `start_index`. The response fields were not on the page | **Verified 12 Nov 2026: holds.** `location=<full postcode>&company_status=active&size=1` returns `{etag, kind, hits, top_hit, items}`; the total count is `hits`. It filters by postcode: `EC2M 4AG` gave 331 and `OX16 9BE` gave 162, and the top hit's registered office postcode matched in both. (The two postcodes were a busy City of London office and a Banbury address; one ordinary-office postcode was not separately tested, so the 20-company shared-address cut-off was not tuned.) Item fields: `company_name`, `company_number`, `company_status`, `company_type`, `date_of_creation`, `registered_office_address`, `sic_codes`, `links.company_profile`. Without `location`, `company_status=liquidation` returned 108,746 hits. Fallback in spec 7.3 not needed | [Advanced company search](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/search/advanced-company-search) |
| A38 | Search results | Items have `title`, `company_number`, `company_status`, `company_type`, `date_of_creation`, `date_of_cessation`, `address` (with `postal_code`, `locality`), `address_snippet`, `description`, `matches`; the response has `total_results`, `items_per_page`, `start_index` | **Verified 12 Nov 2026: changed.** Item fields confirmed (also `description_identifier`, `kind`, `links.self`, `matches`, `snippet`, `address.premises`; `address` can include `country`). Response keys: `items`, `items_per_page`, `kind`, `page_number`, `start_index`, `total_results`. **The largest `items_per_page` is 100**: asking for 500 returned 100 items with `items_per_page: 100`, no error. `start_index` was not tested. `date_of_cessation` appears only on dissolved items | [Company search resource](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/companysearch) |

## A39-A42 — SEC EDGAR and Form D

**Status: verified, 12 November 2026** (Task 049 made 7 requests to sec.gov, all with the User-Agent below, at most one a second). Supersedes A8.

**User-Agent chosen:** `SignalFeed/0.3 (+signalfeed@taylorhallin.com)`. This is the spec's `SignalFeed/<version> (+<HTTP_CONTACT>)` format with `HTTP_CONTACT=signalfeed@taylorhallin.com`. SEC answered 200 to all 7 requests with it. The SEC sample format (`Sample Company Name AdminContact@<domain>.com`) was not needed.

| # | Item | Fact | Source |
|---|------|------|--------|
| A39 | Fair access | "Current max request rate: 10 requests/second." User-Agent sample: `Sample Company Name AdminContact@<sample company domain>.com`. No botnets or crawling tools | [Accessing EDGAR data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) |
| A39 | Daily indexes | `/Archives/edgar/daily-index` (current year) and `/Archives/edgar/full-index`; company, form, master and XBRL index types, with company name, form type, CIK, date filed and file name. "Updated nightly starting about 10:00 p.m., ET" | Same |
| A39 | **Checked** | **Verified 12 Nov 2026: holds.** `https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/form.20261110.idx` (Tuesday) returned 200, 1,057,192 bytes, `content-type: application/octet-stream`, `last-modified` 11 Nov 03:01 GMT (10:01 pm Eastern on 10 Nov), which matches the nightly update. Header block of 4 text lines, 4 blank lines, a column header, a rule, then fixed-width rows: form type from column 0 (17 wide), company name (62 wide), CIK (right of it), date filed `yyyymmdd`, file name `edgar/data/<cik>/<accession>.txt`. That day: 170 `D` and 95 `D/A` rows (265, in line with the 200-250 estimate in spec 8.1). The same index also holds `DEF 14A`, `DEFA14A`, `DEFC14A` and `DRS`, so match the form type column exactly (`D` or `D/A`), not a prefix. Company names are cut at 62 characters. The file was not requested for 11 Nov (Veterans Day), so the no-file-on-holidays 404 was not seen. No rate-limit headers were returned | [Daily index](https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/form.20261110.idx) |
| A40 | Form D XML | Each filing has `primary_doc.xml` in schema X0708. Fields include `offeringData.offeringSalesAmounts.totalAmountSold` and `offeringData.typeOfFiling.dateOfFirstSale` (`value` or `yetToOccur`) | [sec-api Form D docs](https://sec-api.io/docs/form-d-xml-json-api), [Form D data set sample](https://huggingface.co/datasets/logiover/sec-edgar-form-d-scraper-sample-data) |
| A40 | **Checked** | **Verified 12 Nov 2026: holds, with notes.** Three filings from the 10 Nov index (an operating company, a D/A, a pooled investment fund), plus two more read to find a `salesCompensationList` recipient. URL: `/Archives/edgar/data/<cik>/<accession without dashes>/primary_doc.xml`; the accession number is not inside the XML, take it from the index file name. All had `<schemaVersion>X0708</schemaVersion>`, `submissionType` `D` or `D/A`. Paths under `edgarSubmission`: `primaryIssuer.cik` (10 digits, zero padded), `.entityName`, `.issuerAddress.{city,stateOrCountry,stateOrCountryDescription,zipCode}`, `.jurisdictionOfInc` (a name such as `DELAWARE`, not a code), `.entityType`, `.yearOfInc` (one of `withinFiveYears` + `value`, or `overFiveYears`); `offeringData.industryGroup.industryGroupType`; `.federalExemptionsExclusions.item` (repeats); `.typeOfFiling.newOrAmendment.isAmendment` and `.previousAccessionNumber` (D/A only); `.typeOfFiling.dateOfFirstSale` (`value` as `yyyy-mm-dd`, or `yetToOccur` true); `.typesOfSecuritiesOffered` (flags such as `isEquityType`, `isOtherType`, `isPooledInvestmentFundType`; no `isDebtType` or `isOptionType` was seen, so the `securities` mapping needs the other flags from the SEC schema); `.offeringSalesAmounts.{totalOfferingAmount,totalAmountSold,totalRemaining}`; `.investors.totalNumberAlreadyInvested`. Amounts are whole dollars as plain digits; `totalOfferingAmount` and `totalRemaining` can be the text `Indefinite` (seen); `totalAmountSold` was a number each time. A D/A can carry a note such as `C$1.3540=US$1.00` in `clarificationOfResponse`, so a foreign-currency amount can sit in a field labelled dollars. **Pooled funds:** `industryGroupType` is `Pooled Investment Fund` with `investmentFundInfo.investmentFundType` (e.g. `Venture Capital Fund`, `Private Equity Fund`) and `is40Act`. A real-estate LP was `Other Real Estate`, not a pooled fund, so the spec's skip rule (exact `Pooled Investment Fund`) keeps such vehicles, which is as designed. Empty elements appear as `<x></x>` (an empty string, not absent). `salesCompensationList` was empty in 4 of 5 filings and held `recipient` elements (name, CRD numbers, address, `statesOfSolicitationList`, `foreignSolicitation`) in 1; `relatedPersonsList` was always present. A single `relatedPersonInfo` is an object and several are an array after XML parsing, so the parser must normalise. No fallback needed | [Form D schema and data set docs](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets), [sec-api Form D docs](https://sec-api.io/docs/form-d-xml-json-api) |
| A40 | Form D data sets | Quarterly ZIPs of the flattened fillable Form D, about 3-3.6 MB a quarter, latest 2026 Q3 (3.48 MB). Not used (the daily walk also backfills) | [Form D data sets](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets) |
| A41 | Volume | 34,553 initial Reg D filings in 2025 (8,634; 7,715; 8,937; 9,267 by quarter); 17,593 from pooled investment funds, 16,960 from other issuers. 2026: 9,918 (Q1), 10,513 (Q2) | [Regulation D offerings statistics](https://www.sec.gov/data-research/statistics-data-visualizations/regulation-d-offerings) |
| A42 | Reuse | "Anyone can access and download this information for free." | [Accessing EDGAR data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) |
| A42 | **Checked** | **Verified 12 Nov 2026: holds.** All 7 requests were free, needed no key or login, and answered 200 to the declared User-Agent. Reuse wording is from the SEC page above, which was read in the planning pass and not re-read in Task 049. Form D filings contain personal names and addresses of related persons; D58 keeps them out of storage and out of fixtures | [Accessing EDGAR data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) |

## A43 — Vision input cost (Task 067 only)

**Status: partly confirmed.**

- `gpt-5.6-luna`: $0.20 input, $0.02 cached, $1.20 output per million tokens (Batch $0.10 / $0.60). `gpt-5.4-nano`: $0.20 / $1.25. The pricing page does not say whether luna accepts images. [API pricing](https://developers.openai.com/api/docs/pricing)
- Newer GPT-5 models price images by 32-pixel patches times a multiplier (1.2 for gpt-5.5, gpt-5.4, gpt-5.2 and gpt-5-mini; 1.5 for gpt-5-nano). An A4 page at 150 dpi (1240 × 1754 px) is 39 × 55 = 2,145 patches, about 2,600 tokens. [Images and vision](https://developers.openai.com/api/docs/guides/images-vision), [Image cost calculator](https://developers.openai.com/api/docs/guides/image-cost-calculator)

## A46 — Accounts reforms

**Status: reported, not confirmed by Companies House on GOV.UK.** The ECCTA accounts changes (no abridged accounts for small companies, a profit and loss account for small and micro companies, software-only filing) were paused from April 2027. Several firms report April 2028. [PKF Smith Cooper](https://www.pkfsmithcooper.com/news-insights/companies-house-delays-2027-filing-rule-changes/), [Rapid Formations](https://www.rapidformations.co.uk/blog/companies-house-profit-and-loss-filing/)
