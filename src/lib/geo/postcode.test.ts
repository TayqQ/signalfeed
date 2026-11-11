import { describe, expect, it } from "vitest";
import outcodes from "./uk-outcodes.json";
import { outcodeCentroid, outcodeItl1, parseUkPostcode } from "./postcode";
import { ukRegionByCode } from "./uk-regions";

describe("parseUkPostcode", () => {
  it("splits a valid postcode", () => {
    expect(parseUkPostcode("L35 9JJ")).toEqual({
      outcode: "L35",
      incode: "9JJ",
    });
    expect(parseUkPostcode("EC1A 1BB")).toEqual({
      outcode: "EC1A",
      incode: "1BB",
    });
    expect(parseUkPostcode("M1 1AE")).toEqual({ outcode: "M1", incode: "1AE" });
    expect(parseUkPostcode("W1A 0AX")?.outcode).toBe("W1A");
    expect(parseUkPostcode("BT1 5GS")?.outcode).toBe("BT1");
  });

  it("accepts lower case and missing or extra spaces", () => {
    expect(parseUkPostcode("  ls1  4ap ")).toEqual({
      outcode: "LS1",
      incode: "4AP",
    });
    expect(parseUkPostcode("SW1A2AA")).toEqual({
      outcode: "SW1A",
      incode: "2AA",
    });
  });

  it("rejects anything that is not a postcode", () => {
    for (const bad of [
      "",
      "Leeds",
      "L35",
      "L35 9J",
      "L35 9JJJ",
      "123 456",
      "L35 9CJ",
      "Q1 1AA",
      "L35 9JJ extra",
      "L35-9JJ",
      "AB123 4CD",
    ]) {
      expect(parseUkPostcode(bad), bad).toBeNull();
    }
  });
});

describe("outcodeCentroid", () => {
  it("returns the centroid and ITL1 code", () => {
    const l35 = outcodeCentroid("L35");
    expect(l35?.itl1).toBe("TLD");
    expect(l35?.lat).toBeGreaterThan(53);
    expect(l35?.lat).toBeLessThan(54);
    expect(outcodeCentroid("ls1")?.itl1).toBe("TLE");
    expect(outcodeCentroid("EH1")?.itl1).toBe("TLM");
    expect(outcodeCentroid("CF10")?.itl1).toBe("TLL");
    expect(outcodeCentroid("EC1A")?.itl1).toBe("TLI");
  });

  it("returns null for an unknown outcode", () => {
    expect(outcodeCentroid("ZZ99")).toBeNull();
    expect(outcodeCentroid("")).toBeNull();
  });
});

describe("outcodeItl1", () => {
  it("knows Northern Ireland without a centroid", () => {
    expect(outcodeCentroid("BT1")).toBeNull();
    expect(outcodeItl1("BT1")).toBe("TLN");
    expect(outcodeItl1("bt47")).toBe("TLN");
    expect(outcodeItl1("L35")).toBe("TLD");
    expect(outcodeItl1("ZZ99")).toBeNull();
  });
});

describe("uk-outcodes.json", () => {
  const entries = Object.entries(outcodes) as [
    string,
    [number, number, string],
  ][];

  it("gives every outcode a valid ITL1 code and UK coordinates", () => {
    expect(entries.length).toBeGreaterThan(2500);
    for (const [outcode, [lat, lon, itl1]] of entries) {
      expect(ukRegionByCode(itl1), outcode).not.toBeNull();
      expect(lat, outcode).toBeGreaterThan(49.8);
      expect(lat, outcode).toBeLessThan(61);
      expect(lon, outcode).toBeGreaterThan(-8.7);
      expect(lon, outcode).toBeLessThan(1.9);
    }
  });

  it("holds only valid outcode shapes", () => {
    for (const [outcode] of entries) {
      expect(outcode).toMatch(/^[A-Z]{1,2}[0-9][0-9A-Z]?$/);
    }
  });
});
