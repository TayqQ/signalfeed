"use client";

import { useId, useState, type KeyboardEvent } from "react";
import {
  CommitInput,
  Disclosure,
  FIELD,
  FIELD_LABEL,
  HINT,
  firstValue,
  paramValues,
  withToggled,
  withValues,
  type Layout,
  type Params,
  type Update,
} from "./filter-controls";

/** One choice in the place box: a UK region, a town or a country. */
export interface PlaceOption {
  key: "ukregion" | "city" | "country";
  value: string;
  label: string;
}

const PLACE_KEYS = ["ukregion", "city", "country", "region"] as const;

const HINTS: Readonly<Record<(typeof PLACE_KEYS)[number], string>> = {
  ukregion: "UK region",
  city: "Town",
  country: "Country",
  region: "World region",
};

const DEFAULT_KM = "25";

function normal(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * One box for where: UK region, town and country, plus "Within N km of" a
 * town. With JavaScript the box is a combobox over all three; without it, it
 * falls back to plain selects and a text field that submit with the form.
 */
export function PlaceBox({
  params,
  update,
  enhanced,
  layout,
  places,
  labels,
  radii,
  townListId,
}: {
  params: Params;
  update: Update;
  enhanced: boolean;
  layout: Layout;
  places: readonly PlaceOption[];
  /** `key:value` to a display name, for chosen values. */
  labels: Readonly<Record<string, string>>;
  radii: readonly number[];
  /** The id of a `<datalist>` of town names. */
  townListId: string;
}) {
  const ids = useId();
  const optionLabels = new Map(
    places.map((place) => [`${place.key}:${place.value}`, place.label]),
  );
  const chosen = PLACE_KEYS.flatMap((key) =>
    paramValues(params, key).map((value) => ({
      key,
      value,
      label:
        labels[`${key}:${value}`] ??
        optionLabels.get(`${key}:${value}`) ??
        value,
    })),
  );
  const near = firstValue(params, "near");
  const km = firstValue(params, "km") || DEFAULT_KM;
  const [kmDraft, setKmDraft] = useState(km);
  const nearText = near ? (labels[`near:${near}`] ?? near) : "";

  const count = chosen.length + (near ? 1 : 0);
  const firstLabel = chosen[0]?.label ?? `Near ${nearText}`;
  const trigger =
    count === 0
      ? "Place"
      : count === 1
        ? firstLabel
        : `${firstLabel} +${count - 1}`;

  return (
    <Disclosure
      enhanced={enhanced}
      layout={layout}
      label={trigger}
      title="Place"
    >
      <div className="space-y-4">
        {chosen.length > 0 ? (
          <fieldset>
            <legend className="sr-only">Chosen places</legend>
            <ul>
              {chosen.map((place) => (
                <li key={`${place.key}:${place.value}`}>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
                    <input
                      type="checkbox"
                      name={place.key}
                      value={place.value}
                      checked
                      onChange={() =>
                        update((p) =>
                          withToggled(p, place.key, place.value, false),
                        )
                      }
                    />
                    {place.label}
                    <span className="text-muted">{HINTS[place.key]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {enhanced ? (
          <PlaceCombobox
            options={places}
            chosen={chosen}
            onPick={(option) =>
              update((p) => withToggled(p, option.key, option.value, true))
            }
          />
        ) : (
          <NoScriptPlaceFields
            places={places}
            townListId={townListId}
            ids={ids}
          />
        )}

        <fieldset>
          <legend className={FIELD_LABEL}>Distance</legend>
          <div className="flex items-center gap-2 text-[13px]">
            <label htmlFor={`${ids}-km`}>Within</label>
            <select
              id={`${ids}-km`}
              name="km"
              value={near ? km : kmDraft}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setKmDraft(value);
                if (near) {
                  update((p) =>
                    withValues(p, "km", value === DEFAULT_KM ? [] : [value]),
                  );
                }
              }}
              className={`${FIELD} w-auto`}
            >
              {radii.map((radius) => (
                <option key={radius} value={String(radius)}>
                  {radius} km
                </option>
              ))}
            </select>
            <label htmlFor={`${ids}-near`}>of</label>
          </div>
          <CommitInput
            id={`${ids}-near`}
            name="near"
            type="text"
            list={townListId}
            autoComplete="off"
            value={nearText}
            placeholder="A UK town"
            aria-describedby={`${ids}-near-hint`}
            className={`${FIELD} mt-2`}
            onCommit={(text) =>
              update((p) => {
                const next = withValues(p, "near", text ? [text] : []);
                const radius = near ? km : kmDraft;
                return withValues(
                  next,
                  "km",
                  text && radius !== DEFAULT_KM ? [radius] : [],
                );
              })
            }
          />
          <p id={`${ids}-near-hint`} className={HINT}>
            Only finds companies with a known town or postcode.
          </p>
        </fieldset>
      </div>
    </Disclosure>
  );
}

function NoScriptPlaceFields({
  places,
  townListId,
  ids,
}: {
  places: readonly PlaceOption[];
  townListId: string;
  ids: string;
}) {
  const regions = places.filter((place) => place.key === "ukregion");
  const countries = places.filter((place) => place.key === "country");
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${ids}-ukregion`} className={FIELD_LABEL}>
          Add a UK region
        </label>
        <select
          id={`${ids}-ukregion`}
          name="ukregion"
          defaultValue=""
          className={FIELD}
        >
          <option value="">Choose a region</option>
          {regions.map((region) => (
            <option key={region.value} value={region.value}>
              {region.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${ids}-city`} className={FIELD_LABEL}>
          Add a town
        </label>
        <input
          id={`${ids}-city`}
          name="city"
          type="text"
          list={townListId}
          autoComplete="off"
          placeholder="Leeds"
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor={`${ids}-country`} className={FIELD_LABEL}>
          Add a country
        </label>
        <select
          id={`${ids}-country`}
          name="country"
          defaultValue=""
          className={FIELD}
        >
          <option value="">Choose a country</option>
          {countries.map((country) => (
            <option key={country.value} value={country.value}>
              {country.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const MAX_SUGGESTIONS = 8;

/**
 * A combobox over UK regions, towns and countries. Arrow keys move through
 * the suggestions and Enter picks one. Any other text can be added as a town.
 */
export function PlaceCombobox({
  options,
  chosen,
  onPick,
}: {
  options: readonly PlaceOption[];
  chosen: ReadonlyArray<{ key: string; value: string }>;
  onPick: (option: PlaceOption) => void;
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-list`;
  const needle = normal(text);
  const taken = new Set(chosen.map((item) => `${item.key}:${item.value}`));

  const matches = needle
    ? options
        .filter(
          (option) =>
            !taken.has(`${option.key}:${option.value}`) &&
            normal(option.label).includes(needle),
        )
        .sort(
          (a, b) =>
            Number(!normal(b.label).startsWith(needle)) -
            Number(!normal(a.label).startsWith(needle)),
        )
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const exactTown = matches.some(
    (option) => option.key === "city" && normal(option.label) === needle,
  );
  const items: PlaceOption[] =
    needle && !exactTown && !taken.has(`city:${needle}`)
      ? [...matches, { key: "city", value: needle, label: text.trim() }]
      : matches;
  const open = items.length > 0;
  const current = Math.min(active, items.length - 1);

  function pick(option: PlaceOption) {
    onPick(option);
    setText("");
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = items[current];
      if (option) pick(option);
    }
  }

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        Region, town or country
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="London, Leeds, Germany"
        className={FIELD}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Places"
        hidden={!open}
        className="mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-line bg-surface py-1"
      >
        {items.map((option, index) => (
          <li
            key={`${option.key}:${option.value}`}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(option);
            }}
            className={`flex cursor-pointer items-baseline justify-between gap-2 px-2.5 py-1.5 text-[13px] ${
              index === current ? "bg-surface-sunk" : ""
            }`}
          >
            <span>{option.label}</span>
            <span className="text-xs text-muted">{HINTS[option.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
