# 032 Theme clustering, assignment and naming

- **Tier:** 3 (clustering choices shape every trend view). **Suggested model:** Claude Opus.
- **Depends on:** 024, 025, 027. **Wave:** 3.

## Goal
Assign embedded tags to themes with the greedy centroid method, name new themes with batched LLM calls, and provide the functions behind the `pnpm themes` manual tool.

## Why it matters
Themes are the unit of every trend. They must be stable (saved searches will reference them), explainable, cheap to update, and correctable by a person.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (section 7, A26)
- `docs/decisions.md` (D14, D34, D35)
- `src/core/ports.ts`, `src/core/sectors.ts`, `src/core/json-schema.ts`, `src/core/enums.ts`
- `src/db/schema.ts` (`tags`, `company_tags`, `themes`, `tag_themes`)
- `src/pipeline/extract/extract-item.ts` (the budget pattern), `src/pipeline/extract/pricing.ts`
- `src/pipeline/resolve/slugs.ts`, `src/lib/normalise.ts`

## Files you may create or change
- `src/pipeline/themes/cluster.ts`, `src/pipeline/themes/cluster.test.ts` (new; pure)
- `src/pipeline/themes/stoplist.ts`, `src/pipeline/themes/stoplist.test.ts` (new)
- `src/pipeline/themes/assign-themes.ts`, `src/pipeline/themes/assign-themes.test.ts` (new)
- `src/pipeline/themes/name-themes.ts`, `src/pipeline/themes/name-themes.test.ts` (new)
- `src/pipeline/themes/theme-admin.ts`, `src/pipeline/themes/theme-admin.test.ts` (new)
- `src/pipeline/themes/testing.ts` (new: vector and theme builders)

## Steps
1. **`cluster.ts` (pure):** `export const DEFAULT_THEME_THRESHOLD = 0.6` (Task 039 tunes it), `cosine`, `normalise`, `meanCentroid`, and `assignGreedy({ tags, themes, threshold })`. Tags arrive in the spec's order (mentions descending, then slug). The function returns the assignments and new themes, updating centroids after each assignment. Ties on similarity go to the lower theme id. It is deterministic.
2. **`stoplist.ts`:** a short list of generic tags never themed ("startup", "startups", "technology", "tech", "innovation", "platform", "funding", "investment", "company", "business", "app", "solutions"). No company or place names. Exported as a function `isGenericTag(slug)`.
3. **`assign-themes.ts`:** `assignThemesStep({ db, model, threshold })`:
   - load active themes with centroids from the same `embedding_model`;
   - load embedded tags with no `tag_themes` row, skipping generic ones, with total mentions;
   - run `assignGreedy`;
   - in one transaction, insert `tag_themes` rows (`assigned_by = auto`, similarity), create new themes (slug from the tag slug via `allocateSlug`, name = tag label, `name_source = tag`, `seed_tag_id`), and update centroids;
   - never change a tag that already has a link, manual or auto.
4. **`name-themes.ts`:** `nameThemesStep({ db, llm, budget, model, maxThemes, runId })`:
   - pick active themes with `named_at IS NULL` and at least 2 companies;
   - batch up to 20 per call, sending the top 8 tags each;
   - strict output `{ themes: [{ id, name, sector }] }` with Zod: name 2-40 characters, sector in `SECTORS`;
   - prompt version `theme-names-v1`; the prompt asks for sentence case, British English, 2-4 words, and no company names;
   - budget check before and usage record after each call, purpose `theme_naming`;
   - skip any theme with `name_source = manual`; ignore output ids that were not sent;
   - set `name`, `sector`, `name_source = llm`, `named_at`.
5. **`theme-admin.ts`:** `listThemes`, `renameTheme`, `setThemeSector`, `mergeThemes`, `moveTag` (to a theme or to none), `suggestMerges(threshold + 0.1)`, as in spec section 7.3. Merges follow chains, refuse self-merges and merges into merged themes, and recompute the surviving centroid. Every change sets `reviewed_at`.

## Tests and acceptance criteria
- `pnpm check` passes. Tests use the fake LLM and the fake embedding vectors; no network.
- `assignGreedy`:
  - three tight synthetic groups produce three themes;
  - a tag just below the threshold starts a new theme and one just above joins;
  - shuffled input in the same mention order gives identical output.
- Assign step (PGlite):
  - a second run is a no-op;
  - manual links and `theme_id = null` links survive;
  - generic tags are skipped;
  - slug collisions get `-2`.
- Naming:
  - batches of 20;
  - manual names are never overwritten;
  - an invalid sector or over-long name fails validation and leaves the theme unnamed for the next run;
  - a budget refusal stops cleanly;
  - usage rows have purpose `theme_naming`.
- Admin:
  - merge moves links and sets `merged_into_id`;
  - filters on the old slug resolve to the survivor through a helper `resolveThemeSlug`;
  - `moveTag` to none creates a null link that auto-assignment respects.

## Out of scope
- The CLI wrapper and wiring (043), threshold tuning (039), company and weekly stats (033).
