import { describe, expect, it } from "vitest";
import { isSector } from "@/core/sectors";
import { allSicCodes } from "./sic-codes";
import {
  SIC_CODE_EXCEPTIONS,
  SIC_DIVISION_SECTORS,
  SIC_SECTOR_MAP_VERSION,
  sectorsForSic,
} from "./sic-sectors";

describe("sectorsForSic", () => {
  it("maps the spec examples", () => {
    expect(sectorsForSic(["62012"])).toEqual(["software-ai"]);
    expect(sectorsForSic(["21100"])).toEqual(["health-life-sciences"]);
    expect(sectorsForSic(["64999"])).toEqual(["financial-services"]);
    expect(sectorsForSic(["35110"])).toEqual(["climate-energy"]);
    expect(sectorsForSic(["85590"])).toEqual(["education"]);
  });

  it("gives no sector for the vague codes", () => {
    for (const code of ["70229", "74909", "82990", "96090", "99999", "98000"]) {
      expect(sectorsForSic([code])).toEqual([]);
    }
  });

  it("ignores vague codes next to a real one", () => {
    expect(sectorsForSic(["62012", "70229"])).toEqual(["software-ai"]);
  });

  it("sorts and removes repeats", () => {
    expect(
      sectorsForSic(["62012", "62020", "64999", "21100", "62012"]),
    ).toEqual(["financial-services", "health-life-sciences", "software-ai"]);
  });

  it("lets a 5-digit exception beat its division", () => {
    expect(sectorsForSic(["62011"])).toEqual(["media-creative"]);
    expect(sectorsForSic(["70221"])).toEqual(["business-services"]);
    expect(sectorsForSic(["70100"])).toEqual([]);
    expect(sectorsForSic(["30300"])).toEqual(["space-deep-tech"]);
  });

  it("handles empty, unknown and malformed input", () => {
    expect(sectorsForSic([])).toEqual([]);
    expect(sectorsForSic(["", "abcde", "00000", "123456", "toString"])).toEqual(
      [],
    );
  });

  it("accepts a code that lost its leading zero", () => {
    expect(sectorsForSic(["1110"])).toEqual(["food-agriculture"]);
  });
});

describe("the sector tables", () => {
  const codes = allSicCodes();

  it("has an entry for every division in the committed list", () => {
    const divisions = new Set(codes.map((code) => code.slice(0, 2)));
    for (const division of divisions) {
      expect(
        Object.hasOwn(SIC_DIVISION_SECTORS, division),
        `division ${division}`,
      ).toBe(true);
    }
  });

  it("has no division that is absent from the list", () => {
    const divisions = new Set(codes.map((code) => code.slice(0, 2)));
    for (const division of Object.keys(SIC_DIVISION_SECTORS)) {
      expect(divisions.has(division), `division ${division}`).toBe(true);
    }
  });

  it("uses only real sectors, and never `other`", () => {
    const values = [
      ...Object.values(SIC_DIVISION_SECTORS),
      ...Object.values(SIC_CODE_EXCEPTIONS),
    ];
    for (const value of values) {
      if (value === null) continue;
      expect(isSector(value)).toBe(true);
      expect(value).not.toBe("other");
    }
  });

  it("only has exceptions for listed codes", () => {
    for (const code of Object.keys(SIC_CODE_EXCEPTIONS)) {
      expect(codes, `code ${code}`).toContain(code);
    }
  });

  it("maps every listed code without throwing", () => {
    for (const code of codes) {
      expect(() => sectorsForSic([code])).not.toThrow();
    }
  });

  it("has a version string", () => {
    expect(SIC_SECTOR_MAP_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
