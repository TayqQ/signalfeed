import Link from "next/link";
import type { Sector } from "@/core/sectors";
import type { ThemeRef } from "@/core/read-models";
import { Chip } from "@/components/ui/chip";
import { Monogram } from "@/components/ui/monogram";
import { PlaceBadge } from "@/components/ui/place-badge";
import { SectorLabel } from "@/components/ui/sector-label";

/**
 * The top of the company page: monogram, name, the description as a
 * standfirst, place, main sector, any status worth knowing, then theme chips.
 * Kept compact on phones so key facts and the latest round fit the first
 * screen: the standfirst is clamped to three lines and the themes scroll
 * sideways in one row.
 */
export function CompanyHeader({
  name,
  description,
  countryCode,
  place,
  mainSector,
  statuses,
  themes,
}: {
  name: string;
  description: string | null;
  countryCode: string | null;
  /** Town and region text, or null when only the country is known. */
  place: string | null;
  mainSector: Sector | null;
  /** For example "Acquired" or "Dissolved on 3 May 2026". */
  statuses: string[];
  themes: ThemeRef[];
}) {
  const standfirst = description?.trim() || null;
  return (
    <header>
      <div className="flex items-center gap-3 sm:gap-4">
        <span className="sm:hidden">
          <Monogram name={name} size={40} />
        </span>
        <span className="hidden sm:inline-flex">
          <Monogram name={name} size={56} />
        </span>
        <h1 className="min-w-0 break-words font-display text-[24px] font-semibold leading-tight tracking-tight text-ink sm:text-[38px]">
          {name}
        </h1>
      </div>
      {standfirst ? (
        <p className="mt-2 line-clamp-3 max-w-3xl text-[15px] leading-snug text-ink sm:mt-3 sm:line-clamp-none sm:text-[17px]">
          {standfirst}
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-muted">No description yet.</p>
      )}
      <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] sm:mt-3">
        <PlaceBadge countryCode={countryCode} city={place} />
        <span aria-hidden="true" className="text-faint">
          ·
        </span>
        {mainSector ? (
          <Link
            href={`/?sector=${encodeURIComponent(mainSector)}`}
            className="underline-offset-4 hover:underline"
          >
            <SectorLabel sector={mainSector} />
          </Link>
        ) : (
          <SectorLabel sector={null} />
        )}
        {statuses.map((status) => (
          <Chip key={status}>{status}</Chip>
        ))}
      </p>
      {themes.length > 0 ? (
        <ul
          aria-label="Themes"
          className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:mt-3 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {themes.map((theme) => (
            <li key={theme.slug} className="shrink-0">
              <Link
                href={`/themes/${encodeURIComponent(theme.slug)}`}
                className="block rounded-[var(--radius-pill)] transition-colors duration-[120ms] ease-out hover:opacity-80 motion-reduce:transition-none"
              >
                <Chip>{theme.name}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
