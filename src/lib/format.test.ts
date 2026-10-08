import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "@/core/enums";
import { formatDate, formatMoneyCompact, formatRoundType } from "./format";

describe("formatMoneyCompact", () => {
  it("formats en-GB compact amounts", () => {
    expect(formatMoneyCompact(820_000_000, "GBP")).toBe("£8.2M");
    expect(formatMoneyCompact(1_000_000_000, "USD")).toBe("US$10M");
    expect(formatMoneyCompact(95_000_000, "EUR")).toBe("€950K");
    expect(formatMoneyCompact(120_000_000_000, "GBP")).toBe("£1.2B");
    expect(formatMoneyCompact(1_250, "GBP")).toBe("£12.5");
    expect(formatMoneyCompact(0, "GBP")).toBe("£0");
    expect(formatMoneyCompact(-820_000_000, "GBP")).toBe("-£8.2M");
    expect(formatMoneyCompact(120_000_000, "CAD")).toBe("CAD 1.2M");
  });
});

describe("formatDate", () => {
  it("formats a UTC calendar date", () => {
    expect(formatDate("2026-10-08")).toBe("8 Oct 2026");
    expect(formatDate("2026-10-08T23:30:00Z")).toBe("8 Oct 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("rejects a date that is not a real calendar day", () => {
    expect(() => formatDate("2026-02-31")).toThrow(/Invalid date/);
    expect(() => formatDate("not-a-date")).toThrow(/Invalid date/);
  });
});

describe("formatRoundType", () => {
  it("labels series and pre-seed rounds", () => {
    expect(formatRoundType("series_a")).toBe("Series A");
    expect(formatRoundType("pre_seed")).toBe("Pre-seed");
    expect(formatRoundType("series_d_plus")).toBe("Series D+");
  });

  it("covers every round type", () => {
    for (const roundType of ROUND_TYPES) {
      expect(formatRoundType(roundType).length).toBeGreaterThan(0);
    }
  });
});
