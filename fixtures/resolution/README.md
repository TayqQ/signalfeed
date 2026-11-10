# Resolution eval fixtures

`cases.json` is a hand-written set of reports that tests company and event merging. It uses invented company names and synthetic extractions, so it needs no LLM and no publisher text. It is not a sample of real news. It deliberately over-represents hard cases, such as common names and near-identical names.

Each report has a gold `companyKey` and `eventKey`. Two reports with the same key should end up on the same record. `pnpm eval --resolution` runs them through the real resolver in order and scores every pair of reports.

Do not edit a gold key to raise the score. If a case is wrong, say why in the commit.
