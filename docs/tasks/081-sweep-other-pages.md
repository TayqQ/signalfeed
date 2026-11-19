# 081 Move the other pages onto the system, and remove the old colour names

- **Tier:** 1-2 (mechanical, page by page). **Suggested model:** Claude Sonnet.
- **Depends on:** 075. Best after 079, so the shared row components exist. **Wave:** UX 5.

## Goal
These pages keep their structure but use the 075 primitives and the semantic colour utilities, so the whole site matches:
- trends;
- investors and investor detail;
- acquisitions;
- themes and theme detail;
- about;
- status;
- not-found and error.

Then the remapped `zinc-*`, `blue-*`, `amber-*`, `red-*` and `emerald-*` names are deleted from `globals.css`.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 3, 4 and 6
- `src/app/globals.css`
- each page listed above and the components it uses

## Files you may create or change
- `src/app/trends/**`, `src/app/investors/**`, `src/app/acquisitions/**`, `src/app/themes/**`, `src/app/about/**`, `src/app/status/**`, `src/app/not-found.tsx`, `src/app/error.tsx`
- These components and their tests:
  - `src/components/acquisitions-table.tsx`
  - `investor-activity-table.tsx`
  - `rising-themes-table.tsx`
  - `early-momentum-table.tsx`
  - `theme-header.tsx`
  - `theme-leaders.tsx`
  - `charts/*`
- `src/app/globals.css`: delete the remapped names only once `grep` finds no user.
- `scripts/screenshots.ts`: add one screenshot per page at 375 px.
- `docs/tasks/README.md` (the 081 row only)

## Steps
1. Page by page, swap the old colour classes for semantic ones. Use `StageChip`, `Amount`, `PlaceBadge`, `RelativeDate` and `Monogram` wherever a page shows those facts. Use `RoundList` where a page lists funding rounds (for example investor detail).
2. Tables that scroll sideways on phones become stacked rows, following the `RoundList` pattern.
3. Charts use `RankedBars` where they show a ranking; keep the existing charts otherwise, but on the `data-*` tokens.
4. **Money format.** Switch every remaining `formatMoneyCompact` call (for example "£8.2M") to `formatMoneyShort` (the house style, for example "£8.2m"), then delete `formatMoneyCompact` and its tests once nothing imports it. Also relabel the deal-size bands in `src/lib/size-bands.ts` to the house style ("£1m–£5m", "Under £1m", "£100m+"); the labels change but the URL values must not. Add `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/size-bands.ts` and `src/lib/size-bands.test.ts` to the files you may change for this step only.
5. When no file uses an old name (`grep -rnE "(zinc|blue|amber|red|emerald)-[0-9]" src` is empty), delete the remapped block and its comment from `globals.css`.

## Tests and acceptance criteria
- The existing page tests stay green, updated only for changed classes or text.
- No horizontal page scroll at 375 px on any page. Screenshots in both themes.
- The `grep` in step 5 is empty, `formatMoneyCompact` is gone, and the remapped block is gone.
- `pnpm check` and `pnpm build` pass.

## Out of scope
- New features on these pages.
- Any commit.
