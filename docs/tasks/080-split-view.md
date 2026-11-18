# 080 Split view (list plus company preview)

- **Tier:** 3 (client state, keyboard and focus handling, URL state). **Suggested model:** Claude Opus.
- **Depends on:** 079. **Wave:** UX 4.

## Goal
Turn on the third list view from `docs/design/design-system.md` section 1. Compact rows sit on the left, and a company preview with actions sits on the right. Leads can be worked through without leaving the page, and the selection survives Back and shared links.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 1, 4 and 6
- The prototype `docs/design/directions/c-prospector.html`, as a visual reference
- `src/components/rounds/*` (079), `src/lib/view-preference.ts`
- `src/db/queries/companies.ts` (`getCompanyPreview` from 076)
- `src/components/company/*` (077: action row, signals, key facts)

## Files you may create or change
- `src/components/rounds/RoundSplit.tsx`, `RoundPreview.tsx` and tests (new)
- `src/components/rounds/ViewSwitch.tsx` and its test (enable Split)
- `src/app/page.tsx`: render Split when it is chosen and the screen is at least 1100 px.
- `src/app/api/company-preview/[slug]/route.ts` (new, GET, cached, returns `CompanyPreview` JSON) **or** a server action, whichever keeps the client code smaller. Explain the choice in the hand-back.
- `scripts/screenshots.ts`: add Split at 1280 px in both themes.
- `docs/tasks/README.md` (the 080 row only)

## Steps
1. **Layout.** The list takes about 40% and the preview the rest, both scrolling inside a sticky frame below the filter bar. Below 1100 px a Split choice falls back to List; the switch explains why in its title.
2. **Selection.**
   - The selection lives in `?open=<slug>`. With none, the first row is selected.
   - j/k or the arrow keys move the selection. Enter or "Open full page" goes to `/companies/<slug>`.
   - Selecting updates the URL with `router.replace`; it doesn't push a history entry per keypress.
3. **Preview.**
   - The server renders the preview for the initial `open`.
   - Later selections fetch `CompanyPreview`. Show a skeleton after 150 ms, never a layout jump.
   - Cancel stale requests (`AbortController`).
   - Reuse 077's action row, key facts and signals components.
4. **Accessibility.**
   - The list is a set of links with `aria-current="true"` on the selected one.
   - The preview is a labelled `region` with `aria-live="polite"` on the company name.
   - Focus stays in the list while moving; Enter moves to the full page.
5. **Without JavaScript.** Each row is a plain link to `?open=<slug>`, so the server renders the preview.

## Tests and acceptance criteria
- Keyboard movement and URL sync.
- A stale response never overwrites a newer selection (a fake fetch with delays).
- No-JavaScript links.
- The fallback below 1100 px.
- Screenshots in both themes.
- `pnpm check` and `pnpm build` pass.

## Out of scope
- Saved views or lists (Phase 4).
- Any commit.
