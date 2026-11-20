# 086 Funding page polish: summary as a closable section, sector dropdown, top bar

- **Tier:** 2. **Suggested model:** Claude Opus.
- **Depends on:** 084 (merged). **Wave:** UX v2 follow-up.

## Why (Taylor's review, 20 November 2026)
1. **Mobile stat tiles:** the "Rounds" tile is shorter than "Raised" and "Median", because the grid is `items-start`. The three tiles should be the same height.
2. **"Get the weekly brief" button:** it leads to About and does nothing useful, and on phones it squeezes the search box. Remove it until the brief exists.
3. **"What's happening" summary:**
   - It sits in a rounded card. When open, it leaves empty space under the stat tiles and under "Biggest rounds". When collapsed, it's a dead bar above the list.
   - It is a section of the page, not a card. Open by default, at the top. A close control removes it from the page entirely, a small button at the top right of the funding page brings it back, and there's an option to keep it hidden by default.
4. **Sector filter:** a long chip row that scrolls sideways isn't needed. Make it a dropdown: a scrollable, multi-select list with the busiest sectors first.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 1, 2, 4 and 8
- `src/app/page.tsx`
- `src/components/home/*` (`funding-summary.tsx`, `summary-disclosure.tsx`, `sector-bars.tsx`, `quick-views.tsx`)
- `src/components/filters/*` (`filter-form.tsx`, `filter-controls.tsx`, `sector-chips.tsx`, `applied-chips.tsx`)
- `src/components/shell/top-bar.tsx`, `src/components/ui/*` (Popover, Sheet, Button)
- `src/lib/view-preference.ts` (how `raisory_summary` is read today), `src/db/queries/summary.ts`, `src/lib/cached.ts`

## Files you may create or change
- `src/app/page.tsx`
- `src/components/home/*` and tests
- `src/components/filters/*` and tests
- `src/components/shell/top-bar.tsx` and its test (remove the brief button only)
- `src/lib/view-preference.ts` and its test (summary preference)
- `src/db/queries/summary.ts` and its test (a sector-count query), `src/lib/cached.ts` (its cache wrapper only)
- Do **not** edit `docs/tasks/README.md`.

## Steps
1. **Tiles.** On narrow widths the three stat tiles stretch to equal height (`items-stretch` for that row), while the wide layout keeps tiles from stretching to the sector list's height.
2. **Top bar.** Remove "Get the weekly brief". Search takes the freed width; on phones it fills the bar beside the logo mark.
3. **Summary section.**
   - **Not a card.** No border, radius or panel background around the whole section; it sits on the page background. Its inner blocks (stat tiles, sectors, biggest rounds) may keep their light panels.
   - **Header row:** the title "What's happening", the window caption ("All rounds we hold" or the date range), and at the right a close button (an icon with `aria-label="Hide summary"`).
   - **Layout without dead space:**
     - From `xl`: two columns. The left holds the three stat tiles in a row, with "Biggest rounds" under them. The right holds "Where the money went".
     - Between `md` and `xl`: the stat tiles in a row, then sectors and biggest rounds side by side.
     - On phones: stat tiles in a row, then sectors, then biggest rounds.
     - The two columns should end at about the same height; check with real data.
   - **Closing** removes the whole section, including its header, from the page, leaving no bar. It sets a session cookie `raisory_summary=closed` (no `Max-Age`), so it stays closed while browsing this session.
   - **Bringing it back:** when the summary is hidden, a small button at the top right of the funding page's toolbar (beside the quick views, or right-aligned above the filters), labelled "Show summary" with a small chart icon, opens it again and clears the session cookie.
   - **"Keep hidden by default":** a small text link or checkbox in the summary's header (next to the close button) sets the persistent `raisory_summary=hidden` cookie (one year). With that set, the page loads with the summary hidden, and "Show summary" opens it for this visit. Unticking it, or a "Show by default" option reached from the same place, removes the persistent cookie.
   - **Server-rendered from the cookies,** so there's no flash. Update `view-preference` with tests for open, closed for the session, and hidden by default.
4. **Sector dropdown.**
   - Replace the sector chip row with one control: a button labelled "Sector" (or "Sector: Fintech", or "Sectors (2)"). It opens a `Popover` (a `Sheet` on phones, inside the existing filter sheet) with a search box and a scrollable checkbox list of every sector, each with its round count.
   - **Order:** by rounds in the **last 90 days**, highest first; ties alphabetical; sectors with none at the end. Why 90 days:
     - a week or a month is too few rounds to rank reliably (history starts in late October 2026, and there are only a few rounds a day);
     - a year would rank by the past, not the present;
     - 90 days matches the "Last 90 days" date preset and a business quarter, which is how investors and sellers think about deal flow.

     Show "Ranked by rounds in the last 90 days" as a small caption in the list.
   - **Counts** come from one new query, `getSectorCounts(db, { days: 90 })` (cached like the others), independent of the other active filters, so the order doesn't jump around as you filter.
   - Selecting stays multi-select, and the URL parameters don't change (`sector=`). Applied sectors still show as removable chips.
   - The theme second level (when exactly one sector is chosen) moves into the same dropdown, under the chosen sector.
   - It must still work without JavaScript: in the GET form, a `<details>` with the same checkbox list.
5. Remove anything left unused (the chip row component and the old summary disclosure), with their tests.

## Tests and acceptance criteria
- Unit tests: `getSectorCounts` ordering and ties; the dropdown's label states; selection writes the same URLs as before (reuse the 078 old-URL test); the summary cookie states; the brief button is gone.
- **In the browser,** at 1440, 1100, 800 and 375 px, light and dark, with real data:
  - no sideways scroll;
  - the summary has no card frame and no big empty areas;
  - close removes it, "Show summary" brings it back, and "keep hidden" survives a reload;
  - the sector dropdown lists the busiest sectors first.
- `pnpm check` and `pnpm build` pass.

## Out of scope
- Data or pipeline changes.
- Any commit, push or PR.
