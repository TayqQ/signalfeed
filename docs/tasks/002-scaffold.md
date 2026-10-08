# 002 Project scaffold and CI

- **Tier:** 1 (scaffolding and config). **Suggested model:** Composer 2.5 or Claude Sonnet.
- **Depends on:** none. **Wave:** 1.

## Goal
Create the Next.js + TypeScript project with every Phase 1 dependency, script, lint rule and CI check in place. Later tasks then never need to touch `package.json` or shared config.

## Why it matters
Parallel tasks can't safely share `package.json` or config files. Owning them all here removes the main source of merge conflicts and gives every later task a working `pnpm check` from the start.

## Read first
- `AGENTS.md`
- `docs/spec.md` (sections 4, 9, 10, 11)
- `docs/decisions.md` (D1, D17, D18, D23)

## Files you may create or change
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (only if pnpm needs it for build-script approvals), `.npmrc`, `.nvmrc`
- `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`
- `vitest.config.ts`, `vitest.setup.ts`
- `.gitignore`, `.env.example`
- `.github/workflows/ci.yml`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- `src/lib/smoke.test.ts`

## Requirements
- Use the latest stable Next.js (App Router, `src/` directory, no `pages/`), React, Tailwind CSS v4 and the current Node LTS (put it in `.nvmrc` and `engines`). Set the `packageManager` field for pnpm.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, path alias `@/*` pointing to `src/*`.
- **Dependencies:** `next`, `react`, `react-dom`, `drizzle-orm`, `@neondatabase/serverless`, `pg`, `zod` (v4), `openai`, `fast-xml-parser`, `server-only`.
- **Dev dependencies:** `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/pg`, `drizzle-kit`, `@electric-sql/pglite`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `tsx`, `eslint`, `eslint-config-next`, `typescript-eslint`, `prettier`, `tailwindcss`, `@tailwindcss/postcss`, `@playwright/test`.
- **Scripts.** The target files are created by later tasks; that is expected.
  - `dev`, `build`, `start` (Next)
  - `lint` (`eslint .`), `format` / `format:check` (Prettier)
  - `typecheck` (`tsc --noEmit`)
  - `test` (`vitest run`), `test:watch`
  - `check` (`pnpm lint && pnpm typecheck && pnpm test`)
  - `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/db/migrate.ts`), `db:seed` (`tsx src/db/seed.ts`)
  - `pipeline` (`tsx src/cli/pipeline.ts`), `entities` (`tsx src/cli/entities.ts`), `eval` (`tsx src/eval/cli.ts`)
  - `screenshots` (`tsx scripts/screenshots.ts`)
- **ESLint** (flat config): `eslint-config-next` plus `typescript-eslint` recommended-type-checked, and `no-explicit-any` as an error. Use `no-restricted-imports` so files under `src/app/**` and `src/components/**` cannot import `@/pipeline/*`, and files under `src/pipeline/**` and `src/cli/**` cannot import `@/app/*` or `@/components/*`. Ignore `drizzle/`, `.next/`, `fixtures/`.
- **Vitest:** `environment: 'node'` by default, with `jsdom` for `*.test.tsx` (via `environmentMatchGlobs` or projects, whichever the installed version supports). `passWithNoTests: false`. Include `src/**/*.test.{ts,tsx}`.
- **`vitest.setup.ts`:** replace `globalThis.fetch` with a function that throws `"Network access is disabled in tests; inject a fake HttpFetcher"`. Load `@testing-library/jest-dom`.
- **`.env.example`:** `DATABASE_URL`, `OPENAI_API_KEY`, `EXTRACTION_MODEL`, `LLM_MONTHLY_CAP_GBP=3`, `MAX_EXTRACTIONS_PER_RUN=150`, `HTTP_CONTACT` (a URL or email used in the User-Agent), each with a one-line comment.
- **`src/app/page.tsx`:** a placeholder "SignalFeed" heading. **`layout.tsx`:** html lang `en-GB`, metadata title.
- **`src/lib/smoke.test.ts`:** one test asserting that `fetch` throws (proves the setup file runs).
- **`.github/workflows/ci.yml`:** on push and pull_request. Use pnpm with a cache, then run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. The build must not need any secrets. Add `permissions: contents: read`.

## Acceptance criteria
These commands all succeed locally:
```
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm build
```
- Importing `@/pipeline/x` from a file in `src/app` is a lint error. Test this temporarily and don't commit the test file.
- CI passes on the task branch.

## Out of scope
- Any database, pipeline or real UI code.
- `LICENSE`. The maintainer creates the repo with GitHub's AGPL-3.0 template.
- README content beyond what create-next-app generates. Delete the generated README if there is one; Task 023 writes it.
