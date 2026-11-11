# Theme eval fixtures

`labelled-tags.json` holds 215 lowercase tags in the style extraction v2 produces. Task 039 uses them to choose the theme threshold τ (`DEFAULT_THEME_THRESHOLD`), and D47 to choose the LLM check bands (`DEFAULT_THEME_BANDS`).

## File format

An array of objects:

| Field      | Meaning                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `tag`      | The tag text, lowercase, unique across the file                            |
| `group`    | Expected group id. Tags with the same id should end up in the same theme   |
| `mentions` | Invented mention count. It only sets the order the clustering sees tags in |

There are no company names. Mention counts are made up.

## The grouping rule

A group is one market: the level a founder would name in one phrase, such as "heat pumps", "pet insurance" or "ai agents". Apply these checks in order.

1. **Same product or service, same group.** Tags share a group when they are about the same product or service, even if the companies play different roles in it. Making, installing, financing, maintaining or writing software for solar panels is all "solar". Synonyms, spelling variants and abbreviations ("baas" and "banking as a service") always share a group.
2. **A different product or service is a different group,** even when the tags share a word or a sector. "Payment orchestration" and "agent orchestration" are apart. So are "battery recycling" and "battery storage", and "claims automation" and "pet insurance".
3. **Sector words are not markets.** Words that span many products ("insurtech", "proptech", "edtech", "food tech", "agritech", "space tech", "construction tech", "digital health", "logistics") group only with their own synonyms. They do not absorb the markets inside them.
4. **A group may hold one tag.** It then tests that the tag stays apart from its neighbours.

The rule is about what the tags mean, not about how close their embeddings are. Do not move a tag because the clustering puts it somewhere else.

## What the groups test

- **Near-synonyms:** "ai agents" and "agentic ai" share a group. So do "cyber security" and "cybersecurity", and "llmops" and "llm ops".
- **Spelling variants and abbreviations:** "e-commerce" and "ecommerce"; "baas" and "banking as a service".
- **Roles in one market:** "solar financing" and "rooftop solar"; "turbine maintenance" and "offshore wind".
- **Broad and narrow:** "insurtech" and "pet insurance" are separate groups. Pet insurance is a market of its own; insurtech is a sector word (check 3).
- **Traps that must stay apart:** "battery recycling" and "payment rails", "battery recycling" and "battery storage", "solar panels" and "offshore wind", "ai agents" and "llmops", "neobank" and "embedded finance", "space tech" and "construction tech".

## Recording

Each tag is embedded as `tagEmbeddingInput(tag)` from `src/pipeline/embed/embed-tags.ts`, the same text production embeds (D46). The recording's file name and its `template` field carry `TAG_EMBEDDING_TEMPLATE`, so a recording made with another template is never scored.

`recorded/text-embedding-3-small-512-market-v1.json` holds one 512-dimension vector per tag, rounded to 4 decimal places. Do not edit it by hand. The maintainer makes it with:

```
pnpm eval --themes --live
```

`recorded/text-embedding-3-large-512-market-v1.json` is the same set embedded with the larger model, for comparison (D46). `pnpm eval --themes [--live] --model text-embedding-3-large` scores or remakes it and prints the sweep without changing the report.

`recorded/text-embedding-3-small-512.json` is the earlier recording of the bare tags, from before D46. Nothing reads it. It is kept as the baseline in D46 and can be deleted.

`pnpm eval --themes` scores the current recording with no network. `src/eval/themes.test.ts` does the same in CI and is skipped while the recording is missing.

## LLM check verdicts

Tags in the similarity band are placed by an LLM verdict (D47). `recorded/check-<model>-<prompt version>-<embedding recording>.json` holds the verdicts, so the full method replays for free and gives the same result every time.

- The file name carries the check model, `THEME_CHECK_PROMPT_VERSION` and the embedding recording. The file also stores a hash of the system prompt and schema, and a file with another hash is refused. Bump the version with any prompt change.
- Each verdict is keyed by the exact question the LLM saw: the tag and each candidate theme's top tags (`bandQuestionKey`). A change of band, embeddings or theme contents that changes a question finds no verdict. The replay reports it as missing and never guesses.
- A verdict is the chosen candidate's index from 0, or `null` for none.
- `questions`, `invalid` and the token and cost totals count every paid call, including answers that were cut off and so gave no verdict.

Do not edit it by hand. The maintainer adds missing verdicts for the band grid with:

```
pnpm eval --themes --check --live [--low <τ>... --high <τ>...] [--rounds <n>]
```

Without `--low` and `--high` it covers `THEME_BAND_GRID`. It asks one pass of the method at a time, as production would, saves after every paid round and stops at $0.05 a run.

`recorded/check-gpt-5.6-luna-theme-check-v1-….json` holds the verdicts from the first prompt. Its totals include 400 questions whose answers were cut off. Nothing reads it. It is kept as the baseline in D47 and can be deleted.

`recorded/merge-trial-gpt-5.6-luna.json` holds the answers from the merge-check trial in D47. The check was not built, and nothing reads the file. Its token counts are included in the v2 verdicts file's totals; its calls, questions and cost are not.
