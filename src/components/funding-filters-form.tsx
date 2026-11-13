import Link from "next/link";
import { ROUND_TYPES } from "@/core/enums";
import { NEAR_RADII_KM, DEFAULT_NEAR_KM } from "@/core/read-models";
import type { FundingFilters, ThemeRef } from "@/core/read-models";
import { SECTORS, SECTOR_LABELS } from "@/core/sectors";
import { formatRoundType } from "@/lib/format";
import { UK_PLACES, findPlaceBySlug } from "@/lib/geo/uk-places";
import { UK_REGIONS } from "@/lib/geo/uk-regions";
import { SIZE_BAND_RANGES, SIZE_BANDS } from "@/lib/size-bands";

const inputClass =
  "mt-1 w-full border border-zinc-300 bg-white px-2 py-2 text-sm text-ink";
const labelClass = "block text-sm font-medium";
const legendClass = "text-sm font-semibold";
const groupClass = "space-y-3 border-t border-rule pt-4";
const checkGridClass =
  "mt-1 grid grid-cols-1 gap-x-2 text-sm min-[420px]:grid-cols-2 lg:grid-cols-1";
const checkLabelClass = "flex items-center gap-2 py-1";
const hintClass = "mt-1 text-xs text-quiet";

/**
 * Suggestions for the town inputs: only the biggest UK places (about 70), so
 * the page stays small. Any other UK place can still be typed by name.
 */
const SUGGESTED_PLACES = UK_PLACES.filter((place) => place.populationBand >= 4)
  .map((place) => place.name)
  .sort((a, b) => a.localeCompare(b, "en-GB"));

/**
 * One shared list of suggestions for the town inputs. Render it once on the
 * page, because the form can appear twice (mobile and desktop).
 */
