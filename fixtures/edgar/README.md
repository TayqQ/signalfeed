# EDGAR fixtures

Trimmed, anonymised samples for the Form D parser and index parser (Task 055). Tests must never touch the network.

## Source and date

- Daily form index `https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/form.20261110.idx` (business day 10 November 2026), fetched 12 November 2026.
- Three `primary_doc.xml` Form D filings (schema X0708) fetched the same day from `https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/primary_doc.xml`: an operating company (form D), an amendment (D/A) and a pooled investment fund (form D, `Pooled Investment Fund`, Venture Capital Fund).
- Requests were sent with `User-Agent: SignalFeed/0.3 (+signalfeed@taylorhallin.com)`, at most one a second.

## Files

- `form-index.idx`: the real header and column layout, 11 invented rows: non-Form-D forms, `D`, `D/A`, and look-alike types (`DEF 14A`, `DRS`) that a parser must not treat as Form D. The real file is sorted by form type; so is this one.
- `form-d-company.xml`: new filing, first sale `yetToOccur`, offering `Indefinite`, `yearOfInc` within five years.
- `form-d-amendment.xml`: D/A with `previousAccessionNumber`, `overFiveYears`, a first-sale date, a total sold, a previous EDGAR name and a non-US state code (`A1`).
- `form-d-fund.xml`: `industryGroupType` `Pooled Investment Fund` with `investmentFundInfo`. This is the case the collector skips and counts.

## What was changed

- Every company name, previous name, address, CIK and accession number is invented (CIKs 1999001-1999003, 1999101-1999108). Amounts, dates, state codes, exemption codes, and the field structure are as filed.
- Every person name is invented ("Example Person One" to "Example Person Five"), including `relatedPersonsList`, `salesCompensationList` recipients and the signature block, so tests can prove no name is stored. Broker-dealer names are invented too.
- Phone numbers are removed. `useOfProceeds`, free-text clarifications and similar fields were dropped. Some fields the spec does not use were kept (`issuerSize`, `durationOfOffering`, `minimumInvestmentAccepted`, `salesCommissionsFindersFees`, `businessCombinationTransaction`, `signatureBlock`) so parsers prove they ignore extras.
- The three sampled filings had empty `salesCompensationList` elements. The `recipient` structure used in the amendment and fund fixtures was copied from a fourth real filing seen during the check (a private equity fund, not stored here) with all names, addresses and numbers replaced by invented ones.
- `form-index.idx` keeps the real header text (including the SEC webmaster address in the header).

All names in these files are invented. Do not add real filings here.
