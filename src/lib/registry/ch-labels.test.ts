import { describe, expect, it } from "vitest";
import { companyStatusLabel, companyTypeLabel } from "./ch-labels";

describe("companyStatusLabel", () => {
  it("uses Companies House wording", () => {
    expect(companyStatusLabel("active", null)).toBe("Active");
    expect(companyStatusLabel("dissolved", null)).toBe("Dissolved");
    expect(companyStatusLabel("administration", null)).toBe(
      "In Administration",
    );
    expect(companyStatusLabel("liquidation", null)).toBe("Liquidation");
    expect(companyStatusLabel("receivership", null)).toBe("Receiver Action");
  });

  it("adds a detail only when it says something", () => {
    expect(companyStatusLabel("active", "active")).toBe("Active");
    expect(companyStatusLabel("active", "")).toBe("Active");
    expect(companyStatusLabel("active", "active-proposal-to-strike-off")).toBe(
      "Active (Active proposal to strike off)",
    );
  });

  it("shows unknown values as given", () => {
    expect(companyStatusLabel("brand-new", null)).toBe("brand-new");
    expect(companyStatusLabel("active", "odd-detail")).toBe(
      "Active (odd-detail)",
    );
    expect(companyStatusLabel("constructor", null)).toBe("constructor");
  });

  it("returns null for no status", () => {
    expect(companyStatusLabel(null, null)).toBeNull();
    expect(companyStatusLabel("", "x")).toBeNull();
  });
});

describe("companyTypeLabel", () => {
  it("uses Companies House wording", () => {
    expect(companyTypeLabel("ltd")).toBe("Private limited company");
    expect(companyTypeLabel("plc")).toBe("Public limited company");
    expect(companyTypeLabel("llp")).toBe("Limited liability partnership");
    expect(companyTypeLabel("oversea-company")).toBe("Overseas company");
  });

  it("shows unknown values as given", () => {
    expect(companyTypeLabel("new-kind")).toBe("new-kind");
  });

  it("returns null for no type", () => {
    expect(companyTypeLabel(null)).toBeNull();
    expect(companyTypeLabel("")).toBeNull();
  });
});
