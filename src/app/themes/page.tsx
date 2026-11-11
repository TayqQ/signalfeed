import type { Metadata } from "next";
import Link from "next/link";
import { SECTOR_LABELS } from "@/core/sectors";
import type { ThemeSummary } from "@/core/read-models";
import { listThemes } from "@/db/queries/themes";
import { MIN_THEME_COMPANIES } from "@/db/queries/trends";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Themes | SignalFeed" };

export default async function ThemesPage() {
  const themes = await cached(
    () => listThemes(getWebDb()),
    ["themes", "active"],
  );
  const groups = new Map<string, ThemeSummary[]>();
  for (const theme of themes) {
    const label = theme.sector ? SECTOR_LABELS[theme.sector] : "No sector yet";
    groups.set(label, [...(groups.get(label) ?? []), theme]);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Themes</h1>
      <p className="mt-3 max-w-2xl text-quiet">
        Groups of related companies, by sector. Themes with fewer than{" "}
        {MIN_THEME_COMPANIES} companies are listed but kept out of the trend
        tables.
      </p>
      {themes.length === 0 ? (
        <p className="mt-8 border-y border-rule py-8 text-quiet">
          No themes yet. They appear once enough companies have been collected.
        </p>
      ) : (
        [...groups].map(([label, group]) => (
          <section key={label} className="mt-8" aria-label={label}>
            <h2 className="border-b-2 border-ink pb-1 text-lg font-semibold">
              {label}
            </h2>
            <ul className="divide-y divide-rule">
              {group.map((theme) => (
                <li
                  key={theme.slug}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 py-2"
                >
                  <Link
                    href={`/themes/${theme.slug}`}
                    className="text-signal underline underline-offset-4"
                  >
                    {theme.name}
                  </Link>
                  <span className="text-sm text-quiet">
                    {theme.companyCount === 1
                      ? "1 company"
                      : `${theme.companyCount} companies`}
                    {theme.companyCount < MIN_THEME_COMPANIES
                      ? " · few companies"
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
