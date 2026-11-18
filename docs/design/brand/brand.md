# Raisory brand

Chosen 17 November 2026: direction 2, "Ledger". The drafts of all three directions stay in `brand-board.html`. The final sheet is `brand.html`.

## Name
**Raisory**: "raise" plus "-ory", as in directory or advisory. Said "RAY-zor-ee". Always one word with a capital R. Never RAISORY in running text, never Raisory.io or "the Raisory".

## Logo
- **Mark: "breakout".** An open ring (a funding round) with a brass dot breaking out up and to the right (the company growing past it). The gap always sits at the top right, and the dot is always brass.
- **Wordmark:** "Raisory" in Inter Tight SemiBold, tracking -3%, outlined (`logo/raisory-wordmark.svg`). Do not retype it in a live font for the logo.
- **Lockup:** the mark's height is 1.18 times the cap height, centred on the capitals, with a gap of 0.38 times the cap height. Use the files and don't rebuild it.

| File | Use |
|---|---|
| `logo/raisory-lockup.svg` | Light backgrounds (paper, white) |
| `logo/raisory-lockup-dark.svg` | Dark mode (Night) |
| `logo/raisory-lockup-reversed.svg` | On Raisory green or Forest |
| `logo/raisory-lockup-mono.svg` | One colour (`currentColor`), for print or embossing |
| `logo/raisory-mark*.svg` | The mark alone, at 24 px and up, in the same four variants |
| `logo/favicon.svg` | Browser tab, 16-32 px. A Forest tile with a heavier ring (7 rather than 5.5) and a bigger dot |
| `logo/app-icon.svg` | Square app icon, Apple touch and social images. Platforms round the corners |

**Clear space:** at least the dot's diameter on every side. **Minimum size:** 88 px wide for the lockup, 20 px for the mark (use the favicon below that).

**Don't:**
- move the dot or the gap;
- recolour the dot green;
- put the ring inside a box (except the app icon and favicon);
- add a shadow, gradient or outline;
- stretch it;
- set the lockup on a busy photo.

## Colour
The tokens are in `tokens.css`, with light as the default, dark following the system, and a manual toggle through `data-theme`.

| Role | Light | Dark | Rule |
|---|---|---|---|
| Paper | #F6F4EE | #0B1411 | Page background. Warm, never pure white |
| Surface | #FFFFFF | #111D18 | Cards, tables, inputs |
| Ink | #10241D | #E8EDE9 | Text |
| Muted | #5D6B64 | #94A39B | Secondary text (5.1:1 and 7.1:1) |
| Raisory green | #1D4A38 | #7CC29A | Links, primary buttons, the ring, the selected state |
| Forest | #0E2B21 | #0E2B21 | Icon tile, hero bands, reversed lockup |
| Mint wash | #E3EEE7 | #18302A | Selected rows, chips |
| Brass | #A8834A | #CDAA6E | The dot, "new" markers and one highlight per view. For text, use `--accent-ink` |
| Up / down / warn / info | #2E7553 · #B23A2E · #8A5710 · #3E6A8A | #7CC29A · #EE8A7C · #E2B05A · #86AFCF | Always with an icon or word, never colour alone |

**Proportions:** mostly paper and ink, green for action and identity, brass sparingly. If a screen has more than about 5% brass, it's too much.

**Charts:** `--data-1` to `--data-8`, in order. Each passes 3:1 against the surface in both modes (checked 17 November 2026). A single-series chart uses `--data-1`.

## Type
- **Inter Tight** (600, tracking -2.5%): the wordmark, page titles, section headings and big numbers.
- **Inter** (400/500/600): everything else. Use `font-variant-numeric: tabular-nums` wherever numbers line up (amounts, counts, dates in tables).
- **Scale (px):** 12 · 13 · 15 (body) · 17 · 20 · 24 · 30 · 38 · 48. UI text is 13-15. Headings go up in this scale and are never bold Inter.
- **Money format:** £4.2m, £850k, £12.0m. Use the sign and the unit, with no space, and one decimal for millions.

## Voice
Plain, exact and calm. Use British spelling. Say what happened and how sure we are ("Confirmed by Companies House", "Reported by 2 sources"). Avoid hype words ("explosive", "unicorn hunting") and emoji.
