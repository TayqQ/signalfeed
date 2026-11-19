# Raisory brand

Chosen 17 November 2026: direction 2, "Ledger". The drafts of all three directions stay in `brand-board.html`. The final sheet is `brand.html`.

## Name
**Raisory**: "raise" plus "-ory", as in directory or advisory. Said "RAY-zor-ee". Always one word with a capital R. Never RAISORY in running text, never Raisory.io or "the Raisory".

## Logo
- **Mark: "breakout".** An open ring (a funding round) with an orange dot breaking out up and to the right (the company growing past it). The gap always sits at the top right; the ring is navy and the dot is always orange.
- **Wordmark:** "Raisory" in Inter Tight SemiBold, tracking -3%, outlined (`logo/raisory-wordmark.svg`). Do not retype it in a live font for the logo.
- **Lockup:** the mark's height is 1.18 times the cap height, centred on the capitals, with a gap of 0.38 times the cap height. Use the files and don't rebuild it.

| File | Use |
|---|---|
| `logo/raisory-lockup.svg` | Light backgrounds (paper, white) |
| `logo/raisory-lockup-dark.svg` | Dark mode (Night) |
| `logo/raisory-lockup-reversed.svg` | On navy (ink) or the brand navy |
| `logo/raisory-lockup-mono.svg` | One colour (`currentColor`), for print or embossing |
| `logo/raisory-mark*.svg` | The mark alone, at 24 px and up, in the same four variants |
| `logo/favicon.svg` | Browser tab, 16-32 px. A deep navy tile with a white ring that is heavier (7 rather than 5.5) and a bigger dot |
| `logo/app-icon.svg` | Square app icon, Apple touch and social images. Platforms round the corners |

**Clear space:** at least the dot's diameter on every side. **Minimum size:** 88 px wide for the lockup, 20 px for the mark (use the favicon below that).

**Don't:**
- move the dot or the gap;
- recolour the dot (it is always orange);
- put the ring inside a box (except the app icon and favicon);
- add a shadow, gradient or outline;
- stretch it;
- set the lockup on a busy photo.

## Colour
**v2 "Harbour+"**, chosen 19 November 2026. It replaces the v1 green and brass, which read as a nature brand. The values are in `tokens.css`, and the comparison board is `palette-v2.html` (palette D). Light is the default; dark follows the system, with a manual toggle via `data-theme`.

| Role | Light | Dark | Rule |
|---|---|---|---|
| Paper | #F3F5FA | #0A1222 | App background. Cold off-white, never warm |
| Surface / raised / overlay | #FFFFFF | #111B30 / #18253F / #213152 | In dark mode, each level is lighter, so panels, cards and menus read as separate planes |
| Ink | #0E1C3B | #E8EDF6 | Text |
| Muted | #465474 | #9DAAC2 | Secondary text |
| Navy (brand) | #1D49A9 | #82A8FF | Identity, links, selection, the logo ring. Between v2 options Harbour (#1E3F80) and Signal (#1B5BF5), closer to Harbour |
| Orange (accent) | #E95D10 | #FF7A30 | What must be noticed: the primary action, "New", the active quick view, the logo dot. Orange buttons use ink text (white fails). Orange text uses `--accent-ink` (#B0430A) |
| Up / down / warn / info | #0B7A4B · #B5302A · #806200 · #1F65AD | #4FD08F · #FF8A7D · #F0CF4A · #6FB6F2 | Always with an icon or word. Warn is yellow-amber, kept clear of the orange |

**Contrast and emphasis:** the UI stays mostly calm (paper, white panels, ink). Navy marks where you are and what's selected; orange marks what to act on or notice. Use at most one orange button per view.

**Sidebar:** in light mode it's white, the same family as the page, not a dark bar. In dark mode it's the darkest plane (#070E1B).

**Charts:** `--data-1` to `--data-8`, in order. Each is at least 3:1 against its surface in both themes.

## Type
- **Inter Tight** (600, tracking -2.5%): the wordmark, page titles, section headings and big numbers.
- **Inter** (400/500/600): everything else. Use `font-variant-numeric: tabular-nums` wherever numbers line up (amounts, counts, dates in tables).
- **Scale (px):** 12 · 13 · 15 (body) · 17 · 20 · 24 · 30 · 38 · 48. UI text is 13-15. Headings go up in this scale and are never bold Inter.
- **Money format:** £4.2m, £850k, £12.0m. Use the sign and the unit, with no space, and one decimal for millions.

## Voice
Plain, exact and calm. Use British spelling. Say what happened and how sure we are ("Confirmed by Companies House", "Reported by 2 sources"). Avoid hype words ("explosive", "unicorn hunting") and emoji.
