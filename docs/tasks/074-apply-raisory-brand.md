# 074 Apply the Raisory brand across the site

- **Tier:** 2 (clearly specified; touches every page's look, no data or pipeline change). **Suggested model:** Claude Sonnet.
- **Depends on:** the brand chosen on 17 November 2026 (`docs/design/brand/`). **Wave:** UX overhaul, step 2.

## Goal
The live site looks and reads as **Raisory**:
- the new logo, favicon, fonts and colours;
- light and dark mode (system default plus a toggle);
- no visible "SignalFeed" left in the UI.

Layout and page structure stay as they are, since the page-by-page rebuild comes later. This is a token-level swap plus the header.

## Read first
- `AGENTS.md`
- `docs/design/brand/brand.md` (rules), `docs/design/brand/tokens.css` (every value), `docs/design/brand/logo/` (SVGs)
- `src/app/globals.css`, `src/app/layout.tsx`, `src/components/site-header.tsx`, `src/components/site-footer.tsx`
- `src/components/charts/` (they read `--chart-*` and `--color-stage-*`)

## Files you may create or change
- `src/app/globals.css`, `src/app/layout.tsx`
- `src/app/icon.svg` (new, a copy of `docs/design/brand/logo/favicon.svg`), `src/app/apple-icon.tsx` (new, `ImageResponse` 180×180 of `app-icon.svg`'s artwork)
- `src/components/site-header.tsx`, `src/components/site-footer.tsx`
- `src/components/raisory-logo.tsx` (new), `src/components/theme-toggle.tsx` (new), plus tests for both
- Any `src/app/**/*.tsx` and `src/components/**/*.tsx`, **only** to:
  - replace the visible text "SignalFeed" with "Raisory";
  - swap `bg-white` for `bg-surface`;
  - swap `text-white` (on a brand background) for `text-on-brand`.
- The matching `*.test.tsx` files, only where they assert on the text or classes changed above
- `docs/tasks/README.md` (one row for 074)

**Do not touch:** `src/pipeline`, `src/db`, `src/core`, `src/lib` (the HTTP user agent, schema names and error strings keep "SignalFeed" until the repo rename), the GitHub repo URL in the footer, the indexing or robots logic, or `docs/design/`.

## Steps
1. **Fonts.** In `layout.tsx`, replace Schibsted Grotesk:
   - `Inter` (`--font-inter`, subsets latin and latin-ext) is the sans font;
   - `Inter_Tight` (weight 600, `--font-inter-tight`) is `--font-display`.

   In `globals.css`:
   - `--font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif`;
   - add `--font-display`;
   - set `h1, h2 { font-family: var(--font-display); letter-spacing: -0.025em; }` in `@layer base`;
   - wherever numbers line up, keep the existing `tabular-nums` classes.

2. **Tokens, with dark mode.** Copy the raw variables from `docs/design/brand/tokens.css` into `globals.css`. That means the `:root` light set, the `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` set and the `:root[data-theme="dark"]` set. Then switch `@theme` to `@theme inline`, so every utility points at a variable that flips with the theme. Utility names stay as they are (Tailwind's names, remapped), so pages need no class changes:

   | Utility colour | Light | Dark |
   |---|---|---|
   | `paper` | var(--paper) | (flips via var) |
   | `surface` (new) | var(--surface) | |
   | `ink` | var(--ink) | |
   | `quiet` | var(--muted) | |
   | `rule` | var(--line) | |
   | `signal` | var(--brand) | |
   | `on-brand` (new) | var(--on-brand) | |
   | `accent`, `accent-soft`, `brand-soft` (new) | the tokens | |
   | `zinc-50` | #EFECE4 | #0E1814 |
   | `zinc-100` | #E9E5DB | #15221C |
   | `zinc-200` | #E3DFD4 | #22322B |
   | `zinc-300` | #CFC9BA | #2F433A |
   | `zinc-400` | #8A958F | #64736B |
   | `zinc-500` | #6E7A74 | #7F8D86 |
   | `zinc-600` | #5D6B64 | #94A39B |
   | `zinc-700` | #3B4A43 | #B8C3BD |
   | `zinc-800` | #22352D | #D3DBD6 |
   | `zinc-900` | #10241D | #E8EDE9 |
   | `blue-100` | var(--brand-soft) | |
   | `blue-600` | var(--brand) | |
   | `blue-700`, `blue-900` | #163B2C | #95D1AE |
   | `emerald-100` / `emerald-900` | var(--up-soft) / var(--up) | |
   | `amber-50`, `amber-100` / `amber-300` / `amber-900`, `amber-950` | var(--warn-soft) / #E2C48E (dark #5A4520) / var(--warn) | |
   | `red-50`, `red-100` / `red-300` / `red-900` | var(--down-soft) / #E6B2AA (dark #5A2A24) / var(--down) | |

   Define the zinc and blue values as raw variables (for example `--g-50`) in the three theme blocks, and point `@theme inline` at them. Write a short comment saying the names are kept so pages need no change, and that the semantic names arrive with the page rebuild.

   Set `html { background: var(--paper); color: var(--ink); color-scheme: light dark; }`. The focus outline uses `var(--focus)`.

3. **Charts and stages.** Rewrite the chart variables for both themes, each at least 3:1 against `--paper`. Keep the existing comment's rule and update its wording, since the site now has dark overrides.

   | Variable | Light | Dark |
   |---|---|---|
   | `--chart-1..4` | --data-1, --data-3, --data-8, --data-6 | the same tokens (they flip) |
   | `--chart-bar`, `--chart-line` | var(--brand) | var(--brand) |
   | `--chart-axis` | #6E7A74 | #7F8D86 |
   | `--chart-grid` | var(--line) | var(--line) |
   | `--chart-mark` | var(--surface) | var(--surface) |
   | `--chart-gap` | var(--paper) | var(--paper) |
   | `--chart-text` | var(--muted) | var(--muted) |

   Stage colours, where later stages read stronger:

   | Stage | Light | Dark |
   |---|---|---|
   | early | #4E8A69 | #3F8560 |
   | seed | #2E7553 | #5FA67F |
   | venture | #1D4A38 | #7CC29A |
   | late | #0E2B21 | #B5E0C6 |
   | other | #7F8A84 | #7F8D86 |

4. **Logo component.** `RaisoryLogo` renders the lockup as inline SVG, taken from `logo/raisory-lockup.svg` with the same paths and viewBox:
   - ring stroke `var(--brand)`;
   - dot fill `var(--accent)`;
   - wordmark fill `var(--ink)`.

   This way one component works in both themes. It takes `className` and has `role="img"` and `aria-label="Raisory"`. The header link wraps it at about 22px high and keeps an accessible name, "Raisory home".

5. **Theme toggle.**
   - A small client component in the header: an icon button (sun and moon as inline SVG, no icon library) with `aria-label` "Switch to dark theme" or "Switch to light theme".
   - With no stored choice it follows the system. A click sets `data-theme` on `<html>` and stores `light` or `dark` in `localStorage` (wrap it in try/catch).
   - Prevent a flash of the wrong theme: add a tiny inline script in `<head>` (in `layout.tsx`) that applies the stored choice before paint, and put `suppressHydrationWarning` on `<html>`.
   - Test the component: initial label, click toggles the attribute, and storage failure doesn't throw.

6. **Header and footer.**
   - The header gets the logo, the same nav, and the toggle on the right. It sits on `bg-surface` with the bottom rule, its items are vertically centred (it uses `items-baseline` today), and it still wraps at 375px.
   - The footer stays as it is apart from colours.

7. **Metadata.** `title: { default: "Raisory", template: "%s · Raisory" }`. Check that page titles that already contain "SignalFeed" don't end up with the name twice. The description stays, reworded to start with "Raisory tracks…". Add `themeColor` for light (#F6F4EE) and dark (#0B1411) via `export const viewport`. Icons come from the `icon.svg` and `apple-icon` file conventions.

8. **Text.** Replace the visible "SignalFeed" with "Raisory" in `src/app` and `src/components`. On the About page, where it explains the project history, a sentence like "Raisory (formerly SignalFeed)" is fine once.

9. **Contrast.** If any test checks chart or stage colours, update it to the new values. Otherwise add a small unit test that parses the light values in `globals.css` and checks the 3:1 rule.

## Tests and acceptance criteria
- `pnpm check` passes, and `pnpm test` stays green, with new tests for the logo, the toggle and contrast.
- `pnpm build` succeeds.
- `grep -rn "SignalFeed" src/app src/components` returns only the "formerly" mention, plus tests that assert its absence.
- No class names outside the swaps listed in "Files you may create or change".
- No layout change except in the header.

## Out of scope
- Redesigning pages, filters, rows or charts (the visual directions come next).
- Renaming the repo, package, user agent or database.
- Any commit, push or PR. The maintainer commits outside working hours.
