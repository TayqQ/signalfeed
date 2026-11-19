# 083 App shell: sidebar, top bar, full-width content

- **Tier:** 3 (it replaces the site's frame on every page, with responsive and keyboard behaviour). **Suggested model:** Claude Opus.
- **Depends on:** 082. **Wave:** UX v2, step 2 (parallel with 084).

## Goal
The site becomes an app that uses the whole window: a left sidebar for navigation, a top bar with global search and the one orange action, and a content area with no centred max-width (`docs/design/design-system.md` section 8). The prototype is `docs/design/brand/palette-v2.html` (palette D).

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 6 and 8
- `docs/design/brand/palette-v2.html`, as a visual reference for the shell (sidebar, rail, bottom bar, top bar); don't copy its code
- `src/app/layout.tsx`, `src/components/site-header.tsx`, `src/components/site-footer.tsx`, `src/components/theme-toggle.tsx`, `src/components/raisory-logo.tsx`
- `src/components/ui/*` (Button `accent` from 082, Sheet)

## Files you may create or change
- `src/components/shell/*.tsx` and tests (new: `AppShell`, `Sidebar`, `NavItem`, `TopBar`, `GlobalSearch`, `BottomTabs`, `icons.tsx` with inline SVG icons; no icon library)
- `src/app/layout.tsx`: render `AppShell` around `children`; leave `metadata` and `viewport` alone
- `src/components/site-header.tsx`, `src/components/site-footer.tsx` and their tests (retire and delete once unused)
- `src/components/theme-toggle.tsx` and its test (placement and size only)
- `src/app/globals.css`: shell layout rules only, if any
- `scripts/screenshots.ts` (add the shell at 1440, 1100, 800 and 375 px)
- `docs/tasks/README.md` (the 083 row only)

**Do not edit page files in `src/app/**/page.tsx`.** Task 084 removes their headers and containers at the same time as this task.

## Steps
1. **Layout.** A full-height CSS grid: the sidebar column, then a column holding the top bar and the content. The content scrolls. The sidebar and top bar stay fixed in place (sticky, not `position: fixed`, so the page's own scroll and anchors keep working). No `max-width` on the content area; give it 24 px padding (16 px on phones).
2. **Sidebar** (240 px, `bg-nav`, `border-nav-line`):
   - The logo links home.
   - **Primary nav:** Funding `/`, Investors `/investors`, Themes `/themes`, Trends `/trends`, Acquisitions `/acquisitions`. There's no Companies index route yet, so leave it out and mention it in the hand-back.
   - **Lower group:** Status, About, and small "Source code" and "AGPL-3.0" links (moved from the footer; the licence needs a visible source link).
   - **At the foot:** the theme toggle.
   - The active item uses `bg-nav-active`, `text-nav-active-ink` and `aria-current="page"`, matched by path prefix (`/investors/x` makes Investors active; company pages make Funding active).
3. **Icon rail** at 1024-1279 px: a 64 px rail with icons only, each with a tooltip (`title` plus a visually hidden label), in the same order.
4. **Phones (under 768 px):** no sidebar. A bottom tab bar with Funding, Investors, Themes, Trends and More. More opens a `Sheet` holding Acquisitions, Status, About, Source and the theme toggle. Keep the bottom bar's height in mind so content isn't hidden behind it (padding-bottom plus the safe-area inset). The top bar keeps the logo mark and search.
5. **Top bar:**
   - `GlobalSearch` is a GET form to `/` with `q`. `/` and ⌘K/Ctrl+K focus it, unless focus is already in a text field.
   - On the right, one `accent` button, "Get the weekly brief", linking to `/about#brief` as a placeholder.
6. **Accessibility:**
   - A "Skip to content" link as the first focusable element.
   - The sidebar is a `<nav aria-label="Main">`; the bottom tab bar is a second nav labelled "Main (mobile)", hidden from wider screens.
   - Focus styles are visible on every item.

## Tests and acceptance criteria
- Unit tests:
  - active-item matching for `/`, `/investors/byfounders` and `/companies/x`;
  - the search shortcut ignores key presses in inputs;
  - the More sheet opens and closes.
- **In the browser** at 1440, 1100, 800 and 375 px, in both themes:
  - the shell renders;
  - nothing scrolls sideways;
  - the content uses the full width;
  - the bottom tab bar never covers content.
- `pnpm check` and `pnpm build` pass.

## Out of scope
- Page content, headers and containers (084).
- A companies index page.
- Any commit.
