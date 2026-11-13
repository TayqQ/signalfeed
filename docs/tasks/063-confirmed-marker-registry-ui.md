# 063 Confirmed marker, filters and registry facts on pages

- **Tier:** 2 (small UI changes following existing components). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 052, 059. **Wave:** 4.

## Goal
Show the "Confirmed" marker and its wording, add the confirmed and company size filters to the funding page, and show registry facts and confirmations on company pages. Keep it minimal and functional.

## Why it matters
Users need to see which raises an official filing backs, and the paying user needs company age, status and size at a glance (spec-phase3 section 11). The maintainer will do one full UX/UI overhaul later, so this task follows existing components and adds no new visual language.

## Read first
- `AGENTS.md`
- `docs/spec-phase3.md` (sections 9.1, 11)
- `docs/spec-phase2.md` (section 12.1, accessibility)
- `src/core/read-models.ts`
- `src/app/page.tsx`, `src/components/funding-table.tsx`, `src/components/funding-filters-form.tsx`
- `src/app/companies/[slug]/page.tsx`, `src/components/event-timeline.tsx`, `src/components/company-location.tsx`
- `src/lib/format.ts`, `src/lib/registry/company-size.ts`

## Files you may create or change
- `src/app/page.tsx`
- `src/components/funding-table.tsx`, `src/components/funding-table.test.tsx`
- `src/components/funding-filters-form.tsx`
- `src/app/companies/[slug]/page.tsx`
- `src/components/event-timeline.tsx`, `src/components/event-timeline.test.tsx`
- `src/components/confirmed-marker.tsx`, `src/components/confirmed-marker.test.tsx` (new)
- `src/components/company-registry.tsx`, `src/components/company-registry.test.tsx` (new)

## Steps
1. **`confirmed-marker.tsx`:** a small text label "Confirmed" in the existing quiet style, whose accessible name and `title` are the confirmation text ("Confirmed: shares allotted on 2 February 2026 (Companies House SH01)"). Text, not colour alone. No client JavaScript.
2. **Funding table:** the marker beside the date of rows with a confirmation. Grants keep their existing wording.
3. **Filters form:** a checkbox "Confirmed by an official filing" (`evidence=confirmed`) and a "Company size" group of checkboxes (`cosize`), with a one-line hint: "From the company's latest accounts at Companies House. UK companies only." Follow the existing form markup; the form must still work without JavaScript.
4. **Company page, `company-registry.tsx`:** a "Registry" section with the fields in spec section 11 for Companies House (number linked to its public page, status, type, incorporated, SIC codes with descriptions, size band with "accounts made up to", registered office postcode district) and SEC (CIK linked to EDGAR). "Source: Companies House" and "Source: SEC EDGAR" lines. A dissolved or insolvent status is shown as text in the heading area too ("Dissolved on 3 May 2026"). Nothing is shown for companies with no link.
5. **Timeline:** each event lists its confirmations under the amount, using the confirmation text. A grant with attached news reports shows both its GtR source line and the headlines.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass.
- Component tests: the marker's accessible name is the confirmation text; the table shows it only for confirmed rows; the registry block renders each field, never a full postcode, and nothing when there is no link; the timeline shows confirmation lines.
- Manually with `pnpm dev` and the seed data (059): the filters change the URL as expected and round-trip; pages work with JavaScript off.

## Out of scope
- New pages, charts or a redesign. About and status pages (064).
