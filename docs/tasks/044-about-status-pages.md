# 044 About and status page updates

- **Tier:** 1 (content and a small query). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 036, 038. **Wave:** 5.

## Goal
Document the Phase 2 methods on `/about`, and show the new pipeline state on `/status`.

## Why it matters
Trend scores, themes, locations and grants are only trustworthy if the method and the limits are public. Attribution for GtR and OS/ONS data is a licence condition.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 7-10, 12, 14)
- `docs/sources.md` (Phase 2 sections, attribution wording)
- `src/app/about/page.tsx`, `src/app/status/page.tsx`, `src/db/queries/status.ts`
- `src/core/read-models.ts`, `src/core/domain.ts`

## Files you may create or change
- `src/app/about/page.tsx`
- `src/app/status/page.tsx`
- `src/db/queries/status.ts`, `src/db/queries/status.test.ts` (new)

## Steps
1. **About**, with anchors:
   - `#themes`: how tags become themes, that names are suggested by a model and reviewed by a person, and what sectors are;
   - `#rising-score`: the formula in words, α = 3, the windows, an example, and that grants are excluded;
   - `#momentum`: equity rounds only, "first recorded" not "first ever", and the 36-month step-up basis;
   - `#locations`: ITL1 regions, towns and postcode districts, what "near" can and cannot do, and coverage limits;
   - `#grants`: Innovate UK data from UKRI Gateway to Research, organisations only, amounts are grant offers, with the attribution wording recorded in `docs/sources.md`;
   - attribution for the OS/ONS geography data.
2. **Status query:** add spend this month by purpose (extraction, embedding, theme naming, tagging, eval), tags embedded and pending, active, unnamed and unreviewed themes, grant projects and participants (kept, skipped, unresolved), the last stats and locations rebuild times from `derived_rebuilds`, and the latest grants run.
3. **Status page:** show these in the existing style. Spend stays against the cap.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass with no `DATABASE_URL`.
- `status.test.ts` (PGlite): spend by purpose sums to the month total; theme and grant counts match seeded data.
- The about page links from `/trends` (`#rising-score`) resolve.

## Out of scope
- Other pages (040-042).
