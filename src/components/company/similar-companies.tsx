import Link from "next/link";
import { SECTOR_LABELS } from "@/core/sectors";
import type { SimilarCompanies as SimilarCompaniesData } from "@/db/queries/companies";
import { Amount } from "@/components/ui/amount";
import { Monogram } from "@/components/ui/monogram";
import { PlaceBadge } from "@/components/ui/place-badge";
import { RelativeDate } from "@/components/ui/relative-date";
import { StageChip } from "@/components/ui/stage-chip";

/**
 * "Companies like this": up to five companies with the same main sector,
 * the same stage first (the query decides the order). Says honestly when the
 * sector is pending or nothing matches.
 */
export function SimilarCompanies({
  similar,
  now,
}: {
  similar: SimilarCompaniesData | null;
  now?: Date;
}) {
  const sector = similar?.mainSector ?? null;
  const items = similar?.items ?? [];
  return (
    <section aria-labelledby="similar-heading" className="mt-8 sm:mt-12">
      <h2
        id="similar-heading"
        className="font-display text-[20px] font-semibold text-ink"
      >
        Companies like this
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        {sector === null
          ? "Sector pending, so there is nothing to compare with yet."
          : items.length === 0
            ? `No other ${SECTOR_LABELS[sector]} companies with a recorded round yet.`
            : `Same sector, ${SECTOR_LABELS[sector]}, with the same stage first.`}
      </p>
      {items.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {items.map((item) => (
            <li key={item.slug} className="min-w-0">
              <Link
                href={`/companies/${item.slug}`}
                className="block h-full rounded-[var(--radius)] border border-line bg-surface p-3 transition-colors duration-[120ms] ease-out hover:bg-surface-sunk motion-reduce:transition-none"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Monogram name={item.name} size={28} />
                  <span className="truncate text-[15px] font-semibold text-ink">
                    {item.name}
                  </span>
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <StageChip
                    roundType={item.roundType}
                    label={item.roundLabel ?? undefined}
                  />
                  <Amount
                    amount={item.amount}
                    amountGbpMinor={item.amountGbpMinor}
                  />
                </span>
                <span className="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs">
                  <PlaceBadge countryCode={item.countryCode} city={item.city} />
                  <RelativeDate date={item.announcedOn} now={now} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
