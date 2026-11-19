# SignalFeed Phase 3.5: company websites

Status: **approved by the maintainer on 17 November 2026**, with the section 12 recommendations. Builds on Phase 3 (`docs/spec-phase3.md`). Same rules: precision first, company-level data only, no personal names, AI spend under £1 a month.

## 1. Why
- **No company has a website today.** Live data on 17 November: 0 of 2,338 companies have `website_domain`. The extraction fills it only when the article prints the domain. The UKRI organisation record has a `website` field, which `gtr-schemas.ts` parses but nothing stores.
- **Companies House coverage.** Of 26 news companies with no stated country, none has a D62 hint, so none is searched. Some are UK companies (for example bit.bio). UK companies must show their registered name and number on their website (Companies Act 2006 and the Company, LLP and Business (Names and Trading Disclosures) Regulations 2015). A verified website that shows a company number is the strongest Companies House evidence we can get without a grant.
- **Product.** Both audiences expect a website link. Agencies (Phase 4) need the domain to act on a lead. The redesign can show favicons.

## 2. Scope
1. Find candidate domains for a company from free sources first, and from a search API last.
2. Fetch each candidate's homepage once, politely, and decide with fixed rules: `linked`, `candidate` (review queue) or `rejected`.
3. Read a UK company number from a verified site and feed it to Companies House linking as a new strong method.
4. Show the link and favicon on company pages, built with the UX overhaul.

## 3. Non-goals
- Crawling beyond the homepage, plus one legal or imprint page when the homepage links to one (section 6.2). No JavaScript rendering.
- Storing page content, or any person's name, email or phone number found on a page.
- Websites for investors (later, same machinery).
- Search lookups for grant-only companies (about 2,280). They get only the free UKRI website field.
- Social profiles (LinkedIn, X). They are not a company website.

## 4. Which companies, in what order
| Priority | Who | Candidate sources |
|---|---|---|
| 1 | Companies with a news report (`event_sources` row), never checked or due for re-check | all sources in section 5 |
| 2 | Grant-only companies with a UKRI website | UKRI website only |

About 61 news companies today plus 1-5 new ones a day. A company is re-checked after 180 days, or when its name or Companies House link changes (fingerprint, as `registry_searches` does).

## 5. Candidate sources, cheapest and most reliable first
1. **Article domain:** `websiteDomain` from current extractions (already stored on `companies` when present).
2. **UKRI organisation website:** add `website` to `grant_participants`. Fill it on the normal organisation fetch, plus a one-off capped re-fetch of already-fetched organisations (about 2,000 requests at 3 a second, about 11 minutes, split across runs by `MAX_GRANT_ORG_FETCHES_PER_RUN`).
3. **Name is a domain:** names like "bit.bio" or "fal.ai" are tried as written.
4. **Guesses:** the registrable name slug with `.com`, `.io`, `.ai`, `.co`, `.co.uk` (and `.de`, `.fr` etc. when the stated country has one). At most 6 guesses, news companies only.
5. **Search API (optional):** only when 1-4 gave no strong result, news companies only. Query: `"<name>" <city or country> <first tag>`. Top 5 results, after dropping known non-company hosts (section 6.4). At most `MAX_WEBSITE_SEARCHES_PER_MONTH` (default 200). Without a key the step skips this source and still runs.

**Search provider:** Brave Search API. As of November 2026 it has no free plan. Each plan includes $5 of monthly credit (about 1,000 queries), needs a card on file, and expects attribution on the site. Secondary sources say the terms forbid storing results. We store only a domain that our own fetch verified, never the result list, titles or snippets. Task 071 must confirm this against the live terms before adding the key (A51).

## 6. Fetch and verification
### 6.1 Polite fetch
- `robots.txt` is checked per host, cached for 7 days. Disallowed means `rejected: robots`, which is not a judgement on the domain.
- The user agent is `buildUserAgent(HTTP_CONTACT)`, with 1 request per second per host, a 10-second timeout, at most 5 redirects and a 1 MB body cap. HTML only.
- The final domain after redirects is the candidate. A redirect to another registrable domain is followed once, and the evidence notes it (rebrands).
- Each run reads at most `MAX_WEBSITE_FETCHES_PER_RUN` pages (default 300).

### 6.2 What is read (kept in memory, not stored)
- `<title>`, `og:site_name`, `og:title`, meta description, and visible text up to 3,000 characters with scripts and styles removed.
- **UK company number:** an 8-character number (`\d{8}` or `(SC|NI|OC|SO|NC|R0)\d{6}`) within 60 characters of "company number", "company no", "registered in England", "registered in Scotland", "registration number" or "Companies House". Look on the homepage first. If none is there, look on at most one linked page whose link text or path says imprint, legal, terms, privacy or contact.
- **Parked or for-sale signals:** known parking hosts, "domain is for sale", registrar holding pages.
- The favicon URL (`<link rel=icon>` or `/favicon.ico`), for task 073.

### 6.3 Rules (D64, proposed)
Checked in order. The first rule that applies decides.

| Rule | Condition | Result |
|---|---|---|
| X1 | parked or for-sale, fetch failed, non-HTML, or robots disallow | `rejected` (not a judgement; retried at re-check) |
| X2 | the page shows a UK company number that differs from the company's `linked` Companies House number | `rejected` |
| X3 | the domain is `linked` to another company | `candidate`, reason "domain held by …" |
| W1 | the page shows the same UK company number as the company's `linked` Companies House number | `linked` |
| W2 | the domain came from the article or the company's own UKRI record, **and** the company name matches `og:site_name` or the title (section 6.5) | `linked` |
| W3 | the name matches (6.5), **and** the LLM check (6.6) says `same` | `linked` |
| C1 | the name matches but the LLM says `unsure`, or the LLM is over budget | `candidate` |
| C2 | source 1 or 2 without a name match (rebrand, holding page) | `candidate` |
| — | anything else | `rejected` |

