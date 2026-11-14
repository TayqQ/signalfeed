// Search hints (D62, spec-phase3 sections 7.2 and 8.3). News often gives no
// country, so a UK company with `country_code` null was never searched in
// Companies House. Hints decide who is searched and in what order. They never
// change the link rules, and they are never written to `companies.country_code`:
// an inferred country is not shown as fact.

import { matchUkCity } from "@/lib/geo/uk-places";
import { ukRegionFromText } from "@/lib/geo/uk-region-names";
import { SOURCE_COUNTRY_HINTS } from "@/pipeline/sources";

/**
 * Why a company is searched in Companies House. The first four are evidence
 * the search had before D62. The last three are hints, used only when the
 * country is null or GB.
 */
export type ChSearchReason =
  | "grant_number"
  | "grant"
  | "country_gb"
  | "uk_location"
  | "gbp"
  | "uk_source"
  | "uk_place";

export type ChSearchHint = Extract<
  ChSearchReason,
  "gbp" | "uk_source" | "uk_place"
>;

/** Why a company may be linked to a Form D issuer. */
export type FormDSearchHint = "us_country" | "usd" | "us_source";

const EVIDENCE: ReadonlySet<ChSearchReason> = new Set([
  "grant_number",
  "grant",
  "country_gb",
  "uk_location",
]);

/** Hints in the order they are shown: strongest first. */
const HINT_ORDER: readonly ChSearchHint[] = ["gbp", "uk_source", "uk_place"];

/** Source slugs whose reports hint at this country (`SOURCE_COUNTRY_HINTS`). */
export function sourceSlugsFor(country: "GB" | "US"): string[] {
  return Object.entries(SOURCE_COUNTRY_HINTS)
    .filter(([, code]) => code === country)
    .map(([slug]) => slug)
    .sort();
}

/**
 * True when a town or region text names one UK place without doubt. A
 * shared name ("Newport") with no clear winner does not count. A name that
 * is also a large place abroad ("Boston", "Perth") still counts, which is
 * why this is the weakest hint.
 */
export function isUkPlaceText(
  text: string | null | undefined,
  kind: "city" | "region",
): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false;
  if (kind === "region") return ukRegionFromText(trimmed) !== null;
  const match = matchUkCity(trimmed);
  return match !== null && "place" in match;
}

/** Hints only count when the country is unknown or GB. */
export function hintsApply(countryCode: string | null): boolean {
  return countryCode === null || countryCode.toUpperCase() === "GB";
}

/** The hints among the reasons, strongest first. */
export function chHints(reasons: readonly ChSearchReason[]): ChSearchHint[] {
  return HINT_ORDER.filter((hint) => reasons.includes(hint));
}

/** True when nothing but hints put the company in the queue. */
export function searchedOnHintsOnly(
  reasons: readonly ChSearchReason[],
): boolean {
  return (
    !reasons.some((reason) => EVIDENCE.has(reason)) &&
    chHints(reasons).length > 0
  );
}

/**
 * The queue tier, lowest first, or null when the company is not searched:
 * 0 a grant gives a company number; 1 other evidence (GB country, a grant,
 * a UK location row); 2 two or more hints; 3 a GBP round or a UK-only
 * source; 4 a UK town or region only.
 */
export function chSearchTier(
  reasons: readonly ChSearchReason[],
): number | null {
  if (reasons.includes("grant_number")) return 0;
  if (reasons.some((reason) => EVIDENCE.has(reason))) return 1;
  const hints = chHints(reasons);
  if (hints.length >= 2) return 2;
  if (hints.includes("gbp") || hints.includes("uk_source")) return 3;
  if (hints.includes("uk_place")) return 4;
  return null;
}

/**
 * The note added to the reason of a link or candidate when only hints put
 * the company in the queue, so review shows why it appeared. Null otherwise.
 */
export function chSearchNote(
  reasons: readonly ChSearchReason[],
): string | null {
  if (!searchedOnHintsOnly(reasons)) return null;
  return `searched on hint: ${chHints(reasons).join(", ")}; country not stated`;
}

/**
 * Form D hints for a company: a US country, a USD round, or a report from a
 * US-only source. Linking still takes any company whose country is null or
 * US (section 8.3); the hints only explain a review row.
 */
export function formDHints(input: {
  countryCode: string | null;
  currencies: readonly (string | null)[];
  sourceSlugs: readonly string[];
}): FormDSearchHint[] {
  const hints: FormDSearchHint[] = [];
  if (input.countryCode?.toUpperCase() === "US") hints.push("us_country");
  if (input.currencies.some((c) => c?.toUpperCase() === "USD")) {
    hints.push("usd");
  }
  const usSources = new Set(sourceSlugsFor("US"));
  if (input.sourceSlugs.some((slug) => usSources.has(slug))) {
    hints.push("us_source");
  }
  return hints;
}

/**
 * The note added to a Form D link or candidate reason when the company's
 * country is not stated. Null when the country is stated.
 */
export function formDSearchNote(
  countryCode: string | null,
  hints: readonly FormDSearchHint[],
): string | null {
  if (countryCode !== null) return null;
  const shown = hints.filter((hint) => hint !== "us_country");
  return shown.length > 0
    ? `searched on hint: ${shown.join(", ")}; country not stated`
    : "country not stated, no US hint";
}
