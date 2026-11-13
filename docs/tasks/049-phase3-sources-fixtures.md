# 049 Companies House key, source check and API fixtures [maintainer]

- **Tier:** 1 (account set-up, a few manual requests, fixture trimming). **Suggested model:** Composer 2.5 or Claude Sonnet, working with the maintainer.
- **Depends on:** none. **Wave:** 1.

## Goal
Create the Companies House API key, check the assumptions the planning pass could only read about, and record trimmed, anonymised API fixtures for the client tasks.

## Why it matters
The Companies House client (054), the EDGAR client (055) and the linking step (056) are built from fixtures, with no network in tests. If a field is named differently or missing, it is far cheaper to find out now than in a Tier 3 task.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 7, 8, 14: A31-A42)
- `docs/sources.md` ("Phase 3 sources")
- `docs/decisions.md` (D19, D58)

## Files you may create or change
- `docs/sources.md` (the "Phase 3 sources" section only)
- `fixtures/companies-house/` (new): `search.json`, `profile-active.json`, `profile-dormant.json`, `profile-dissolved.json`, `filing-history-capital.json`, `advanced-search-location.json`, `README.md`
- `fixtures/edgar/` (new): `form-index.idx`, `form-d-company.xml`, `form-d-amendment.xml`, `form-d-fund.xml`, `README.md`

## Steps
1. **[maintainer] Create the key.** Register a Companies House developer account at `https://developer.company-information.service.gov.uk/`, create an application, and add a key of type "REST API key" (live environment). Restrict it to the GitHub Actions use if the form allows. Store it in a password manager. Do not commit it or paste it into chat; set it as `COMPANIES_HOUSE_API_KEY` in a local `.env` only for this task.
2. **[maintainer] Decide `HTTP_CONTACT`.** SEC fair access needs a contact email in the User-Agent. Choose an address you are happy to send to the SEC (a project address is best). It goes in the repository variable in Task 065.
3. **Check Companies House (A31, A34, A35, A37, A38)** with at most 20 requests, using public test companies of your choice:
   - `GET /search/companies?q=...&items_per_page=50`: confirm the item fields and the largest allowed `items_per_page`.
   - `GET /company/{number}`: confirm `sic_codes`, `date_of_creation`, `date_of_cessation`, `company_status`, `type`, `registered_office_address.postal_code`, `accounts.last_accounts.type` and `period_end_on` (the docs mark `made_up_to` deprecated), `previous_company_names`, `links.insolvency` (the docs mark `has_insolvency_history` deprecated), `etag`.
   - `GET /company/{number}/filing-history?category=capital`: confirm whether SH01 list items carry `action_date` and `description_values.date` and `.capital`. If they only appear on `GET /company/{number}/filing-history/{transaction_id}`, record that (the client then needs one request per SH01).
   - `GET /advanced-search/companies?location=<a busy postcode>&company_status=active&size=1`: confirm that `location` filters by postcode and which field gives the total count (`hits`?). Try one ordinary office postcode too.
   - Note the rate-limit headers, if any.
4. **Check EDGAR (A39, A40, A42)** with at most 10 requests, a User-Agent with the contact email, and at most 1 request a second: one daily `form.<yyyymmdd>.idx`, and three `primary_doc.xml` files (an operating company, an amendment and a pooled fund).
5. **Record fixtures.** Trim each response to the fields the spec uses plus a few unknown ones (so parsers prove they ignore extra fields).
   - Replace every company name, previous name and address line with invented ones; keep realistic shapes (postcodes valid in format, numbers 8 characters).
   - Remove officer, PSC and person links if any appear.
   - In the Form D fixtures, keep `relatedPersonsList` and `salesCompensationList` but replace every name with obviously invented ones ("Example Person One"), so tests can prove they are never stored. Remove phone numbers.
   - Each `README.md` says where the data came from, when, what was changed, and that every name is invented.
6. **Update `docs/sources.md`.** Change each "to verify" row for A31, A34, A35, A37, A38, A40 and A42 to what you found, with the date and links. If an assumption fails (for example `location` cannot count companies at a postcode), say so plainly and name the fallback from the spec.

## Tests and acceptance criteria
- `pnpm check` passes (formatting of the new files).
- No real company name, address, person name, phone number or key appears in any committed file. Search the diff for the key before finishing.
- `docs/sources.md` states, for each assumption, verified, changed or failed, with the date.

## Out of scope
- Writing clients or parsers (054, 055). Any request volume beyond the limits above.
