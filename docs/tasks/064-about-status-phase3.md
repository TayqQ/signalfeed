# 064 About and status page updates

- **Tier:** 1 (wording and counts). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 051, 059. **Wave:** 4.

## Goal
Explain Phase 3 methods and limits on `/about`, with Companies House and SEC attribution, and add registry, Form D and confirmation counts to `/status`.

## Why it matters
Users should know what "confirmed" does and does not mean, and the maintainer needs to see at a glance whether linking and collection are working.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 7, 8, 9, 11, 13.3)
- `docs/sources.md` ("Phase 3 sources": attribution)
- `src/app/about/page.tsx`, `src/app/status/page.tsx`
- `src/db/queries/status.ts` and its test, `src/core/read-models.ts` (`StatusSummary`)

## Files you may create or change
- `src/app/about/page.tsx`
- `src/app/status/page.tsx`
- `src/db/queries/status.ts`, `src/db/queries/status.test.ts`

## Steps
1. **About.** A short section each, in plain British English:
   - **Companies House links:** how a company is linked (exact name plus a supporting fact; otherwise left unlinked), that a link can be wrong and how to report it, and that SignalFeed never stores officers' or shareholders' names.
   - **Confirmed raises:** what an SH01 or a Form D confirms (that shares were issued or an offering was filed at about that time), and that amounts stay as news reported them unless the marker says the amount agrees.
   - **Company facts:** incorporation date and founded year, SIC sectors only for companies with no theme, size bands from the latest accounts ("full accounts" does not mean large), registered office districts and why shared addresses are ignored.
   - **Attribution:** "Source: Companies House. Contains public sector information from the Companies House register." and "Source: U.S. Securities and Exchange Commission, EDGAR (Form D)." Check the wording against `docs/sources.md`.
2. **Status query.** Add to `StatusSummary`: registry links by status and method; companies searched with no match; open candidates; profiles older than 90 days; last registry run's requests and whether it hit the limit or a 429 (from the latest run stats); Form D: last done index day, filings stored, funds skipped, linked filings; confirmations by record kind; news events confirmed.
3. **Status page.** A "Registry and filings" section rendering those counts, in the existing table style.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass.
- `status.test.ts` (PGlite): every new count on seeded rows, and zeros on an empty database.

## Out of scope
- Funding and company pages (063).
