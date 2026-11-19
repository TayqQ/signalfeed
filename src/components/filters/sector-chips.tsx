"use client";

import { useId, useState } from "react";
import {
  ChoiceChip,
  Disclosure,
  FIELD,
  paramValues,
  withToggled,
  withValues,
  type Layout,
  type Params,
  type Update,
} from "./filter-controls";

export interface SectorOption {
  value: string;
  label: string;
}

export interface ThemeOption {
  slug: string;
  name: string;
  sector: string | null;
}

/** Turning a sector off also drops the themes that only it offered. */
function changeSector(
  params: Params,
  sector: string,
  on: boolean,
  themes: readonly ThemeOption[],
): Params {
  const next = withToggled(params, "sector", sector, on);
  if (on) return next;
  const dropped = new Set(
    themes.filter((theme) => theme.sector === sector).map((t) => t.slug),
  );
  return withValues(
    next,
    "theme",
    paramValues(next, "theme").filter((slug) => !dropped.has(slug)),
  );
}

/**
 * The sector chip row (multi-select), with the chosen sectors' themes as a
 * second level once any sector is chosen.
 */
export function SectorChips({
  params,
  update,
  enhanced,
  layout,
  sectors,
  themes,
}: {
  params: Params;
  update: Update;
  enhanced: boolean;
  layout: Layout;
  sectors: readonly SectorOption[];
  themes: readonly ThemeOption[];
}) {
  const chosen = paramValues(params, "sector");
  const chosenThemes = paramValues(params, "theme");

  return (
    <div
      className={
        layout === "bar" ? "flex min-w-0 items-center gap-2" : "space-y-4"
      }
    >
      <fieldset className="min-w-0 flex-1">
        <legend
          className={
            layout === "sheet" ? "mb-1.5 text-[13px] font-semibold" : "sr-only"
          }
        >
          Sector
        </legend>
        <div
          className={
            layout === "bar"
              ? "flex gap-2 overflow-x-auto py-1 [scrollbar-width:thin]"
              : "flex flex-wrap gap-2"
          }
        >
          {sectors.map((sector) => (
            <ChoiceChip
              key={sector.value}
              name="sector"
              value={sector.value}
              label={sector.label}
              checked={chosen.includes(sector.value)}
              onChange={(on) =>
                update((p) => changeSector(p, sector.value, on, themes))
              }
            />
          ))}
        </div>
      </fieldset>
      {chosen.length > 0 ? (
        <ThemePicker
          params={params}
          update={update}
          enhanced={enhanced}
          layout={layout}
          themes={themes}
        />
      ) : !enhanced ? (
        // No picker until a sector is chosen; keep themes from the URL.
        chosenThemes.map((slug) => (
          <input key={slug} type="hidden" name="theme" value={slug} />
        ))
      ) : null}
    </div>
  );
}

/**
 * The chosen sectors' themes as a searchable checkbox list. Themes chosen by
 * URL from other sectors stay listed so they can be unticked. No counts yet:
 * they need a query this task does not add.
 */
export function ThemePicker({
  params,
  update,
  enhanced,
  layout,
  themes,
}: {
  params: Params;
  update: Update;
  enhanced: boolean;
  layout: Layout;
  themes: readonly ThemeOption[];
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const sectors = paramValues(params, "sector");
  const chosen = paramValues(params, "theme");
  const known = new Map(themes.map((theme) => [theme.slug, theme]));
  const list: ThemeOption[] = themes.filter(
    (theme) =>
      (theme.sector != null && sectors.includes(theme.sector)) ||
      chosen.includes(theme.slug),
  );
  for (const slug of chosen) {
    if (!known.has(slug)) list.push({ slug, name: slug, sector: null });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? list.filter((theme) => theme.name.toLowerCase().includes(needle))
    : list;

  return (
    <Disclosure
      enhanced={enhanced}
      layout={layout}
      label={chosen.length > 0 ? `Themes (${chosen.length})` : "Themes"}
      title="Themes"
    >
      {enhanced ? (
        <div className="mb-2">
          <label htmlFor={searchId} className="sr-only">
            Find a theme
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Find a theme"
            className={FIELD}
          />
        </div>
      ) : null}
      <fieldset>
        <legend className="sr-only">Themes</legend>
        <ul className="max-h-64 overflow-y-auto">
          {shown.map((theme) => (
            <li key={theme.slug}>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
                <input
                  type="checkbox"
                  name="theme"
                  value={theme.slug}
                  checked={chosen.includes(theme.slug)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    update((p) => withToggled(p, "theme", theme.slug, on));
                  }}
                />
                {theme.name}
              </label>
            </li>
          ))}
        </ul>
        {shown.length === 0 ? (
          <p className="py-1 text-[13px] text-muted">
            {list.length === 0
              ? "No themes in this sector yet."
              : "No themes match."}
          </p>
        ) : null}
      </fieldset>
    </Disclosure>
  );
}
