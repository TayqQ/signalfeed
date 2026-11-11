import { describe, expect, it } from "vitest";
import { ukRegionFromText } from "./uk-region-names";

describe("ukRegionFromText", () => {
  it("maps nations and their adjectives", () => {
    expect(ukRegionFromText("Scotland")).toBe("scotland");
    expect(ukRegionFromText("Scottish")).toBe("scotland");
    expect(ukRegionFromText("scottish")).toBe("scotland");
    expect(ukRegionFromText("Welsh")).toBe("wales");
    expect(ukRegionFromText("Northern Irish")).toBe("northern-ireland");
    expect(ukRegionFromText("Northern Ireland")).toBe("northern-ireland");
  });

  it("maps English regions", () => {
    expect(ukRegionFromText("Yorkshire")).toBe("yorkshire-and-the-humber");
    expect(ukRegionFromText("the North East")).toBe("north-east");
    expect(ukRegionFromText("North West England")).toBe("north-west");
    expect(ukRegionFromText("East Anglia")).toBe("east-of-england");
    expect(ukRegionFromText("London")).toBe("london");
    expect(ukRegionFromText("the South West")).toBe("south-west");
  });

  it("maps ceremonial counties and city regions", () => {
    expect(ukRegionFromText("Kent")).toBe("south-east");
    expect(ukRegionFromText("Cornwall")).toBe("south-west");
    expect(ukRegionFromText("Greater Manchester")).toBe("north-west");
    expect(ukRegionFromText("West Midlands")).toBe("west-midlands");
    expect(ukRegionFromText("Tyne and Wear")).toBe("north-east");
    expect(ukRegionFromText("County Antrim")).toBe("northern-ireland");
  });

  it("ignores case, hyphens, accents and a country suffix", () => {
    expect(ukRegionFromText("  KENT ")).toBe("south-east");
    expect(ukRegionFromText("north-east")).toBe("north-east");
    expect(ukRegionFromText("Kent, UK")).toBe("south-east");
    expect(ukRegionFromText("Yorkshire, England")).toBe(
      "yorkshire-and-the-humber",
    );
    expect(ukRegionFromText("Scotland, UK")).toBe("scotland");
  });

  it("returns null for ambiguous phrases", () => {
    expect(ukRegionFromText("the Midlands")).toBeNull();
    expect(ukRegionFromText("Midlands")).toBeNull();
    expect(ukRegionFromText("the North")).toBeNull();
    expect(ukRegionFromText("the South")).toBeNull();
    expect(ukRegionFromText("Home Counties")).toBeNull();
    expect(ukRegionFromText("England")).toBeNull();
    expect(ukRegionFromText("UK")).toBeNull();
  });

  it("matches whole phrases only, never a substring", () => {
    expect(ukRegionFromText("Kentish Town")).toBeNull();
    expect(ukRegionFromText("Edinburgh-based Scottish")).toBeNull();
    expect(ukRegionFromText("Scottish and Welsh")).toBeNull();
    expect(ukRegionFromText("Kent and Sussex")).toBeNull();
    expect(ukRegionFromText("New London")).toBeNull();
    expect(ukRegionFromText("Londonderry")).toBeNull();
    expect(ukRegionFromText("")).toBeNull();
    expect(ukRegionFromText("Paris")).toBeNull();
  });
});
