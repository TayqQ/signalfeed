# 067 SH01 document reader prototype [maintainer] _(cuttable; recommended to defer, D55)_

- **Tier:** 3 (paid calls on documents that can hold personal data, and amounts users would trust). **Suggested model:** Claude Opus.
- **Depends on:** 066. **Wave:** 7.

## Goal
Measure whether the amount raised can be read reliably and cheaply from SH01 PDFs, comparing a vision model with free OCR, on 30 documents the maintainer labels. Build regular use only if the measurement and the maintainer say so.

## Why it matters
SH01 metadata confirms that shares were issued, but not for how much (spec-phase3 section 10). Reading the PDF could confirm amounts for UK rounds. It costs money, the PDFs are images, and an SH01 is not always a raise, so this is measured before anything runs on a schedule.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (section 10, A36, A43)
- `docs/decisions.md` (D10, D19, D55, D58)
- `docs/phase3-review.md` (066)
- `src/core/ports.ts` (`LlmClient`), `src/pipeline/extract/openai-client.ts`, `src/pipeline/extract/pricing.ts`, `src/pipeline/budget/budget-guard.ts`
- `src/pipeline/registry/ch-client.ts`

## Files you may create or change
- `src/core/ports.ts` (add optional image or file inputs to `LlmCompleteRequest` only)
- `src/pipeline/extract/openai-client.ts`, `src/pipeline/extract/openai-client.test.ts` (send them; the extraction request body must not change)
- `src/pipeline/registry/ch-documents.ts`, `src/pipeline/registry/ch-documents.test.ts` (new: Document API metadata and content, PDF only)
- `src/pipeline/registry/read-sh01.ts`, `src/pipeline/registry/read-sh01.test.ts` (new)
- `src/eval/sh01.ts`, `src/eval/sh01.test.ts` (new); `src/eval/cli.ts` (`--sh01` only)
- `fixtures/sh01/labels.json`, `fixtures/sh01/README.md` (new)
- `docs/sh01-eval-results.md` (new)

## Steps
1. **Check A43.** Confirm on OpenAI's documentation whether `gpt-5.6-luna` accepts image or PDF input, and its image token rule. If it does not, use the cheapest model that does, and update the cost estimate before going further.
2. **[maintainer] Label 30 SH01s** of linked companies with a recent round: for each, the transaction id and the totals the form states (shares allotted per class, amount paid per share including premium, total). Store **only** the transaction ids and numbers in `fixtures/sh01/labels.json`. **Never commit the PDFs**: page 3 onwards can hold the presenter's name and contact details.
3. **Fetch only pages 1-2** (the allotment table) for reading. Pages with presenter or signature details are never sent to a model or stored.
4. **Vision reader:** one call per document, strict output `{ classes: [{ shares, pricePerShare, currency, paid: boolean, nonCash: boolean }], total }`, through `BudgetGuard` with purpose `document_reading` and a per-document worst-case estimate. Code computes totals (D8).
5. **OCR reader:** Tesseract on the runner (`apt-get install tesseract-ocr poppler-utils`) with a rule-based parser for the same fields. No dependency is added to `package.json`; the eval says if the tools are missing.
6. **`pnpm eval --sh01 --live`** (maintainer machine, key needed, cap $0.25) runs both on the 30 labels and writes `docs/sh01-eval-results.md`: exact-total accuracy, within-5% accuracy, non-cash detection, cost per document, time per document.
7. **Decision point [maintainer].** Only if a reader reaches at least 95% within 5% on the labels: open a follow-up task for regular use, limited to SH01s that confirm a news round, with a £0.25 monthly sub-limit and at most 50 documents a run (spec section 10). Otherwise record "not adopted" in `docs/decisions.md` (maintainer).

## Tests and acceptance criteria
- `pnpm check` passes. Fakes only in tests.
- The extraction request body is byte-for-byte unchanged (existing test).
- A test proves only pages 1-2 are passed to either reader.
- Budget refusal stops the eval cleanly.

## Out of scope
- Creating events from SH01s. Any scheduled reading.
