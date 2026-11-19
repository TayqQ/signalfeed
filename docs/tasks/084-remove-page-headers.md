# 084 Remove page headers and fill the width

- **Tier:** 2. **Suggested model:** Claude Sonnet.
- **Depends on:** 082. **Wave:** UX v2, step 2 (parallel with 083).

## Goal
Pages stop looking like web pages. The big title and description block at the top of each page goes, the centred max-width containers go, and Split becomes the default list view where there is room (`docs/design/design-system.md` section 8, point 3).

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 1, 2 and 8
- every `src/app/**/page.tsx`, plus `src/app/not-found.tsx` and `src/app/error.tsx`
- `src/lib/view-preference.ts` and its test, `src/components/rounds/round-views.tsx`, `src/components/home/funding-summary.tsx`

## Files you may create or change
- `src/app/**/page.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx` (not `layout.tsx`: that's 083's)
- `src/components/theme-header.tsx`, `src/components/company/company-header.tsx` (spacing only), `src/components/home/*`, `src/components/rounds/*`
- `src/lib/view-preference.ts` and its test
- the matching `*.test.tsx` files, only where they assert on removed text or classes
- `docs/tasks/README.md` (the 084 row only)

## Steps
1. **Headers.** On list and overview pages (home, investors, themes, trends, acquisitions, status, about), remove the visible H1 and the description paragraph. Keep one H1 per page with the `sr-only` class, using the page name ("Funding", "Investors" and so on), so screen readers and the document outline still work. On detail pages (company, investor, theme), the entity's name stays as the visible H1, because it's the content, not page chrome. Any context a removed description gave (for example, what "rounds" means on Trends) moves to a short caption beside the relevant data, or to About.
2. **Containers.** Remove the `max-w-*` and `mx-auto` wrappers from pages, so content fills the content area that 083 provides. The shell supplies the padding; don't add page padding. Long-form text (About, error and 404 messages) keeps a readable measure (`max-w-prose`) inside its own block, aligned left.
3. **Home layout at full width:**
   - The summary becomes a single row of compact tiles across the width (stat tiles, then sectors, then biggest rounds), still collapsible.
   - The quick views and filter bar sit directly under it.
   - The list views use the width (Cards: more columns; List: wider description column).
4. **Default view.** With no cookie and no `?view`, the default becomes **Split**. Below 1100 px, Split's markup already shows the List layout through CSS, so phones and small laptops are unaffected. Update `view-preference` and its tests. A stored choice still wins.
5. **Company page at full width:**
   - The two columns use the width: main about two-thirds, side about one-third.
   - The key facts strip spreads to six columns from 1280 px.
   - The header stays compact.

## Tests and acceptance criteria
- No visible page title or description on list and overview pages. Each page still has exactly one H1 (a test or a grep check).
- `grep -rn "max-w-7xl\|max-w-6xl\|mx-auto" src/app` finds only deliberate prose measures, and each is listed in the hand-back.
- `view-preference` tests cover the new Split default and that a stored List or Cards choice still wins.
- `pnpm check` passes. Leave `pnpm build` to 083, which runs in the same wave.

## Out of scope
- The sidebar, top bar and layout (083).
- Any commit.
