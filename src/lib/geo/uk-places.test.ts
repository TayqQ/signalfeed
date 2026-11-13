import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UK_PLACES,
  findPlaceBySlug,
  matchUkCity,
  normalisePlaceName,
} from "./uk-places";
import { ukRegionByCode } from "./uk-regions";

function placeSlug(city: string): string | null {
  const match = matchUkCity(city);
  return match && "place" in match ? match.place.slug : null;
}

describe("normalisePlaceName", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalisePlaceName("  LEEDS ")).toBe("leeds");
    expect(normalisePlaceName("Stoke-on-Trent")).toBe("stoke on trent");
    expect(normalisePlaceName("Caerdydd")).toBe("caerdydd");
    expect(normalisePlaceName("Aberdâr")).toBe("aberdar");
  });

  it("treats St and Saint alike", () => {
    expect(normalisePlaceName("St Albans")).toBe(
      normalisePlaceName("Saint Albans"),
    );
  });
});

describe("findPlaceBySlug", () => {
  it("finds a place or returns null", () => {
    expect(findPlaceBySlug("leeds")?.name).toBe("Leeds");
    expect(findPlaceBySlug("newport-wales")?.itl1).toBe("TLL");
    expect(findPlaceBySlug("newport-isle-of-wight")?.itl1).toBe("TLJ");
    expect(findPlaceBySlug("nowhere")).toBeNull();
  });
});

describe("matchUkCity", () => {
  it("matches names ignoring case", () => {
    expect(placeSlug("Leeds")).toBe("leeds");
    expect(placeSlug("leeds")).toBe("leeds");
    expect(placeSlug("  BRADFORD ")).toBe("bradford");
  });

  it("matches aliases and other-language names", () => {
    expect(placeSlug("Greater London")).toBe("london");
    expect(placeSlug("City of London")).toBe("london");
    expect(placeSlug("Hull")).toBe("kingston-upon-hull");
    expect(placeSlug("Caerdydd")).toBe("cardiff");
    expect(placeSlug("Londonderry")).toBe("derry");
    expect(placeSlug("Westminster")).toBe("city-of-westminster");
  });

  it("strips country suffixes", () => {
    expect(placeSlug("London, UK")).toBe("london");
    expect(placeSlug("Leeds, England")).toBe("leeds");
    expect(placeSlug("Glasgow, Scotland, UK")).toBe("glasgow");
    expect(placeSlug("Belfast, United Kingdom")).toBe("belfast");
  });

  it("reports names shared by places of similar size as ambiguous", () => {
    expect(matchUkCity("Newport")).toEqual({ ambiguous: true });
    expect(matchUkCity("Royston")).toEqual({ ambiguous: true });
    expect(matchUkCity("Ashford")).toEqual({ ambiguous: true });
    expect(matchUkCity("Newport, UK")).toEqual({ ambiguous: true });
  });

  it("picks the larger place only when it is two bands bigger", () => {
    // Newcastle upon Tyne (alias "Newcastle") is band 4, Newcastle in County Down band 1.
    expect(placeSlug("Newcastle")).toBe("newcastle-upon-tyne");
  });

  it("returns null for unknown places and empty text", () => {
    expect(matchUkCity("Springfield")).toBeNull();
    expect(matchUkCity("")).toBeNull();
    expect(matchUkCity(" , UK")).toBeNull();
    expect(matchUkCity("Paris")).toBeNull();
  });

  it("does not match part of a name", () => {
    expect(matchUkCity("Leed")).toBeNull();
    expect(matchUkCity("New")).toBeNull();
  });
});

describe("uk-places.json", () => {
  it("has unique slugs and valid ITL1 codes", () => {
    expect(UK_PLACES.length).toBeGreaterThan(1000);
    expect(new Set(UK_PLACES.map((p) => p.slug)).size).toBe(UK_PLACES.length);
    for (const place of UK_PLACES) {
      expect(ukRegionByCode(place.itl1), place.slug).not.toBeNull();
      expect(place.populationBand, place.slug).toBeGreaterThanOrEqual(1);
      expect(place.populationBand, place.slug).toBeLessThanOrEqual(6);
      expect(place.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("keeps every place inside the UK bounding box", () => {
    for (const place of UK_PLACES) {
      expect(place.lat, place.slug).toBeGreaterThan(49.8);
      expect(place.lat, place.slug).toBeLessThan(61);
      expect(place.lon, place.slug).toBeGreaterThan(-8.7);
      expect(place.lon, place.slug).toBeLessThan(1.9);
    }
  });

  it("covers every nation and region with a place", () => {
    const codes = new Set(UK_PLACES.map((p) => p.itl1));
    expect(codes.size).toBe(12);
  });

  it("stays within the size limits", () => {
    const places = statSync(
      fileURLToPath(new URL("./uk-places.json", import.meta.url)),
    ).size;
    const outcodes = statSync(
      fileURLToPath(new URL("./uk-outcodes.json", import.meta.url)),
    ).size;
    expect(places).toBeLessThan(300 * 1024);
    expect(outcodes).toBeLessThan(200 * 1024);
  });
});