A manual decision is final, as in D53. One company has at most one `linked` domain. A second strong result for a company that already has one becomes a `candidate`.

### 6.4 Never a company website
Search, social, news, data and directory hosts: linkedin, x/twitter, facebook, instagram, youtube, crunchbase, pitchbook, dealroom, tracxn, wikipedia, techcrunch, sifted, tech.eu, uktech.news, eu-startups, gov.uk, find-and-update.company-information.service.gov.uk, ukri.org, medium, substack, github, apps.apple.com, play.google.com. The list lives in code next to the rules and is unit-tested.

### 6.5 Name match
Uses `registryNormalise` and the existing alias list. It matches when the normalised company name equals the normalised `og:site_name`. Failing that, it matches when the title, split on `|`, `-`, `–`, `:` or `·`, has a part equal to the name. A name of 3 characters or fewer, or a dictionary word on the existing generic-name list, never matches on name alone: it needs W1 or W2.

### 6.6 LLM check
- `gpt-5.6-luna` through `BudgetGuard` with purpose `website_check`. Input: our company name, description and first tag, plus the page's title, `og:site_name`, meta description and the first 1,500 characters of visible text. Output, strict: `{ verdict: "same" | "different" | "unsure" }`, no free text.
- About 700 input tokens. Only for news companies where the name already matches, so about 100 calls a month, well under 1p.

## 7. Company number to Companies House (D65, proposed)
- New link method `website_number`. When a company has a `linked` website (W2 or W3, never W1, which needs a link already), and the page shows a UK company number, and the company has no `linked` Companies House row, fetch that profile. Link it when the Companies House name, current or previous, matches the company name or an alias under the D53 name rules, and the company is not dissolved before the company's first event. Otherwise make it a `candidate`.
- The company enters the Companies House queue at tier 0, with reason `website_number`. Like D62 hints, this is evidence for searching. It is not written to `country_code`.
- The link eval gains cases ch-61 onwards: number on a reseller's site, a parent company's number, a dissolved number, and a rebrand with a previous name.

## 8. Data model (migration 0004)
- **`company_websites`:** `id`, `company_id`, `domain` (registrable domain, lower case), `status` (`linked` | `candidate` | `rejected`), `rule` (X1…C2, manual), `source` (`article` | `ukri` | `name` | `guess` | `search`), `evidence` (short text, at most 300 characters, for example "footer company number 12345678 matches Companies House"), `company_number_seen`, `favicon_url`, `checked_at`, `decided_by` (`auto` | `manual`), `fingerprint`. Unique on (`company_id`, `domain`); a partial unique index on `domain` where `status = 'linked'`.
- **`companies.website_domain`:** written only from the `linked` row, and cleared when that row is demoted. The existing unique constraint stays.
- **`grant_participants.website`:** text, nullable.
- Enums: `REGISTRY_LINK_METHODS` gains `website_number`. New `WEBSITE_RULES`, `WEBSITE_SOURCES`.

## 9. Pipeline and review
- A new `pnpm ingest websites` step in `daily.yml` runs after grants and before the registry step, so new numbers link the same day. It gets a 10-minute time limit (`MAX_WEBSITE_MINUTES_PER_RUN`) and `timeout-minutes: 12`. The job limit rises from 75 to 85 minutes.
- **Review:** `pnpm registry list --websites` and `pnpm registry approve|reject --website <id>`, which reuse the review CLI.
- **About page:** a short "How we find websites" note, plus the Brave attribution if search is on.

## 10. Testing and the gate
- **Labelled eval** `fixtures/websites/cases.json`: at least 40 cases from real companies, stored as saved HTML snippets (title, meta and footer only, no personal data). They cover true sites, namesakes in other countries, parked domains, aggregators, rebrands with redirects, a reseller footer showing another company's number, and a short or generic name.
- **Gate:** `pnpm eval --websites` must show **0 wrong `linked` results**. Recall is reported, with no threshold. The live LLM part runs once on the maintainer's machine, capped at $0.05.
- Unit tests use fakes only, as in the rest of the repo.

## 11. Cost
| Item | Per month |
|---|---|
| LLM checks (about 100 × 700 tokens) | under 1p |
| Brave search (at most 200 queries) | £0 inside the $5 credit (a card is needed) |
| Page fetches | free |

## 12. Maintainer decisions (17 November 2026: recommendations accepted)
1. **Search provider.** Sign up for Brave (card on file, stays inside the $5 credit, attribution on the About page)? Or start without search and judge recall from sources 1-4 first? *Recommendation:* start without search, and add it in 071 only if the eval's recall on news companies is under about 60%.
2. **Favicons.** Hot-linking sends visitors' IPs to third-party sites. *Recommendation:* store a cached copy of at most 32 KB, PNG, ICO or JPEG only (no SVG, for script safety), refreshed at re-check.
3. **Grant-only companies.** Do the one-off UKRI re-fetch of about 2,000 organisations for their websites? *Recommendation:* yes. It is free, and it adds websites to the leads view later.

## 13. Assumptions to verify
- **A50.** The share of UKRI organisation records that have a non-empty `website`. Sample 100 in task 069.
- **A51.** Brave's current terms allow our use: query, fetch the result page ourselves, store only the domain we verified. Confirm before adding a key (task 071).
- **A52.** The share of news-company homepages whose company number appears on the homepage or one legal page. Report it from the eval.
