"use client";

import { useId, useState, type ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import {
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
  /** Rounds in the ranking window, when known. The list is already in order. */
  count?: number;
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

/** The trigger's text: "Sector", "Sector: Education" or "Sectors (2)". */
export function sectorButtonLabel(
  chosen: readonly string[],
  sectors: readonly SectorOption[],
): string {
  if (chosen.length === 0) return "Sector";
  if (chosen.length === 1) {
    const value = chosen[0] ?? "";
    const label = sectors.find((sector) => sector.value === value)?.label;
    return `Sector: ${label ?? value}`;
  }
  return `Sectors (${chosen.length})`;
}

function byName(a: ThemeOption, b: ThemeOption): number {
  return a.name.localeCompare(b.name, "en-GB");
}

/**
 * One sector control: a button ("Sector", "Sector: Education", "Sectors (2)")
 * that opens a scrollable checkbox list of every sector with its round count,
 * busiest first. Each chosen sector's themes are listed under it, as the
 * second level. It is a `Popover` in the bar, a section that opens in place
 * inside the phone filter sheet, and a `<details>` without JavaScript, whose
 * checkboxes submit with the GET form (`sector=`, `theme=`).
 */
export function SectorPicker({
  params,
  update,
  enhanced,
  layout,
  sectors,
  themes,
  caption,
}: {
  params: Params;
  update: Update;
  enhanced: boolean;
  layout: Layout;
  sectors: readonly SectorOption[];
  themes: readonly ThemeOption[];
  /** How the list is ordered, e.g. "Ranked by rounds in the last 90 days". */
  caption?: string;
}) {
  const label = sectorButtonLabel(paramValues(params, "sector"), sectors);
  const list = (
    <SectorList
      params={params}
      update={update}
      enhanced={enhanced}
      sectors={sectors}
      themes={themes}
      caption={caption}
    />
  );
  if (layout === "sheet" && enhanced) {
    return <InPlace label={label}>{list}</InPlace>;
  }
  return (
    <Disclosure enhanced={enhanced} layout="bar" label={label} title="Sector">
      {list}
    </Disclosure>
  );
}

/** Inside the phone sheet: a full-width button that opens the list below it. */
function InPlace({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section aria-label="Sector">
      <h3 className="mb-1.5 text-[13px] font-semibold">Sector</h3>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`${buttonClasses("secondary", "md")} w-full justify-between`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-[200ms] ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div
          id={id}
          className="mt-2 rounded-[var(--radius)] border border-line bg-surface p-3"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

const ROW =
  "flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1.5 text-[13px] text-ink hover:bg-surface-sunk";

/**
 * The searchable checkbox list. Themes chosen by URL whose sector is not
 * chosen stay listed at the end, so they can be unticked (and still submit).
 */
export function SectorList({
  params,
  update,
  enhanced,
  sectors,
  themes,
  caption,
}: {
  params: Params;
  update: Update;
  enhanced: boolean;
  sectors: readonly SectorOption[];
  themes: readonly ThemeOption[];
  caption?: string;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const chosen = paramValues(params, "sector");
  const chosenThemes = paramValues(params, "theme");
  const needle = enhanced ? query.trim().toLowerCase() : "";
  const matches = (text: string) =>
    needle === "" || text.toLowerCase().includes(needle);

  const known = new Map(themes.map((theme) => [theme.slug, theme]));
  const rows = sectors.flatMap((sector) => {
    const own = chosen.includes(sector.value)
      ? themes.filter((theme) => theme.sector === sector.value).sort(byName)
      : [];
    const sectorMatches = matches(sector.label);
    const shownThemes = sectorMatches
      ? own
      : own.filter((theme) => matches(theme.name));
    if (!sectorMatches && shownThemes.length === 0) return [];
    return [{ sector, own, shownThemes }];
  });
  const others: ThemeOption[] = chosenThemes
    .map((slug) => known.get(slug) ?? { slug, name: slug, sector: null })
    .filter((theme) => theme.sector === null || !chosen.includes(theme.sector))
    .sort(byName);
  const shownOthers = others.filter((theme) => matches(theme.name));

  const themeBox = (theme: ThemeOption) => (
    <li key={theme.slug}>
      <label className={ROW}>
        <input
          type="checkbox"
          name="theme"
          value={theme.slug}
          checked={chosenThemes.includes(theme.slug)}
          onChange={(event) => {
            const on = event.currentTarget.checked;
            update((p) => withToggled(p, "theme", theme.slug, on));
          }}
        />
        <span className="min-w-0 flex-1">{theme.name}</span>
      </label>
    </li>
  );

  return (
    <div>
      {enhanced ? (
        <div className="mb-2">
          <label htmlFor={searchId} className="sr-only">
            Find a sector or theme
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Find a sector or theme"
            autoComplete="off"
            className={FIELD}
          />
        </div>
      ) : null}
      {caption ? <p className="mb-1 text-xs text-muted">{caption}</p> : null}
      <fieldset>
        <legend className="sr-only">Sectors</legend>
        <ul className="-mx-1 max-h-72 overflow-y-auto overscroll-contain">
          {rows.map(({ sector, own, shownThemes }) => (
            <li key={sector.value}>
              <label className={ROW}>
                <input
                  type="checkbox"
                  name="sector"
                  value={sector.value}
                  checked={chosen.includes(sector.value)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    update((p) => changeSector(p, sector.value, on, themes));
                  }}
                />
                <span className="min-w-0 flex-1">{sector.label}</span>
                {sector.count !== undefined ? (
                  <span
                    className={`shrink-0 text-xs tabular-nums ${sector.count > 0 ? "text-muted" : "text-faint"}`}
                  >
                    <span className="sr-only">, </span>
                    {sector.count.toLocaleString("en-GB")}
                    <span className="sr-only">
                      {sector.count === 1 ? " round" : " rounds"}
                    </span>
                  </span>
                ) : null}
              </label>
              {chosen.includes(sector.value) ? (
                <div className="mb-1 ml-3 border-l border-line pl-2">
                  <fieldset>
                    <legend className="sr-only">
                      Themes in {sector.label}
                    </legend>
                    {own.length === 0 ? (
                      <p className="px-1 py-1 text-xs text-muted">
                        No themes in this sector yet.
                      </p>
                    ) : (
                      <ul>{shownThemes.map(themeBox)}</ul>
                    )}
                  </fieldset>
                </div>
              ) : null}
            </li>
          ))}
          {shownOthers.length > 0 ? (
            <li className="mt-1 border-t border-line pt-1">
              <fieldset>
                <legend className="px-1 pt-1 text-xs font-medium text-muted">
                  Other chosen themes
                </legend>
                <ul>{shownOthers.map(themeBox)}</ul>
              </fieldset>
            </li>
          ) : null}
        </ul>
        {rows.length === 0 && shownOthers.length === 0 ? (
          <p className="px-1 py-1 text-[13px] text-muted">
            No sector or theme matches.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
