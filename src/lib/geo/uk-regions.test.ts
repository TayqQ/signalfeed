import { describe, expect, it } from "vitest";
import {
  UK_REGIONS,
  ukRegionByCode,
  ukRegionBySlug,
  ukRegionFromGtrName,
} from "./uk-regions";

describe("UK_REGIONS", () => {
  it("has the 12 ITL1 areas with unique slugs and codes", () => {
    expect(UK_REGIONS).toHaveLength(12);
    expect(new Set(UK_REGIONS.map((r) => r.slug)).size).toBe(12);
    expect(new Set(UK_REGIONS.map((r) => r.code)).size).toBe(12);
    expect(ukRegionByCode("TLN")?.slug).toBe("northern-ireland");
  });

  it("looks up by slug and code", () => {
    expect(ukRegionBySlug("scotland")?.code).toBe("TLM");
    expect(ukRegionByCode("TLC")?.name).toBe("North East");
    expect(ukRegionBySlug("nowhere")).toBeNull();
    expect(ukRegionByCode("TLZ")).toBeNull();
  });
});

describe("ukRegionFromGtrName", () => {
  it("maps GtR names", () => {
    expect(ukRegionFromGtrName("North West")?.slug).toBe("north-west");
    expect(ukRegionFromGtrName("Yorkshire and The Humber")?.slug).toBe(
      "yorkshire-and-the-humber",
    );
    expect(ukRegionFromGtrName("East of England")?.slug).toBe(
      "east-of-england",
    );
    expect(ukRegionFromGtrName("Northern Ireland")?.code).toBe("TLN");
  });

  it("ignores case and accepts the Ordnance Survey names", () => {
    expect(ukRegionFromGtrName("  south EAST ")?.slug).toBe("south-east");
    expect(ukRegionFromGtrName("Eastern")?.slug).toBe("east-of-england");
    expect(ukRegionFromGtrName("Yorkshire and the Humber")?.code).toBe("TLE");
  });

  it("accepts the ONS ITL1 names", () => {
    expect(ukRegionFromGtrName("North East (England)")?.code).toBe("TLC");
    expect(ukRegionFromGtrName("East (England)")?.code).toBe("TLH");
    expect(ukRegionFromGtrName("South West (England)")?.slug).toBe(
      "south-west",
    );
    expect(ukRegionFromGtrName("Yorkshire and The Humber")?.code).toBe("TLE");
  });

  it("returns null for anything else", () => {
    expect(ukRegionFromGtrName("Outside UK")).toBeNull();
    expect(ukRegionFromGtrName("")).toBeNull();
  });
});
