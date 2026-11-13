# SignalFeed specification: Phase 3 (confirmed raises from filings)

Phase 3 builds on `docs/spec.md` and `docs/spec-phase2.md`. Everything in those specs still holds unless this document says otherwise. Tasks are in `docs/tasks/048-*.md` onwards (046 and 047 stay reserved for the deferred Hacker News and GitHub tasks). Decisions D51-D60 in `docs/decisions.md` record the choices made here. Sources were checked on 12 November 2026; details and links are in `docs/sources.md` ("Phase 3 sources").

The goal from the roadmap: mark raises as `confirmed` with official data, and fill the gaps that news misses. The maintainer's priority order is Companies House first, SEC Form D second, then the matching rules and a minimal "confirmed" marker on the site.

## 1. Users and the questions they ask

**Paying-user groundwork: a small UK agency or recruiter selling to newly funded companies** (the Phase 2 "groundwork user", now the priority). Phase 3 helps them answer:

- Is this company real and still trading? (Companies House number, status, dissolved or in liquidation.)
- How old is it? (Incorporation date, so company age and acquisition target age stop being sparse.)
- Where is it? (Registered office postcode district, for companies the news gives no town for.)
- What does it do, broadly? (SIC codes, as a fallback sector when a company has no theme.)
- How big is it? (Size from its last accounts: micro, small, medium.)
- Did this raise really happen? (A "confirmed" marker when an official filing backs the news.)

**Founder user** (unchanged). Founded years improve acquisition target ages (spec-phase2 section 8.4). Confirmed US raises from Form D make amounts and dates more trustworthy.

## 2. Scope

In scope:

1. **Companies House linking.** Link news and grant companies to a `uk_company_number` with deterministic, high-precision rules. Ambiguous cases go to a review queue or stay unlinked (section 7.2).
2. **Companies House facts.** For linked companies: incorporation date (fills an empty `founded_year`), status, company type, SIC codes, registered office postcode, and the type of the last accounts filed (section 7.3).
3. **SEC Form D.** Collect Form D notices from the EDGAR daily indexes, parse the structured XML, store organisation facts only, link issuers to news companies by `sec_cik` (section 8).
4. **Confirmation.** Filing-to-news matching rules. A news funding round becomes `confirmed` when an SH01 share allotment (Companies House) or a Form D (SEC) matches it (section 9).
5. **Grants matched to news.** A news report of an Innovate UK grant attaches to the grant event instead of creating a second event (section 9.4).
6. **Minimal UI.** A "Confirmed" marker and filter, a company size filter, and registry facts on company pages (section 11).
7. **Cuttable last wave: reading SH01 documents.** A prototype that reads the amount raised from SH01 PDFs, measured before any regular use. Recommended to defer (section 10).

## 3. Non-goals for Phase 3

- **Personal data (D58).** No officer, person with significant control (PSC), shareholder, subscriber or "related persons" names. The officers, PSC and charges endpoints are never called. Form D related persons and sales recipients are never parsed into storage. No phone numbers or street addresses are stored.
- **Events created from Form D alone.** Form D filings for issuers SignalFeed has never seen in the news are stored but do not become events (D51, open decision in section 13.3).
- **Events created from SH01 alone.** An allotment can be option exercises, a share-for-share exchange or a conversion, not a raise. Without reading the document, SignalFeed cannot tell.
- **Rewriting news facts.** Registry data never overwrites a value news already gave (founded year, city, amount, round type). It fills empty fields and adds new facts beside them (D57).
- **Changing `companies.status`.** The registry status is shown from the new registry table. The Phase 1 `status` column is left alone.
- **Employee counts from iXBRL accounts.** Possible later (section 13.3), not needed for the size bands.
- **The Companies House streaming API and bulk products.** Periodic API refreshes are enough at this volume (D52).
- **A UI overhaul.** Phase 3 changes follow existing components. The maintainer plans one full UX/UI pass after the functionality is complete.
- **Extraction changes** (section 4).

## 4. Extraction and the Phase 2 go-live

**No change to the extraction schema or prompt.** Phase 3 needs nothing new from news text. Company numbers and legal names are almost never stated in startup news, and asking for them would invite guesses. Matching uses the facts extraction already returns: name, aliases, country, city, region, founded year, round type, amount and date. The prompt version stays `v2`, so nothing needs re-extracting.

**Order against Task 045 (Phase 2 go-live).**

- No Phase 3 task has to land before 045. Phase 3 code can be built while 045 runs.
- Task 050 (the record-origin guard) must be merged before any news event can be marked `confirmed`. It is in wave 1 for that reason, and it changes nothing visible on its own.
- Task 066 (Phase 3 go-live) runs **after** 045 has extracted at least two weeks of real news, so that there are real UK and US companies to link and real rounds to confirm. Its link review needs real data.
- Nothing in Phase 3 is time-sensitive. Companies House and EDGAR both keep full history, so starting later loses nothing.
- The maintainer can create the Companies House API key at any time (Task 049).

## 5. Data model additions

New tables only, plus appended enum values. No existing column changes type, and no existing row is rewritten, except:

- filling the reserved, empty `companies.uk_company_number`, `companies.sec_cik` and `companies.founded_year` (with `founded_year_source`), which Phase 1 reserved for this;
- `events.evidence` on news events, which is derived (section 9.3), like other canonical event fields (D12).

### 5.1 Enums

Appended (values are only ever appended):

| Enum | New values |
|---|---|
| `record_kind` | `ch_allotment`, `sec_form_d` |
| `location_source` | `registered_office` |
| `alias_source` | `registry` |
| `founded_year_source` | `sec_form_d` |
| `llm_purpose` | `document_reading` (used only by the cuttable Task 067; appended now so 067 needs no migration) |

`source_kind` already has `companies_house` and `sec_edgar` from Phase 1.

New enums:

