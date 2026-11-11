import { describe, expect, it } from "vitest";
import type { FundingCriteria } from "@/core/read-models";
import {
  effectiveRoundTypes,
  FUNDING_CRITERIA_VERSION,
  parseFundingCriteria,
  parseFundingFilters,
  parseFundingView,
  serialiseFundingCriteria,
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
      size: ["1m-5m", "100M-plus"],
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
      sizeBands: ["1m-5m", "100m-plus"],
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

const CRITERIA_TABLE: FundingCriteria[] = [
  {},
  { q: "Northwind" },
  { roundTypes: ["seed"] },
  { roundTypes: ["pre_seed", "seed", "grant"] },
  { roundTypes: ["grant"] },
  { sizeBands: ["under-1m", "1m-5m", "100m-plus"] },
  { minGbpMinor: 150, maxGbpMinor: 2000 },
  { minGbpMinor: 5_000_000_00 },
  { from: "2026-06-01", to: "2026-12-31" },
  { regions: ["UK", "Europe", "Middle East & Africa"] },
  { countryCodes: ["GB", "US"] },
  { ukRegions: ["london", "yorkshire-and-the-humber"] },
  { cities: ["berlin", "leeds", "san francisco"] },
  { near: { placeSlug: "leeds", km: 25 } },
  { near: { placeSlug: "leeds", km: 100 } },
  { sectors: ["software-ai", "health-life-sciences"] },
  { themes: ["ai-drug-discovery", "grid-batteries"] },
  { tag: "robotics", investorSlug: "northstar-capital" },
  { momentum: "first" },
  { momentum: "repeat" },
  {
    q: "Acme & Sons",
    roundTypes: ["pre_seed", "seed", "grant"],
    sizeBands: ["under-1m"],
    minGbpMinor: 10_050,
    from: "2026-06-01",
    regions: ["UK"],
    countryCodes: ["GB"],
    ukRegions: ["north-west"],
    cities: ["leeds"],
    near: { placeSlug: "leeds", km: 50 },
    sectors: ["health-life-sciences"],
    themes: ["ai-drug-discovery"],
    tag: "biotech",
    investorSlug: "x",
    momentum: "first",
  },
];

describe("canonical criteria serialisation", () => {
  it("is version 2", () => {
    expect(FUNDING_CRITERIA_VERSION).toBe(2);
  });

  it.each(CRITERIA_TABLE.map((c, i) => [i, c] as const))(
    "round-trips criteria %i, and serialising again is idempotent",
    (_index, criteria) => {
      const text = serialiseFundingCriteria(criteria);
      const parsed = parseFundingCriteria(new URLSearchParams(text));
      expect(parsed).toEqual(criteria);
      expect(serialiseFundingCriteria(parsed)).toBe(text);
    },
  );

  it("uses the fixed key order", () => {
    const text = serialiseFundingCriteria({
      momentum: "first",
      investorSlug: "inv",
      tag: "t",
      themes: ["th"],
      sectors: ["education"],
      near: { placeSlug: "leeds", km: 50 },
      cities: ["bath"],
      ukRegions: ["wales"],
      countryCodes: ["GB"],
      regions: ["UK"],
      to: "2026-02-01",
      from: "2026-01-01",
      maxGbpMinor: 200,
      minGbpMinor: 100,
      sizeBands: ["under-1m"],
      roundTypes: ["seed"],
      q: "x",
    });
    const keys = [...new URLSearchParams(text).keys()];
    expect(keys).toEqual([
      "q",
      "round",
      "size",
      "min",
      "max",
      "from",
      "to",
      "region",
      "country",
      "ukregion",
      "city",
      "near",
      "km",
      "sector",
      "theme",
      "tag",
      "investor",
      "momentum",
    ]);
  });

  it("gives one string whatever the order or duplicates of multi values", () => {
    const a = new URLSearchParams(
      "round=grant&round=seed&city=leeds&city=bath&sector=education&sector=software-ai&theme=b&theme=a&size=5m-20m&size=1m-5m",
    );
    const b = new URLSearchParams(
      "size=1m-5m&theme=a&sector=software-ai&city=bath&round=seed&sector=education&round=grant&city=leeds&theme=b&size=5m-20m&round=seed&city=BATH",
    );
    const textA = serialiseFundingCriteria(parseFundingCriteria(a));
    const textB = serialiseFundingCriteria(parseFundingCriteria(b));
    expect(textA).toBe(textB);
    expect(textA).toBe(
      "round=seed&round=grant&size=1m-5m&size=5m-20m&city=bath&city=leeds&sector=software-ai&sector=education&theme=a&theme=b",
    );
    // Hand-built criteria in a different order serialise the same way.
    expect(
      serialiseFundingCriteria({ cities: ["leeds", "bath", "bath"] }),
    ).toBe("city=bath&city=leeds");
  });

  it("omits defaults", () => {
    expect(
      serialiseFundingCriteria({ near: { placeSlug: "leeds", km: 25 } }),
    ).toBe("near=leeds");
    expect(serialiseFundingCriteria({})).toBe("");
    expect(
      serialiseFundingFilters({ ...parseFundingFilters({}), page: 1 }),
    ).toBe("");
  });

  it("puts the view after the criteria", () => {
    expect(
      serialiseFundingFilters({
        page: 3,
        pageSize: 50,
        sort: "amount",
        direction: "desc",
        roundTypes: ["seed"],
        momentum: "repeat",
      }),
    ).toBe(
      "round=seed&momentum=repeat&sort=amount&dir=desc&page=3&pageSize=50",
    );
  });
});

describe("targeting parameters", () => {
  it("parses every Phase 2 parameter", () => {
    const criteria = parseFundingCriteria({
      theme: ["AI-Drug-Discovery", "grid-batteries"],
      sector: "Health-Life-Sciences",
      ukregion: ["london", "wales"],
      city: [" Leeds ", "San Francisco"],
      near: "Leeds",
      km: "50",
      momentum: "FIRST",
    });
    expect(criteria).toEqual({
      themes: ["ai-drug-discovery", "grid-batteries"],
      sectors: ["health-life-sciences"],
      ukRegions: ["london", "wales"],
      cities: ["leeds", "san francisco"],
      near: { placeSlug: "leeds", km: 50 },
      momentum: "first",
    });
  });

  it("drops km without near, and unknown places", () => {
    expect(parseFundingCriteria({ km: "50" })).toEqual({});
    expect(parseFundingCriteria({ near: "unknown-place", km: "50" })).toEqual(
      {},
    );
    expect(parseFundingCriteria({ near: "" })).toEqual({});
  });

  it("falls back to 25 km for any radius that is not allowed", () => {
    for (const km of ["30", "0", "-10", "abc", "", "25.5", "1e2x"]) {
      expect(parseFundingCriteria({ near: "leeds", km }).near).toEqual({
        placeSlug: "leeds",
        km: 25,
      });
    }
    for (const km of ["10", "25", "50", "100"]) {
      expect(parseFundingCriteria({ near: "leeds", km }).near?.km).toBe(
        Number(km),
      );
    }
    expect(parseFundingCriteria({ near: "leeds" }).near?.km).toBe(25);
  });

  it("drops invalid sectors, UK regions, momentum and over-long cities", () => {
    const criteria = parseFundingCriteria({
      sector: ["nonsense", "education"],
      ukregion: ["atlantis", "scotland"],
      momentum: "sometimes",
      city: ["x".repeat(81), "y".repeat(80)],
    });
    expect(criteria).toEqual({
      sectors: ["education"],
      ukRegions: ["scotland"],
      cities: ["y".repeat(80)],
    });
  });

  it("keeps at most 10 cities", () => {
    const cities = Array.from({ length: 14 }, (_v, i) => `town-${i + 10}`);
    const parsed = parseFundingCriteria({ city: cities }).cities;
    expect(parsed).toHaveLength(10);
    expect(parsed).toEqual(cities.slice(0, 10));
  });
});

describe("criteria and view", () => {
  it("splits criteria from view and merges them for Phase 1 callers", () => {
    const params = {
      round: "seed",
      sort: "amount",
      dir: "desc",
      page: "2",
      pageSize: "50",
    };
    expect(parseFundingCriteria(params)).toEqual({ roundTypes: ["seed"] });
    expect(parseFundingView(params)).toEqual({
      sort: "amount",
      direction: "desc",
      page: 2,
      pageSize: 50,
    });
    expect(parseFundingFilters(params)).toEqual({
      roundTypes: ["seed"],
      sort: "amount",
      direction: "desc",
      page: 2,
      pageSize: 50,
    });
    expect(parseFundingView({})).toEqual({ page: 1, pageSize: 25 });
  });

  it("keeps Phase 1 URLs meaning the same criteria", () => {
    const url =
      "q=Northwind&round=seed&round=series_a&region=UK&country=GB&tag=Robotics&investor=Northstar-Capital&from=2024-01-01&to=2026-12-31&min=1.5&max=20&size=1m-5m&size=100M-plus";
    expect(parseFundingCriteria(new URLSearchParams(url))).toEqual({
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
      sizeBands: ["1m-5m", "100m-plus"],
    });
  });
});

describe("effectiveRoundTypes", () => {
  it("excludes grants by default", () => {
    const types = effectiveRoundTypes({});
    expect(types).not.toContain("grant");
    expect(types).toContain("seed");
    expect(types).toContain("unknown");
    expect(effectiveRoundTypes({ roundTypes: [] })).toEqual(types);
  });

  it("returns exactly the selected types otherwise", () => {
    expect(effectiveRoundTypes({ roundTypes: ["grant"] })).toEqual(["grant"]);
    expect(effectiveRoundTypes({ roundTypes: ["seed", "grant"] })).toEqual([
      "seed",
      "grant",
    ]);
  });
});
