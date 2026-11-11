# 030 Server-rendered chart components

- **Tier:** 2 (presentational components with pure layout maths). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** none. **Wave:** 2.

## Goal
Build three accessible SVG chart components (sparkline, weekly column chart, horizontal bar chart) and their layout maths, with no chart library and no client JavaScript.

## Why it matters
Trend pages need charts that render on the server, work without JavaScript, and can be read by screen readers. Owning ~300 lines of SVG code avoids a dependency and a client bundle (D38).

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (sections 12.1 and 12.2)
- `docs/decisions.md` (D18, D38)
- `src/app/globals.css`, `src/components/funding-table.tsx` (style and colour tokens)

## Files you may create or change
- `src/lib/chart-scale.ts`, `src/lib/chart-scale.test.ts` (new)
- `src/components/charts/chart-figure.tsx` (new)
- `src/components/charts/sparkline.tsx` (new)
- `src/components/charts/column-chart.tsx` (new)
- `src/components/charts/bar-chart.tsx` (new)
- `src/components/charts/charts.test.tsx` (new)
- `src/app/globals.css` (chart colour tokens and patterns only)

## Steps
1. **`chart-scale.ts`:** `linearScale(domain, range)`, `niceTicks(max, count)` (1, 2, 5 × 10ⁿ steps), `bandLayout(n, width, gap)`, `stack(series)`, and `formatAxisValue` (compact numbers, and GBP via the existing formatter where needed).
2. **`ChartFigure`:** a `<figure>` with the SVG, a `<figcaption>` holding a required `summary` sentence, and a `<details><summary>Show data</summary><table>…</table></details>` with real `<th scope>` headers.
3. **`Sparkline`:** a small inline line for weekly counts, `role="img"` with an `aria-label` such as "Weekly rounds over 26 weeks, from 2 to 9". It has no axes and no figure wrapper, because it sits in a table cell next to the numbers.
4. **`ColumnChart`:** weekly columns, optionally stacked (for example early, later and unknown stage), with a y-axis using nice ticks, sparse x labels (every 4 weeks or month starts), and a text legend. Stacked series differ by fill pattern as well as colour.
5. **`BarChart`:** horizontal bars with labels and values, for top acquirers or investors.
6. Colours come from CSS variables in `globals.css` that pass WCAG AA contrast against the background, in light and dark mode if the site supports both. Use `viewBox` and `width="100%"` so charts scale down to 360 px.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass. No `"use client"` in any chart file.
- `chart-scale` tests: `niceTicks(9, 4)` gives `[0, 2, 4, 6, 8, 10]`; an all-zero series does not divide by zero; `stack` totals equal the sum of the series.
- Component tests render each chart and assert: an accessible name, the caption text, a data table whose rows match the input, a legend for stacked series, and an empty-data state ("No data yet") rather than an empty SVG.

## Out of scope
- Pages (040-042), interactivity, tooltips that need JavaScript.
