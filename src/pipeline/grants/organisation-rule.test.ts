import { describe, expect, it } from "vitest";
import { isOrganisation } from "./organisation-rule";

describe("isOrganisation", () => {
  it.each([
    "Acme Robotics Ltd",
    "ACME ROBOTICS LIMITED",
    "Acme Co-op CIC",
    "Acme LLP",
    "Acme Robotics Ltd.",
    "Acme Robotics Group PLC",
    "Acme Robotics P.L.C.",
    "Acme Holdings L.L.P.",
    "Acme Partners LP",
    "Acme Trust Community Interest Company",
    "Acme Robotics, Ltd",
  ])("accepts %s", (name) => {
    expect(isOrganisation(name, null)).toBe(true);
  });

  it.each([
    "University of Example",
    "Example City Council",
    "Jane Example",
    "J Example T/A Example Design",
    "Example Design Studio",
    "Ltd",
    "Alp",
    "Example Helpltd",
  ])("rejects %s", (name) => {
    expect(isOrganisation(name, null)).toBe(false);
  });

  it("accepts any name with a registration number", () => {
    expect(isOrganisation("Example Design Studio", "01234567")).toBe(true);
  });

  it("ignores a blank registration number", () => {
    expect(isOrganisation("Jane Example", "  ")).toBe(false);
    expect(isOrganisation("Jane Example", undefined)).toBe(false);
  });
});