| Enum | Values |
|---|---|
| `registry_kind` | `companies_house`, `sec_edgar` |
| `registry_link_status` | `linked`, `candidate`, `rejected` |
| `registry_link_method` | `grant_number`, `name_grant_postcode`, `name_filing`, `name_location`, `prefix_filing_location`, `form_d_round`, `manual` |
| `link_decided_by` | `auto`, `manual` |
| `registry_search_outcome` | `linked`, `candidates`, `none`, `skipped` |
| `sector_source` | `theme`, `sic` |

### 5.2 Registry links

- `registry_links`: `id`, `company_id` (FK), `registry` (`registry_kind`), `registry_id` (text: a Companies House number such as `09876543` or `SC123456`, or a CIK without leading zeros), `registry_name` (the name the registry gives, an organisation), `status`, `method` (nullable for candidates), `reason` (text, which rule and signals), `decided_by`, `created_at`, `decided_at`. Unique (`company_id`, `registry`, `registry_id`). Partial unique indexes: one `linked` row per (`company_id`, `registry`), and one `linked` row per (`registry`, `registry_id`). Index on (`registry`, `status`).
- `registry_searches`: `company_id`, `registry`, `searched_at`, `outcome`, `input_fingerprint` (hash of the names and events the search used). PK (`company_id`, `registry`). A company is searched again only when its fingerprint changes or after 90 days.

When a row becomes `linked`, the step also fills `companies.uk_company_number` or `companies.sec_cik` if empty, and adds the registry name as an alias with source `registry`. Unlinking (manual only) clears the column it filled.

### 5.3 Companies House

- `ch_companies`: `company_number` (PK), `name`, `status` (text, from the Companies House enumeration), `status_detail` (nullable), `company_type`, `incorporated_on` (date), `ceased_on` (date, nullable), `sic_codes` (text array), `office_postcode` (nullable, full postcode, **never displayed**), `office_outcode` (nullable), `office_locality` (nullable), `previous_names` (text array, organisation names only), `accounts_type` (nullable, the `accounts.last_accounts.type` value), `accounts_made_up_to` (date, nullable: `last_accounts.period_end_on`, or the deprecated `made_up_to` when that is missing), `has_insolvency_history` (boolean: `links.insolvency` present, or the deprecated flag), `etag`, `fetched_at`, `first_seen_at`. Index on `office_outcode`.
- `ch_filings`: `id`, `company_number`, `transaction_id` (unique), `type` (for example `SH01`), `category` (`capital`), `filed_on` (date), `action_date` (date, nullable: the allotment date), `capital` (jsonb, nullable: `[{ currency, figure }]`, the statement of capital after the allotment), `document_id` (nullable, for Task 067), `fetched_at`. Index on (`company_number`, `action_date`). Only capital-category SH01 items are stored.
- `ch_address_counts`: `postcode` (PK), `active_companies` (integer), `checked_at`. A cache for the shared-address check (section 7.3).

### 5.4 SEC Form D

- `form_d_filings`: `id`, `source_id` (FK `sources`, the `sec-edgar` row), `accession_number` (unique), `cik`, `issuer_name`, `entity_type`, `jurisdiction` (state or country of incorporation), `issuer_state`, `issuer_city`, `year_of_inc` (smallint, nullable: only given when within five years), `inc_over_five_years` (boolean), `industry_group`, `is_amendment`, `previous_accession_number` (nullable), `date_of_first_sale` (date, nullable), `first_sale_yet_to_occur` (boolean), `total_offering_usd_minor` (nullable: null when "Indefinite"), `total_sold_usd_minor` (nullable), `investor_count` (nullable), `securities` (text array, for example `equity`, `debt`, `option`), `exemptions` (text array, for example `06b`), `filed_on` (date), `fetched_at`, `company_id` (nullable FK, set by linking), `linked_at`. Index on `cik`, on `filed_on`, and on `company_id`.
- `edgar_index_days`: `day` (date, PK), `status` (`done`, `missing`), `form_d_found`, `form_d_stored`, `fund_skipped`, `fetched_at`. Lets collection resume and backfill without repeats.

Pooled investment funds are counted, never stored. No related persons, sales recipients, phone numbers or street addresses are parsed into storage.

### 5.5 Derived tables

Rebuilt from source tables, written as a diff (D37). They hold nothing that cannot be recomputed.

- `event_confirmations`: `event_id` (FK cascade), `record_kind`, `record_id`, `rule` (text, for example `ch_allotment_window`), `record_date` (date), `confirms_amount` (boolean), `computed_at`. PK (`event_id`, `record_kind`, `record_id`). Index on (`record_kind`, `record_id`).
- `company_sectors`: `company_id`, `sector`, `source` (`sector_source`). PK (`company_id`, `sector`). Index on `sector`. A company's theme sectors, plus SIC sectors when it has no theme sector (section 7.3).

### 5.6 Web access

`ch_companies.office_postcode` is never displayed, but it is a company's public registered office, so the web role keeps read access (as for `grant_participants.postcode` in Phase 2). No Phase 3 table holds article text, abstracts or personal data, so `scripts/sql/roles.sql` needs no new revoke. Task 051 confirms this.

## 6. Pipeline additions

New steps, each idempotent and safe to rerun:

**In `pnpm ingest run` (hourly), after the Phase 2 steps:**

13. **Confirm.** Rebuild `event_confirmations` from stored records and set `events.evidence` (section 9). Local database only, no network. Skipped when its input fingerprint is unchanged.
14. **Sectors.** Rebuild `company_sectors` (section 7.3). Skipped when unchanged.

The locations step (11) gains the registered-office rule (section 7.3). Grant-to-news matching (section 9.4) runs inside the existing resolve step.

**In the daily workflow (`.github/workflows/daily.yml`), after grants:**

