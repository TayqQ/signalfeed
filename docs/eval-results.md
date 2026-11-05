# Extraction eval results

**The live extraction eval has not been run yet.** It needs an OpenAI key and a small amount of prepaid credit. So no accuracy figures exist for extraction, and no default model has been chosen from evidence: `gpt-4.1-nano` is only the starting default.

To run it:

```bash
pnpm eval --live --model gpt-4.1-nano --model gpt-4o-mini --model gpt-4.1-mini
```

It caps itself at $1, records every response in `fixtures/extraction/recorded/`, and replaces this file with the results. Later runs of `pnpm eval --replay` and CI score those recordings without calling the API.

Merging can be measured without a key. See `docs/resolution-eval-results.md`.
