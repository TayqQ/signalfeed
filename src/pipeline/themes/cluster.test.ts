import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_BANDS,
  DEFAULT_THEME_THRESHOLD,
  assignGreedy,
  cosine,
  meanCentroid,
  normalise,
  type GreedyTag,
} from "./cluster";
import { axis, tightGroup, vectorAt } from "./testing";

const DIMS = 16;

function tag(
  id: number,
  slug: string,
  embedding: number[],
  mentions = 1,
): GreedyTag {
  return { id, slug, mentions, embedding };
}

describe("vector helpers", () => {
  it("computes cosine similarity and handles zero vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([2, 0], [3, 0])).toBe(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine(vectorAt(0.6, 0, 1, DIMS), axis(0, DIMS))).toBeCloseTo(
      0.6,
      12,
    );
    expect(() => cosine([1], [1, 0])).toThrow(/lengths differ/);
  });

  it("normalises to unit length and leaves zero alone", () => {
    expect(normalise([3, 4])).toEqual([0.6, 0.8]);
    expect(normalise([0, 0])).toEqual([0, 0]);
  });

  it("takes the normalised mean", () => {
    const c = meanCentroid([
      [1, 0],
      [0, 1],
    ]);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(() => meanCentroid([])).toThrow();
  });

  it("defaults τ to 0.76, the theme eval's choice", () => {
    expect(DEFAULT_THEME_THRESHOLD).toBe(0.76);
  });

  it("defaults the LLM check band to 0.72 to 0.88 (D47)", () => {
    expect(DEFAULT_THEME_BANDS).toEqual({ low: 0.72, high: 0.88 });
  });
});

describe("assignGreedy", () => {
  it("turns three tight groups into three themes", () => {
    const groups = [0, 1, 2].map((centre) =>
      tightGroup(centre, 4, { dimensions: 64, spread: 10 }),
    );
    const tags = groups.flatMap((vectors, g) =>
      vectors.map((v, i) => tag(g * 10 + i, `g${g}-t${i}`, v, 10 - i)),
    );
    const result = assignGreedy({ tags, themes: [] });

    expect(result.newThemes).toHaveLength(3);
    expect(result.assignments).toHaveLength(12);
    for (const [g] of groups.entries()) {
      const targets = new Set(
        result.assignments
          .filter((a) => Math.floor(a.tagId / 10) === g)
          .map((a) => JSON.stringify(a.target)),
      );
      expect(targets.size).toBe(1);
    }
    // Seeds are the most mentioned tag of each group.
    expect(result.newThemes.map((t) => t.seedSlug).sort()).toEqual([
      "g0-t0",
      "g1-t0",
      "g2-t0",
    ]);
    expect(result.updatedCentroids).toEqual([]);
  });

  it("starts a new theme just below τ and joins just above", () => {
    const themes = [{ id: 7, centroid: axis(0, DIMS), members: [] }];
    const below = assignGreedy({
      tags: [
        tag(1, "below", vectorAt(DEFAULT_THEME_THRESHOLD - 0.001, 0, 1, DIMS)),
      ],
      themes,
    });
    expect(below.newThemes).toHaveLength(1);
    expect(below.assignments[0]).toMatchObject({
      target: { kind: "new", index: 0 },
      similarity: 1,
    });

    const above = assignGreedy({
      tags: [
        tag(2, "above", vectorAt(DEFAULT_THEME_THRESHOLD + 0.001, 0, 1, DIMS)),
      ],
      themes,
    });
    expect(above.newThemes).toHaveLength(0);
    expect(above.assignments[0]!.target).toEqual({ kind: "existing", id: 7 });
    expect(above.assignments[0]!.similarity).toBeCloseTo(
      DEFAULT_THEME_THRESHOLD + 0.001,
      9,
    );
    expect(above.updatedCentroids.map((u) => u.id)).toEqual([7]);
  });

  it("counts exactly τ as a match", () => {
    const result = assignGreedy({
      tags: [tag(1, "edge", [0.5, Math.sqrt(0.75)])],
      themes: [{ id: 1, centroid: [1, 0], members: [] }],
      threshold: 0.5,
    });
    expect(result.newThemes).toHaveLength(0);
  });

  it("updates the centroid after each assignment", () => {
    // b is 0.55 from the seed but 0.7+ from the mean of seed and a.
    const seed = axis(0, DIMS);
    const a = vectorAt(0.8, 0, 1, DIMS);
    const b = vectorAt(0.55, 0, 1, DIMS);
    const result = assignGreedy({
      tags: [tag(1, "seed", seed, 3), tag(2, "a", a, 2), tag(3, "b", b, 1)],
      themes: [],
    });
    expect(result.newThemes).toHaveLength(1);
    expect(result.assignments.map((x) => x.target)).toEqual([
      { kind: "new", index: 0 },
      { kind: "new", index: 0 },
      { kind: "new", index: 0 },
    ]);
    expect(result.newThemes[0]!.centroid).toEqual(meanCentroid([seed, a, b]));
  });

  it("uses existing members when it recomputes a centroid", () => {
    const members = [axis(0, DIMS), axis(0, DIMS), axis(0, DIMS)];
    const newcomer = vectorAt(0.7, 0, 1, DIMS);
    const result = assignGreedy({
      tags: [tag(1, "x", newcomer)],
      themes: [{ id: 3, centroid: axis(0, DIMS), members }],
      threshold: 0.6,
    });
    expect(result.updatedCentroids).toEqual([
      { id: 3, centroid: meanCentroid([...members, newcomer]) },
    ]);
  });

  it("gives ties to the lower theme id", () => {
    const between = normalise([1, 1, 0, 0]);
    const result = assignGreedy({
      tags: [tag(1, "between", between)],
      themes: [
        { id: 9, centroid: [0, 1, 0, 0], members: [] },
        { id: 4, centroid: [1, 0, 0, 0], members: [] },
      ],
      threshold: 0.6,
    });
    expect(result.assignments[0]!.target).toEqual({ kind: "existing", id: 4 });
  });

  it("prefers existing themes to new ones on a tie", () => {
    const between = normalise([1, 1, 0, 0]);
    const result = assignGreedy({
      tags: [tag(1, "seed", [0, 1, 0, 0], 2), tag(2, "between", between, 1)],
      themes: [{ id: 50, centroid: [1, 0, 0, 0], members: [] }],
      threshold: 0.6,
    });
    expect(result.assignments[1]!.target).toEqual({ kind: "existing", id: 50 });
  });

  it("gives identical output for shuffled input in the same mention order", () => {
    const vectors = [
      ...tightGroup(0, 5, { dimensions: 64, spread: 10, similarity: 0.8 }),
      ...tightGroup(1, 5, { dimensions: 64, spread: 30, similarity: 0.7 }),
      vectorAt(0.62, 0, 1, 64),
      vectorAt(0.5, 2, 3, 64),
    ];
    const tags = vectors.map((v, i) =>
      tag(i + 1, `tag-${String(i).padStart(2, "0")}`, v, i % 3),
    );
    // A fixed permutation: every 5th element, wrapping round (5 and 12 are coprime).
    const shuffled = tags.map((_, i) => tags[(i * 5 + 3) % tags.length]!);
    expect(new Set(shuffled).size).toBe(tags.length);
    const themes = [{ id: 1, centroid: axis(4, 64), members: [] }];

    const first = assignGreedy({ tags, themes });
    const second = assignGreedy({ tags: shuffled, themes });
    expect(second).toEqual(first);
    // Order: mentions descending, then slug.
    expect(first.assignments.slice(0, 2).map((a) => a.tagId)).toEqual([3, 6]);
  });
});
