"use client";

import { useState } from "react";
import { useEnhanced } from "@/components/filters/filter-controls";
import { RankedBars, type RankedBarItem } from "@/components/ui/ranked-bars";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatMoneyShort } from "@/lib/format";

export interface SectorBar {
  /** Unique per bar: the sector key, or "pending". */
  key: string;
  label: string;
  gbpMinor: number;
  count: number;
  /** The list filtered to this sector; none for "Sector pending". */
  href?: string;
}

export type SectorMetric = "gbp" | "count";

/** How many named sectors to show; "Sector pending" is added after them. */
export const SECTOR_BAR_LIMIT = 5;

function plural(count: number): string {
  return count === 1 ? "1 round" : `${count.toLocaleString("en-GB")} rounds`;
}

/** The bars for a metric: biggest first, "Sector pending" always last. */
export function sectorBarItems(
  sectors: readonly SectorBar[],
  metric: SectorMetric,
): RankedBarItem[] {
  const value = (sector: SectorBar) =>
    metric === "gbp" ? sector.gbpMinor : sector.count;
  const other = (sector: SectorBar) =>
    metric === "gbp" ? sector.count : sector.gbpMinor;
  const named = sectors
    .filter((sector) => sector.href !== undefined)
    .sort((a, b) => value(b) - value(a) || other(b) - other(a))
    .slice(0, SECTOR_BAR_LIMIT);
  const pending = sectors.filter((sector) => sector.href === undefined);
  return [...named, ...pending].map((sector) => ({
    label: sector.label,
    value: value(sector),
    valueLabel:
      metric === "gbp"
        ? formatMoneyShort(sector.gbpMinor, "GBP")
        : plural(sector.count),
    href: sector.href,
  }));
}

/**
 * "Where the money went": sectors ranked by £ raised, or by rounds with the
 * toggle (which needs JavaScript, so it appears once that runs). Each named
 * sector links to the list filtered to it.
 */
export function SectorBars({
  sectors,
  headingId,
}: {
  sectors: readonly SectorBar[];
  headingId: string;
}) {
  const enhanced = useEnhanced();
  const [metric, setMetric] = useState<SectorMetric>("gbp");
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          className="font-display text-[17px] font-semibold text-ink"
        >
          Where the money went
        </h3>
        {enhanced ? (
          <SegmentedControl
            label="Rank sectors by"
            options={[
              { value: "gbp", label: "£ raised" },
              { value: "count", label: "Rounds" },
            ]}
            value={metric}
            onChange={(value) => setMetric(value === "count" ? "count" : "gbp")}
          />
        ) : null}
      </div>
      <div className="mt-3">
        <RankedBars items={sectorBarItems(sectors, metric)} />
      </div>
      {sectors.some((sector) => sector.href !== undefined) ? (
        <p className="mt-2 text-xs text-muted">
          Bars start at zero. Select a sector to filter the rounds below.
        </p>
      ) : null}
    </div>
  );
}
