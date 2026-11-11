# 025 Phase 2 core contracts

- **Tier:** 3 (shared types that every later task builds on). **Suggested model:** Claude Opus.
- **Depends on:** none. **Wave:** 1.

## Goal
Add the Phase 2 enums, ports, stats types, read models, sector list and environment settings to `src/core`, so later tasks can work in parallel against fixed contracts.

## Why it matters
Like Task 003 in Phase 1, this fixes the shapes before the schema, the pipeline and the pages are written. Changes here later would ripple through many tasks.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 5, 6, 7.2, 8, 9.2, 9.3 and 12)
- `docs/decisions.md` (D25, D34-D44)
- `src/core/enums.ts`, `src/core/ports.ts`, `src/core/domain.ts`, `src/core/read-models.ts`, `src/core/env.ts`, `src/core/env.test.ts`

## Files you may create or change
- `src/core/enums.ts`, `src/core/enums.test.ts` (new)
- `src/core/ports.ts`
- `src/core/domain.ts`
- `src/core/read-models.ts`
- `src/core/env.ts`, `src/core/env.test.ts`
- `src/core/sectors.ts`, `src/core/sectors.test.ts` (new)

Do not touch `src/core/extraction-schema.ts`, `src/core/json-schema.ts` or `src/core/eval-fixture.ts`. Task 024 owns them in this wave.

## Steps
1. **Enums.** Append values: `source_kind` gets `ukri_gtr`; `llm_purpose` gets `theme_naming` and `tagging`; `alias_source` gets `grant`. Add the new enums in spec section 5.1 (`THEME_STATUSES`, `THEME_NAME_SOURCES`, `THEME_ASSIGNED_BY`, `LOCATION_PRECISIONS`, `LOCATION_SOURCES`, `GRANT_ROLES`, `RECORD_KINDS`) with their types. Never reorder or rename existing values. A test asserts that the Phase 1 values still come first, in their original order.
2. **Sectors.** `src/core/sectors.ts` exports `SECTORS` (the slugs in spec section 7.2, in that order), `Sector`, `SECTOR_LABELS` and `isSector()`. The list is append-only, and a comment says so.
3. **Ports.** Add `EmbeddingClient` exactly as in spec section 6.
4. **Domain stats.** Add `GrantCollectStats`, `GrantResolveStats`, `EmbedStats`, `ThemeStats`, `LocationStats` and `DerivedStats` (each with a `skipped?: boolean` where a step can be skipped). Add them to `IngestStats` as **optional** fields, so stats stored by Phase 1 runs still type-check.
5. **Read models.**
   - Split `FundingFilters` into `FundingCriteria` and `FundingView` (`sort`, `direction`, `page`, `pageSize`), with `type FundingFilters = FundingCriteria & FundingView`. Add to `FundingCriteria`: `themes?: string[]`, `sectors?: Sector[]`, `ukRegions?: string[]` (ITL1 slugs), `cities?: string[]`, `near?: { placeSlug: string; km: NearRadiusKm }`, `momentum?: "first" | "repeat"`. Export `NEAR_RADII_KM = [10, 25, 50, 100] as const` and `DEFAULT_NEAR_KM = 25`.
   - `RoundMomentum`: `equityRoundNumber`, `monthsSincePrevious`, `stepUpRatio`, `stepUpBasisOn` (date or null). Add `momentum?: RoundMomentum | null` and `evidence?: EvidenceLevel` to `FundingRow`.
   - Theme read models: `ThemeRef`, `ThemeSummary` (slug, name, nameIsReviewed, sector, companyCount, tagCount), `WeeklyPoint` (weekStart, rounds, earlyRounds, laterRounds, unknownStageRounds, totalGbpMinor), `RisingThemeRow` (theme, recentRounds, baselineRounds, expected, score or null, recentGbpMinor, sparkline: number[]), `EarlyMomentumRow` (theme, recentEarlyRounds, score, lateShare), `ThemeDetail` (summary, tags, weekly, stage mix, redirectToSlug).
   - `AcquisitionRow` (event id, target, acquirer ref or raw name, price, date, precision, target age or null, themes), `AcquirerSummary`, `InvestorActivityRow` (investor ref, led, joined, medianRoundGbpMinor, roundsWithAmount, rounds).
   - `CompanyLocationView` (precision, ukRegion slug or null, place name or null, outcode or null, countryCode). Add optional `themes`, `sectors`, `location` and `roundsInLast24Months` to `CompanyDetail`, and optional `momentum` to `FundingRoundEvent`.
   - New fields on existing read models must be optional, so `pnpm check` stays green until the query tasks fill them.
6. **Env.** Add to `pipelineEnvSchema`: `EMBEDDING_MODEL` (default `text-embedding-3-small`), `MAX_EMBEDDINGS_PER_RUN` (default 2000), `MAX_THEME_NAMES_PER_RUN` (default 20), `MAX_GRANT_TAGGINGS_PER_RUN` (default 200), and an optional `GITHUB_TOKEN`. Add the same to `noLlmPipelineEnvSchema`. Tests cover defaults and invalid values.

## Tests and acceptance criteria
- `pnpm check` passes, and `pnpm build` passes.
- Enum test: Phase 1 values unchanged and first; new values present.
- `isSector` accepts every slug and rejects others.
- A type-level test (or `satisfies` checks in a test file) shows that a Phase 1 `FundingFilters` object literal still type-checks.
- No file outside the list changes.

## Out of scope
- The database schema (027), parsing filters (029), the extraction schema (024).
