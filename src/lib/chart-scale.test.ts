import { describe, expect, it } from "vitest";
import {
  bandLayout,
  formatAxisValue,
  linearScale,
  niceTicks,
  stack,
} from "./chart-scale";

describe("linearScale", () => {
  it("maps the domain onto the range", () => {
    const scale = linearScale([0, 10], [100, 0]);
    expect(scale(0)).toBe(100);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(0);
  });

  it("does not divide by zero on a flat domain", () => {
    expect(linearScale([3, 3], [20, 0])(3)).toBe(20);
  });
});

describe("niceTicks", () => {
  it("uses 1, 2 or 5 times a power of ten", () => {
    expect(niceTicks(9, 4)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("always reaches the max", () => {
    for (const max of [1, 3, 7, 13, 47, 999, 12_345]) {
      const ticks = niceTicks(max, 4);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("copes with zero, negative and non-finite maxima", () => {
    expect(niceTicks(0, 4)).toEqual([0, 1]);
    expect(niceTicks(-5, 4)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN, 4)).toEqual([0, 1]);
  });
});

describe("bandLayout", () => {
  it("fills the width with gaps between bands", () => {
    const bands = bandLayout(4, 100, 4);
    expect(bands).toHaveLength(4);
    expect(bands[0]).toEqual({ x: 0, width: 22 });
    const last = bands[3]!;
    expect(last.x + last.width).toBeCloseTo(100);
  });

  it("returns nothing for no bands and never a negative width", () => {
    expect(bandLayout(0, 100, 4)).toEqual([]);
    expect(bandLayout(10, 5, 4)[0]?.width).toBe(0);
  });
});

describe("stack", () => {
  const series = [
    { key: "early", values: [1, 2, 0] },
    { key: "later", values: [3, 0, 4] },
    { key: "unknown", values: [0, 1, 1] },
  ];

  it("totals equal the sum of the series", () => {
    const { totals } = stack(series);
    expect(totals).toEqual([4, 3, 5]);
  });

  it("starts each layer where the previous one ended", () => {
    const { layers } = stack(series);
    expect(layers[1]?.segments[0]).toEqual({ start: 1, end: 4 });
    expect(layers[2]?.segments[2]).toEqual({ start: 4, end: 5 });
  });

  it("treats negative, missing and non-finite values as zero", () => {
    const { totals } = stack([
      { key: "a", values: [-2, Number.NaN, 1] },
      { key: "b", values: [1] },
    ]);
    expect(totals).toEqual([1, 0, 1]);
  });

  it("handles an all-zero series and no series", () => {
    expect(stack([{ key: "a", values: [0, 0] }]).totals).toEqual([0, 0]);
    expect(stack([])).toEqual({ layers: [], totals: [] });
  });
});

describe("formatAxisValue", () => {
  it("compacts plain numbers", () => {
    expect(formatAxisValue(0)).toBe("0");
    expect(formatAxisValue(950)).toBe("950");
    expect(formatAxisValue(1200)).toBe("1.2K");
    expect(formatAxisValue(3_000_000)).toBe("3M");
  });

  it("formats GBP minor units with the shared formatter", () => {
    expect(formatAxisValue(820_000_000, { currency: "GBP" })).toBe("£8.2M");
  });
});
