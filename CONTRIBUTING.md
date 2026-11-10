# Contributing

## Setup

Follow "Run it locally" in the README. Before opening a pull request, run:

```bash
pnpm check
```

```bash
pnpm build
```

Tests never touch the network or real APIs. Database tests use `createTestDb()`, which runs real Postgres in-process, so they need no setup.

## How work is organised

Phase 1 was built from the task files in `docs/tasks/`, each listing the files it may change. For new work, keep changes small and say which files you expect to touch. Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Decisions go in `docs/decisions.md`, appended rather than rewritten.

## Data rules

- Never display feed summaries or any article text. Show headlines, links and extracted facts only.
- Never keep records of individual people or their contact details.
- Never add special cases for particular headlines or company names. Fix the rule and add a test, or record a manual merge with `pnpm entities`.
- If a merge is wrong, add the pattern to `fixtures/resolution/cases.json`. Do not edit a gold key to raise a score.

## Licence

Contributions are under AGPL-3.0. A contributor licence agreement may be needed if dual licensing is introduced later.
