import { isSector, SECTORS, type Sector } from "@/core/sectors";
import { sectorsForSic } from "@/lib/registry/sic-sectors";

/** One of a company's themes, as `company_themes` stores it. */
export interface ThemeStrength {
  themeId: number;
  /** How many of the company's tags fall in the theme: its strength. */
  tagCount: number;
  /** The theme's sector slug, or null while the theme has none. */
  sector: string | null;
}

export interface MainSectorInput {
  themes: readonly ThemeStrength[];
  /** SIC codes of the company's linked Companies House record. */
  sicCodes: readonly string[];
}

/**
 * The one sector a row shows (docs/design/research.md section 5):
 *   1. the sector of the company's strongest theme: the highest tag count,
 *      ties broken by the lowest theme id;
 *   2. otherwise the sector most of its SIC codes map to, ties broken by
 *      sector order in `SECTORS`;
 *   3. otherwise null, shown as "Sector pending".
 * Never `other`: it says nothing about the company, so a theme in `other`
 * is passed over, and SIC codes never map to it.
 */
export function chooseMainSector({
  themes,
  sicCodes,
}: MainSectorInput): Sector | null {
  let best: { themeId: number; tagCount: number; sector: Sector } | null = null;
  for (const theme of themes) {
    if (!isSector(theme.sector) || theme.sector === "other") continue;
    if (
      best === null ||
      theme.tagCount > best.tagCount ||
      (theme.tagCount === best.tagCount && theme.themeId < best.themeId)
    ) {
      best = {
        themeId: theme.themeId,
        tagCount: theme.tagCount,
        sector: theme.sector,
      };
    }
  }
  if (best) return best.sector;

  const votes = new Map<Sector, number>();
  for (const code of sicCodes) {
    const sector = sectorsForSic([code])[0];
    if (sector && sector !== "other") {
      votes.set(sector, (votes.get(sector) ?? 0) + 1);
    }
  }
  let winner: Sector | null = null;
  let winnerVotes = 0;
  for (const sector of SECTORS) {
    const count = votes.get(sector) ?? 0;
    if (count > winnerVotes) {
      winner = sector;
      winnerVotes = count;
    }
  }
  return winner;
}
