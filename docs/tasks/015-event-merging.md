# 015 Event merging and canonical fields

- **Tier:** 3 (the core merging logic; mistakes duplicate or wrongly merge rounds). **Suggested model:** Claude Opus.
- **Depends on:** 009, 010, 012. **Wave:** 5.

## Goal
Turn one stored extraction into resolved, deduplicated events. The steps are:
1. post-process the raw LLM output;
2. resolve the company and investors (Task 012);
3. match an existing event or create a new one;
4. link the source;
5. recompute the event's canonical fields from all its sources;
6. apply FX conversion.

## Why it matters
This is where five articles about the same raise become one funding round. Accuracy here decides whether every count and trend later on can be trusted.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 5, 6, 7 in full)
- `docs/decisions.md` (D8, D11, D12, D13, D16)
- `src/core/extraction-schema.ts`, `src/core/enums.ts`, `src/core/domain.ts`, `src/core/ports.ts`
- `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`
- `src/lib/money.ts`, `src/lib/normalise.ts`
- `src/pipeline/store/extractions.ts`, `src/pipeline/store/fx-rates.ts`
- `src/pipeline/resolve/types.ts`, `src/pipeline/resolve/company-matcher.ts`, `src/pipeline/resolve/investor-matcher.ts`, `src/pipeline/resolve/testing.ts`

## Files you may create or change
- `src/pipeline/resolve/post-process.ts`, `src/pipeline/resolve/post-process.test.ts`
- `src/pipeline/resolve/event-matcher.ts`, `src/pipeline/resolve/event-matcher.test.ts`
- `src/pipeline/resolve/canonicalise.ts`, `src/pipeline/resolve/canonicalise.test.ts`
- `src/pipeline/resolve/resolve-extraction.ts`, `src/pipeline/resolve/resolve-extraction.test.ts`

## Requirements
- **`post-process.ts`:** `postProcess(result: ExtractionV1, item: { title, summary, url, publishedAt })` returns normalised events. It:
  - drops domains not found by `domainAppearsIn`;
  - turns `amountText` and `priceText` into `Money` via `parseAmountText`;
  - uppercases country codes and drops invalid ones;
  - normalises and dedupes tags;
  - drops investors with empty names;
  - drops events whose company name is empty;
  - returns nothing when `isRelevant` is false.

  It is a pure function.
- **`event-matcher.ts`:** `findMatchingEvent(db, { type, companyId, date, roundType, amountUsdMinor, acquirerCompanyId, productName, url })` returns an event id or `null`, applying the windows and rules from spec section 7. Also export `corroboratesFor(db, incomingEvent)`, which returns the `Corroboration` callback that `resolveCompany` needs.
- **`canonicalise.ts`:**
  - `recomputeEvent(db, eventId, fx: { getRatesOnOrBefore })` loads every `event_sources` row with its extraction result, item date and source priority. It recomputes every canonical field by the rules in spec section 7: majority non-null, then source priority, then earliest item. That includes the detail-table fields, the investor union and lead flags (rewriting `event_investors`), `announced_on`, `date_precision` and `source_count`.
  - It fills USD/GBP columns with `convertMinor`, using the rate on or before `announced_on`. If no rate is stored, it leaves them null for the FX step (Task 019) to fill later.
  - Rerunning it with the same sources produces an identical row.
  - Also export `recomputeEventsForCompany(db, companyId, fx)`, which Task 020 uses.
- **`resolve-extraction.ts`:** `resolveExtraction(db, extractionId, { fx })`, run inside a single transaction. It:
  1. loads the extraction;
  2. if the item had an older extraction linked to events, deletes those `event_sources` links, recomputes the affected events, and deletes events left with zero sources;
  3. post-processes;
  4. for each event: resolves the company (and for acquisitions, the acquirer as a company), resolves the investors, finds or creates the event plus its detail row, inserts the `event_sources` link, and recomputes;
  5. sets the company status to `acquired` for acquisition targets;
  6. marks the extraction resolved.

  It is idempotent: running it twice changes nothing.

## Acceptance criteria
- `pnpm check` passes.
- Scenario tests with PGlite and builders from `testing.ts`:
  1. three extractions from different sources about the same seed round (one with lead investors, one in GBP, one without an amount) give one event, `source_count` 3, the union of investors, a correct lead and the majority amount;
  2. the same company raising a seed round and then a Series A four months later gives two events;
  3. a seed round and a Series A in the same week with different amounts give two events;
  4. a roundup extraction with three raises gives three companies and three events;
  5. an acquisition creates both companies and sets the target to `acquired`, and a second report merges into the same event;
  6. an irrelevant extraction creates nothing and is marked resolved;
  7. resolving the same extraction twice is a no-op;
  8. re-extraction where the new result names a different round type re-links the event and recomputes it, deleting an orphaned event;
  9. arrival order doesn't matter: resolving A, B, C and resolving C, B, A give identical canonical rows;
  10. with FX rates present, the USD/GBP columns are filled with values hand-checked against the fixture rates.

## Out of scope
- Manual merges (020), the pipeline loop and batch FX fetching (019), UI.
