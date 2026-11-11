import placeData from "./uk-places.json";
import { slugify } from "../normalise";
import type { UkRegionCode } from "./uk-regions";

export interface UkPlace {
  slug: string;
  name: string;
  aliases: readonly string[];
  itl1: UkRegionCode;
  lat: number;
  lon: number;
  /** 1 is under 10k people, 2 is 10k, 3 is 25k, 4 is 100k, 5 is 250k, 6 is 1M and over. */
  populationBand: 1 | 2 | 3 | 4 | 5 | 6;
}

export type UkCityMatch = { place: UkPlace } | { ambiguous: true } | null;

export const UK_PLACES: readonly UkPlace[] = placeData as unknown as UkPlace[];

/** A larger place wins only when it is at least this many bands bigger. */
const MIN_BAND_GAP = 2;

/** Trailing words that name a country, not a place ("London, UK"). */
const COUNTRY_SUFFIXES = new Set([
  "uk",
  "u k",
  "gb",
  "united kingdom",
  "great britain",
  "britain",
  "england",
  "scotland",
  "wales",
  "northern ireland",
]);

/**
 * Lowercase ASCII words separated by single spaces. Accents, punctuation and
 * case do not matter, and "St" and "Saint" are the same word.
 */
export function normalisePlaceName(name: string): string {
  return slugify(name)
    .split("-")
    .filter(Boolean)
    .map((word) => (word === "st" ? "saint" : word))
    .join(" ");
}

const BY_SLUG: ReadonlyMap<string, UkPlace> = new Map(
  UK_PLACES.map((place) => [place.slug, place]),
);

const BY_NAME: ReadonlyMap<string, readonly UkPlace[]> = (() => {
  const index = new Map<string, UkPlace[]>();
  for (const place of UK_PLACES) {
    for (const name of [place.name, ...place.aliases]) {
      const key = normalisePlaceName(name);
      if (!key) continue;
      const list = index.get(key) ?? [];
      if (!list.includes(place)) list.push(place);
      index.set(key, list);
    }
  }
  return index;
})();

export function findPlaceBySlug(slug: string): UkPlace | null {
  return BY_SLUG.get(slug) ?? null;
}

/** Drops ", UK", ", England" and similar from the end. */
function stripCountrySuffixes(city: string): string {
  const parts = city.split(",").map((part) => part.trim());
  while (parts.length > 1) {
    const last = parts[parts.length - 1] ?? "";
    if (!COUNTRY_SUFFIXES.has(normalisePlaceName(last))) break;
    parts.pop();
  }
  return parts.join(", ");
}

/**
 * Matches a free-text city to a UK place by name or alias. When several
 * places share the name, the biggest wins only if it is at least two
 * population bands above the next. Otherwise the match is ambiguous.
 */
export function matchUkCity(city: string): UkCityMatch {
  const key = normalisePlaceName(stripCountrySuffixes(city));
  if (!key) return null;
  const candidates = BY_NAME.get(key);
  if (!candidates || candidates.length === 0) return null;
  const [only] = candidates;
  if (candidates.length === 1 && only) return { place: only };

  const ranked = [...candidates].sort(
    (a, b) =>
      b.populationBand - a.populationBand || a.slug.localeCompare(b.slug),
  );
  const [first, second] = ranked;
  if (
    first &&
    second &&
    first.populationBand - second.populationBand >= MIN_BAND_GAP
  ) {
    return { place: first };
  }
  return { ambiguous: true };
}
