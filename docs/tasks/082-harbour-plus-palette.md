# 082 Harbour+ palette and recoloured logo

- **Tier:** 2. **Suggested model:** Claude Sonnet.
- **Depends on:** 081. **Wave:** UX v2, step 1 (before 083 and 084).

## Goal
Replace the v1 green and brass with the v2 "Harbour+" navy and orange everywhere, using the same token names, so no page needs its classes changed. Add the new tokens the app shell needs. Recolour the logo, favicon and app icon.

## Read first
- `AGENTS.md`
- `docs/design/brand/brand.md` (Colour section) and `docs/design/brand/tokens.css` (the new values, which are the source of truth)
- `docs/design/design-system.md` section 8
- `src/app/globals.css`, `src/app/globals.test.ts`
- `src/components/raisory-logo.tsx`, `src/app/icon.svg`, `src/app/apple-icon.tsx`, `src/app/layout.tsx` (`viewport`)
- `src/components/ui/button.tsx`, `src/components/ui/new-mark.tsx`, and the selected-row styles in `src/components/rounds/*`

## Files you may create or change
- `src/app/globals.css`, `src/app/globals.test.ts`
- `src/components/raisory-logo.tsx` and its test
- `src/app/icon.svg` (copy of `docs/design/brand/logo/favicon.svg`), `src/app/apple-icon.tsx`
- `src/app/layout.tsx`: the `viewport.themeColor` values only
- `src/components/ui/button.tsx` and its tests (add an `accent` variant)
- `src/components/rounds/*.tsx`: selected-row colours only (switch to `sel-bg` / `sel-bar`)
- `src/app/ui/page.tsx`: show the accent button and the new surfaces in the gallery
- `docs/tasks/README.md` (the 082 row only)

## Steps
1. **Tokens.** Copy every value from `docs/design/brand/tokens.css` into the three theme blocks in `globals.css` (light `:root`, the dark media query, and `[data-theme="dark"]`), replacing the v1 values. Add the new tokens: `raised`, `overlay`, `accent-hover`, `on-accent`, `nav-bg`, `nav-ink`, `nav-muted`, `nav-active-bg`, `nav-active-ink`, `nav-line`, `sel-bg`, `sel-bar`, `logo-ring`, `logo-dot` and `logo-ink`. Expose them as utilities in `@theme inline` (`bg-raised`, `bg-overlay`, `text-on-accent`, `bg-nav`, `text-nav-ink`, `bg-sel`, `border-sel-bar` and so on). Keep every existing utility name working. The stage colours now come from the data colours (see tokens.css).
2. **Logo.** In `RaisoryLogo`, the ring uses `var(--logo-ring)`, the dot `var(--logo-dot)` and the wordmark `var(--logo-ink)`. Copy the recoloured favicon to `src/app/icon.svg`, and draw the apple icon as the deep navy tile (#0E1C3B) with a white ring and an orange (#FF7A30) dot.
3. **Theme colour.** `viewport.themeColor` becomes light #F3F5FA and dark #0A1222.
4. **Buttons.** `primary` stays navy (`brand` / `on-brand`). Add `accent`: an orange fill, `text-on-accent` (ink, because white fails contrast) and `accent-hover` on hover. Only the top bar's main action and a page's single most important action may use it.
5. **Selection.** Selected rows in List and Split use `bg-sel` with a 2-3 px `sel-bar` inset bar, replacing `brand-soft`.
6. **Contrast test.** Update `globals.test.ts` to the new values. Add the pairs ink on raised and overlay, muted on raised, on-accent on accent, nav-ink and nav-muted on nav-bg, nav-active-ink on nav-active-bg, and ink on sel-bg, in both themes. Text pairs need 4.5:1; marks need 3:1.

## Tests and acceptance criteria
- `grep -rniE "1D4A38|7CC29A|0E2B21|A8834A|CDAA6E|F6F4EE|E3EEE7|18302A" src` returns nothing.
- The contrast test passes for every pair, in both themes.
- `pnpm check` and `pnpm build` pass.
- In the browser, the home and company pages are recoloured in both themes with no layout change. Dark-mode panels are visibly lighter than the page.

## Out of scope
- Layout, sidebar and page headers (083, 084).
- Any commit.
