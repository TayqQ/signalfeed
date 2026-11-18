import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "@/core/enums";
import type { FundingCriteria } from "@/core/read-models";
import {
  countryOptions,
  datePresetFrom,
  describeAppliedFilters,
  effectiveRoundTypes,
  fundingFiltersHref,
  matchDatePreset,
  NON_GRANT_ROUND_TYPES,
  STAGE_PRESETS,
  FUNDING_CRITERIA_VERSION,
  parseFundingCriteria,
  unresolvedNearName,
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
  { evidence: "confirmed" },
  { companySizes: ["micro", "small"] },
  { companySizes: ["full_accounts", "dormant", "no_accounts_yet"] },
  {
    evidence: "confirmed",
    companySizes: ["micro", "medium"],
    sectors: ["software-ai"],
  },
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
    evidence: "confirmed",
    companySizes: ["small", "no_accounts_yet"],
  },
];

describe("canonical criteria serialisation", () => {
  it("is version 3", () => {
    expect(FUNDING_CRITERIA_VERSION).toBe(3);
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
      companySizes: ["small"],
      evidence: "confirmed",
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
      "evidence",
      "cosize",
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

describe("Phase 3 parameters (version 3)", () => {
  it("parses evidence and cosize slugs", () => {
    expect(
      parseFundingCriteria(
        new URLSearchParams(
          "evidence=confirmed&cosize=no-accounts-yet&cosize=micro&cosize=full-accounts",
        ),
      ),
    ).toEqual({
      evidence: "confirmed",
      companySizes: ["micro", "full_accounts", "no_accounts_yet"],
    });
  });

  it("serialises bands as slugs, in band order, de-duplicated", () => {
    expect(
      serialiseFundingCriteria({
        evidence: "confirmed",
        companySizes: ["no_accounts_yet", "micro", "micro", "full_accounts"],
      }),
    ).toBe(
      "evidence=confirmed&cosize=micro&cosize=full-accounts&cosize=no-accounts-yet",
    );
  });

  it("accepts comma lists and any case", () => {
    expect(
      parseFundingCriteria(
        new URLSearchParams("evidence=CONFIRMED&cosize=Small,DORMANT"),
      ),
    ).toEqual({ evidence: "confirmed", companySizes: ["small", "dormant"] });
  });

  it("drops invalid values", () => {
    expect(
      parseFundingCriteria(
        new URLSearchParams(
          "evidence=reported&cosize=huge&cosize=full_accounts&cosize=",
        ),
      ),
    ).toEqual({});
    expect(
      parseFundingCriteria(new URLSearchParams("evidence=&cosize=large,micro")),
    ).toEqual({ companySizes: ["micro"] });
  });

  it("leaves version 2 URLs unchanged", () => {
    const url =
      "round=seed&round=grant&size=1m-5m&near=leeds&km=50&sector=software-ai&momentum=first";
    const criteria = parseFundingCriteria(new URLSearchParams(url));
    expect(criteria.evidence).toBeUndefined();
    expect(criteria.companySizes).toBeUndefined();
    expect(serialiseFundingCriteria(criteria)).toBe(url);
  });

  it("puts the new keys after the version 2 keys", () => {
    expect(
      serialiseFundingFilters({
        page: 2,
        pageSize: 25,
        companySizes: ["micro"],
        evidence: "confirmed",
        momentum: "first",
      }),
    ).toBe("momentum=first&evidence=confirmed&cosize=micro&page=2");
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

  it("resolves near by place name, case-insensitively, to a slug", () => {
    for (const near of ["leeds", "Leeds", " LEEDS "]) {
      expect(parseFundingCriteria({ near }).near).toEqual({
        placeSlug: "leeds",
        km: 25,
      });
    }
    const named = parseFundingCriteria({ near: "Newcastle upon Tyne" }).near;
    expect(named?.placeSlug).toBe("newcastle-upon-tyne");
    expect(
      serialiseFundingCriteria(parseFundingCriteria({ near: "Leeds" })),
    ).toBe("near=leeds");
  });

  it("reports a near name that does not resolve", () => {
    expect(unresolvedNearName({ near: "Atlantis" })).toBe("Atlantis");
    expect(unresolvedNearName({ near: "Leeds" })).toBeUndefined();
    expect(unresolvedNearName({ near: "leeds" })).toBeUndefined();
    expect(unresolvedNearName({})).toBeUndefined();
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

/**
 * Links people may have saved before the filter bar (task 078). Each one must
 * keep parsing to exactly these criteria. The parser did not change, so these
 * expectations are what the old sidebar form and hidden fields produced.
 */
const OLD_URLS: ReadonlyArray<{ url: string; criteria: FundingCriteria }> = [
  { url: "", criteria: {} },
  { url: "q=Northwind", criteria: { q: "Northwind" } },
  {
    url: "q=+Acme+%26+Sons+&round=seed&round=series_a",
    criteria: { q: "Acme & Sons", roundTypes: ["seed", "series_a"] },
  },
  { url: "round=grant", criteria: { roundTypes: ["grant"] } },
  {
    url: "round=series_b&round=series_c&round=series_d_plus&round=growth",
    criteria: {
      roundTypes: ["series_b", "series_c", "series_d_plus", "growth"],
    },
  },
  {
    url: "round=seed,pre_seed&round=debt&round=unknown",
    criteria: { roundTypes: ["pre_seed", "seed", "debt", "unknown"] },
  },
  {
    url: "size=1m-5m&size=100M-plus&min=250000&max=2000000",
    criteria: {
      sizeBands: ["1m-5m", "100m-plus"],
      minGbpMinor: 25_000_000,
      maxGbpMinor: 200_000_000,
    },
  },
  {
    url: "from=2026-06-01&to=2026-06-30",
    criteria: { from: "2026-06-01", to: "2026-06-30" },
  },
  {
    url: "region=Europe&region=uk&country=us&country=UK",
    criteria: { regions: ["UK", "Europe"], countryCodes: ["GB", "US"] },
  },
  {
    url: "ukregion=london&ukregion=scotland&city=Leeds&city=San+Francisco",
    criteria: {
      ukRegions: ["london", "scotland"],
      cities: ["leeds", "san francisco"],
    },
  },
  {
    url: "near=Leeds&km=50",
    criteria: { near: { placeSlug: "leeds", km: 50 } },
  },
  {
    url: "near=newcastle-upon-tyne&km=30",
    criteria: { near: { placeSlug: "newcastle-upon-tyne", km: 25 } },
  },
  { url: "near=Atlantis&km=50", criteria: {} },
  {
    url: "sector=software-ai&sector=Health-Life-Sciences&theme=ai-drug-discovery",
    criteria: {
      sectors: ["software-ai", "health-life-sciences"],
      themes: ["ai-drug-discovery"],
    },
  },
  { url: "theme=&sector=&q=", criteria: {} },
  { url: "tag=Robotics", criteria: { tag: "robotics" } },
  {
    url: "investor=Northstar-Capital",
    criteria: { investorSlug: "northstar-capital" },
  },
  { url: "momentum=first", criteria: { momentum: "first" } },
  { url: "momentum=&evidence=", criteria: {} },
  {
    url: "momentum=repeat&evidence=confirmed",
    criteria: { momentum: "repeat", evidence: "confirmed" },
  },
  {
    url: "cosize=micro&cosize=no-accounts-yet&cosize=dormant",
    criteria: { companySizes: ["micro", "dormant", "no_accounts_yet"] },
  },
  {
    // Everything the old sidebar submitted, with empty text boxes and the
    // default radius, as it arrived from a real form submit.
    url: "q=&ukregion=north-west&city=&near=&km=25&sector=climate-energy&theme=&round=seed&size=under-1m&cosize=small&min=&max=&from=2026-01-01&to=&momentum=",
    criteria: {
      roundTypes: ["seed"],
      from: "2026-01-01",
      sizeBands: ["under-1m"],
      sectors: ["climate-energy"],
      ukRegions: ["north-west"],
      companySizes: ["small"],
    },
  },
  {
    url: "q=Bio&round=pre_seed&round=seed&round=grant&size=under-1m&min=100.5&from=2026-06-01&region=UK&country=GB&ukregion=north-west&city=leeds&near=leeds&km=100&sector=health-life-sciences&theme=ai-drug-discovery&tag=biotech&investor=x&momentum=first&evidence=confirmed&cosize=small&cosize=no-accounts-yet&sort=amount&dir=asc&page=3",
    criteria: {
      q: "Bio",
      roundTypes: ["pre_seed", "seed", "grant"],
      sizeBands: ["under-1m"],
      minGbpMinor: 10_050,
      from: "2026-06-01",
      regions: ["UK"],
      countryCodes: ["GB"],
      ukRegions: ["north-west"],
      cities: ["leeds"],
      near: { placeSlug: "leeds", km: 100 },
      sectors: ["health-life-sciences"],
      themes: ["ai-drug-discovery"],
      tag: "biotech",
      investorSlug: "x",
      momentum: "first",
      evidence: "confirmed",
      companySizes: ["small", "no_accounts_yet"],
    },
  },
];

describe("old links (task 078)", () => {
  it("covers at least 15 links and every parameter", () => {
    expect(OLD_URLS.length).toBeGreaterThanOrEqual(15);
    const keys = new Set(
      OLD_URLS.flatMap(({ url }) => [...new URLSearchParams(url).keys()]),
    );
    for (const key of [
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
      "evidence",
      "cosize",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it.each(OLD_URLS.map((entry) => [entry.url || "(empty)", entry] as const))(
    "%s parses to the same criteria",
    (_label, { url, criteria }) => {
      expect(parseFundingCriteria(new URLSearchParams(url))).toEqual(criteria);
    },
  );
});

/** The chips each old link shows, in the same order as `OLD_URLS`. */
const OLD_URL_CHIPS: readonly (readonly string[])[] = [
  [],
  ["Name: Northwind"],
  ["Name: Acme & Sons", "Seed", "Series A"],
  ["Grants"],
  ["Series B+"],
  ["Pre-seed/Seed", "Debt", "Unknown"],
  ["£1m–£5m", "£100m+", "At least £250k", "Up to £2.0m"],
  ["From 1 Jun 2026", "Until 30 Jun 2026"],
  ["United Kingdom", "United States", "UK", "Europe"],
  ["London", "Scotland", "Leeds", "San Francisco"],
  ["Within 50 km of Leeds"],
  ["Within 25 km of Newcastle upon Tyne"],
  [],
  ["Software, AI and data", "Health and life sciences", "AI drug discovery"],
  [],
  ["Tag: Robotics"],
  ["Investor: Northstar Capital"],
  ["First round"],
  [],
  ["Confirmed only", "Repeat raiser"],
  [
    "Company size: Tiny",
    "Company size: Dormant",
    "Company size: Not yet filed",
  ],
  [
    "Climate and energy",
    "Seed",
    "Under £1m",
    "This year",
    "North West",
    "Company size: Small",
  ],
  [
    "Name: Bio",
    "Health and life sciences",
    "AI drug discovery",
    "Pre-seed/Seed",
    "Grants",
    "Under £1m",
    "At least £101",
    "From 1 Jun 2026",
    "North West",
    "Leeds",
    "United Kingdom",
    "UK",
    "Within 100 km of Leeds",
    "Confirmed only",
    "Company size: Small",
    "Company size: Not yet filed",
    "First round",
    "Investor: X",
    "Tag: Biotech",
  ],
];

const CHIP_NAMES = {
  themes: { "ai-drug-discovery": "AI drug discovery" },
  today: "2026-11-18",
};

describe("applied filter chips for old links (task 078)", () => {
  it("has one chip list per old link", () => {
    expect(OLD_URL_CHIPS).toHaveLength(OLD_URLS.length);
  });

  it.each(
    OLD_URLS.map(
      (entry, index) =>
        [entry.url || "(empty)", entry, OLD_URL_CHIPS[index] ?? []] as const,
    ),
  )("%s shows the right chips", (_label, { criteria }, labels) => {
    const chips = describeAppliedFilters(criteria, CHIP_NAMES);
    expect(chips.map((chip) => chip.label)).toEqual(labels);
    expect(new Set(chips.map((chip) => chip.id)).size).toBe(chips.length);
  });

  it.each(OLD_URLS.map((entry) => [entry.url || "(empty)", entry] as const))(
    "%s: each chip's link removes only its own value",
    (_label, { criteria }) => {
      const chips = describeAppliedFilters(criteria, CHIP_NAMES);
      for (const chip of chips) {
        const href = fundingFiltersHref(chip.without);
        const query = href.split("?")[1] ?? "";
        const after = parseFundingCriteria(new URLSearchParams(query));
        expect(after).toEqual(chip.without);
        const left = describeAppliedFilters(after, CHIP_NAMES).map((c) => c.id);
        expect(left).not.toContain(chip.id);
        for (const other of chips) {
          if (other.id !== chip.id) expect(left).toContain(other.id);
        }
      }
    },
  );
});

describe("filter bar helpers", () => {
  it("builds removal links that keep sort, direction and page size", () => {
    const filters = parseFundingFilters(
      new URLSearchParams(
        "sector=software-ai&sector=education&round=seed&sort=amount&dir=asc&page=4&pageSize=50",
      ),
    );
    const chips = describeAppliedFilters(filters);
    const education = chips.find((chip) => chip.id === "sector:education");
    expect(education).toBeDefined();
    expect(fundingFiltersHref(education?.without ?? {}, filters)).toBe(
      "/?round=seed&sector=software-ai&sort=amount&dir=asc&pageSize=50",
    );
    expect(fundingFiltersHref({}, filters)).toBe(
      "/?sort=amount&dir=asc&pageSize=50",
    );
    expect(fundingFiltersHref({})).toBe("/");
  });

  it("removes a whole Stage preset with one chip", () => {
    const chips = describeAppliedFilters({
      roundTypes: ["pre_seed", "seed", "series_a"],
    });
    expect(chips.map((chip) => chip.label)).toEqual([
      "Pre-seed/Seed",
      "Series A",
    ]);
    expect(chips[0]?.without).toEqual({ roundTypes: ["series_a"] });
    expect(
      describeAppliedFilters({ roundTypes: [...ROUND_TYPES] }).map(
        (chip) => chip.label,
      ),
    ).toEqual(["All rounds, including grants"]);
  });

  it("works out date presets in UTC", () => {
    expect(datePresetFrom("7d", "2026-11-18")).toBe("2026-11-11");
    expect(datePresetFrom("30d", "2026-03-01")).toBe("2026-01-30");
    expect(datePresetFrom("90d", "2026-11-18")).toBe("2026-08-20");
    expect(datePresetFrom("year", "2026-11-18")).toBe("2026-01-01");
    expect(matchDatePreset({ from: "2026-10-19" }, "2026-11-18")).toBe("30d");
    expect(
      matchDatePreset({ from: "2026-10-19", to: "2026-11-01" }, "2026-11-18"),
    ).toBeUndefined();
    expect(matchDatePreset({ from: "2026-10-18" }, "2026-11-18")).toBe(
      undefined,
    );
  });

  it("lists every country the parser accepts, by name", () => {
    const countries = countryOptions();
    expect(countries.find((c) => c.code === "US")?.name).toBe("United States");
    for (const { code } of countries) {
      expect(parseFundingCriteria({ country: code }).countryCodes).toEqual([
        code,
      ]);
    }
  });

  it("keeps the Stage presets inside the round types", () => {
    for (const preset of STAGE_PRESETS) {
      for (const type of preset.roundTypes) {
        expect(NON_GRANT_ROUND_TYPES).toContain(type);
      }
    }
    expect(NON_GRANT_ROUND_TYPES).not.toContain("grant");
  });
});
