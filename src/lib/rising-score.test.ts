import { describe, expect, it } from "vitest";
import type { RoundType } from "@/core/enums";
import {
  BASELINE_WEEKS,
  MIN_BASELINE_WEEKS,
  MIN_RECENT_ROUNDS,
  RECENT_WEEKS,
  SHRINKAGE_ALPHA,
  describeScore,
  isEarlyMomentum,
  lateShare,
  rankEarlyMomentum,
  rankRising,
  risingScore,
  windows,
} from "./rising-score";

const twoDp = (value: number | null) =>
  value === null ? null : value.toFixed(2);

describe("constants", () => {
  it("match spec section 8.1", () => {
    expect(RECENT_WEEKS).toBe(8);
    expect(BASELINE_WEEKS).toBe(26);
    expect(MIN_BASELINE_WEEKS).toBe(8);
    expect(SHRINKAGE_ALPHA).toBe(3);
    expect(MIN_RECENT_ROUNDS).toBe(3);
  });
});

describe("windows", () => {
  it("uses 8 recent weeks and 26 baseline weeks with long history", () => {
    expect(windows("2026-11-02", "2024-04-01")).toEqual({
      recent: { from: "2026-09-14", to: "2026-11-02", weeks: 8 },
      baseline: { from: "2026-03-16", to: "2026-09-07", weeks: 26 },
    });
  });

  it("starts the baseline at the first collected week", () => {
    expect(windows("2026-11-02", "2026-06-03")?.baseline).toEqual({
      from: "2026-06-01",
      to: "2026-09-07",
      weeks: 15,
    });
  });

  it("needs at least 8 baseline weeks (16 weeks in all)", () => {
    expect(windows("2026-11-02", "2026-07-20")?.baseline.weeks).toBe(8);
    expect(windows("2026-11-02", "2026-07-27")).toBeNull();
    expect(windows("2026-11-02", "2026-10-26")).toBeNull();
  });
});

// Spec section 8.1: N_R = 400, N_B = 1,200, so e = b / 3.
const SPEC_ROWS = [
  { slug: "a", recent: 1, baseline: 0, expected: 0, score: "0.29" },
  { slug: "b", recent: 6, baseline: 6, expected: 2, score: "0.59" },
  { slug: "c", recent: 40, baseline: 120, expected: 40, score: "0.00" },
  { slug: "d", recent: 60, baseline: 120, expected: 40, score: "0.38" },
  { slug: "e", recent: 2, baseline: 30, expected: 10, score: "-0.96" },
  { slug: "f", recent: 15, baseline: 9, expected: 3, score: "1.10" },
] as const;

function scoreRow(recent: number, baseline: number) {
  return risingScore({
    recent,
    baseline,
    totalRecent: 400,
    totalBaseline: 1200,
  });
}

