import { describe, expect, it } from "vitest";
import { confirmationText } from "./confirmation-text";

describe("confirmationText", () => {
  it("words an SH01 allotment", () => {
    expect(
      confirmationText({
        kind: "ch_allotment",
        recordDate: "2026-02-02",
        confirmsAmount: false,
      }),
    ).toBe(
      "Confirmed: shares allotted on 2 February 2026 (Companies House SH01)",
    );
  });

  it("words a Form D with the amount sold", () => {
    expect(
      confirmationText({
        kind: "sec_form_d",
        recordDate: "2026-01-05",
        confirmsAmount: true,
        amountUsdMinor: 440_000_000,
      }),
    ).toBe("Confirmed: Form D, $4.4M sold, first sale 5 January 2026 (SEC)");
  });

  it("words a Form D without an amount", () => {
    expect(
      confirmationText({
        kind: "sec_form_d",
        recordDate: "2026-01-05",
        confirmsAmount: false,
        amountUsdMinor: null,
      }),
    ).toBe("Confirmed: Form D, first sale 5 January 2026 (SEC)");
  });

  it("words a grant", () => {
    expect(
      confirmationText({
        kind: "ukri_grant",
        recordDate: "2026-03-01",
        confirmsAmount: true,
      }),
    ).toBe("Confirmed: Innovate UK grant (UKRI Gateway to Research)");
  });

  it("writes whole months in full, whatever the month", () => {
    expect(
      confirmationText({
        kind: "ch_allotment",
        recordDate: "2025-09-30",
        confirmsAmount: false,
      }),
    ).toContain("30 September 2025");
  });

  it("rejects an invalid date", () => {
    expect(() =>
      confirmationText({
        kind: "ch_allotment",
        recordDate: "2026-02-31",
        confirmsAmount: false,
      }),
    ).toThrow();
  });
});
