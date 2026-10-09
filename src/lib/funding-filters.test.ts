import { describe, expect, it } from "vitest";
import {
  parseFundingFilters,
  serialiseFundingFilters,
} from "./funding-filters";

describe("parseFundingFilters", () => {
  it("round-trips filters and converts GBP to minor units", () => {
    const filters = parseFundingFilters({
      q: " Northwind ",
      round: ["seed", "series_a"],
      region: "UK",
      country: "GB",
      tag: "Robotics",
      investor: "Northstar-Capital",
      from: "2024-01-01",
      to: "2026-12-31",
      min: "1.5",
      max: "20",
      sort: "amount",
      dir: "asc",
      page: "2",
    });

    expect(filters).toEqual({
      q: "Northwind",
      roundTypes: ["seed", "series_a"],
      regions: ["UK"],
      countryCodes: ["GB"],
      tag: "robotics",
      investorSlug: "northstar-capital",
      from: "2024-01-01",
      to: "2026-12-31",
      minGbpMinor: 150,
      maxGbpMinor: 2000,
      sort: "amount",
      direction: "asc",
      page: 2,
      pageSize: 25,
    });

    const again = parseFundingFilters(
      new URLSearchParams(serialiseFundingFilters(filters)),
    );
    expect(again).toEqual(filters);
  });

  it("drops invalid values and keeps the valid ones", () => {
    const filters = parseFundingFilters({
      q: "   ",
      round: ["seed", "not-a-round", "series_b"],
      region: ["UK", "Atlantis"],
      country: ["GB", "England", "us", "uk"],
      tag: "",
      investor: "",
      from: "2024-13-40",
      to: "yesterday",
      min: "lots",
      max: "-5",
      sort: "popular",
      dir: "sideways",
      page: "0",
      pageSize: "1000",
    });

    expect(filters).toEqual({
      roundTypes: ["seed", "series_b"],
      regions: ["UK"],
      countryCodes: ["GB", "US"],
      page: 1,
      pageSize: 100,
    });
    expect(() =>
      parseFundingFilters({ min: "nope", sort: "nope", page: "-4" }),
    ).not.toThrow();
  });

  it("accepts repeated and comma-separated values, including region names", () => {
    const params = new URLSearchParams();
    params.append("round", "seed");
    params.append("round", "nope");
    params.append("round", "grant");
    params.append("region", "middle east & africa");
    params.set("country", "uk");

    const filters = parseFundingFilters(params);
    expect(filters.roundTypes).toEqual(["seed", "grant"]);
    expect(filters.regions).toEqual(["Middle East & Africa"]);
    expect(filters.countryCodes).toEqual(["GB"]);

    const comma = parseFundingFilters({ round: "seed,series_a,nope" });
    expect(comma.roundTypes).toEqual(["seed", "series_a"]);

    const again = parseFundingFilters(
      new URLSearchParams(serialiseFundingFilters(filters)),
    );
    expect(again.regions).toEqual(["Middle East & Africa"]);
    expect(again.countryCodes).toEqual(["GB"]);
  });
});