describe("risingScore", () => {
  it.each(SPEC_ROWS)(
    "gives theme $slug the spec's score $score",
    ({ recent, baseline, expected, score }) => {
      const result = scoreRow(recent, baseline);
      expect(result.expected).toBeCloseTo(expected, 10);
      expect(twoDp(result.score)).toBe(score);
    },
  );

  it("is exactly 0 when the theme keeps its share", () => {
    expect(scoreRow(40, 120).score).toBe(0);
  });

  it("is null when there are no baseline rounds at all", () => {
    expect(
      risingScore({
        recent: 5,
        baseline: 0,
        totalRecent: 10,
        totalBaseline: 0,
      }),
    ).toEqual({ expected: 0, score: null });
  });

  it("rejects negative or non-finite counts", () => {
    expect(() =>
      risingScore({
        recent: -1,
        baseline: 0,
        totalRecent: 1,
        totalBaseline: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      risingScore({
        recent: 1,
        baseline: Number.NaN,
        totalRecent: 1,
        totalBaseline: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("rankRising", () => {
  const rows = SPEC_ROWS.map((row) => ({
    slug: row.slug,
    recent: row.recent,
    score: scoreRow(row.recent, row.baseline).score,
  }));

  // Spec discrepancy: section 8.1 gives the page order as F, B, D, C, E, but
  // E has r = 2, so the r ≥ 3 rule hides it, just as it hides A (r = 1).
  // The rule wins; the spec's order holds for the scores themselves.
  it("orders the spec's themes F, B, D, C and hides A and E (r < 3)", () => {
    expect(rankRising(rows).map((row) => row.slug)).toEqual([
      "f",
      "b",
      "d",
      "c",
    ]);
  });

  it("scores the spec's themes in the order F, B, D, C, E", () => {
    const scores = ["f", "b", "d", "c", "e"].map(
      (slug) => rows.find((row) => row.slug === slug)?.score ?? Number.NaN,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1] as number);
    }
  });

  it("lists E once it has 3 recent rounds", () => {
    const withE = rows.map((row) =>
      row.slug === "e"
        ? { ...row, recent: 3, score: scoreRow(3, 30).score }
        : row,
    );
    expect(rankRising(withE).map((row) => row.slug)).toEqual([
      "f",
      "b",
      "d",
      "c",
      "e",
    ]);
  });

  it("does not depend on input order", () => {
    expect(rankRising([...rows].reverse())).toEqual(rankRising(rows));
  });

  it("breaks ties by recent rounds, then slug, and puts null scores last", () => {
    const ranked = rankRising([
      { slug: "zeta", recent: 5, score: null },
      { slug: "beta", recent: 4, score: 0.5 },
      { slug: "alpha", recent: 4, score: 0.5 },
      { slug: "gamma", recent: 9, score: 0.5 },
      { slug: "delta", recent: 3, score: null },
    ]);
    expect(ranked.map((row) => row.slug)).toEqual([
      "gamma",
      "alpha",
      "beta",
      "zeta",
      "delta",
    ]);
  });

  it("keeps extra fields and does not change the input", () => {
    const input = [
      { slug: "x", recent: 3, score: 0.1, name: "X" },
      { slug: "y", recent: 3, score: 0.2, name: "Y" },
    ];
    const ranked = rankRising(input);
    expect(ranked.map((row) => row.name)).toEqual(["Y", "X"]);
    expect(input.map((row) => row.slug)).toEqual(["x", "y"]);
  });
});

/** `count` companies, each with the given round types. */
function companies(count: number, roundTypes: RoundType[]): RoundType[][] {
  return Array.from({ length: count }, () => [...roundTypes]);
}

describe("early momentum (spec section 8.2)", () => {
  // "Agentic accounting": r_early 7, b_early 4, early totals 150 and 450.
  const early = risingScore({
    recent: 7,
    baseline: 4,
    totalRecent: 150,
    totalBaseline: 450,
  });
  // 12 companies with a known round type, 2 of them at Series A.
  const share = lateShare([
    ...companies(8, ["seed"]),
    ...companies(2, ["pre_seed", "seed"]),
    ...companies(2, ["seed", "series_a"]),
  ]);

  it("gives the worked example's score and late share", () => {
    expect(early.expected).toBeCloseTo(4 / 3, 10);
    expect(twoDp(early.score)).toBe("0.84");
    expect(twoDp(share)).toBe("0.17");
  });

  it("lists the worked example", () => {
    expect(
      isEarlyMomentum({ recent: 7, score: early.score, lateShare: share }),
    ).toBe(true);
  });

  it("needs 3 recent early rounds, a positive score and a late share of at most 0.25", () => {
    const base = { recent: 3, score: 0.1, lateShare: 0.25 };
    expect(isEarlyMomentum(base)).toBe(true);
    expect(isEarlyMomentum({ ...base, recent: 2 })).toBe(false);
    expect(isEarlyMomentum({ ...base, score: 0 })).toBe(false);
    expect(isEarlyMomentum({ ...base, score: null })).toBe(false);
    expect(isEarlyMomentum({ ...base, lateShare: 0.26 })).toBe(false);
    expect(isEarlyMomentum({ ...base, lateShare: null })).toBe(false);
  });

  it("ranks listed themes by score, then recent early rounds, then slug", () => {
    const ranked = rankEarlyMomentum([
      { slug: "c", recent: 4, score: 0.3, lateShare: 0.1 },
      { slug: "b", recent: 9, score: 0.84, lateShare: 0.2 },
      { slug: "a", recent: 9, score: 0.84, lateShare: 0.2 },
      { slug: "late", recent: 9, score: 2, lateShare: 0.5 },
    ]);
    expect(ranked.map((row) => row.slug)).toEqual(["a", "b", "c"]);
  });
});

describe("lateShare", () => {
  it("ignores companies with only unknown, debt or grant rounds", () => {
    expect(
      lateShare([
        ...companies(4, ["seed"]),
        ...companies(1, ["series_b"]),
        ...companies(3, ["unknown", "debt", "grant"]),
        [],
      ]),
    ).toBeCloseTo(1 / 5, 10);
  });

  it("counts a company with only later rounds as known and late", () => {
    expect(
      lateShare([...companies(4, ["growth"]), ...companies(1, ["seed"])]),
    ).toBeCloseTo(4 / 5, 10);
  });

  it("is null below 5 companies with a known round type", () => {
    expect(
      lateShare([...companies(4, ["seed"]), ...companies(3, ["unknown"])]),
    ).toBeNull();
  });
});

describe("describeScore", () => {
  it("gives exp(s) to one decimal", () => {
    expect(describeScore(Math.log(2))).toBe("about 2.0× its usual share");
    expect(describeScore(Math.log(18 / 6))).toBe("about 3.0× its usual share");
    expect(describeScore(Math.log(5 / 13))).toBe("about 0.4× its usual share");
    expect(describeScore(0)).toBe("about 1.0× its usual share");
  });

  it("explains a missing score", () => {
    expect(describeScore(null)).toBe("not enough history yet");
  });
});
