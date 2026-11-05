import Link from "next/link";
import { ROUND_TYPES } from "@/core/enums";
import type { FundingFilters } from "@/core/read-models";
import { formatRoundType } from "@/lib/format";
import { REGIONS } from "@/lib/regions";

const inputClass =
  "mt-1 w-full border border-zinc-300 bg-white px-2 py-1.5 text-sm text-ink";
const labelClass = "block text-sm font-medium";

function majorUnits(minor: number | undefined): string | undefined {
  return minor === undefined ? undefined : String(minor / 100);
}

/** A plain GET form, so filtering works without JavaScript and every view has a URL. */
export function FundingFiltersForm({ filters }: { filters: FundingFilters }) {
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

      <fieldset>
        <legend className={labelClass}>Round</legend>
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-sm lg:grid-cols-1">
          {ROUND_TYPES.map((round) => (
            <label key={round} className="flex items-center gap-2">
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
      </fieldset>

      <div>
        <label htmlFor="region" className={labelClass}>
          Region
        </label>
        <select
          id="region"
          name="region"
          defaultValue={filters.regions?.[0] ?? ""}
          className={inputClass}
        >
          <option value="">Any region</option>
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="tag" className={labelClass}>
          Theme
        </label>
        <input
          id="tag"
          name="tag"
          defaultValue={filters.tag}
          placeholder="ai agents"
          className={inputClass}
        />
      </div>

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
        <div>
          <label htmlFor="min" className={labelClass}>
            Min £
          </label>
          <input
            id="min"
            name="min"
            type="number"
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
            min="0"
            defaultValue={majorUnits(filters.maxGbpMinor)}
            className={inputClass}
          />
        </div>
      </div>

      {filters.investorSlug ? (
        <input type="hidden" name="investor" value={filters.investorSlug} />
      ) : null}
      {filters.countryCodes?.map((country) => (
        <input key={country} type="hidden" name="country" value={country} />
      ))}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
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
