import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "@/core/enums";
import {
  formatCompanyAge,
  formatDate,
  formatMoneyShort,
  formatRoundType,
} from "./format";

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

describe("formatCompanyAge", () => {
  it("gives the calendar-year age at a date", () => {
    expect(formatCompanyAge(2021, "2026-10-08")).toBe("5 years");
    expect(formatCompanyAge(2025, "2026-01-02")).toBe("1 year");
    expect(formatCompanyAge(2026, "2026-10-08")).toBe("under 1 year");
  });

  it("returns null when the year is unknown or after the date", () => {
    expect(formatCompanyAge(null, "2026-10-08")).toBeNull();
    expect(formatCompanyAge(2027, "2026-10-08")).toBeNull();
    expect(formatCompanyAge(2020, "not a date")).toBeNull();
  });
});

describe("formatMoneyShort", () => {
  it("uses the house style: lower-case units, one decimal for m and bn", () => {
    expect(formatMoneyShort(420_000_000, "GBP")).toBe("£4.2m");
    expect(formatMoneyShort(1_200_000_000, "GBP")).toBe("£12.0m");
    expect(formatMoneyShort(85_000_000, "GBP")).toBe("£850k");
    expect(formatMoneyShort(232_000_000_000, "GBP")).toBe("£2.3bn");
    expect(formatMoneyShort(95_000, "GBP")).toBe("£950");
    expect(formatMoneyShort(0, "GBP")).toBe("£0");
    expect(formatMoneyShort(75_000_000_000, "USD")).toBe("US$750.0m");
    expect(formatMoneyShort(-420_000_000, "GBP")).toBe("-£4.2m");
  });

  it("promotes at the unit boundaries", () => {
    expect(formatMoneyShort(99_960_000, "GBP")).toBe("£1.0m");
    expect(formatMoneyShort(99_996_000_000, "GBP")).toBe("£1.0bn");
    expect(formatMoneyShort(99_940, "GBP")).toBe("£999");
    expect(formatMoneyShort(99_960, "GBP")).toBe("£1k");
  });
});
