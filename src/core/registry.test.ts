import { describe, expect, it } from "vitest";
import {
  COMPANY_SIZE_BANDS,
  COMPANY_SIZE_BAND_SLUGS,
  companiesHouseUrl,
  companySizeBandFromSlug,
  companySizeBandSlug,
  edgarCompanyUrl,
  isCompanySizeBand,
  normaliseCik,
  normaliseCompanyNumber,
} from "./registry";

describe("normaliseCompanyNumber", () => {
  it.each([
    ["09876543", "09876543"],
    ["9876543", "09876543"],
    ["123", "00000123"],
    ["sc123456", "SC123456"],
    ["SC123456", "SC123456"],
    ["NI654321", "NI654321"],
    ["oc301234", "OC301234"],
    ["R0012345", "R0012345"],
    [" SC 123 456 ", "SC123456"],
    ["0987 6543", "09876543"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normaliseCompanyNumber(input)).toBe(expected);
  });

  it.each([
    [""],
    ["   "],
    ["123456789"],
    ["00000000"],
    ["SC000000"],
    ["SC12345"],
    ["SC1234567"],
    ["S1234567"],
    ["ABC12345"],
    ["12-345-678"],
    ["SC12345A"],
    ["not a number"],
  ])("rejects %j", (input) => {
    expect(normaliseCompanyNumber(input)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(normaliseCompanyNumber(null)).toBeNull();
    expect(normaliseCompanyNumber(undefined)).toBeNull();
  });
});

describe("normaliseCik", () => {
  it.each([
    ["1999999", "1999999"],
    ["0001999999", "1999999"],
    ["  320193 ", "320193"],
    ["7", "7"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normaliseCik(input)).toBe(expected);
  });

  it.each([
    [""],
    ["0"],
    ["0000000000"],
    ["CIK1999999"],
    ["1 999 999"],
    ["-1999999"],
    ["19999.99"],
    ["12345678901"],
  ])("rejects %j", (input) => {
    expect(normaliseCik(input)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(normaliseCik(null)).toBeNull();
    expect(normaliseCik(undefined)).toBeNull();
  });
});

describe("company size bands", () => {
  it("lists the six bands in order", () => {
    expect(COMPANY_SIZE_BANDS).toEqual([
      "micro",
      "small",
      "medium",
      "full_accounts",
      "dormant",
      "no_accounts_yet",
    ]);
  });

  it("uses the URL slugs from the spec", () => {
    expect(COMPANY_SIZE_BANDS.map(companySizeBandSlug)).toEqual([
      "micro",
      "small",
      "medium",
      "full-accounts",
      "dormant",
      "no-accounts-yet",
    ]);
    expect(new Set(Object.values(COMPANY_SIZE_BAND_SLUGS)).size).toBe(6);
  });

  it("reads every slug back to its band", () => {
    for (const band of COMPANY_SIZE_BANDS) {
      expect(companySizeBandFromSlug(companySizeBandSlug(band))).toBe(band);
    }
  });

  it("rejects values that are not slugs", () => {
    expect(companySizeBandFromSlug("full_accounts")).toBeNull();
    expect(companySizeBandFromSlug("large")).toBeNull();
    expect(companySizeBandFromSlug("")).toBeNull();
  });

  it("recognises bands", () => {
    expect(isCompanySizeBand("no_accounts_yet")).toBe(true);
    expect(isCompanySizeBand("no-accounts-yet")).toBe(false);
    expect(isCompanySizeBand(3)).toBe(false);
  });
});

describe("registry URLs", () => {
  it("links to the public Companies House page", () => {
    expect(companiesHouseUrl("SC123456")).toBe(
      "https://find-and-update.company-information.service.gov.uk/company/SC123456",
    );
    expect(companiesHouseUrl("9876543")).toBe(
      "https://find-and-update.company-information.service.gov.uk/company/09876543",
    );
  });

  it("links to the EDGAR company page", () => {
    expect(edgarCompanyUrl("0001999999")).toBe(
      "https://www.sec.gov/edgar/browse/?CIK=1999999",
    );
  });

  it("throws on invalid identifiers", () => {
    expect(() => companiesHouseUrl("../officers")).toThrow();
    expect(() => edgarCompanyUrl("abc")).toThrow();
  });
});
