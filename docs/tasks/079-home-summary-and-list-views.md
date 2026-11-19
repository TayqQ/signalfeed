# 079 Home page: summary, quick views, List and Cards, view switch

- **Tier:** 2. **Suggested model:** Claude Opus (the page most people see first).
- **Depends on:** 076, 078. **Wave:** UX 3.

## Goal
The home page from `docs/design/design-system.md` section 2:
- the collapsible "What's happening" summary;
- quick-view tabs;
- the 078 filter bar;
- the rounds in **List** or **Cards**, with a remembered view switch.

Split is prepared for but ships in 080.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 1, 2, 4 and 6
- `docs/design/research.md` sections 3, 7 and 8
- The prototypes `docs/design/directions/b-briefing.html` (summary, cards) and `a-terminal.html` (list), as a visual reference
- `src/app/page.tsx`, `src/components/funding-table.tsx` and its test, `src/components/pagination.tsx`
- `src/db/queries/summary.ts` (076)

## Files you may create or change
- `src/app/page.tsx`
- `src/components/home/*.tsx` and tests (new: `FundingSummary`, `QuickViews`)
- `src/components/rounds/*.tsx` and tests (new: `RoundList`, `RoundCards`, `ViewSwitch`, plus a shared `RoundRowParts` if useful)
- `src/components/funding-table.tsx` and its test (retire it once `RoundList` replaces it everywhere; investor pages may still use it, so check before deleting)
- `src/lib/view-preference.ts` and its test (new: read and write the `raisory_view` and `raisory_summary` cookies, plus the `?view=` override)
- `src/components/pagination.tsx` (restyle only)
- `scripts/screenshots.ts`: add the home page in both views, both themes, at 375 and 1280 px.
- `docs/tasks/README.md` (the 079 row only)

## Steps
1. **Summary.** Implement `FundingSummary` from `getFundingSummary` for the same filters as the list.
   - Headline stats with the change against the previous window (an up or down arrow plus the words, never colour alone).
   - `RankedBars` by £, with a £/rounds toggle.
   - The three biggest rounds.
   - It is collapsible, with the state in the cookie.
   - It says what window it covers.
   - Clicking a sector bar applies that sector filter.
2. **Quick views.** Tabs (All, UK, Confirmed, Seed and Series A, £10m+), each a link to a filter URL with its count. Count them in one grouped query added to `summary.ts` only if 076 didn't already provide the counts; otherwise ask the maintainer. The active tab is the one whose filters exactly match.
3. **`RoundList`** (desktop table):
   - identity (`Monogram`, name, a one-line description with an ellipsis);
   - `StageChip`;
   - `SectorLabel`;
   - `PlaceBadge`;
   - `Amount` (right-aligned, with `ConfirmedMark`);
   - `RelativeDate` with `NewMark`.

   Hovering or focusing a row shows the lead investors. Sortable headers keep the existing sort parameters. Below 768 px each row becomes a stack:
   - line 1: name and amount;
   - line 2: stage and sector;
   - line 3: description;
   - line 4: place and date.
4. **`RoundCards`.** A responsive grid (1, 2 or 3 columns). Each card holds:
   - identity and place;
   - a two-line description;
   - a facts row (amount, stage, sector);
   - a footer with the date and the leads.
5. **View switch.**
   - `ViewSwitch` (List · Cards · Split) sits next to Sort.
   - Split is shown but disabled, with the title "Coming soon", until 080.
   - It reads the server-side cookie so there is no flash. `?view=` overrides it.
   - Changing it sets the cookie and updates the URL without a reload.
   - It is hidden under 768 px.
6. **Empty results.** An `EmptyState` naming the active filters, with "Clear all".

## Tests and acceptance criteria
- `view-preference` covers: the cookie only, `?view` overriding the cookie, an invalid value, and phone fallback rules where testable.
- `RoundList` and `RoundCards` render every fallback state (no amount, no sector, no place, no description).
- Summary tests: an empty window, no previous window, and a sector click giving the right URL.
- No horizontal scroll at 375 px. Screenshots for both views, both themes, both widths.
- `pnpm check` and `pnpm build` pass.

## Out of scope
- Split view (080).
- Other pages (081).
- Any commit.
