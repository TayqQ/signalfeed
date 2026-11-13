# Companies House API fixtures

Source: the Companies House Public Data REST API (`https://api.company-information.service.gov.uk`), fetched on 12 November 2026 for Task 049 with a live REST key (14 requests). Credit: Companies House.

Files:

- `search.json`: `GET /search/companies?q=...&items_per_page=100`, cut to 5 items (active and dissolved).
- `profile-active.json`, `profile-dormant.json`, `profile-dissolved.json`: `GET /company/{number}`. The dormant one has `accounts.last_accounts.type` = `dormant`. The dissolved one has `date_of_cessation`.
- `filing-history-capital.json`: `GET /company/{number}/filing-history?category=capital`, cut to 6 items (SH01 allotments plus SH19, SH10 and SH20 items).
- `advanced-search-location.json`: `GET /advanced-search/companies?location=<postcode>&company_status=active&size=1`. The total is `hits`.

What was changed:

- Every company name, previous name and address line is invented, as are postcodes (valid format only), company numbers (8 characters), the document links, barcodes and transaction ids. Etags are fake hashes.
- Trimmed to the fields the spec uses. Unused real fields were dropped (confirmation statement, `last_full_members_list_date`, next accounts and so on). `profile-active.json` carries one made-up field (`x_unknown_future_field`) so parsers prove they ignore unknown fields.
- Officer, PSC and charges links, and document links, were removed. No person is named anywhere.
- Dates, SIC codes, statuses, types and share-capital figures are kept as returned.
- Fixtures are real responses reshaped, not complete ones. Real responses carry more fields than these.

All names, addresses and identifiers in these files are invented. Any match with a real company is a coincidence. Never put the API key in a fixture.
