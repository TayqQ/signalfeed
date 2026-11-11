import { describe, expect, it } from "vitest";
import { coverage, median, targetAge } from "./trend-stats";

const MILLION_GBP = 100_000_000;

describe("median", () => {
  it("is null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle value of an odd-length list in any order", () => {
    expect(median([7])).toBe(7);
    expect(median([9, 1, 5])).toBe(5);
  });

  it("averages the middle two of an even-length list, rounded down", () => {
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([100, 201])).toBe(150);
  });

  it("gives £2.0M for the investor example in spec section 8.5", () => {
    expect(
      median([1.2 * MILLION_GBP, 2.0 * MILLION_GBP, 3.5 * MILLION_GBP]),
    ).toBe(2.0 * MILLION_GBP);
  });

  it("does not change the input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("targetAge", () => {
  it("gives 7 for founded 2019 and acquired in May 2026", () => {
    expect(targetAge(2019, "2026-05-14")).toBe(7);
  });

  it("is 0 when founded in the announcement year", () => {
    expect(targetAge(2026, "2026-05-14")).toBe(0);
  });

  it("is null outside 1900 to the announcement year", () => {
    expect(targetAge(null, "2026-05-14")).toBeNull();
    expect(targetAge(1899, "2026-05-14")).toBeNull();
    expect(targetAge(1900, "2026-05-14")).toBe(126);
    expect(targetAge(2027, "2026-05-14")).toBeNull();
    expect(targetAge(2019.5, "2026-05-14")).toBeNull();
  });
});

describe("coverage", () => {
  it("formats known of total", () => {
    expect(coverage(4, 19)).toBe("4 of 19");
    expect(coverage(3, 4)).toBe("3 of 4");
    expect(coverage(1200, 1500)).toBe("1,200 of 1,500");
  });
});
