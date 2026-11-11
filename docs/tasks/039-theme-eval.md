# 039 Theme clustering eval [maintainer runs the live step]

- **Tier:** 2 (a scorer and fixtures, like Task 014). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 031, 032. **Wave:** 4.

## Goal
Measure how well the greedy clustering groups tags at different thresholds, choose the default τ, and keep a replayable check in CI.

## Why it matters
τ decides whether "ai agents" and "agentic ai" share a theme, and whether "insurtech" swallows "pet insurance". Choosing it by measurement, not by feel, makes themes defensible.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 7.1, 13, A26)
- `src/eval/cli.ts`, `src/eval/score.ts` (style), `src/eval/recording.ts`
- `src/pipeline/themes/cluster.ts`, `src/pipeline/embed/openai-embeddings.ts`, `src/pipeline/extract/pricing.ts`

## Files you may create or change
- `src/eval/themes.ts`, `src/eval/themes.test.ts` (new)
- `src/eval/cli.ts` (add `--themes`)
- `fixtures/themes/labelled-tags.json`, `fixtures/themes/README.md` (new)
- `fixtures/themes/recorded/text-embedding-3-small-512.json` (new, from the live step)
- `docs/theme-eval-results.md` (new)
- `src/pipeline/themes/cluster.ts` (only the value of `DEFAULT_THEME_THRESHOLD`)

## Steps
1. **Labelled set.** About 200 lowercase tags in about 25 expected groups, in the style extraction v2 produces. Include near-synonyms ("ai agents", "agentic ai"), spelling variants ("e-commerce", "ecommerce"), broad and narrow pairs ("insurtech", "pet insurance"), and traps that must stay apart ("battery recycling" and "payment rails"). Each tag has a group id and an invented mention count for ordering. No company names. The maintainer reviews the groups before the live run.
2. **Scorer.** `scoreThemes(groupsExpected, assignment)` gives pairwise precision, recall and F1 over same-group pairs, plus the number of themes. `sweep(embeddings, thresholds)` runs `assignGreedy` at τ = 0.40, 0.45 … 0.80.
3. **CLI.** `pnpm eval --themes --live` embeds the labelled tags through the real adapter and the budget guard (purpose `eval`), rounds vectors to 4 decimal places, saves them to `fixtures/themes/recorded/`, and writes `docs/theme-eval-results.md` with the sweep table. `pnpm eval --themes` (replay) uses the recording.
4. **Maintainer.** Run the live step (cost well under $0.001). Pick the τ with the best F1, preferring the higher τ on near ties (fewer wrong merges, D29's reasoning). Set `DEFAULT_THEME_THRESHOLD`, and record the choice in the results file.

## Tests and acceptance criteria
- `pnpm check` passes.
- Scorer unit tests: perfect assignment gives F1 = 1; all-in-one gives precision equal to the share of same-group pairs; all singletons give recall 0.
- `themes.test.ts` replays the recording (once committed) and asserts that F1 at the chosen τ is at least 0.75 (A26). Before the recording exists, the test is skipped with a clear message.
- **Maintainer:** the results file has the sweep, the chosen τ and its F1.

## Out of scope
- Real-data review (045), changing the clustering method.
