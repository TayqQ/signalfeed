import type { ReactNode } from "react";
import type { ThemeRef } from "@/core/read-models";
import { SECTORS, SECTOR_LABELS, type Sector } from "@/core/sectors";

const inputClass =
  "mt-1 w-full border border-zinc-300 bg-white px-2 py-2 text-sm text-ink";
const labelClass = "block text-sm font-medium";

/**
 * A plain GET form with theme and sector selects, so it works without
 * JavaScript. `children` adds more fields, such as dates. The reset link goes
 * back to `action` with no filters.
 */
export function ThemeSelect({
  action,
  themes,
  theme,
  sector,
  submitLabel = "Apply filters",
  children,
}: {
  action: string;
  themes: readonly ThemeRef[];
  /** Selected theme slug. */
  theme?: string;
  sector?: Sector;
  submitLabel?: string;
  children?: ReactNode;
}) {
  const themeKnown = themes.some((item) => item.slug === theme);
  return (
    <form
      method="get"
      action={action}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <label htmlFor="theme" className={labelClass}>
          Theme
        </label>
        <select
          id="theme"
          name="theme"
          defaultValue={themeKnown ? theme : ""}
          className={inputClass}
        >
          <option value="">All themes</option>
          {themes.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sector" className={labelClass}>
          Sector
        </label>
        <select
          id="sector"
          name="sector"
          defaultValue={sector ?? ""}
          className={inputClass}
        >
          <option value="">All sectors</option>
          {SECTORS.map((value) => (
            <option key={value} value={value}>
              {SECTOR_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      {children}
      <div className="flex items-end gap-4 sm:col-span-2 lg:col-span-4">
        <button
          type="submit"
          className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-signal"
        >
          {submitLabel}
        </button>
        <a
          href={action}
          className="text-sm text-signal underline underline-offset-4"
        >
          Reset filters
        </a>
      </div>
    </form>
  );
}
