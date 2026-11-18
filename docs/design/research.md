# Research: filters, scanning, craft and trends

Written 17 November 2026 for the UX/UI overhaul. Part A is read from the code. Part B is from the web; where a source could not be read this is said plainly (see section 9).

## 1. Summary: the 10 recommendations, ranked

1. **Lead with a sector row, not a sidebar.** The code already has 16 fixed sectors (`src/core/sectors.ts`), and every theme already carries one. Show them as a single row of chips above the table, with themes as a second level inside the chosen sector. No new taxonomy is needed, only a better control.
2. **Replace the 400-line checkbox sidebar with a short filter bar.** Five visible controls (search, sector, stage, amount, place), a "More filters" popover for the rest, and removable chips showing what is applied. Keep the plain GET form behind it so URLs and no-JavaScript still work.
3. **Match each control to its data.** Stage becomes a segmented control or chips, amount becomes presets plus a range, date becomes presets ("Last 7 days", "30 days", "This year"), place becomes one searchable box, and investor and theme become searchable multi-selects.
4. **Redesign the row around five facts: who, what they do, how much, stage, when.** The amount is the largest figure, stage is a coloured chip with a text label, and the "confirmed" marker sits next to the amount.
5. **Add a card view alongside the list.** Cards for browsing (market readers), a dense list for working (service providers). Remember the choice per visitor. On mobile the list becomes stacked cards by default.
6. **Give every company an identity.** Favicon or logo when available, monogram otherwise, plus a short one-line description. This is what makes Crowdcube and Republic feel like products, not tables.
7. **Make the home page a two-part page: "what is happening" above, "who is raising" below.** A headline strip (rounds and £ this month against last), sector ranked bars, and a weekly sparkline, then the filtered feed.
8. **Company page in a fixed order, with a "what you need" header.** Name, one-line description, website button, location, stage, total raised, then latest round, investors, registry facts, history, sources.
9. **Adopt a short craft checklist and enforce it in tokens** (section 7): one radius scale, tinted neutrals, one accent, flat surfaces with one subtle shadow level, no decorative gradients, no emoji, tabular numbers.
10. **Use trend charts that need no axis reading**: ranked bars with a share-of-total, sparklines inside rows, and a small-multiples grid for sectors. Avoid multi-line charts.

## 2. Filter audit (Part A)

Source: `src/lib/funding-filters.ts` and `src/components/funding-filters-form.tsx`. "Both" means market readers and service providers.

| Param | What it means | Who uses it | Verdict | Right control | Default |
|---|---|---|---|---|---|
| `q` | Company name search | Both | Keep, always visible | Text search with "/" shortcut | Empty |
| `sector` | One of 16 broad sectors | Both | Keep, primary | Chip row (multi-select) | All |
| `theme` | One of 73 themes (single select in the UI, many allowed in the URL) | Providers | Keep, but as second level under sector | Searchable multi-select, filtered by chosen sector | Any |
| `round` | Round type (pre-seed to growth, debt, grant) | Both | Keep, primary | Segmented control or chips: Pre-seed/Seed, Series A, Series B+, Debt. Grants behind "More" | All except grants (as today, D44) |
| `size` | Deal size bands (under £1M to £100M+) | Both | Keep | Chips with the same five bands | Any |
| `min` / `max` | Free £ range | Few | Demote | Range slider with presets, inside "More filters" | None |
| `from` / `to` | Date window | Both | Keep as presets | Date presets (7 days, 30 days, 90 days, This year), custom range in "More" | Last 90 days on the home feed |
| `ukregion` | 12 UK regions | Providers | Keep, merged into one place control | Searchable multi-select | All |
| `city` | Town or city | Providers | Merge into the place control | Same box as region and near | None |
| `near` + `km` | Within X km of a town | Providers selling locally | Keep but demote | "Within 25 km of ..." inside the place popover | Off |
| `region` / `country` | World region and country (hidden fields, no control) | Readers; a few providers | Add a country control, drop `region` | Searchable multi-select with flags | UK |
| `cosize` | Company size band from Companies House accounts (micro to full accounts, dormant) | Providers (a good buying signal) | Demote; relabel in plain words | Chips in "More": "Tiny", "Small", "Mid-size", "Large", "Not yet filed". Hide dormant by default | Any |
| `evidence` | Confirmed by an official filing | Providers (trust) | Keep as a toggle | Toggle "Confirmed only" | Off |
| `momentum` | First recorded round, or raised again within 24 months | Few; wording is confusing | Demote and rename | Segmented control in "More": "Any / First round / Repeat raiser". Hide until history is longer than a year (history starts November 2026) | Any |
| `investor` | One investor slug (hidden, set from investor pages) | Both | Promote to a visible control | Searchable single select with typeahead | None |
| `tag` | One of 121 tags (hidden, set from links) | Nobody directly | Drop from the UI; keep parsing for old links | None. Map to theme or sector on arrival | None |
| `sort` / `dir` | Newest, amount, relevance | Both | Keep | Single select "Sort: Newest" next to the view switch; column headers still sort | Newest (relevance when `q` set) |
| `page` / `pageSize` | Paging | Both | Keep | Pager; page size not user-facing | 25 |

