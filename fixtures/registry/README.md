# Registry link eval fixtures

`link-cases.json` holds hand-labelled cases for the registry link rules (`src/pipeline/registry/link-rules.ts`). `pnpm eval --links` replays them with no network and writes `docs/link-eval-results.md`. A test (`src/eval/links.test.ts`) requires no wrong automatic link and auto-link recall of at least 50%.

Every company name, number, postcode and filing is invented. No case names a person. Cases use the normalised types from `src/core/registry.ts`, not raw API JSON. Fields left out take the defaults in `src/eval/links.ts` (for example, an active `ltd` company, an `SH01` filing, a `day`-precision `funding_round`).

The set is not a sample of real data. It over-represents hard cases: short brand names, trading names, holdings companies, dormant and dissolved namesakes, re-registered companies, shared addresses, two companies wanting one number, previous names, Scottish and Northern Irish numbers, and Form D filings.

## Labelling rule

A case is labelled linked only when a careful person with the same facts would be sure. Otherwise it is labelled `candidates` (worth a look) or `none`. The label says what is true, not what the rules do: a correct link that the rules send to review stays labelled as a link, and counts against recall.

## Changing cases

Do not edit a label to raise the score. If a case fails, fix a rule, keep the case, and note the change in the results file. If a label is wrong, say why in the commit. A wrong automatic link found on real data becomes a new case here.
