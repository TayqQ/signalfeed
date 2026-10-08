# 023 README, screenshots and architecture diagram

- **Tier:** 1 (documentation plus a small screenshot script). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** 021, 022. **Wave:** 8.

## Goal
Write the public README (what it is, screenshots, architecture diagram, how it works, running locally, limitations, licence) and `CONTRIBUTING.md`, plus a script that captures the screenshots.

## Why it matters
The README is the first thing a visitor to the repo reads. It should explain the project and its trade-offs clearly within a couple of minutes, and be honest about the limitations.

## Read first
- `AGENTS.md`
- `docs/spec.md`, `docs/decisions.md`, `docs/deployment.md`, `docs/eval-results.md`, `docs/sources.md`
- `docs/tasks/README.md`
- `package.json`, `.env.example`

## Files you may create or change
- `README.md`
- `CONTRIBUTING.md`
- `scripts/screenshots.ts`
- `docs/images/*.png`

## Requirements
- **`scripts/screenshots.ts`:** uses Playwright (`chromium`, already a dev dependency; run `pnpm exec playwright install chromium` locally). Takes a base URL (default `http://localhost:3000`) and saves `docs/images/funding-table.png`, `company-page.png` and `status.png` at a 1280×800 viewport, plus `funding-table-mobile.png` at 390×844. Run it against the production URL, or against local seed data if production has too little data yet. Say which one in the image captions.
- **`README.md`** sections:
  1. one-paragraph description and the live link;
  2. screenshots;
  3. features (Phase 1);
  4. architecture: a Mermaid diagram adapted from spec section 4, plus 5-8 bullets on key design choices linking to `docs/decisions.md`;
  5. how extraction works, and accuracy (summary table from `docs/eval-results.md`);
  6. cost controls (the three spend-cap layers; the web can't trigger ingestion);
  7. tech stack;
  8. running locally: prerequisites, `pnpm install`, a local Postgres with pgvector via a one-line `docker run pgvector/pgvector:...`, `.env`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, `pnpm check`;
  9. **limitations**: news-only coverage and bias towards English-language and well-covered startups; headline and summary extraction misses details; amounts are as reported, not verified (filings come in Phase 3); history starts at the first ingest date; entity merging is conservative, so some duplicates remain until they are reviewed; fixtures paraphrase summaries, so live accuracy may be lower; Vercel Hobby is non-commercial;
  10. roadmap (link to `docs/roadmap.md`);
  11. data and attribution policy;
  12. licence (AGPL-3.0).
- **`CONTRIBUTING.md`:** setup, `pnpm check`, task-file workflow, Conventional Commits, the "edit only listed files" rule, data rules (no article text, no personal data), and a note that contributions may require a CLA if dual licensing is introduced.
- Write for users and contributors only.

## Acceptance criteria
- `pnpm check` passes. The Mermaid diagram renders on GitHub (check the pull request preview).
- Every image referenced in the README exists, and every relative link resolves (check with `pnpm dlx markdown-link-check README.md CONTRIBUTING.md`).

## Out of scope
- Changing application code, spec or decisions.
