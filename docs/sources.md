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

**Status: confirmed** (model IDs and prices move — snapshot below from OpenAI docs, 8 Oct 2026)

### Cheap / mid extraction models (per 1M tokens, standard API)

| Model | Input | Output | Notes |
|-------|-------|--------|--------|
| `gpt-4.1-nano` | $0.10 | $0.40 | Matches spec “cheap tier” |
| `gpt-4.1-mini` | $0.40 | $1.60 | Matches spec “mid tier” |
| `gpt-4o-mini` | $0.15 | $0.60 | Alternative cheap option |
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