Problems found in the current form:
- Eight checkbox lists or free inputs sit open in a 15rem sidebar. UK region (12), sector (16), round (10), deal size (5), company size (6) are all expanded at once.
- Town and "Near" are two text boxes sharing a datalist of 70 towns, which gives a poor typeahead.
- `region`, `country`, `tag`, `investor` and extra values exist in the URL but have no control, so a visitor can be filtered by something they cannot see or remove. Every applied value must show as a removable chip.
- The "Apply filters" button means no live feedback. Keep it for no-JS, but apply on change when JavaScript is present.

## 3. Row and card anatomy

**Fields available per row (`FundingRow`):** company name and slug, city and country code, round type and label, amount (original and GBP), announce date, up to a few lead investors, investor count, source count, tags, momentum (round number, months since previous, step-up ratio), evidence level and confirmation text.

**Not on a row yet, needed:** company logo or website domain, one-line description, sector and themes. These exist on the company (`websiteDomain`, `description`, `sectors`, `themes`) and need a small query addition.

**Show these on every row, in priority order:**
1. Company identity: logo or monogram, then name (links to the company page).
2. Amount raised, large and right-aligned with tabular figures, "Undisclosed" in muted text when null.
3. Round stage as a labelled chip (colour plus text, never colour alone).
4. One-line description, truncated to one line in the list and two in the card.
5. Sector chip (one, the main one) and place with a flag.
6. Date as a relative phrase ("3 days ago") with the exact date on hover or in a title.
7. Confirmed marker: a tick icon with the word "Confirmed", beside the amount.

**Second line or hover only:** lead investors (first one or two names, "+3"), step-up ("2.4x on last round"), source count.

**Company page only:** all investors and roles, full round history, registry details, SIC codes, ycBatch, GitHub, founded year and its source, every source article.

**List and card switch.** Segmented control "List | Cards" next to Sort, stored in a cookie. List is the default on desktop for the service-provider job (scan 25 rows at once). Cards are the default on screens under 640px. On mobile, a "table" is a stack: line 1 name and amount, line 2 stage chip and sector, line 3 description, line 4 place and date. Never scroll a table sideways at 375px. The card layout follows Crowdcube and Republic: identity at the top, a short bio, a flag, then a key-facts row.

## 4. Company page anatomy (in order)

