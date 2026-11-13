# 055 EDGAR client and Form D parser

- **Tier:** 2 (an API client and a structured XML parser). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 048, 049. **Wave:** 2.

## Goal
Fetch EDGAR daily form indexes and Form D `primary_doc.xml` files within SEC fair access rules, and parse them into `FormDFacts`, reading organisation fields only.

## Why it matters
Form D is the structured, free source for US raises (spec-phase3 section 8). The parser is where personal data could leak in: related persons and sales recipients sit in the same XML, so the parser must never read them.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 8.1, 8.2, A39-A42)
- `docs/sources.md` ("Phase 3 sources", as updated by 049)
- `fixtures/edgar/README.md` and its fixtures
- `src/core/ports.ts`, `src/lib/http.ts` (`buildUserAgent`), `src/core/registry.ts`
- `fast-xml-parser` usage in `src/pipeline/collect/parse-feed.ts`

## Files you may create or change
- `src/pipeline/filings/form-index.ts`, `src/pipeline/filings/form-index.test.ts` (new)
- `src/pipeline/filings/form-d-xml.ts`, `src/pipeline/filings/form-d-xml.test.ts` (new)
- `src/pipeline/filings/edgar-client.ts`, `src/pipeline/filings/edgar-client.test.ts` (new)
- `src/pipeline/filings/testing.ts` (new: a fake `EdgarClient` from fixtures, for 057)

## Steps
1. **`form-index.ts`:** `parseFormIndex(text)` reads the fixed-width `form.<yyyymmdd>.idx` (skip the header block up to the dashed line), returning rows `{ formType, companyName, cik, dateFiled, fileName }`. `formDRows(rows)` keeps `D` and `D/A`. `accessionFromFileName(fileName)` gives the accession number.
2. **`form-d-xml.ts`:** `parseFormD(xml)` with `fast-xml-parser`, then Zod, returning `FormDFacts` plus `isFund` (industry group "Pooled Investment Fund") and the amendment link.
   - Read only: `primaryIssuer` (CIK, entity name, entity type, jurisdiction of incorporation, `yearOfInc` value and within-five-years flag, city and state of the principal place of business), `offeringData` (industry group, federal exemptions, type of filing with `isAmendment`, `previousAccessionNumber` and `dateOfFirstSale` or `yetToOccur`, types of securities, `offeringSalesAmounts` total offering and total sold, investors already invested).
   - Never read `relatedPersonsList`, `salesCompensationList`, phone numbers or street lines. Do not even map them into an intermediate object: strip those elements from the parsed tree before validation.
   - "Indefinite" offering amounts become null. Dollar amounts become cents.
3. **`edgar-client.ts`:** `createEdgarClient({ http, contact, sleep, clock })`:
   - refuses to start unless `contact` contains an email address (SEC fair access);
   - `getFormIndex(day)`: the daily index URL; 404 returns `missing`;
   - `getFormD(cik, accession)`: `/Archives/edgar/data/<cik>/<accession without dashes>/primary_doc.xml`;
   - at most 5 requests a second (injectable sleep), `Accept-Encoding: gzip, deflate`, User-Agent from `buildUserAgent(contact)`;
   - on 429 or 403 (SEC's throttling response), wait 10 minutes once, then throw;
   - a request counter.

## Tests and acceptance criteria
- `pnpm check` passes. Fixtures through a fake `HttpFetcher`; no network.
- The index parser handles the header, wide company names and `D/A`.
- The company, amendment and fund fixtures parse; the fund is flagged; "Indefinite" becomes null; amounts are cents.
- **No name from `relatedPersonsList` or `salesCompensationList` appears anywhere in the parsed result** (serialise it and search for each invented name).
- The client never makes more than 5 requests in any second (fake clock), and refuses a contact with no `@`.

## Out of scope
- Storing filings and linking (057).
