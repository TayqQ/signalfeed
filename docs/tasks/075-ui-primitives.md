# 075 UI primitives and semantic tokens

- **Tier:** 2. **Suggested model:** Claude Sonnet.
- **Depends on:** 074. **Wave:** UX 1 (parallel with 076).

## Goal
The shared building blocks every view and page uses (`docs/design/design-system.md` sections 3 and 4), plus semantic colour utilities, and a private page that shows them all in both themes. No page uses them yet.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` (all)
- `docs/design/brand/brand.md`
- `src/app/globals.css`
- `src/components/confirmed-marker.tsx` and its test
- `src/lib/format.ts`, `src/lib/money.ts`
- `src/core/sectors.ts`
- The prototypes `docs/design/directions/a-terminal.html` and `c-prospector.html`, for how the chips, amounts and badges should look. Treat them as a visual reference only; don't copy their code.

## Files you may create or change
- `src/app/globals.css`: add the semantic utilities in section 3 to `@theme inline`; keep every existing name.
- `src/components/ui/*.tsx` and `src/components/ui/*.test.tsx` (new): the components in section 4.
- `src/lib/stage.ts`, `src/lib/stage.test.ts` (new): `stageBucket(roundType)`, the only copy of the stage-to-colour mapping.
- `src/components/confirmed-marker.tsx` and its test: make it render `ui/ConfirmedMark`, or re-export it, so existing pages pick up the new look; existing tests must still pass.
- `src/app/ui/page.tsx` (new): a gallery of every component in every state. Return `notFound()` when `process.env.VERCEL_ENV === "production"`, and set `robots: noindex`.
- `src/app/globals.test.ts`: extend the contrast checks to the token pairs the components use.
- `docs/tasks/README.md` (the 075 row only).

## Steps
1. **Semantic utilities.** Add the names in section 3 of the spec (for example `bg-surface-sunk`, `text-muted`, `border-line`, `bg-up-soft`, `text-accent-ink`, `bg-data-3`, `bg-stage-seed`), all pointing at the existing variables.
2. **Components.** Build every component in section 4 with the props and states listed there.
   - Server components where possible. `SegmentedControl`, `Popover` and `Sheet` are client components.
   - No component fetches data.
   - `Popover` and `Sheet` must trap focus, close on Escape and outside click, and return focus to their trigger. Use the native `<dialog>` element if that keeps the code small. Don't add a library.
3. **Stage mapping.** `StageChip` takes a `RoundType` plus an optional label and picks the colour bucket:
   - early: pre-seed;
   - seed: seed;
   - venture: Series A and B;
   - late: Series C, D+ and growth;
   - other: debt, grant and unknown.
4. **Gallery.** `/ui` shows each component in all of its states, with long and missing values, in a grid. It includes a theme toggle (the existing one). It is the reference for later tasks.

## Tests and acceptance criteria
- Unit tests for each component:
  - text and fallback states ("Undisclosed", "Sector pending", "Place not known");
  - that `StageChip` and `ConfirmedMark` never rely on colour alone (the text is present);
  - `RelativeDate` boundaries (today, yesterday, 14 days);
  - that `SegmentedControl` arrow keys move the selection;
  - that `Sheet` closes on Escape and returns focus.
- The contrast test covers every text-on-background pair used.
- `pnpm check` and `pnpm build` pass. The `/ui` page renders in light and dark, at 375 and 1280 px, with no horizontal scroll.

## Out of scope
- Changing any page other than through `confirmed-marker`.
- Deleting the old remapped names (task 081).
- Any commit. The maintainer commits outside working hours.