- `pnpm ingest registry`: link companies to Companies House, fetch and refresh profiles, fetch capital filings for linked companies with recent rounds, and check shared addresses. Needs `COMPANIES_HOUSE_API_KEY`; skipped without it. At most `MAX_CH_REQUESTS_PER_RUN` requests (default 2,000).
- `pnpm ingest formd`: fetch EDGAR daily form indexes for days not yet done (up to yesterday), then each new Form D and D/A XML, store non-fund filings, and link issuers to companies by CIK or name. At most `MAX_EDGAR_DAYS_PER_RUN` days (default 10) and `MAX_EDGAR_REQUESTS_PER_RUN` requests (default 3,000). Needs `HTTP_CONTACT` to contain an email address (SEC fair access).

Backfill: `pnpm ingest registry --max-requests <n>` run by hand in chunks, and `pnpm ingest formd --since 2026-05-01` for six months of Form D.

**Manual tool.** `pnpm registry <list|show|link|reject|unlink>` reviews link candidates (section 7.2), like `pnpm entities` and `pnpm themes`. It runs only from a maintainer's machine or a manual workflow.

**New environment variables** (`src/core/env.ts`): `COMPANIES_HOUSE_API_KEY` (optional), `MAX_CH_REQUESTS_PER_RUN` (default 2000), `MAX_EDGAR_DAYS_PER_RUN` (default 10), `MAX_EDGAR_REQUESTS_PER_RUN` (default 3000). The Companies House key is a GitHub Actions secret only. Vercel never gets it.

No new port. Both clients are adapters over `HttpFetcher`, which already takes headers. Companies House uses HTTP Basic auth with the key as the username and an empty password.

## 7. UK Companies House

### 7.1 Verdict and verified facts

**Use the REST API with a free key. Do not use the bulk snapshot** (D52). Checked on 12 November 2026 (A31-A38, `docs/sources.md`):

- **Key.** Free. A Companies House developer account registers an application of type "API key". The key is sent with HTTP Basic auth as the username, with an empty password. **[maintainer]** creates the account and key (Task 049).
- **Rate limit.** Still **600 requests in five minutes**, per application. Over the limit, every request gets HTTP 429 until the window ends. Companies House may ban applications that keep exceeding it, and will raise the limit on request. SignalFeed stays at 500 per five minutes (about 1.6 a second), leaving headroom for manual use of the same key.
- **Terms and licence.** There is no separate API terms page. Register information is made available under the Registrar's approvals under section 47 of the Copyright, Designs and Patents Act 1988. A Companies House service owner wrote in 2021 that Companies House "imposes no rules or requirements on how the information on the public register is used", and that users are responsible for data protection and copyright law. Companies House's own guidance (2019) asks for the source to be credited and copyright status acknowledged. SignalFeed credits "Source: Companies House" and stores no personal data. Confirm commercial reuse before Phase 4 (A32), as for GtR (A17).
- **Bulk snapshot.** The free company data product is a monthly zip of CSV (471 MB for 1 November 2026, or seven parts of about 70 MB), live companies only, published within 5 working days of month end, with no licence stated on the page. It is not needed: SignalFeed needs facts for a few thousand companies, which the API serves in a few hours a month (D52).
- **Document API.** Filing PDFs are image-only (fax-like PDF/A), so reading an SH01 needs OCR or a vision model (A36, section 10).

### 7.2 Linking rules (D53)

The rules run per company in the `registry` step. They are pure functions (`src/pipeline/registry/link-rules.ts`) over the company's facts and the API responses, so they are unit-tested and replayed by the link eval (section 12) with no network.

**Which companies are searched.** Companies not merged, with `country_code = GB`, or with a grant participant, or with a UK `company_locations` row. Companies with no normalised name of at least 3 characters are skipped (`outcome = skipped`).

**Names.** The registry normaliser is `normaliseCompanyName` (Phase 1: lower case, no diacritics, legal suffixes removed, punctuation removed), plus `&` read as "and". A name matches **exactly** when the normalised registry name, or one of its `previous_names`, equals the company's normalised name or one of its aliases. It matches **by prefix** when the normalised registry name starts with the company's normalised name followed by a space ("tidewell platform" for "tidewell"). Nothing else is a match. "UK", "Holdings" and similar words are not stripped, because they usually name a different legal entity.

**Step 0: a number we already trust.** If the company has `uk_company_number` from a grant record (Phase 2), fetch that profile. If its name or a previous name matches exactly, link with method `grant_number`. Otherwise record a `candidate` with the reason "grant number, name differs", and leave the column as it is.

**Step 1: search.** Call `/search/companies?q=<name>&items_per_page=50` for the company name and up to two aliases. Keep exact matches and prefix matches. Fetch the profile of each exact match and of at most three prefix matches.

**Step 2: conflicts** remove a candidate:

| Conflict | Rule |
|---|---|
| Too young | Incorporated after the company's earliest event date. |
| Closed too early | `ceased_on` before the company's latest event date. |
| Dormant through a round | Last accounts are `dormant` and an equity round falls inside the accounts year (the 12 months up to `accounts_made_up_to`). A company that issued shares for cash is not dormant. |
| Wrong type for a raise | No share capital (`private-limited-guarant-nsc` and similar) while the company has an equity round. Allowed for grant-only companies. |
| Founded year disagrees | News states a founded year and the incorporation year differs by more than 2. |
| Taken | The number is already `linked` to another company. This makes a merge candidate for the two companies ("same Companies House number"), not a link. |

**Step 3: support signals.** An auto-link needs at least one:

| Signal | Rule |
|---|---|
| S1 Grant postcode | A grant participant of the company has the same full postcode as the registered office, or the same outcode. |
| S2 Location | The company has a `company_locations` row with a town or outcode, and the registered office outcode's centroid is within 25 km of it. |
| S3 Filing | An SH01 with an allotment date within 120 days before to 30 days after one of the company's equity rounds. This costs one filing-history request per candidate. |

