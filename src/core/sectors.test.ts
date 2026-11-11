import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DEFAULT_NEAR_KM,
  NEAR_RADII_KM,
  type FundingCriteria,
  type FundingFilters,
  type FundingView,
} from "./read-models";
import { isSector, SECTOR_LABELS, SECTORS } from "./sectors";

describe("sectors", () => {
  it("lists the 16 approved slugs in the spec's order", () => {
    expect(SECTORS).toEqual([
      "software-ai",
      "financial-services",
      "health-life-sciences",
      "climate-energy",
      "transport-mobility",
      "property-construction",
      "retail-consumer",
      "food-agriculture",
      "manufacturing-industrial",
      "media-creative",
      "education",
      "business-services",
      "security-defence",
      "space-deep-tech",
      "public-social",
      "other",
    ]);
  });

  it("has a label for every slug and no others", () => {
    expect(Object.keys(SECTOR_LABELS).sort()).toEqual([...SECTORS].sort());
    expect(SECTOR_LABELS["health-life-sciences"]).toBe(
      "Health and life sciences",
    );
    expect(SECTOR_LABELS["media-creative"]).toBe("Media, creative and gaming");
  });

  it("accepts every slug", () => {
    for (const slug of SECTORS) expect(isSector(slug)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [
      "",
      "Software-AI",
      " other",
      "health",
      "fintech",
      "Other",
      undefined,
      null,
      3,
      ["other"],
    ]) {
      expect(isSector(value)).toBe(false);
    }
  });
});

// Read-model contract checks sit here because Task 025 may not add a
// read-models test file. They fail at typecheck time if the contract breaks.
describe("funding filter contract", () => {
  it("still accepts a Phase 1 FundingFilters object", () => {
    const phase1 = {
      q: "acme",
      roundTypes: ["seed", "series_a"],
      regions: ["europe"],
      countryCodes: ["GB"],
      tag: "fintech",
      investorSlug: "example-ventures",
      from: "2026-01-01",
      to: "2026-06-30",
      minGbpMinor: 100_000_00,
      maxGbpMinor: 5_000_000_00,
      sizeBands: ["1m-5m"],
      sort: "amount",
      direction: "desc",
      page: 2,
      pageSize: 50,
    } satisfies FundingFilters;
    expect(phase1.page).toBe(2);

    const minimal = { page: 1, pageSize: 50 } satisfies FundingFilters;
    expect(minimal.pageSize).toBe(50);
  });

  it("accepts the Phase 2 criteria", () => {
    const criteria = {
      roundTypes: ["pre_seed", "seed", "grant"],
      sizeBands: ["under-1m"],
      themes: ["agentic-accounting"],
      sectors: ["health-life-sciences"],
      ukRegions: ["yorkshire-and-the-humber"],
      cities: ["leeds"],
      near: { placeSlug: "leeds", km: DEFAULT_NEAR_KM },
      momentum: "first",
      from: "2026-06-01",
    } satisfies FundingCriteria;
    expect(criteria.near.km).toBe(25);
  });

  it("is criteria plus view", () => {
    expectTypeOf<FundingFilters>().toEqualTypeOf<
      FundingCriteria & FundingView
    >();
    expectTypeOf<FundingCriteria>().not.toHaveProperty("page");
    expectTypeOf<FundingCriteria>().not.toHaveProperty("sort");
  });

  it("lists the allowed radii with 25 km as the default", () => {
    expect(NEAR_RADII_KM).toEqual([10, 25, 50, 100]);
    expect(NEAR_RADII_KM).toContain(DEFAULT_NEAR_KM);
  });
});
