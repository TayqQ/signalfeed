# 077 Company page rebuild

- **Tier:** 2. **Suggested model:** Claude Opus (layout and craft carry the result).
- **Depends on:** 075, 076. **Wave:** UX 2 (parallel with 078).

## Goal
`/companies/[slug]` becomes the single combined page from `docs/design/design-system.md` section 2. It takes:
- B's header;
- C's action row and Signals;
- A's sticky side column;

all built from the 075 primitives, with honest states for missing data.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` sections 2, 4 and 6
- `docs/design/research.md` section 4
- The prototypes `docs/design/directions/b-briefing.html`, `c-prospector.html` and `a-terminal.html` (company views), as a visual reference
- `src/app/companies/[slug]/page.tsx`, plus these components:
  - `src/components/event-timeline.tsx`
  - `company-registry.tsx`
  - `company-momentum.tsx`
  - `company-location.tsx`
  - `investor-list.tsx`
  - `source-list.tsx`
  - `tag-list.tsx`
- `src/db/queries/companies.ts` (`getCompanyDetail`)

## Files you may create or change
- `src/app/companies/[slug]/page.tsx`
- `src/components/company/*.tsx` and tests (new: header, action row, key facts, latest round, signals, official records, similar companies)
- `src/components/event-timeline.tsx`, `company-registry.tsx`, `company-momentum.tsx`, `company-location.tsx`, `investor-list.tsx`, `source-list.tsx`, `tag-list.tsx` and their tests (restyle or retire; delete a component only when nothing else imports it)
- `src/db/queries/companies.ts` and its test: only to add "Companies like this" (same main sector, then the same stage; at most 5; excluding this company).
- `scripts/screenshots.ts`: add the company page at 375 px in both themes.
- `docs/tasks/README.md` (the 077 row only)

## Steps
1. **Layout.** Follow section 2's order exactly. Use two columns from `lg`, with the side column sticky below the header. Use one column below `lg`, in the phone order given in the spec.
2. **Action row.**
   - Visit website: disabled-looking but focusable, with a "Website not found yet" note when there is no domain.
   - Companies House: a link to the company's public page, only when linked.
   - Copy company number: a client component with a "Copied" confirmation and an `aria-live` message.
   - Share: uses `navigator.share` when available, otherwise copies the URL.
3. **Signals.** Derive these in plain words from stored data only:
   - "Confirmed by a Companies House filing";
   - "Raised in the last 30 days";
   - "First round we have recorded";
   - "Raised again within 24 months";
   - "Reported by N sources".

   Never guess or score.
4. **Missing data.** "Not known" in key facts, "Sector pending", "No Companies House match yet" (`EmptyState`), and the existing history caveat ("History starts in November 2026").
5. **First screen.** At 375 × 812 the header, key facts and latest round are fully visible without scrolling, for both a rich company and a sparse one. Check with the screenshots.

## Tests and acceptance criteria
- Component tests for the signals' wording and conditions, the action row with and without a registry link, and the key-fact fallbacks.
- No horizontal scroll at 375 px.
- Screenshots at 375 and 1280 px, light and dark, for a confirmed UK company and a news-only company, attached in the hand-back (paths).
- `pnpm check` and `pnpm build` pass.

## Out of scope
- Favicons (Phase 3.5 task 073).
- Investor pages.
- Any commit.
