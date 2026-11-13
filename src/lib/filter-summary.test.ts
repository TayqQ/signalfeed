import { describe, expect, it } from "vitest";
import { describeFundingCriteria } from "./filter-summary";

const names = {
  themes: { "ai-drug-discovery": "AI drug discovery" },
  places: { leeds: "Leeds" },
};

describe("describeFundingCriteria", () => {
  it("says grants are excluded when nothing is set", () => {
    expect(describeFundingCriteria({})).toBe(
      "All funding rounds, excluding grants",
    );
  });

  it("matches the spec example", () => {
    expect(
      describeFundingCriteria(
        {
          roundTypes: ["seed", "grant"],
          sizeBands: ["under-1m"],
          near: { placeSlug: "leeds", km: 25 },
          sectors: ["health-life-sciences"],
          from: "2026-06-01",
        },
        names,
      ),
    ).toBe(
      "Seed and grant rounds under £1M, within 25 km of Leeds, in health and life sciences, since 1 June 2026",
    );
  });

  it("keeps Series names capitalised and lists three or more with commas", () => {
    expect(
      describeFundingCriteria({ roundTypes: ["seed", "series_a", "series_b"] }),
    ).toBe("Seed, Series A and Series B rounds");
    expect(describeFundingCriteria({ roundTypes: ["grant"] })).toBe(
      "Grant rounds",
    );
  });

  it("describes size ranges, themes, places and momentum", () => {
    expect(
      describeFundingCriteria(
        {
          roundTypes: ["pre_seed"],
          minGbpMinor: 50_000_00,
          maxGbpMinor: 2_000_000_00,
          ukRegions: ["london"],
          cities: ["leeds", "san francisco"],
          themes: ["ai-drug-discovery"],
          momentum: "first",
          from: "2026-01-01",
          to: "2026-06-30",
        },
        names,
      ),
    ).toBe(
      "Pre-seed rounds of £50K to £2M, in London, Leeds or San Francisco, in the AI drug discovery theme, first recorded equity round, from 1 January 2026 to 30 June 2026",
    );
  });
});
