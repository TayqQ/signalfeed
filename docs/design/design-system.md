# Raisory design system and page plan

Agreed with Taylor on 18 November 2026, after reviewing the three directions in `directions/`. The brand lives in `brand/`; this file covers how the product is put together. It becomes decision D66 when it merges.

## 1. Decision: one site, three list views
- **One home page structure, one company page, one phone layout.** Nothing switches per "user type".
- **The list of rounds has three views**, chosen by the visitor with a visible switch next to Sort:

  | View | Comes from | For |
  |---|---|---|
  | **List** (default) | A, Terminal | Scanning many rounds |
  | **Cards** | B, Briefing | Browsing and reading descriptions |
  | **Split** (list plus preview) | C, Prospector | Working through leads without leaving the page |

- **The choice is remembered** in the cookie `raisory_view` (`list` / `cards` / `split`, one year, `SameSite=Lax`), which the server reads so the first paint is right. `?view=` overrides it for one visit, which makes view-specific links shareable. There is no settings page.
- **Phones (under 768 px) always show the stacked list.** The switch is hidden there. Split needs at least 1100 px; below that, a split choice falls back to List, and the switch shows Split as unavailable with a title explaining why.
- **Views share data and parts.** Every view renders the same `FundingRow[]` from the same query, using the same primitives (section 4). A view is only an arrangement. If one view needs a field, all views get it from the same query.
- **Not done, on purpose:** separate home pages, navigation or company pages per audience. That would triple the work for every later feature (websites in Phase 3.5, the agency leads in Phase 4), and shared links would look different to different people.

## 2. Page templates
### Home (`/`)
1. **"What's happening" summary** (from B), collapsible, with the state remembered in the cookie `raisory_summary=closed`.
   - A headline: £ raised, the number of rounds and the median, for the current window, against the previous window of the same length.
   - Sectors ranked by £. Each bar has a text value, and a click filters the list.
   - The three biggest rounds.
   - It describes the same window as the list's date filter (90 days by default) and says so.
2. **Quick views** (from C): tabs that set filters, each with a count: All, UK, Confirmed, Seed and Series A, £10m+. A tab only writes normal filter parameters; it is not a separate concept.
3. **The filter bar** (research section 2):
   - search with the `/` shortcut;
   - the sector chip row, with themes as a second level once one sector is chosen;
   - a Stage segmented control;
   - amount presets;
   - date presets;
   - one place box (region, town, near);
   - "Confirmed only";
   - "More filters" (company size, momentum, investor, custom ranges).

   Below it, removable chips for every applied value plus "Clear all". It stays a GET form, so URLs and no-JavaScript keep working; with JavaScript it applies on change.
4. **The list**, in the chosen view, with Sort, the view switch and paging.

### Company (`/companies/[slug]`): one page combining the best of A, B and C
1. **Header** (B): monogram (favicon once Phase 3.5 lands), name, description as a standfirst, place badge, sector and theme chips.
2. **Action row** (C): Visit website (shown with a "Website not found yet" note when there is none), Companies House (only when linked), Copy company number, Share.
3. **Key facts strip** (all three): stage, total raised, last round and its date, founded, company size, investors. Show "Not known" in muted text where a value is missing.
4. **Two columns on desktop:**
   - Main: latest round (with the proof box when confirmed), funding history timeline with amount bars, investors with their roles, sources.
   - Side, sticky (A): "Signals" (C, plain words built only from stored data), then "From official records" (Companies House facts, or an honest empty state).
5. **"Companies like this"** (same sector, then the same stage), up to five compact items.
6. **At 375 px:** one column, ordered header, key facts, latest round (all in the first screen), signals, history, investors, records, sources, similar companies.

### Other pages (trends, investors, acquisitions, themes, about, status)
These keep their structure. They move onto the new primitives and tokens in one sweep (task 081). They get no view switch.

## 3. Tokens
- **Source:** `brand/tokens.css`, already in `src/app/globals.css` (task 074).
- **Semantic utilities replace the remapped Tailwind names.** Task 074 kept `zinc-*`, `blue-*`, `amber-*` etc. remapped so pages didn't change. Task 075 adds semantic utility names. Rebuilt pages use only those:

  | Group | Utilities |
  |---|---|
  | Surfaces | `paper`, `surface`, `surface-sunk` |
  | Lines | `line`, `line-strong` |
  | Text | `ink`, `muted`, `faint` |
  | Brand | `brand`, `brand-hover`, `brand-soft`, `on-brand`, `accent`, `accent-soft`, `accent-ink` |
  | Meaning | `up`, `up-soft`, `down`, `down-soft`, `warn`, `warn-soft`, `info`, `info-soft` |
  | Data | `data-1` to `data-8` |
  | Stage | `stage-early`, `stage-seed`, `stage-venture`, `stage-late`, `stage-other` |

  The old names stay until task 081 removes the last user, then they are deleted.
- **Type:**
  - Inter Tight 600 for page titles, section headings and big figures.
  - Inter 400/500/600 for everything else.
  - The scale is 12, 13, 15 (body), 17, 20, 24, 30, 38, 48 px.
  - Tabular figures on every number that can line up.
