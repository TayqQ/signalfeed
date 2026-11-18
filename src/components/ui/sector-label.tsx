import { SECTOR_LABELS, isSector } from "@/core/sectors";

/** The main sector, or "Sector pending" in muted text. */
export function SectorLabel({ sector }: { sector: string | null }) {
  if (sector === null || !isSector(sector)) {
    return <span className="text-muted">Sector pending</span>;
  }
  return <span className="text-ink">{SECTOR_LABELS[sector]}</span>;
}
