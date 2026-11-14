import { describe, expect, it } from "vitest";
import { SOURCE_COUNTRY_HINTS, SOURCES } from "@/pipeline/sources";
import {
  chSearchNote,
  chSearchTier,
  formDHints,
  formDSearchNote,
  hintsApply,
  isUkPlaceText,
  searchedOnHintsOnly,
  sourceSlugsFor,
} from "./search-hints";

describe("source country hints", () => {
  it("names only configured sources, and UKTN is the one UK-only source", () => {
    const slugs = new Set(SOURCES.map((s) => s.slug));
    for (const slug of Object.keys(SOURCE_COUNTRY_HINTS)) {
      expect(slugs.has(slug), slug).toBe(true);
    }
    expect(sourceSlugsFor("GB")).toEqual(["uktech-news"]);
    expect(sourceSlugsFor("US")).toEqual([]);
  });
});

describe("chSearchTier", () => {
  it("puts evidence before hints, and two hints before one", () => {
    expect(chSearchTier(["grant_number", "grant"])).toBe(0);
    expect(chSearchTier(["country_gb"])).toBe(1);
    expect(chSearchTier(["uk_location", "gbp"])).toBe(1);
    expect(chSearchTier(["gbp", "uk_place"])).toBe(2);
    expect(chSearchTier(["gbp"])).toBe(3);
    expect(chSearchTier(["uk_source"])).toBe(3);
    expect(chSearchTier(["uk_place"])).toBe(4);
    expect(chSearchTier([])).toBeNull();
  });

  it("notes the hints only when nothing else put the company in the queue", () => {
    expect(searchedOnHintsOnly(["uk_source", "gbp"])).toBe(true);
    expect(chSearchNote(["uk_source", "gbp"])).toBe(
      "searched on hint: gbp, uk_source; country not stated",
    );
    expect(searchedOnHintsOnly(["country_gb", "gbp"])).toBe(false);
    expect(chSearchNote(["country_gb", "gbp"])).toBeNull();
  });

  it("applies hints only to a null or GB country", () => {
    expect(hintsApply(null)).toBe(true);
    expect(hintsApply("GB")).toBe(true);
    expect(hintsApply("FR")).toBe(false);
    expect(hintsApply("US")).toBe(false);
  });
});

describe("isUkPlaceText", () => {
  it("takes a UK town or region, and nothing abroad", () => {
    expect(isUkPlaceText("Leeds", "city")).toBe(true);
    expect(isUkPlaceText("Paris", "city")).toBe(false);
    expect(isUkPlaceText("Scotland", "region")).toBe(true);
    expect(isUkPlaceText("Bavaria", "region")).toBe(false);
    expect(isUkPlaceText(null, "city")).toBe(false);
    expect(isUkPlaceText("  ", "region")).toBe(false);
  });
});

describe("formDHints", () => {
  it("reads a US country and a USD round", () => {
    expect(
      formDHints({
        countryCode: "US",
        currencies: ["USD", null],
        sourceSlugs: [],
      }),
    ).toEqual(["us_country", "usd"]);
    expect(
      formDHints({ countryCode: null, currencies: ["EUR"], sourceSlugs: [] }),
    ).toEqual([]);
  });

  it("notes a missing country, with or without a hint", () => {
    expect(formDSearchNote(null, ["usd"])).toBe(
      "searched on hint: usd; country not stated",
    );
    expect(formDSearchNote(null, [])).toBe("country not stated, no US hint");
    expect(formDSearchNote("US", ["us_country", "usd"])).toBeNull();
  });
});