1. **Header:** logo or monogram, name, one-line description, website button ("Visit website", from `websiteDomain`), place with flag, status.
2. **Key facts strip** (four to six values in one row): stage of last round, total raised, last round amount and date, founded year, company size band, number of investors.
3. **Latest round card:** amount, stage, date, lead investors, confirmed marker, step-up against the previous round.
4. **Funding history:** a simple timeline of rounds, newest first, with an amount bar per round so growth reads at a glance.
5. **Investors:** names as links, with role (lead or participant) and kind.
6. **About the company:** longer description, sector and themes as links to browse pages.
7. **Registry facts:** Companies House number, incorporation date, SIC codes with labels, accounts size band, status. SEC details for US filers. Labelled "From official records".
8. **Latest news and sources:** linked articles with outlet and date.
9. **"Companies like this"**: same sector and stage, three to five cards (good for providers building a list).

Sections 1 to 3 must fit above the fold at 375px.

## 5. Sector model

**Finding:** the two-level model largely exists. `SECTORS` holds 16 values (software-ai, financial-services, health-life-sciences, climate-energy, transport-mobility, property-construction, retail-consumer, food-agriculture, manufacturing-industrial, media-creative, education, business-services, security-defence, space-deep-tech, public-social, other). `ThemeRef.sector` links each of the 73 themes to one sector, and `src/lib/registry/sic-sectors.ts` maps Companies House SIC codes to sectors. The fragmentation is a user-interface problem: the form shows a 16-item checkbox list and a flat 73-item dropdown, and rows show tags rather than sector.

