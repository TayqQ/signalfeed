# 008 Extraction fixtures [maintainer review]

- **Tier:** 1 (data gathering against a fixed schema). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 001, 003. **Wave:** 3.

## Goal
Create 25-30 real headline cases with expected extraction outputs. The eval (Task 014) uses them to measure accuracy and choose the model.

## Why it matters
Without a fixed, human-checked answer set, nobody can say whether the extractor works, or whether a cheaper model is good enough.

## Read first
- `AGENTS.md`
- `docs/sources.md`
- `docs/spec.md` (sections 6 and 10)
- `docs/decisions.md` (D19, D20)
- `src/core/eval-fixture.ts`, `src/core/extraction-schema.ts`, `src/core/enums.ts`

## Files you may create or change
- `fixtures/extraction/cases.json`
- `fixtures/extraction/README.md`
- `src/eval/fixtures.test.ts`

## Requirements
- Take real headlines and URLs from the **enabled** feeds in `docs/sources.md`: TechCrunch Venture, Tech.eu, EU-Startups and UKTN.
- Do not use Sifted or Crunchbase News headlines. Their terms restrict AI use of the content (`docs/sources.md`, A2 and A14).
- For each case, write `summary` yourself, in 1-3 sentences in your own words, carrying the facts a feed summary would contain. Never paste publisher text.
- The mix:
  - 14-16 funding rounds, covering at least USD, GBP and EUR; at least 5 UK or Europe companies; at least 2 with a named lead; 1 with no amount; 1 with an unusual label such as "seed extension";
  - 3-4 acquisitions;
  - 2 launches;
  - 1 roundup article listing at least 2 raises;
  - 4 irrelevant items (opinion, layoffs, big-tech earnings, event recap);
  - 2 tricky items: "in talks to raise" is not relevant, and a valuation that isn't a raise is not relevant.
- `expected` follows `src/core/eval-fixture.ts`. `amountText` is the verbatim amount phrase. Investors are organisations only.
- `fixtures/extraction/README.md` explains the file format, the rule about writing summaries in your own words, and how to add a case.
- `src/eval/fixtures.test.ts` validates `cases.json` against the schema, checks that ids are unique, and checks the mix (at least 25 cases, at least 4 irrelevant, at least 3 acquisitions).

## Acceptance criteria
- `pnpm check` passes.
- **Maintainer review:** a person reads every case and confirms the expected values against the original article, then ticks this box in the pull request description: "All expected outputs verified by hand".

## Out of scope
- The scorer and runner (014), changes to the schema (003).
