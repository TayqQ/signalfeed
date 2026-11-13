import { describe, expect, it } from "vitest";
import sicData from "./sic-codes.json";
import {
  allSicCodes,
  isKnownSic,
  normaliseSicCode,
  sicLabel,
} from "./sic-codes";

describe("sic-codes.json", () => {
  it("holds about 730 five-digit codes with descriptions", () => {
    const codes = allSicCodes();
    expect(codes.length).toBeGreaterThan(700);
    expect(codes.length).toBeLessThan(760);
    for (const code of codes) {
      expect(code).toMatch(/^\d{5}$/);
      expect(sicLabel(code)).toBeTruthy();
    }
  });

  it("stays small", () => {
    expect(JSON.stringify(sicData).length).toBeLessThan(60_000);
  });
});

describe("sicLabel", () => {
  it("returns the description", () => {
    expect(sicLabel("62012")).toBe(
      "Business and domestic software development",
    );
    expect(sicLabel("99999")).toBe("Dormant Company");
  });

  it("restores a dropped leading zero", () => {
    expect(sicLabel("1110")).toBe(sicLabel("01110"));
    expect(normaliseSicCode(" 1110 ")).toBe("01110");
  });

  it("returns null for unknown or malformed codes", () => {
    expect(sicLabel("00000")).toBeNull();
    expect(sicLabel("abcde")).toBeNull();
    expect(sicLabel("")).toBeNull();
    expect(sicLabel("toString")).toBeNull();
    expect(sicLabel("123456")).toBeNull();
  });
});

describe("isKnownSic", () => {
  it("is true only for listed codes", () => {
    expect(isKnownSic("62012")).toBe(true);
    expect(isKnownSic("62013")).toBe(false);
  });
});