export function PlaceSuggestions() {
  return (
    <datalist id="uk-place-suggestions">
      {SUGGESTED_PLACES.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

function majorUnits(minor: number | undefined): string | undefined {
  return minor === undefined ? undefined : String(minor / 100);
}

/**
 * A plain GET form, so filtering works without JavaScript and every view has a
 * URL. Controls are grouped as Where, What, Round and size, When, Momentum.
 * `themes` fills the theme select.
 */
export function FundingFiltersForm({
  filters,
  themes = [],
}: {
  filters: FundingFilters;
  themes?: readonly ThemeRef[];
}) {
  const nearSlug = filters.near?.placeSlug;
  const nearName = nearSlug
    ? (findPlaceBySlug(nearSlug)?.name ?? nearSlug)
    : undefined;
  const selectedTheme = filters.themes?.[0];
  const themeKnown = themes.some((theme) => theme.slug === selectedTheme);

  return (
    <form method="get" action="/" className="space-y-4">
      <div>
        <label htmlFor="q" className={labelClass}>
          Company name
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={filters.q}
          className={inputClass}
        />
      </div>

      <fieldset className={groupClass}>
        <legend className={legendClass}>Where</legend>
        <fieldset>
          <legend className={labelClass}>UK region</legend>
          <div className={checkGridClass}>
            {UK_REGIONS.map((region) => (
              <label key={region.slug} className={checkLabelClass}>
                <input
                  type="checkbox"
                  name="ukregion"
                  value={region.slug}
                  defaultChecked={filters.ukRegions?.includes(region.slug)}
                />
                {region.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="city" className={labelClass}>
            Town or city
          </label>
          <input
            id="city"
            name="city"
            type="text"
            list="uk-place-suggestions"
            autoComplete="off"
            defaultValue={filters.cities?.[0]}
            placeholder="Leeds"
            aria-describedby="city-hint"
            className={inputClass}
          />
          <p id="city-hint" className={hintClass}>
            Type a UK town, e.g. Leeds.
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <div>
            <label htmlFor="near" className={labelClass}>
              Near
            </label>
            <input
              id="near"
              name="near"
              type="text"
              list="uk-place-suggestions"
              autoComplete="off"
              defaultValue={nearName}
              placeholder="Anywhere"
              aria-describedby="near-hint"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="km" className={labelClass}>
              Within
            </label>
            <select
              id="km"
              name="km"
              defaultValue={String(filters.near?.km ?? DEFAULT_NEAR_KM)}
              className={inputClass}
            >
              {NEAR_RADII_KM.map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id="near-hint" className={hintClass}>
          Type any UK town for a distance search. Distance searches only find
          companies with a known town or postcode district.
        </p>
      </fieldset>

      <fieldset className={groupClass}>
        <legend className={legendClass}>What</legend>
        <fieldset>
          <legend className={labelClass}>Sector</legend>
          <div className={checkGridClass}>
            {SECTORS.map((sector) => (
              <label key={sector} className={checkLabelClass}>
                <input
                  type="checkbox"
                  name="sector"
                  value={sector}
                  defaultChecked={filters.sectors?.includes(sector)}
                />
                {SECTOR_LABELS[sector]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="theme" className={labelClass}>
            Theme
          </label>
          <select
            id="theme"
            name="theme"
            defaultValue={selectedTheme ?? ""}
            className={inputClass}
          >
            <option value="">Any theme</option>
            {selectedTheme && !themeKnown ? (
              <option value={selectedTheme}>{selectedTheme}</option>
            ) : null}
            {themes.map((theme) => (
              <option key={theme.slug} value={theme.slug}>
                {theme.name}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className={groupClass}>
        <legend className={legendClass}>Round and size</legend>
        <fieldset>
          <legend className={labelClass}>Round type</legend>
          <div className={checkGridClass}>
            {ROUND_TYPES.map((round) => (
              <label key={round} className={checkLabelClass}>
                <input
                  type="checkbox"
                  name="round"
                  value={round}
                  defaultChecked={filters.roundTypes?.includes(round)}
                />
                {formatRoundType(round)}
              </label>
            ))}
          </div>
          <p className={hintClass}>
            Leave all unticked to see every round except grants. Grants come
            from UKRI Gateway to Research.
          </p>
        </fieldset>
        <fieldset>
          <legend className={labelClass}>Deal size</legend>
          <div className={checkGridClass}>
            {SIZE_BANDS.map((band) => (
              <label key={band} className={checkLabelClass}>
                <input
                  type="checkbox"
                  name="size"
                  value={band}
                  defaultChecked={filters.sizeBands?.includes(band)}
                />
                {SIZE_BAND_RANGES[band].label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="min" className={labelClass}>
              Min £
            </label>
            <input
              id="min"
              name="min"
              type="number"
              inputMode="numeric"
              min="0"
              defaultValue={majorUnits(filters.minGbpMinor)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="max" className={labelClass}>
              Max £
            </label>
            <input
              id="max"
              name="max"
              type="number"
              inputMode="numeric"
              min="0"
              defaultValue={majorUnits(filters.maxGbpMinor)}
              className={inputClass}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className={groupClass}>
        <legend className={legendClass}>When</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="from" className={labelClass}>
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="to" className={labelClass}>
              To
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={filters.to}
              className={inputClass}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className={groupClass}>
        <legend className={legendClass}>Raising history</legend>
        <div className="text-sm">
          <label className={checkLabelClass}>
            <input
              type="radio"
              name="momentum"
              value=""
              defaultChecked={!filters.momentum}
            />
            Any
          </label>
          <label className={checkLabelClass}>
            <input
              type="radio"
              name="momentum"
              value="first"
              defaultChecked={filters.momentum === "first"}
            />
            First recorded round only
          </label>
          <label className={checkLabelClass}>
            <input
              type="radio"
              name="momentum"
              value="repeat"
              defaultChecked={filters.momentum === "repeat"}
            />
            Raised again within 24 months
          </label>
        </div>
        <p className={hintClass}>
          Our history starts in November 2026, so a first recorded round may not
          be the company&apos;s first ever.
        </p>
      </fieldset>

      {/* Values this form has no control for. They stay in the URL. */}
      {filters.tag ? (
        <input type="hidden" name="tag" value={filters.tag} />
      ) : null}
      {filters.investorSlug ? (
        <input type="hidden" name="investor" value={filters.investorSlug} />
      ) : null}
      {filters.countryCodes?.map((country) => (
        <input key={country} type="hidden" name="country" value={country} />
      ))}
      {filters.regions?.map((region) => (
        <input key={region} type="hidden" name="region" value={region} />
      ))}
      {filters.themes?.slice(1).map((slug) => (
        <input key={slug} type="hidden" name="theme" value={slug} />
      ))}
      {filters.cities?.slice(1).map((city) => (
        <input key={city} type="hidden" name="city" value={city} />
      ))}

      <div className="flex items-center gap-4 border-t border-rule pt-4">
        <button
          type="submit"
          className="bg-signal px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Apply filters
        </button>
        <Link
          href="/"
          className="text-sm text-quiet underline underline-offset-4"
        >
          Reset
        </Link>
      </div>
    </form>
  );
}