- **Space:** a 4 px base. Components use 4, 8, 12, 16 and 24; page sections use 32, 48 and 64.
- **Radius:** 6 for controls and chips, 10 for cards and panels, 14 for sheets and large tiles, pill for chips that are filters.
- **Depth:** flat by default with hairline `line` borders. `shadow-1` only for sticky headers; `shadow-2` only for popovers, sheets and menus.
- **Motion:** 120 ms for hover and press, 200 ms for sheets and popovers, `ease-out`. No motion when `prefers-reduced-motion` is set.
- **Breakpoints:** `sm` 640, `md` 768 (phone to tablet; the list stops stacking), `lg` 1100 (split view allowed), `xl` 1280.

## 4. Components (`src/components/ui/`)
Each component is small and has no data access: it takes values, renders them, and has a unit test. Pages and views compose them.

| Component | What it shows | Notes |
|---|---|---|
| `Monogram` | 1-2 letters on a tint picked from the name; later a favicon | Sizes 24, 28, 40, 56. `aria-hidden` (the name is always next to it) |
| `Amount` | GBP first, original currency small beneath when it differs | "Undisclosed" in muted text when null. Sizes `sm` (list) and `lg` (company) |
| `StageChip` | Stage text plus a small stage-ramp marker | Never colour alone. Normalised label (`Series F` shows "Series F" but uses the late-stage colour) |
| `ConfirmedMark` | Tick icon plus "Confirmed" | Its title is the confirmation text. It replaces the current `confirmed-marker` look and keeps its tests |
| `PlaceBadge` | Country-code badge plus city | "Place not known" in muted text |
| `SectorLabel` | The main sector | "Sector pending" in muted text when null |
| `RelativeDate` | "Yesterday", "4 days ago", then a date after 14 days | Exact date in `title` and `<time dateTime>` |
| `NewMark` | A brass dot plus "New" | Rounds announced within 2 days |
| `Chip` / `FilterChip` | Static label / removable applied filter | FilterChip is a link that removes the value (works without JavaScript) |
| `SegmentedControl` | Stage, view switch, £/rounds toggle | Radio-group semantics, arrow keys |
| `Button` | `primary`, `secondary`, `ghost`; sizes `sm` and `md` | At most one primary per view |
| `Popover`, `Sheet` | Filter popovers on desktop, bottom sheet on phones | Focus trap, Escape closes, returns focus |
| `Stat` | Label plus figure plus sub-line | Key facts strip and the summary headline |
| `RankedBars` | Ranked bars with a text value per bar | Used by the summary and trends. Clicking a bar filters the list |
| `EmptyState` | Honest "not known yet" panels | For example "No Companies House match yet" |

Views (`src/components/rounds/`):
- `RoundList` (table rows on desktop, stacked on phones);
- `RoundCards`;
- `RoundSplit`, with `RoundPreview`;
- `ViewSwitch`.

All of them take `rows: FundingRow[]` plus selection state, nothing else.

## 5. Data each view needs (task 076)
`FundingRow` gains `companyDescription` (one line, from `companies.description`), `mainSector` (a sector key, or null, using the order in research section 5), and `websiteDomain` (null for now). The stage colour comes from `stageBucket(roundType)` in `src/lib/stage.ts` (task 075) at render time, so it is not a row field.

A new query, `getFundingSummary(filters)`, returns:
- total GBP, count and median for the window, and the same for the previous window;
- sectors ranked by GBP and count;
- the three biggest rounds.

It is computed in SQL from the same filtered set as the list.

The split preview needs `getCompanyPreview(slug)`: header facts, key facts, latest round, signals inputs and the registry summary. It must be cached like the company page.

## 6. Accessibility and quality bar
- Text contrast at least 4.5:1, chart and UI marks at least 3:1, in both themes. The contrast test from 074 extends to every new token pair a component uses.
- **Keyboard:**
  - `/` focuses search;
  - in List and Split, j/k or the arrow keys move between rows;
  - Enter opens the selected row;
  - Escape closes sheets and popovers;
  - focus is always visible.
- **Split view:** the list is a `listbox`-like set of links with `aria-current` on the selected row, and the preview is a labelled region. The selection lives in the URL (`?open=<slug>`), so Back and shared links restore it.
- **The definition of done for every page task:**
  - `pnpm check` and `pnpm build` pass;
  - screenshots at 375 and 1280 px in light and dark (`pnpm screenshots`, extended per task);
  - no horizontal page scroll at 375 px;
  - the first-screen rule for the company page holds;
  - empty and missing-data states are shown with real data.

## 7. Build order
| Wave | Tasks | Runs in parallel? |
|---|---|---|
| 1 | 075 primitives and semantic tokens; 076 row fields and summary queries | Yes (different files) |
| 2 | 077 company page; 078 filter bar | Yes |
| 3 | 079 home summary, quick views, List and Cards, view switch | After 076 and 078 |
| 4 | 080 Split view | After 079 |
| 5 | 081 sweep the other pages onto the system, then delete the old remapped names | After 075, best after 079 |

Split ships last on purpose. If Cards turns out to be little used (measured with privacy-friendly page analytics, not per-person tracking), it can be dropped cheaply, because it is only an arrangement.
