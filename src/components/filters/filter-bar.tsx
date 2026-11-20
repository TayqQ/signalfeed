import { MOMENTUM_FILTERS, NEAR_RADII_KM } from "@/core/read-models";
import type { FundingFilters, ThemeRef } from "@/core/read-models";
import { companySizeBandSlug } from "@/core/registry";
import { SECTORS, SECTOR_LABELS, type Sector } from "@/core/sectors";
import {
  COMPANY_SIZE_FILTER_LABELS,
  COMPANY_SIZE_FILTER_OPTIONS,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  MOMENTUM_FILTER_LABELS,
  NON_GRANT_ROUND_TYPES,
  STAGE_PRESETS,
  cityLabel,
  countryName,
  countryOptions,
  datePresetFrom,
  describeAppliedFilters,
  fundingFiltersHref,
  placeLabel,
  serialiseFundingCriteria,
  serialiseFundingFilters,
} from "@/lib/funding-filters";
import { UK_PLACES } from "@/lib/geo/uk-places";
import { UK_REGIONS, ukRegionBySlug } from "@/lib/geo/uk-regions";
import { SIZE_BAND_RANGES, SIZE_BANDS } from "@/lib/size-bands";
import { AppliedChips } from "./applied-chips";
import { FilterForm, type FilterFormData } from "./filter-form";
import type { PlaceOption } from "./place-box";

/** The biggest UK places (about 70), so the page stays small. */
const SUGGESTED_TOWNS = UK_PLACES.filter((place) => place.populationBand >= 4)
  .map((place) => place.name)
  .sort((a, b) => a.localeCompare(b, "en-GB"));

function toParams(query: string): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    (params[key] ??= []).push(value);
  }
  return params;
}

function titleWords(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The window the sector list is ranked over: the "Last 90 days" preset and a
 * business quarter. A week or a month is too few rounds to rank reliably; a
 * year would rank by the past, not the present.
 */
export const SECTOR_RANK_DAYS = 90;

/**
 * The short filter bar above the list (research section 2): the sector
 * dropdown with themes, Stage, amount, date, place, "Confirmed only" and "More
 * filters", with a removable chip for every applied value. `total` is the
 * number of matching rounds, for the phone sheet's "Show N results".
 */
export function FilterBar({
  filters,
  themes = [],
  total,
  sectorCounts,
  today = new Date().toISOString().slice(0, 10),
  action = "/",
}: {
  filters: FundingFilters;
  themes?: readonly ThemeRef[];
  total: number;
  /**
   * Rounds per sector over the last `SECTOR_RANK_DAYS` days, busiest first
   * (`getSectorCounts`). Without it the sectors keep their fixed order.
   */
  sectorCounts?: ReadonlyArray<{ sector: Sector; count: number }>;
  /** YYYY-MM-DD (UTC), for the date presets. */
  today?: string;
  action?: string;
}) {
  const params = toParams(serialiseFundingCriteria(filters));
  const view = Object.fromEntries(
    new URLSearchParams(
      serialiseFundingFilters({
        sort: filters.sort,
        direction: filters.direction,
        page: 1,
        pageSize: filters.pageSize,
      }),
    ),
  );
  const themeNames = Object.fromEntries(
    themes.map((theme) => [theme.slug, theme.name]),
  );

  const labels: Record<string, string> = {};
  for (const slug of filters.ukRegions ?? []) {
    labels[`ukregion:${slug}`] = ukRegionBySlug(slug)?.name ?? slug;
  }
  for (const city of filters.cities ?? [])
    labels[`city:${city}`] = cityLabel(city);
  for (const code of filters.countryCodes ?? []) {
    labels[`country:${code}`] = countryName(code);
  }
  if (filters.near) {
    labels[`near:${filters.near.placeSlug}`] = placeLabel(
      filters.near.placeSlug,
    );
  }
  if (filters.investorSlug) {
    labels[`investor:${filters.investorSlug}`] = titleWords(
      filters.investorSlug,
    );
  }

  const places: PlaceOption[] = [
    ...UK_REGIONS.map((region): PlaceOption => ({
      key: "ukregion",
      value: region.slug,
      label: region.name,
    })),
    ...SUGGESTED_TOWNS.map((name): PlaceOption => ({
      key: "city",
      value: name.toLowerCase(),
      label: name,
    })),
    ...countryOptions().map((country): PlaceOption => ({
      key: "country",
      value: country.code,
      label: country.name,
    })),
  ];

  const companySizes = COMPANY_SIZE_FILTER_OPTIONS.concat(
    filters.companySizes?.includes("dormant") ? ["dormant"] : [],
  ).map((band) => ({
    value: companySizeBandSlug(band),
    label: COMPANY_SIZE_FILTER_LABELS[band],
  }));

  const data: FilterFormData = {
    action,
    params,
    view,
    total,
    stages: STAGE_PRESETS.map((preset) => ({
      value: preset.value,
      label: preset.label,
      rounds: preset.roundTypes,
    })),
    nonGrantRounds: NON_GRANT_ROUND_TYPES,
    dates: DATE_PRESETS.map((preset) => ({
      value: preset,
      label: DATE_PRESET_LABELS[preset],
      from: datePresetFrom(preset, today),
    })),
    sectors: sectorCounts
      ? sectorCounts.map(({ sector, count }) => ({
          value: sector,
          label: SECTOR_LABELS[sector],
          count,
        }))
      : SECTORS.map((sector) => ({
          value: sector,
          label: SECTOR_LABELS[sector],
        })),
    sectorCaption: sectorCounts
      ? `Ranked by rounds in the last ${SECTOR_RANK_DAYS} days`
      : undefined,
    themes: themes.map((theme) => ({
      slug: theme.slug,
      name: theme.name,
      sector: theme.sector,
    })),
    sizes: SIZE_BANDS.map((band) => ({
      value: band,
      label: SIZE_BAND_RANGES[band].label,
    })),
    companySizes,
    momentum: MOMENTUM_FILTERS.map((value) => ({
      value,
      label: MOMENTUM_FILTER_LABELS[value],
    })),
    places,
    towns: SUGGESTED_TOWNS,
    radii: NEAR_RADII_KM,
    labels,
  };

  const chips = describeAppliedFilters(filters, {
    themes: themeNames,
    today,
  }).map((chip) => ({
    id: chip.id,
    label: chip.label,
    href: fundingFiltersHref(chip.without, filters, action),
  }));

  return (
    <div className="space-y-3">
      <FilterForm data={data} />
      <AppliedChips
        chips={chips}
        clearHref={fundingFiltersHref({}, filters, action)}
      />
    </div>
  );
}
