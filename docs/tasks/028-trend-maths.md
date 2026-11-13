# 028 Trend maths: weeks, rising score and company momentum

- **Tier:** 3 (the numbers every trend view shows). **Suggested model:** Claude Opus.
- **Depends on:** 025. **Wave:** 2.

## Goal
Implement the formulas in spec-phase2 section 8 as pure, documented, tested functions in `src/lib`.

## Why it matters
The rising score and momentum signals are the core of Phase 2. Pure functions with the spec's worked examples as tests make them explainable and stop silent drift. Both the pipeline and the web app import them.

## Read first
- `AGENTS.md`
- `docs/spec-phase2.md` (section 8)
- `docs/decisions.md` (D36, D43)
- `src/core/read-models.ts`, `src/core/enums.ts`, `src/lib/size-bands.ts` (style)

## Files you may create or change
- `src/lib/weeks.ts`, `src/lib/weeks.test.ts` (new)
- `src/lib/rising-score.ts`, `src/lib/rising-score.test.ts` (new)
- `src/lib/company-momentum.ts`, `src/lib/company-momentum.test.ts` (new)
- `src/lib/trend-stats.ts`, `src/lib/trend-stats.test.ts` (new)

## Steps
1. **`weeks.ts`:** `weekStart(date)` (the Monday, UTC, as `YYYY-MM-DD`), `addWeeks`, `lastCompleteWeek(now)`, and `weekRange(from, to)`. Everything in UTC.
2. **`rising-score.ts`:**
   - constants `RECENT_WEEKS = 8`, `BASELINE_WEEKS = 26`, `MIN_BASELINE_WEEKS = 8`, `SHRINKAGE_ALPHA = 3`, `MIN_RECENT_ROUNDS = 3`;
   - `windows(lastCompleteWeek, firstCollectedWeek)` returns the recent and baseline week ranges, or null when the baseline has fewer than 8 weeks;
   - `risingScore({ recent, baseline, totalRecent, totalBaseline })` returns `{ expected, score }`, with `score` null when `totalBaseline` is 0;
   - `rankRising(rows)` filters `recent >= 3` and sorts by score, then recent count, then slug;
   - `lateShare(companies)` and `isEarlyMomentum(row)` from section 8.2;
   - `describeScore(score)` gives "about 2.0× its usual share".
   - A doc comment states the formula and why α = 3.
3. **`company-momentum.ts`:** `computeRoundMomentum(rounds)` takes one company's funding rounds (`eventId`, `announcedOn`, `datePrecision`, `roundType`, `amountGbpMinor`) and returns one result per equity round, following section 8.3: numbering, months with the day and precision rules, step-up against the latest earlier round with an amount within 36 months, and rounds in the 24 months to date. Also `roundsInLastMonths(rounds, asOf, 24)`. Debt and grant rounds are skipped. Output is independent of input order.
4. **`trend-stats.ts`:** `median(values)`, `targetAge(foundedYear, announcedOn)` (null outside 1900 to the announcement year), and `coverage(known, total)` for labels such as "4 of 19".

## Tests and acceptance criteria
- `pnpm check` passes.
- The six rising-score rows in spec section 8.1 give exactly the stated scores to 2 decimal places, and `rankRising` returns F, B, D, C, E.
- The early-momentum example in 8.2 gives 0.84 and late share 0.17, and is listed.
- The company in 8.3 gives exactly the table's values, the debt round is ignored, and shuffled input gives the same output.
- Edge cases: `month` precision ignores days; `year` precision gives null months; equal dates give 0 months; a zero or missing amount gives a null step-up; a basis older than 36 months gives null.
- `weekStart` handles year boundaries (2026-12-31 is in the week starting 2026-12-28) and Sundays.
- `median` of an empty list is null; even-length lists average the middle two (integer pence, rounded down).

## Out of scope
- Reading or writing the database (033, 036), and rendering (040-042).