A news founded year that equals the incorporation year is noted in the reason, but is not enough alone.

**Step 4: decide.**

| Situation | Outcome |
|---|---|
| Exactly one exact candidate left, with at least one signal | `linked`, method `name_grant_postcode` (S1), `name_filing` (S3) or `name_location` (S2), in that order of preference |
| Exactly one exact candidate left, no signal | `candidate` (review queue) |
| Several exact candidates left | All become `candidate`s |
| No exact candidate; exactly one prefix candidate with both S2 and S3 | `linked`, method `prefix_filing_location` |
| No exact candidate; prefix candidates otherwise | Up to three become `candidate`s |
| Nothing left | `none`, searched again after 90 days or when the company gains an alias or an event |

Manual decisions (`decided_by = manual`) are final: a rejected number is never proposed again for that company, and a manual link is never replaced. Auto-links are re-checked when the profile is refreshed: if a later conflict appears (for example a dissolution date before a new round), the link becomes a `candidate` again and the company number column is cleared. That is the only automatic unlink.

**Review queue.** `pnpm registry list` shows open candidates with the company's events, the registry name, number, status, incorporation date, outcode and the reason. `link`, `reject` and `unlink` record a manual decision. Reviewing is optional: an unreviewed candidate simply leaves the company unlinked, which is the safe default for hands-off running. Pages never show candidates.

**Worked examples** (invented names; the eval uses the same patterns):

1. **Auto-link by filing.** "Brightwell Robotics" (GB, Leeds, seed £2.1M announced 10 March 2026). The search returns BRIGHTWELL ROBOTICS LTD (active, incorporated 1 June 2022, office LS1) and BRIGHTWELL ROBOTICS SERVICES LTD (prefix). The exact candidate has no conflict. Its capital filings include an SH01 with allotment date 2 February 2026, 36 days before the round (S3), and LS1 is within 25 km of Leeds (S2). **Linked**, method `name_filing`. The prefix match is not considered, because an exact candidate decided.
2. **Review, no support.** "Nova" (GB, no town, seed £500k on 1 May 2026). NOVA LTD exists (incorporated 2009, office in Bristol). Its last accounts are dormant, made up to 31 March 2026, so the accounts year ends before the round: no conflict. No SH01 near the round, no location to compare. **Candidate.** A short brand name matching an old company is exactly the case where a guess would mislead.
3. **Conflict.** "Kestrel AI" (news says founded 2023, first event 12 November 2024). KESTREL AI LTD was incorporated 1 August 2025, after the first event. **No link, no candidate.** Outcome `none`.
4. **Grant postcode.** Grant participant "Fenwick Thermal Ltd", postcode NE1 5DL, no `regNumber`. FENWICK THERMAL LTD has its registered office at NE1 5DL (S1). **Linked**, method `name_grant_postcode`.
5. **Trading name.** "Tidewell" (GB, London, seed £3M on 20 January 2026). No exact match. Prefix matches: TIDEWELL PLATFORM LTD (office EC2A, SH01 allotted 15 December 2025) and TIDEWELL HOLDINGS LTD (office EC2A, no SH01). Only the first has S2 and S3. **Linked**, method `prefix_filing_location`. If both had an SH01 in the window, both would be candidates.
6. **Duplicate found.** "Acme Bio" is linked to 09876543. A later company "AcmeBio" would link to the same number. It becomes a merge candidate with the reason "same Companies House number", for `pnpm entities`.

### 7.3 Facts from Companies House (D57, D59)

Profiles are fetched when a company is linked and refreshed every 90 days, plus weekly for linked companies with an equity round in the last 120 days that is not yet confirmed (so new SH01s and dissolutions are seen). About 70 refreshes a day once the backfill is done.