**User-facing model:**
- **Level 1, sector (16, kept):** the chip row and the home-page ranking. Merge "space-deep-tech" and "security-defence" into one chip if counts stay thin; keep "Other" last and hidden when empty. Aim for 12 to 16 visible chips.
- **Level 2, theme (73):** appears only after a sector is picked, as a searchable list of that sector's themes with live counts ("Generative AI, 14"). Themes with fewer than three companies in the window are hidden in the picker.
- **Row display:** one sector chip per row (the company's main sector), themes only on the company page.
- **Mapping order for a company's sector:** (1) the sector of its strongest theme, (2) otherwise the SIC-code sector from Companies House, (3) otherwise `other`. Tags only feed themes; they never show to the user.
- **Old links:** `tag=` URLs resolve to the tag's theme, then to a sector, and show as chips.

## 6. Reference techniques

Note: Crowdcube and Republic blocked automated fetches (HTTP 403), and Mixpanel, Stripe, Notion and Figma returned text without styling. Points marked "from the brief" or "general knowledge" are not freshly verified against the live page. Open each page in a browser before copying a detail.

**Crowdcube** (from the brief and aggregator listings)
- Card pairs a short pitch with a "percent of target" figure; the number is the headline, and the bar is the proof.
- Campaigns can exceed 100 percent ("108% of target"), which is shown as an achievement, not an error. Borrow: allow a state beyond the bar's end.
- Country flags give instant place recognition at tiny size. Use a flag plus a city name, never a flag alone.
- Facts shown on listings include investor count and pre-money valuation, so a card has two or three hard numbers, not ten.

**Republic Europe** (from the brief and campaign page text)
- A coloured progress bar with the key facts directly beneath it, so the eye goes bar, then numbers.
- Company logos carry the card identity; the rest of the card is quiet.
- Campaign pages say exactly what a bar counts (cash investments only). Borrow this honesty: say what "Confirmed" and "Total raised" mean in a one-line tooltip.

**Mixpanel**
- Product tabs that switch the featured view in place, rather than separate pages (home-page structure; styling not verified).
- Stat callouts as a row of large figures with small captions. Use for the home headline strip.
- Paired primary and secondary buttons everywhere ("Get started" beside "Book a demo"). Use one primary action per view.

**Notion** (general knowledge plus a design analysis that reads the site as warm off-white with a serif accent and one blue for actions)
- Warm, slightly tinted off-white background instead of pure white, and a near-black that is not pure black.
- One confident accent colour reserved for actions.
- Database views: filter chips above, a saved-view switcher, and a row opening into a side panel that keeps your place in the list.

**Stripe** (page structure plus a gradient write-up)
- Metrics as big numbers with small captions in a row of four ("135+", "US$1.9tn").
- Product shown in place: a real billing UI mockup instead of an illustration. For us, use a real row from the data in the hero, not a stock graphic.
- Sections separated by thin rules and generous space, not boxes around everything.
- Gradients are rare, large, soft and custom-tuned (blur, grain, rotation), and sit behind content, never inside UI controls.

**Figma**
- Nothing verifiable was retrieved. Take only the general principle: strong type hierarchy and generous space carry the page without an illustration budget.

## 6b. What the data products do

- **Beauhurst:** a deep filter builder plus saved searches (now called "templates"), collections that add new matches automatically, and alerts when a company in a collection raises. A reviewer said the many filters overwhelm new users, which supports the "five visible, rest hidden" rule. It also filters by time since last round, a good idea for our providers.
- **Dealroom:** the same filter bar and save mechanism across companies, investors and people. A saved search sends a daily digest of new matches. An Activity Centre collects saved searches, lists and alerts. Profiles hold funding history, investors, team and news.
- **Crunchbase and Harmonic:** pages that could be read say alerts are filtered by date, stage and geography, and profiles list investors, team and press. Layout detail not confirmed.
- **Sifted:** nothing found.
- **Linear, Attio, Airtable:** filter chips or dropdowns for the common filters above the table, and an advanced builder for complex ones; the applied state stays visible; saved views store filters, sort and columns; a side panel opens on row click; 4 to 8 columns by default; a dense mode for power users.

**What works for scanning:** primary data on the left, numbers right-aligned with tabular figures, consistent column widths, secondary text muted so it does not compete with the row title, and a visible count of results.

**For us (Phase 4 saved searches):** the code already serialises criteria canonically (`serialiseFundingCriteria`), so a saved search is a stored query string. The UI should be a "Save this search" button and a "Saved" dropdown next to the chips.

## 7. Craft rules: avoiding the "AI slop" look

Sources agree on the tells: a purple-to-blue gradient used as wallpaper, glassmorphism, six identical cards of equal weight, Inter as an unconsidered default, emoji as icons, floating 3D shapes and stock photos. The common cause is defaults, not intent. The checklist below can be enforced as design tokens.

**Checklist**
1. **One accent colour**, used for actions and selected state only. Everything else is neutral. Never use the accent as decoration.
2. **Neutrals are tinted**, not grey: pick a hue from the brand and set low saturation across the whole neutral scale, in both light and dark mode. Pure `#fff` and `#000` are banned as backgrounds and text.
3. **Meaningful colour only.** Stage colours, sector colours and status colours are a fixed, documented set, and each always appears with a text label or icon.
4. **No decorative gradients.** Allowed: one large, soft, low-contrast gradient behind the home hero, or a chart area fill fading to transparent. Banned: gradient text, gradient buttons, gradient borders, purple-blue anywhere.
5. **One radius scale** (for example 4, 8, 12 px) and a rule for which applies where: 4 for chips and inputs, 8 for buttons and rows, 12 for cards. Nested radii shrink (inner radius equals outer minus padding).
6. **One light source.** Shadows always fall down. Use at most two levels: a hairline border plus a very faint 1 to 2 px shadow for resting cards, and one larger soft shadow for popovers. In dark mode, drop shadows and use a slightly lighter surface plus a border.
7. **Borders over shadows** for data surfaces. Tables and rows use 1px hairlines in a tinted neutral.
8. **No glass.** No backdrop blur on cards. At most on a sticky header, with a solid fallback.
9. **Type pairing, not type variety.** One sans for UI, optionally one serif or mono used only for display numbers or section headings. A defined scale (for example 12, 14, 16, 20, 28, 40) and no sizes outside it. Tabular figures for every number.
10. **Spacing rhythm:** a 4px base with steps (4, 8, 12, 16, 24, 40, 64). Related items sit closer than unrelated ones, so groups read without boxes.
11. **Hierarchy through size and weight, not boxes.** If every card looks the same, the layout has no point of view. Make the main number large, the rest small.
12. **Real data, not filler.** Use actual rounds, actual logos, actual amounts in every mock-up and empty state. No lorem ipsum, no stock people, no emoji.
13. **Icons from one set**, one stroke weight, aligned to the text baseline.
14. **Motion is short and purposeful** (under 200ms, ease-out), and respects reduced-motion settings.
15. **Accessible contrast** of at least 4.5:1 for text and 3:1 for chart marks and chip borders, checked in both modes.

**Examples to study:** Stripe's rare, tuned gradient and metric rows; Notion's warm neutrals and single action blue; Linear and Attio for density and restraint in tables.

## 8. Trend views for the home page

Pew Research and Datawrapper guidance, and Tufte's sparklines, point the same way: use the simplest form that answers one question, and label with the takeaway.

1. **Headline strip (stat tiles):** "Rounds this month", "Raised this month (£)", "Median round size", each with change against last month and a tiny sparkline. Instant to read.
2. **Ranked bars, "Where the money went":** top 8 sectors by £ raised in the last 30 days, sorted, with the share and a "vs last month" arrow. Bars always start at zero. This is the single most readable form for non-analysts.
3. **Sparklines in the sector chips and table:** a 12-week line beside each sector name. Shape matters more than values. Tufte designed them for exactly this inline use.
4. **Small multiples for "sectors at a glance":** a grid of 8 to 12 equal tiles, one weekly bar chart per sector, same scale, sorted by recent growth, with a title stating the takeaway ("Climate: up 40% on last quarter"). Keep it below the fold and offer it as an option, as Pew warns small multiples can overwhelm a general audience.
5. **"Biggest rounds this week":** five rows reusing the card or row component, so the page teaches the layout it links to.

Avoid: multi-line charts with more than three series, pie charts, dual axes, and any chart without a plain-language title. Every chart needs a text table or list equivalent for accessibility, and colour is never the only signal.

## 9. Sources

Read:
- [Data Table UI Design Examples](https://www.saasui.design/data-table-ui-design)
- [Pew Research: small multiple charts](https://www.pewresearch.org/decoded/2018/12/20/how-pew-research-center-uses-small-multiple-charts/)
- [Stripe GB home page](https://stripe.com/gb) (text structure only)
- [Mixpanel home](https://mixpanel.com/home) (text structure only)

From search results (summaries, not full pages):
- [Beauhurst platform updates](https://announcekit.app/beauhurst/platform-updates/date/2025/8) and [Beauhurst help centre](https://beauhurst.com/help-centre/what-should-i-do-first/)
- [Dealroom: create and save searches](https://knowledge.dealroom.co/knowledge/how-to-create-and-save-searches?hsLang=en)
- [Attio: filter and sort views](https://attio.com/help/reference/managing-your-data/views/filter-and-sort-views)
- [Stripe filter controls pattern](https://docs.stripe.com/stripe-apps/patterns/filter-controls)
- [Datawrapper: small multiple line charts](https://www.datawrapper.de/blog/what-to-consider-when-creating-small-multiple-line-charts)
- [AI slop catalogue](https://www.mintlify.com/pbakaus/impeccable/concepts/anti-patterns) and [AI slop pattern list](https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md)
- [Notion design analysis (unofficial)](https://webdesignhot.com/design.md/notion/) and [Stripe design language (unofficial)](https://designlang.vercel.app/gallery/stripe-com/stripe-design-language.md)
- [Republic Europe campaign example](https://europe.republic.com/thecarcrowd2) and [Crowdcube listing data](https://p2pmarketdata.com/investments/count-on-crowdcube)

Could not be read: crowdcube.com/investments and europe.republic.com (403), live styling for Mixpanel, Notion, Stripe and Figma, Sifted, Crunchbase and Harmonic UI detail, Linear's own docs, and the leerob.com Stripe article (index page only).
