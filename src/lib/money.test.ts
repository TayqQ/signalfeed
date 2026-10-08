import { describe, expect, it } from "vitest";
import type { Money } from "@/core/domain";
import {
  convertMinor,
  fromMinorUnits,
  parseAmountText,
  toMinorUnits,
} from "./money";

const USD_12_5_MILLION: Money = { amountMinor: 1_250_000_000, currency: "USD" };

describe("parseAmountText", () => {
  it.each<[string | null, string | null, Money | null]>([
    ["$12.5M", null, USD_12_5_MILLION],
    ["US$12.5 million", null, USD_12_5_MILLION],
    ["€3m", null, { amountMinor: 300_000_000, currency: "EUR" }],
    ["£750k", null, { amountMinor: 75_000_000, currency: "GBP" }],
    ["£1.2bn", null, { amountMinor: 120_000_000_000, currency: "GBP" }],
    ["EUR 3 million", null, { amountMinor: 300_000_000, currency: "EUR" }],
    ["12,5 Mio. €", null, { amountMinor: 1_250_000_000, currency: "EUR" }],
    ["$12.5 million Series A", null, USD_12_5_MILLION],
    ["$10-12M", null, { amountMinor: 1_000_000_000, currency: "USD" }],
    ["$10M-$15M", null, { amountMinor: 1_000_000_000, currency: "USD" }],
    ["£1.2-1.5bn", null, { amountMinor: 120_000_000_000, currency: "GBP" }],
    [
      "between £2 million and £4 million",
      null,
      { amountMinor: 200_000_000, currency: "GBP" },
    ],
    ["€3-5 million", null, { amountMinor: 300_000_000, currency: "EUR" }],
    ["$12.5M", "CAD", { amountMinor: 1_250_000_000, currency: "CAD" }],
    ["US$12.5M", "CAD", USD_12_5_MILLION],
    ["3 million", "EUR", { amountMinor: 300_000_000, currency: "EUR" }],
    ["EUR 3 million", "USD", { amountMinor: 300_000_000, currency: "EUR" }],
    ["undisclosed", null, null],
    ["", null, null],
    ["Series A", "USD", null],
    [null, "USD", null],
  ])("parses %j with hint %j", (text, hint, expected) => {
    expect(parseAmountText(text, hint)).toEqual(expected);
  });
});

describe("minor units", () => {
  it("uses 2 decimal places for every currency, rounded half-up", () => {
    expect(toMinorUnits(12.5, "USD")).toBe(1250);
    expect(toMinorUnits(1.005, "JPY")).toBe(101);
    expect(toMinorUnits(1.004, "JPY")).toBe(100);
    expect(fromMinorUnits(1250, "USD")).toBe(12.5);
    expect(fromMinorUnits(toMinorUnits(1.005, "BHD"), "BHD")).toBeCloseTo(1.01);
    expect(toMinorUnits(fromMinorUnits(101, "JPY"), "JPY")).toBe(101);
  });
});

describe("convertMinor", () => {
  it("converts GBP to USD through EUR with a hand-calculated result", () => {
    // £80.00 = 8000 minor units.
    // GBP per 1 EUR = 0.8, so euros = 80 / 0.8 = 100.
    // USD per 1 EUR = 1.25, so dollars = 100 * 1.25 = 125.
    // 125 dollars = 12500 minor units.
    expect(
      convertMinor(8000, "GBP", "USD", { EUR: 1, GBP: 0.8, USD: 1.25 }),
    ).toBe(12500);
  });

  it("rounds half-up", () => {
    // 11 minor GBP / 2 GBP-per-EUR = 5.5 minor EUR, which rounds to 6.
    expect(convertMinor(11, "GBP", "EUR", { GBP: 2 })).toBe(6);
  });

  it("returns the same amount when the currencies match", () => {
    expect(convertMinor(8000, "gbp", "GBP", {})).toBe(8000);
  });

  it("throws when a required rate is missing", () => {
    expect(() => convertMinor(100, "GBP", "USD", { GBP: 0.8 })).toThrow(/USD/);
  });
});
