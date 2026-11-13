import { describe, expect, it } from "vitest";
import { COMPANY_SIZE_BANDS } from "@/core/registry";
import {
  isKnownAccountsType,
  knownAccountsTypes,
  sizeBandForAccounts,
  sizeBandLabel,
} from "./company-size";

// The `account_type` values in the Companies House api-enumerations constants
// (spec-phase3 section 7.3, A34). `null` is the string the constants use.
const CH_ACCOUNT_TYPES = [
  "null",
  "full",
  "small",
  "medium",
  "group",
  "dormant",
  "interim",
  "initial",
  "total-exemption-full",
  "total-exemption-small",
  "partial-exemption",
  "audit-exemption-subsidiary",
  "filing-exemption-subsidiary",
  "micro-entity",
  "no-accounts-type-available",
  "audited-abridged",
  "unaudited-abridged",
];

describe("sizeBandForAccounts", () => {
  it("gives every Companies House account type a band", () => {
    for (const type of CH_ACCOUNT_TYPES) {
      expect(isKnownAccountsType(type), type).toBe(true);
      expect(COMPANY_SIZE_BANDS).toContain(sizeBandForAccounts(type));
    }
    expect(knownAccountsTypes().sort()).toEqual([...CH_ACCOUNT_TYPES].sort());
  });

  it("follows the table in the spec", () => {
    expect(sizeBandForAccounts("micro-entity")).toBe("micro");
    for (const type of [
      "small",
      "total-exemption-full",
      "total-exemption-small",
      "audited-abridged",
      "unaudited-abridged",
      "partial-exemption",
      "audit-exemption-subsidiary",
      "filing-exemption-subsidiary",
    ]) {
      expect(sizeBandForAccounts(type), type).toBe("small");
    }
    expect(sizeBandForAccounts("medium")).toBe("medium");
    expect(sizeBandForAccounts("full")).toBe("full_accounts");
    expect(sizeBandForAccounts("group")).toBe("full_accounts");
    expect(sizeBandForAccounts("dormant")).toBe("dormant");
    for (const type of [
      "initial",
      "interim",
      "null",
      "no-accounts-type-available",
    ]) {
      expect(sizeBandForAccounts(type), type).toBe("no_accounts_yet");
    }
  });

  it("treats null, undefined and empty as no accounts yet", () => {
    expect(sizeBandForAccounts(null)).toBe("no_accounts_yet");
    expect(sizeBandForAccounts(undefined)).toBe("no_accounts_yet");
    expect(sizeBandForAccounts("")).toBe("no_accounts_yet");
    expect(sizeBandForAccounts("  ")).toBe("no_accounts_yet");
    expect(isKnownAccountsType(null)).toBe(true);
    expect(isKnownAccountsType("")).toBe(true);
  });

  it("gives an unknown type full accounts and reports it", () => {
    expect(sizeBandForAccounts("brand-new-type")).toBe("full_accounts");
    expect(isKnownAccountsType("brand-new-type")).toBe(false);
    expect(sizeBandForAccounts("constructor")).toBe("full_accounts");
    expect(isKnownAccountsType("constructor")).toBe(false);
  });

  it("ignores case and spacing", () => {
    expect(sizeBandForAccounts(" Micro-Entity ")).toBe("micro");
  });
});

describe("sizeBandLabel", () => {
  it("has the labels from the task", () => {
    expect(sizeBandLabel("micro")).toBe("Micro");
    expect(sizeBandLabel("small")).toBe("Small");
    expect(sizeBandLabel("medium")).toBe("Medium");
    expect(sizeBandLabel("full_accounts")).toBe(
      "Full accounts (size not stated)",
    );
    expect(sizeBandLabel("dormant")).toBe("Dormant");
    expect(sizeBandLabel("no_accounts_yet")).toBe("No accounts filed yet");
  });

  it("labels every band", () => {
    for (const band of COMPANY_SIZE_BANDS) {
      expect(sizeBandLabel(band).length).toBeGreaterThan(0);
    }
  });
});