- **Founded year.** If `companies.founded_year` is null, set it to the incorporation year with `founded_year_source = companies_house`. A news value is never replaced. The company page shows the incorporation date separately ("Incorporated 1 June 2022"), so a conflict is visible. Company age and acquisition target age (spec-phase2 section 8.4) use `founded_year` as before, so their coverage rises with no change to their code.
- **Status.** Shown on the company page with Companies House's own wording ("Active", "Dissolved", "In Administration", "Liquidation"). Not written to `companies.status`.
- **SIC codes.** Shown with their descriptions from the committed condensed SIC 2007 list (`src/lib/registry/sic-codes.json`, OGL). Mapped to the 16 sectors by `src/lib/registry/sic-sectors.ts`: a table by SIC division, with 5-digit exceptions. Vague codes map to no sector: `70229` (management consultancy), `74909` (other professional activities), `82990` (other business support), `96090` (other service activities), `99999` (dormant) and `98000` (residents' property management). Examples: `62012` software development gives `software-ai`; `21100` pharmaceutical products gives `health-life-sciences`; `64999` financial intermediation gives `financial-services`; `35110` electricity production gives `climate-energy`; `85590` other education gives `education`.
- **Sectors for filtering.** `company_sectors` holds a company's theme sectors (source `theme`). Only a company with **no** theme sector gets its SIC sectors (source `sic`). Themes come from what the company says it does; SIC codes are self-declared, coarse, and often `62020` or `70229` for any tech startup. So SIC fills the gap without overriding a better signal. Mostly this helps untagged grant companies.
- **Registered office location.** A new location rule, between the existing rules 2 and 3:

  1. Grant postcode (unchanged).
  2. News city, UK (unchanged).
  3. **Registered office** (new, source `registered_office`, precision `outcode`). The linked company's office outcode, with its centroid and ITL1 code, if: (a) the full postcode is not a shared address, and (b) when the news gives a region, the outcode's ITL1 agrees with it.
  4. News region, UK (unchanged).
  5. Non-UK city (unchanged).

  **Shared addresses.** Many companies use a formation agent or accountant as their registered office. A startup in Manchester registered at a London formation agent would otherwise be placed in London. Before using an office postcode, the step asks Companies House how many active companies share it (`/advanced-search/companies?location=<postcode>&company_status=active&size=1`, cached in `ch_address_counts` for 180 days). **At 20 or more, the postcode is treated as shared and not used** (A37, A47). This also drops some real offices in large co-working buildings: precision over recall. If the advanced search cannot filter by postcode (A37), the fallback is to count, among SignalFeed's own linked companies, how many share the full postcode, and treat 3 or more as shared.
- **Company size** (`src/lib/registry/company-size.ts`), from `accounts_type`:

  | Band | Accounts types |
  |---|---|
  | `micro` | `micro-entity` |
  | `small` | `small`, `total-exemption-full`, `total-exemption-small`, `audited-abridged`, `unaudited-abridged`, `partial-exemption`, `audit-exemption-subsidiary`, `filing-exemption-subsidiary` |
  | `medium` | `medium` |
  | `full_accounts` | `full`, `group`. Shown as "Full accounts (size not stated)": small companies may choose full accounts, so this is not "large". |
  | `dormant` | `dormant` |
  | `no_accounts_yet` | no last accounts, `initial`, `interim`, `null`, `no-accounts-type-available`. Usually a company under about 21 months old. |

  The accounts regime may change: the reforms that would end abridged accounts and require software filing were paused from April 2027, with April 2028 reported (A46). The mapping is one table in one file.

**Coverage, expected.** News companies with a town were about a quarter (A28). With registered offices, expect roughly half of linked UK companies to gain a postcode district. Founded years should go from rare to most linked UK companies. Both are measured at go-live (A44).

## 8. SEC Form D

### 8.1 Verdict and verified facts

**Build it, for confirmation and CIK links. Do not create events from Form D alone in Phase 3** (D51). Checked on 12 November 2026 (A39-A42):

- **Fair access.** At most 10 requests a second; a `User-Agent` that names the requester with a contact email; no crawling bots. SignalFeed stays at 5 a second and sends `SignalFeed/<version> (+<HTTP_CONTACT>)`, so **`HTTP_CONTACT` must be an email address** for this step.
- **Daily indexes.** `https://www.sec.gov/Archives/edgar/daily-index/<year>/QTR<n>/form.<yyyymmdd>.idx`, sorted by form type, with company name, form type, CIK, date filed and file name. Updated nightly from about 10 pm Eastern. Weekends and holidays have no file (404).
- **Form D XML.** Each filing has `primary_doc.xml` in schema X0708, the same since 2008-2009: issuer name and CIK, entity type, jurisdiction, year of incorporation (a value only if within five years), principal place of business, industry group, federal exemptions, type of filing (new or amendment, date of first sale), offering amounts (total offering, total sold), and investors. `fast-xml-parser` is already a dependency.
- **Volume.** 34,553 initial Reg D filings in 2025, about 49% from issuers that are not pooled investment funds. 2026 runs at about 10,000 a quarter. With amendments, about 200-250 Form D and D/A a working day.
- **Terms.** SEC: "Anyone can access and download this information for free." SEC data is a US government work.
- **Quarterly data sets** (zips of flattened Form D data, about 3.5 MB a quarter) exist, but the daily index walk also backfills, with no zip handling.

### 8.2 Collection

For each day not in `edgar_index_days`, oldest first, up to yesterday: fetch the form index, keep rows with form type `D` or `D/A`, then fetch each `primary_doc.xml`. Parse with Zod over the parsed XML. Skip and count pooled investment funds (`industryGroupType` "Pooled Investment Fund"). Store the rest (section 5.4). Amounts are whole US dollars in the XML, stored as cents. "Indefinite" offering amounts are stored as null. The parser reads only issuer, offering and filing fields. It never reads `relatedPersonsList` or `salesCompensationList`, and a test asserts that no stored column holds a person's name from the fixture.

### 8.3 Linking issuers to companies

The direction is filing to company, because there are far more Form D issuers than news companies.

1. **By CIK.** A company already linked to this CIK owns the filing.
2. **By name.** Otherwise, find non-merged companies whose normalised name or alias equals the normalised issuer name (legal suffixes such as Inc, LLC and Corp are already removed). Companies with a known country other than `US`, or linked to another CIK, conflict.
3. **Decide.** Link (method `form_d_round`) when exactly one company is left and it has a funding round that the Form D confirms by the rules in section 9.2 (date window and amounts). The link and the confirmation then come from the same evidence.
4. **Otherwise.** If exactly one company is left and it has a funding round within 365 days of the filing, record a `candidate`. Else nothing. This keeps common names ("Atlas", "Nova") out of the review queue.
5. On linking, fill `sec_cik`, and fill an empty `founded_year` from `year_of_inc` (source `sec_form_d`).

**Worked example.** News: "Orbital Forge" (US, seed $4.5M, 18 February 2026). Form D: "Orbital Forge, Inc.", CIK 1999999, first sale 5 January 2026, total sold $4,400,000, filed 16 January. Names match exactly, no conflict, and the round is 44 days after the first sale with amounts 2.2% apart. **Linked and confirmed.**

## 9. Confirmation (D54)

### 9.1 What "confirmed" means

`confirmed` means an official record shows the event happened at about that time. It does **not** mean every fact is official: for news rounds, the amount, round type and investors stay as reported. The marker says exactly what the record shows, for example "Confirmed: shares allotted on 2 February 2026 (Companies House SH01)", or "Confirmed: Form D, $4.4M sold, first sale 5 January 2026 (SEC)". `confirms_amount` is true only when the record's amount agrees.

### 9.2 Rules

Applied to every funding round of a linked company. Equity rounds only (not `debt` or `grant`), and only events with `day` or `month` date precision. Windows are against `announced_on`, because news usually reports a round weeks after it closed.

| Record | Window for the record's date | Amounts | `confirms_amount` |
|---|---|---|---|
| SH01 (`ch_allotment`) | Allotment date from 120 days before to 30 days after | Not compared (the PDF holds the price; section 10) | false |
| Form D (`sec_form_d`) | Date of first sale from 180 days before to 45 days after | If both known, the news USD amount must be within 50% of total sold or total offering, otherwise no confirmation | true when within 15% of either |

If several records fit, all are stored, and the marker shows the closest one. One record may confirm at most one event: if it fits several, it goes to the nearest by date, then the lower event id.

**Worked examples:**

| Case | News event | Record | Result |
|---|---|---|---|
| C1 | UK seed, 10 Mar 2026 | SH01 allotted 2 Feb 2026 | Confirmed (36 days before), amount not confirmed |
| C2 | UK seed, 10 Mar 2026 | SH01 allotted 1 Sep 2025 | Not confirmed (190 days before) |
| C3 | US seed $4.5M, 18 Feb 2026 | Form D first sale 5 Jan 2026, sold $4.4M | Confirmed, amount confirmed (2.2%) |
| C4 | US series A $20M, 1 Jun 2026 | Form D first sale 10 May 2026, offering $20M, sold $3M | Confirmed, amount confirmed against the offering |
| C5 | US series A $20M, 1 Jun 2026 | Form D first sale 10 May 2026, offering $3M, sold $3M | Not confirmed (85% apart, a different offering) |
| C6 | UK seed, "around March 2026" (`month`) | SH01 allotted 20 Jan 2026 | Confirmed; the window is measured from 1 March |

### 9.3 How evidence is stored

- `event_confirmations` is rebuilt from `ch_filings`, `form_d_filings`, `registry_links` and events by the confirm step, written as a diff, skipped when its fingerprint is unchanged.
- `events.evidence` is then set to `confirmed` for news events with at least one confirmation, and back to `reported` for news events with none. Events created from an official record (grants) stay `confirmed`.
- **The Phase 2 guard changes first** (Task 050). Today the news event matcher and `corroboratesFor` skip any event with `evidence = confirmed`, to protect grant events. Once news events can be confirmed, that would stop later reports of a confirmed round from matching it, and create duplicates. The guard becomes "skip events that have an `event_record_sources` row" (record-origin events). Behaviour is unchanged for grants and for today's data, and tests prove it.
- A confirmed news event whose reports are all re-extracted away is deleted as before; its confirmation rows cascade, and the next rebuild finds the new event.

### 9.4 Grants matched to news (D56)

UK news sometimes reports an Innovate UK grant ("secures £480k Innovate UK grant"). Phase 2 kept such a report as a separate `reported` grant event. Phase 3 attaches it to the grant event:

- In the resolve step, after the company is resolved, an incoming funding round with round type `grant` is compared with that company's record-origin grant events. It matches when the news date is within 180 days before to 60 days after the grant start, and the news amount is within 15% of the grant offer **or** of the project cost (news often reports the whole project), or the news has no amount and there is exactly one grant event in the window.
- A match links the report through `event_sources` to the grant event. The grant event keeps its record facts (amount, date, round type, label, `confirmed`). Investors are the union of the record's ("Innovate UK", lead) and the reports'. `source_count` counts the reports, so the timeline shows the headline.
- `recomputeEvent` changes so that, for a record-origin event, only `source_count`, the headline links and the investor union come from reports.
- A one-off relink (`pnpm ingest relink-grants`, run in Task 066) applies the same rule to news grant events created before Phase 3, moves their sources and deletes the emptied news events, which are derived data.

**Example C7.** News on 20 April 2026: "Fenwick Thermal secures £480k Innovate UK grant". Grant event: start June 2026, offer £300k, project cost £480k. The date is 42 days before the start and the amount matches the project cost, so the report attaches to the grant event.

## 10. SH01 documents (D55)

**Verdict: Phase 3 uses SH01 filing metadata only, which is free. Reading the documents is a cuttable last wave (Task 067), recommended to defer.**

What the metadata gives, free: the filing date, the allotment date and the statement of capital after the allotment (total nominal value per currency). That is enough to confirm that shares were issued near a reported round (section 9). It does not give the amount raised: nominal value is usually a few pounds or hundreds of pounds, and the price paid per share, including premium, is only in the PDF.

What reading the PDF would cost (A36, A43):

- **The PDFs are images.** Even web-filed forms come as image-only PDF/A, so text extraction needs OCR or a vision model.
- **Vision model.** `gpt-5.6-luna` is $0.20 / $1.20 per million input / output tokens. OpenAI prices newer models' images by 32-pixel patches (about 1.2 tokens a patch). An A4 page at 150 dpi is about 2,150 patches, so about 2,600 tokens. Reading the two pages that hold the allotment table, plus the prompt and up to 1,000 output and reasoning tokens, is about 6,000 input and 1,000 output tokens: **about $0.0024 (0.2p) a document**. Whether luna accepts images or PDF files must be checked first (A43).
- **Volume and monthly cost:**

  | Use | Documents a month | Cost a month |
  |---|---|---|
  | Only SH01s that confirm a news round | about 20-40 | under £0.10 |
  | Every SH01 of every linked company (gap filling) | about 400 | about £0.75-£1.50, with retries |

  Gap filling alone would use most of the £1 normal budget, and it needs the riskiest judgement: whether an allotment is a raise at all (option exercises, conversions of advance subscription agreements, share-for-share exchanges, bonus issues).
- **Accuracy is unmeasured.** Typed web filings should read well; scanned paper forms and multi-class tables are harder. Task 067 measures it on 30 SH01s the maintainer labels, before any regular use.
- **Free alternative.** Tesseract OCR on the GitHub Actions runner (installed with `apt`), with a rule-based parser for the allotment table. No per-document cost, but more code, and table layouts break simple parsing. Task 067 compares both on the same 30 documents.

If 067 is ever switched on: confirmation use only, a per-document worst-case limit through `BudgetGuard` (purpose `document_reading`), a sub-limit of £0.25 a month, and at most 50 documents a run. A read amount is shown as "Companies House SH01: about £2.1M allotted" beside the news amount, never instead of it.

## 11. Pages and routes

No new routes. Minimal, functional changes that follow existing components; a full UX/UI overhaul comes later.

| Route | Change |
|---|---|
| `/` | A small "Confirmed" marker next to the date of confirmed rounds, with the confirmation text in its accessible name. A "Confirmed by an official filing" checkbox (`evidence=confirmed`). A "Company size" multi-select (`cosize`). `describeFundingCriteria` covers both ("Confirmed seed rounds at micro and small companies…"). |
| `/companies/[slug]` | A "Registry" block: Companies House number linked to its public page (`https://find-and-update.company-information.service.gov.uk/company/<number>`), status, company type, incorporation date, SIC codes with descriptions, size band with the accounts date, registered office postcode district (never the full postcode); or the SEC CIK linked to EDGAR. Each event shows its confirmation line. "Source: Companies House" and "Source: SEC EDGAR" under the block. |
| `/about` | Methodology for linking, confirmation, SIC sectors, size bands and registered-office locations, with what they cannot do. Attribution for Companies House and SEC. |
| `/status` | Registry counts (linked by method, open candidates, searched with no match, profiles refreshed), Form D state (last index day, filings stored, funds skipped), confirmations by kind, and Companies House requests in the last run. |

**Filter parameters** (criteria version 3, D60):

| Param | Values | Meaning |
|---|---|---|
| `evidence` | `confirmed` | Only events with `evidence = confirmed` (confirmed news rounds and grants). |
| `cosize` | multi: `micro`, `small`, `medium`, `full-accounts`, `dormant`, `no-accounts-yet` | The company's size band from its last accounts. Companies with no Companies House link never match. |

`FUNDING_CRITERIA_VERSION` becomes 3. Version 2 URLs parse to the same criteria, because both parameters are new and default to "no filter". Canonical serialisation and round-trip tests are extended (D41).

The sector filter reads `company_sectors` **or** the old theme join, so it never returns less than before while `company_sectors` is still empty.

## 12. Testing

- **Unit:** link rules (every row of the tables in section 7.2 and the six worked examples), name matching (exact, previous names, prefix, "&"), SIC-to-sector map (every division has a decision; the vague codes map to nothing), size bands (every Companies House accounts type has a band), confirmation windows and amount checks (C1-C6), grant-to-news matching (C7 and its edges), Form D XML parsing, EDGAR index parsing, the shared-address rule, filter parse and serialise round-trips for version 3.
- **Integration (PGlite):** the registry step on seeded companies with a fake Companies House client (idempotent reruns, manual decisions never overridden, duplicate numbers becoming merge candidates, request limit respected); Form D collection and linking with a fake fetcher; the confirm step (diff writes, evidence set and reset, deleted events); the record-origin guard (a confirmed news event still matches later reports; a grant event still does not); grant relink; the location and sector rules; the new filters.
- **No network:** both clients are tested through a fake `HttpFetcher`. Fixtures are trimmed real responses with every company name and address replaced by invented ones (Task 049). The Form D fixture keeps a `relatedPersonsList` with invented names, so the test can prove they are not stored.
- **Rate limits:** the Companies House client's limiter is tested with a fake clock (no more than 500 requests in any five-minute window; a 429 pauses until the window ends, and a second 429 stops the step). The EDGAR client never exceeds 5 a second.
- **Link eval (Task 053):** `fixtures/registry/link-cases.json` holds about 60 labelled cases with invented names: the company's facts, the recorded API responses it would see, and the expected outcome (a number, `candidate` or `none`). They over-represent hard cases: short brand names, trading names, holdings companies, dormant namesakes, dissolved predecessors, shared addresses and duplicates. `pnpm eval --links` replays them with no network and writes `docs/link-eval-results.md`: precision and recall of auto-links, and how many correct links went to review. **Targets: no wrong auto-link (precision 100%) on the set, and recall of at least 50%.** A test holds both. A wrong auto-link on real data is fixed by changing a rule and adding a case, never by a name list.
- **Confirmation cases (Task 060):** C1-C7 as tests, plus about 20 labelled event-and-filing pairs in `fixtures/registry/confirmation-cases.json`, scored by a test. Target: no wrong confirmation on the set.
- **Real-data review (Task 066):** the maintainer checks 50 auto-links, 20 candidates and 20 confirmations on real data and records the results in `docs/phase3-review.md`. **Target: at most 1 wrong auto-link in 50.** If there are more, auto-linking is restricted (for example, S2 alone stops being enough) before the site shows registry facts.

## 13. Cost, storage and open decisions

### 13.1 Monthly cost

| Item | Volume a month | Cost a month |
|---|---|---|
| Companies House API | about 3,500 requests (250 new companies × about 5, 1,700 refreshes, 200 filing checks, 200 address checks) | £0 |
| SEC EDGAR | about 5,000 requests (22 indexes, about 4,800 XML files) | £0 |
| GitHub Actions | about 5-15 extra minutes a day on a public repo | £0 |
| Neon compute | daily runs of a few minutes; the hourly confirm and sector steps are usually skipped | £0 |
| LLM calls | none in waves 1-6 | £0 |
| **Phase 3 added (waves 1-6)** | | **£0** |
| Task 067, if built and limited to confirmations | about 20-40 SH01s | under £0.10 |

Phases 1-3 together stay at about £0.25-£1.15 a month, as after Phase 2 (spec-phase2 section 14), under the £3 cap.

One-off: the Companies House backfill (about 6,000 companies, about 30,000 requests) takes about 15 daily runs at 2,000 requests, or a few manual runs. Six months of Form D is about 26,000 requests, in three or four manual runs. Both cost nothing.

### 13.2 Storage

| Data | One-off | Growth a month |
|---|---|---|
| `ch_companies` (about 600 bytes a row with indexes) | about 3.5 MB for 6,000 companies | about 0.15 MB |
| `ch_filings` (SH01s from the last 3 years of linked companies) | about 4.5 MB | about 0.2 MB |
| `registry_links`, `registry_searches`, `ch_address_counts` | about 2.5 MB | about 0.15 MB |
| `form_d_filings` (non-fund D and D/A, about 500 bytes a row) | about 9 MB for six months | about 1.5 MB |
| `event_confirmations`, `company_sectors` | under 1 MB | under 0.1 MB |
| **Phase 3 total** | **about 20 MB** | **about 2 MB** |

With Phases 1 and 2 (about 13 MB a month and about 30 MB one-off), the database grows about 15 MB a month. Neon Free's 1 GB lasts about five years. If space gets short, Form D filings for issuers never linked after two years are the first thing to archive (D15: archive, never delete).

### 13.3 Open decisions for the maintainer

1. **Form D-only events.** Recommended: no in Phase 3. Stored filings let Task 066 count how many tech and health issuers under five years old appear each month. A later task could add them as `confirmed` events, hidden by default like grants.
2. **Task 067 (SH01 reading).** Recommended: defer. If built, confirmation use only, with the £0.25 sub-limit.
3. **Prefix auto-links** (method `prefix_filing_location`). Recommended: on, because trading names are common. Alternative: send all prefix matches to review.
4. **Founded year precedence.** Recommended: Companies House fills only empty values. Alternative: the incorporation year replaces news values. Holding companies set up for a later round make the incorporation date misleading, so news should not be overridden.
5. **Shared-address threshold.** Recommended: 20 active companies at a postcode. Measured at go-live.
6. **Review effort.** Expect about 20-40 open candidates a month. Reviewing is optional.
7. **Employee counts from iXBRL accounts** (later). About 80% of accounts are filed electronically, many as iXBRL, which the Document API can return as XHTML, read without an LLM. Not needed for the size bands, so not planned.

## 14. Assumptions for tasks to verify

Continuing from A30 in `docs/spec-phase2.md`. "Verified" rows were checked on 12 November 2026 during planning; the named task re-checks them before relying on them.

| # | Assumption | Status | Checked by |
|---|---|---|---|
| A31 | Companies House API: free key from a developer account (application type "API key"); HTTP Basic auth with the key as username; 600 requests in 5 minutes per application; 429 for the rest of the window; higher limits on request | Verified (docs) | 049, 054 |
| A32 | Register data may be reused: section 47 approvals, "no rules or requirements on how the information on the public register is used" (2021), credit the source. No separate API terms page found. Commercial reuse confirmed with Companies House before Phase 4 | Partly verified | 049, Phase 4 |
| A33 | Free company data product: monthly zip of CSV, 471 MB (1 November 2026), live companies only, no licence stated on the page | Verified | none (not used) |
| A34 | The company profile has `sic_codes`, `date_of_creation`, `date_of_cessation`, `company_status`, `type`, `registered_office_address.postal_code`, `accounts.last_accounts.type` and `period_end_on` (`made_up_to` is deprecated), `previous_company_names`, `links.insolvency` (`has_insolvency_history` is deprecated), `etag`. Account types and statuses are as in the `api-enumerations` constants | Documented and enumerations verified; a real response checked with a key | 049 |
| A35 | `filing-history?category=capital` lists SH01 items with `action_date` or `description_values.date` (allotment date) and `description_values.capital` (`currency`, `figure`) on the list resource, not only on single items | To verify (forum reports differ) | 049 |
| A36 | Document API PDFs are image-only, so reading needs OCR or a vision model | Community-reported | 067 |
| A37 | `/advanced-search/companies` accepts `location` and returns a total count, so `location=<postcode>&company_status=active&size=1` counts companies at a postcode | Parameter documented; count field and postcode behaviour to verify | 049, 056 |
| A38 | `/search/companies` takes `q`, `items_per_page` (up to 100) and `start_index`, and items have `title`, `company_number`, `company_status`, `company_type`, `date_of_creation`, `address.postal_code` | Item fields verified; parameters to verify | 049 |
| A39 | EDGAR: at most 10 requests a second; User-Agent with name and email; daily form indexes under `/Archives/edgar/daily-index/<year>/QTR<n>/`, updated nightly from about 10 pm Eastern | Verified | 055 |
| A40 | Form D `primary_doc.xml` (schema X0708) holds issuer, `industryGroupType`, `yearOfInc`, `dateOfFirstSale`, `offeringSalesAmounts` | Partly verified (third-party docs) | 049, 055 |
| A41 | About 34,600 initial Reg D filings in 2025, 49% non-fund; about 10,000 a quarter in 2026 | Verified (SEC statistics) | 066 |
| A42 | EDGAR data is free to access and reuse | Verified (SEC page) | 049 |
| A43 | `gpt-5.6-luna` accepts image or PDF input, at about 1.2 tokens per 32-pixel patch | To verify | 067 |
| A44 | About 40-60% of UK news companies and most grant companies auto-link; about half of linked companies gain a postcode district | To measure | 066 |
| A45 | About 20-40 new link candidates a month | To measure | 066 |
| A46 | The accounts reforms (no abridged accounts, software-only filing) are paused from April 2027, with April 2028 reported but not confirmed by Companies House | Reported by several firms | 066 |
| A47 | 20 active companies at one postcode separates formation-agent addresses from ordinary offices | To measure | 066 |
