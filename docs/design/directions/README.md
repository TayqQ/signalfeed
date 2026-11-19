# Visual directions: shared brief

Step 3 of the overhaul (`../brief.md`, Process). Three directions on the **same two real pages**, so Taylor can compare like for like and pick one, or mix parts of them. Each is a static, clickable HTML prototype, not production code.

| File | Direction | Leans towards |
|---|---|---|
| `a-terminal.html` | **Terminal.** A dense, precise data table: Stripe or Linear for funding data. | Service providers working through a list |
| `b-briefing.html` | **Briefing.** Editorial and visual: a market summary on top, cards below, in the spirit of Crowdcube or Republic but calmer. | Market readers browsing |
| `c-prospector.html` | **Prospector.** A working tool: list and preview side by side, with quick filters and company pages as lead sheets. | Service providers acting on leads |

All three must serve both audiences (`../brief.md`, Goal). The lean only decides what comes first.

## Each file must contain
1. **A funding page** (the home feed): filters plus 16 rows from `sample-data.json`.
2. **A company page,** reached by clicking a row: Pro Climbing League (rich: confirmed, Companies House facts, four investors). A "switch company" link shows Griffin (sparse: news only, no registry, one investor), so the empty states are designed too.
3. **A tiny header note** saying the direction's name and one sentence on its idea. Taylor reads it, so keep it short.

Switch between the pages with plain JavaScript in one file: a hash route such as `#funding` / `#company/pro-climbing-league`, no framework.

## Hard requirements (all directions)
- **Brand:** `../brand/brand.md`.
  - Link `../brand/tokens.css` and use only its variables, plus local derived values if needed.
  - Logo: inline the lockup's SVG paths from `../brand/logo/raisory-lockup.svg`, ring `var(--brand)`, dot `var(--accent)`, text `var(--ink)`. Favicon: `../brand/logo/favicon.svg`.
  - Fonts: Google Fonts Inter (400/500/600) and Inter Tight (600). Headings and big numbers use Inter Tight, everything else Inter, with tabular figures for numbers.
- **Research:** read `../research.md` sections 1-4 and 7 and apply them. In particular:
  - the filter controls in section 2 (sector chip row; stage chips or a segmented control; amount presets; date presets; one place box; "More filters"; removable chips for every applied value);
  - row anatomy in priority order (section 3);
  - company page order (section 4);
  - the craft rules (section 7).
- **Light and dark:**
  - follow the system by default;
  - a toggle sets `data-theme` on `<html>`;
  - check both themes (the tokens already handle dark).
- **375 px:**
  - no horizontal page scroll;
  - the list becomes stacked items, never a squeezed table;
  - filters collapse to a button that opens a sheet;
  - the company page's header, key facts and latest round fit in the first screen.
- **Desktop at 1280 px** looks intentional, not stretched.
- **Accessibility:**
  - colour is never the only signal (stage chips have text; "Confirmed" has an icon and a word);
  - visible focus states;
  - real buttons and links;
  - contrast at least 4.5:1 for text.
- **Company identity:** monogram tiles, from the first letters, using `--brand-soft` / `--brand` or a small set of muted tints derived from the data colours. There are no logos yet. Leave room for a 20-32 px favicon later.
- **Data honesty** (sectors and descriptions in the data file are real, read from the live company pages):
  - Use only the data in `sample-data.json`. Where a field the design needs is missing (for example a one-line description for most rows), use the `description` given, or show a clear placeholder style such as "Description coming soon" in muted text. Never invent facts about real companies.
  - Amounts show in GBP first, with the original currency second where it differs.
  - Round labels are normalised for display, using `stage` in the data.
- **Filters can be visual only:** controls can look and toggle, but they don't need to filter the rows, except the sector chips and stage, which should really filter the 16 rows so the interaction feels real.
- **No emoji, no stock gradients, no glass, no heavy shadows** (`--shadow-1` and `--shadow-2` only). Flags: draw small flag-like country-code badges (for example "GB") in text. Don't use emoji flags.
- **One self-contained HTML file** (CSS and JS inline). Only Google Fonts loads from outside. Keep it under about 60 KB.

## Process
- Do not edit anything outside your own file, apart from reading the shared files.
- When done, open your file in a headless check if you can. At minimum, re-read it for broken markup.
- Report: the file path, three sentences on the design idea, and anything you couldn't follow.
