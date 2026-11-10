import { describe, expect, it } from "vitest";
import { SIZE_BAND_RANGES, SIZE_BANDS, sizeBandFor } from "./size-bands";

const pounds = (value: number) => value * 100;

describe("sizeBandFor", () => {
  it("puts amounts in the band whose range contains them", () => {
    expect(sizeBandFor(pounds(750_000))).toBe("under-1m");
    expect(sizeBandFor(pounds(2_100_000))).toBe("1m-5m");
    expect(sizeBandFor(pounds(11_000_000))).toBe("5m-20m");
    expect(sizeBandFor(pounds(38_000_000))).toBe("20m-100m");
    expect(sizeBandFor(pounds(350_000_000))).toBe("100m-plus");
  });

  it("treats lower bounds as inclusive and upper bounds as exclusive", () => {
    expect(sizeBandFor(pounds(1_000_000) - 1)).toBe("under-1m");
    expect(sizeBandFor(pounds(1_000_000))).toBe("1m-5m");
    expect(sizeBandFor(pounds(100_000_000))).toBe("100m-plus");
  });

  it("returns null when the amount is unknown or invalid", () => {
    expect(sizeBandFor(null)).toBeNull();
    expect(sizeBandFor(-1)).toBeNull();
    expect(sizeBandFor(Number.NaN)).toBeNull();
  });

  it("covers every non-negative amount with no gaps or overlaps", () => {
    let previousMax = 0;
    for (const band of SIZE_BANDS) {
      const range = SIZE_BAND_RANGES[band];
      expect(range.minGbpMinor).toBe(previousMax);
      previousMax = range.maxGbpMinor ?? Number.POSITIVE_INFINITY;
    }
    expect(previousMax).toBe(Number.POSITIVE_INFINITY);
  });
});
