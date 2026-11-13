import type { FundingCriteria } from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import type { Sector } from "@/core/sectors";
import { formatMoneyCompact, formatRoundType } from "@/lib/format";
import { findPlaceBySlug } from "@/lib/geo/uk-places";
import { ukRegionBySlug } from "@/lib/geo/uk-regions";
import { SIZE_BAND_RANGES } from "@/lib/size-bands";

/** Display names for slugs. Anything missing falls back to the known data, then the slug. */
export interface FundingCriteriaNames {
  themes?: Readonly<Record<string, string>>;
  places?: Readonly<Record<string, string>>;
}

function joinWords(items: readonly string[], word: "and" | "or"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

function lowerFirst(text: string): string {
  // Keep names that start with a proper word ("Series A") as they are.
  if (/^Series /.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function roundPhrase(criteria: FundingCriteria): string {
  const types = criteria.roundTypes ?? [];
  if (types.length === 0) return "All funding rounds";
  const labels = types.map((type, index) => {
    const label = formatRoundType(type);
    return index === 0 ? label : lowerFirst(label);
  });
  return `${joinWords(labels, "and")} rounds`;
}

function sizePhrases(criteria: FundingCriteria): string[] {
  const phrases: string[] = [];
  const bands = (criteria.sizeBands ?? []).map((band) => {
    const label = SIZE_BAND_RANGES[band].label;
    return label.startsWith("Under") ? lowerFirst(label) : `of ${label}`;
  });
  if (bands.length > 0) phrases.push(joinWords(bands, "or"));
  const min = criteria.minGbpMinor;
  const max = criteria.maxGbpMinor;
  const money = (amount: number) => formatMoneyCompact(amount, "GBP");
  if (min != null && max != null) {
    phrases.push(`of ${money(min)} to ${money(max)}`);
  } else if (min != null) {
    phrases.push(`of at least ${money(min)}`);
  } else if (max != null) {
    phrases.push(`of up to ${money(max)}`);
  }
  return phrases;
}

function countryName(code: string): string {
  try {
    return (
      new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-06-01" as "1 June 2026". Criteria dates are already validated. */
function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

function titleCase(text: string): string {
  return text.replace(
    /(^|[\s-])(\p{L})/gu,
    (_all, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
  );
}

function placeName(slug: string, names: FundingCriteriaNames): string {
  return (
    names.places?.[slug] ??
    findPlaceBySlug(slug)?.name ??
    ukRegionBySlug(slug)?.name ??
    titleCase(slug.replace(/-/g, " "))
  );
}

function dateClause(criteria: FundingCriteria): string | null {
  const { from, to } = criteria;
  if (from && to) return `from ${longDate(from)} to ${longDate(to)}`;
  if (from) return `since ${longDate(from)}`;
  if (to) return `up to ${longDate(to)}`;
  return null;
}

/**
 * One plain-English sentence for a search, without a full stop. Pages use it
 * as a heading and Phase 4 alert emails can reuse it. `names` resolves theme
 * and place slugs to display names.
 */
export function describeFundingCriteria(
  criteria: FundingCriteria,
  names: FundingCriteriaNames = {},
): string {
  const head = [roundPhrase(criteria), ...sizePhrases(criteria)].join(" ");
  const clauses: string[] = [];

  if (!criteria.roundTypes || criteria.roundTypes.length === 0) {
    clauses.push("excluding grants");
  }
  if (criteria.regions?.length) {
    clauses.push(`in ${joinWords(criteria.regions, "or")}`);
  }
  if (criteria.countryCodes?.length) {
    clauses.push(
      `in ${joinWords(criteria.countryCodes.map(countryName), "or")}`,
    );
  }
  const places = [
    ...(criteria.ukRegions ?? []),
    ...(criteria.cities ?? []),
  ].map((slug) => placeName(slug, names));
  if (places.length > 0) clauses.push(`in ${joinWords(places, "or")}`);
  if (criteria.near) {
    const place = placeName(criteria.near.placeSlug, names);
    clauses.push(`within ${criteria.near.km} km of ${place}`);
  }
  if (criteria.sectors?.length) {
    const sectors = criteria.sectors.map((sector: Sector) =>
      lowerFirst(SECTOR_LABELS[sector]),
    );
    clauses.push(`in ${joinWords(sectors, "or")}`);
  }
  if (criteria.themes?.length) {
    const themes = criteria.themes.map((slug) => names.themes?.[slug] ?? slug);
    const noun = themes.length === 1 ? "theme" : "themes";
    clauses.push(`in the ${joinWords(themes, "or")} ${noun}`);
  }
  if (criteria.tag) clauses.push(`tagged ${criteria.tag}`);
  if (criteria.investorSlug) {
    clauses.push(`with investor ${criteria.investorSlug}`);
  }
  if (criteria.q) clauses.push(`matching "${criteria.q}"`);
  if (criteria.momentum === "first") {
    clauses.push("first recorded equity round");
  } else if (criteria.momentum === "repeat") {
    clauses.push("with an earlier equity round in the last 24 months");
  }
  const dates = dateClause(criteria);
  if (dates) clauses.push(dates);

  return upperFirst([head, ...clauses].join(", "));
}
