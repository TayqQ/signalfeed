import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { SectorSource } from "@/core/enums";
import type { SectorStats } from "@/core/domain";
import type { Clock } from "@/core/ports";
import { isSector, type Sector } from "@/core/sectors";
import type { Db } from "@/db/client";
import {
  chCompanies,
  companies,
  companySectors,
  companyThemes,
  registryLinks,
  themes,
} from "@/db/schema";
import {
  SIC_SECTOR_MAP_VERSION,
  sectorsForSic,
} from "@/lib/registry/sic-sectors";
import { emptyDiffCounts, writeDiff } from "./diff-write";
import {
  computeFingerprint,
  recordRebuild,
  shouldRebuild,
  type FingerprintInput,
} from "./fingerprint";
import { resolveActiveThemes } from "./company-themes";

/** The `derived_rebuilds` name of this rebuild. */
export const SECTORS_REBUILD = "sectors";

/**
 * Bumped when the sector rules change, so the next run rebuilds. The SIC map
 * has its own version, which is part of the fingerprint too.
 */
export const SECTORS_LOGIC_VERSION = `sectors-v1:${SIC_SECTOR_MAP_VERSION}`;

type SectorRow = typeof companySectors.$inferInsert;

/**
 * The inputs of the sectors rebuild: company themes, theme sectors and
 * merges, the registry links, and the SIC codes of linked companies.
 */
export const SECTOR_INPUTS: readonly FingerprintInput[] = [
  {
    table: companyThemes,
    sums: [companyThemes.companyId, companyThemes.themeId],
  },
  {
    table: themes,
    sums: [
      themes.mergedIntoId,
      sql`hashtext(coalesce(${themes.sector}, '') || '|' || ${themes.status}::text)`,
    ],
  },
  {
    table: companies,
    sums: [companies.mergedIntoId],
  },
  {
    table: registryLinks,
    sums: [
      registryLinks.companyId,
      sql`hashtext(${registryLinks.registry}::text || '|' || ${registryLinks.registryId} || '|' || ${registryLinks.status}::text)`,
    ],
  },
  {
    table: chCompanies,
    sums: [
      sql`hashtext(${chCompanies.companyNumber} || '|' || array_to_string(${chCompanies.sicCodes}, ','))`,
    ],
  },
];

export function sectorsFingerprint(db: Db): Promise<string> {
  return computeFingerprint(db, SECTORS_LOGIC_VERSION, SECTOR_INPUTS);
}

export interface RebuildSectorsOptions {
  db: Db;
  clock: Clock;
  /** Rebuild even when the input fingerprint has not changed. */
  force?: boolean;
}

function emptySourceCounts(): Record<SectorSource, number> {
  return { theme: 0, sic: 0 };
}

function skipped(): SectorStats {
  return {
    written: emptyDiffCounts(),
    rowsBySource: emptySourceCounts(),
    skipped: true,
  };
}

/** Theme sectors by company. Merged themes count towards the theme they moved to. */
async function loadThemeSectors(db: Db): Promise<Map<number, Set<Sector>>> {
  const [themeRows, links] = await Promise.all([
    db
      .select({
        id: themes.id,
        status: themes.status,
        mergedIntoId: themes.mergedIntoId,
        sector: themes.sector,
      })
      .from(themes),
    db
      .select({
        companyId: companyThemes.companyId,
        themeId: companyThemes.themeId,
      })
      .from(companyThemes)
      .innerJoin(companies, eq(companies.id, companyThemes.companyId))
      .where(isNull(companies.mergedIntoId))
      .orderBy(asc(companyThemes.companyId), asc(companyThemes.themeId)),
  ]);

  const active = resolveActiveThemes(themeRows);
  const sectorOf = new Map(themeRows.map((row) => [row.id, row.sector]));
  const byCompany = new Map<number, Set<Sector>>();
  for (const { companyId, themeId } of links) {
    const target = active.get(themeId);
    const sector = target === undefined ? null : sectorOf.get(target);
    if (!isSector(sector)) continue;
    const set = byCompany.get(companyId) ?? new Set<Sector>();
    set.add(sector);
    byCompany.set(companyId, set);
  }
  return byCompany;
}

/** SIC codes of each non-merged company's `linked` Companies House row. */
async function loadSicCodes(db: Db): Promise<Map<number, string[]>> {
  const rows = await db
    .select({
      companyId: registryLinks.companyId,
      sicCodes: chCompanies.sicCodes,
    })
    .from(registryLinks)
    .innerJoin(
      chCompanies,
      eq(chCompanies.companyNumber, registryLinks.registryId),
    )
    .innerJoin(companies, eq(companies.id, registryLinks.companyId))
    .where(
      and(
        eq(registryLinks.registry, "companies_house"),
        eq(registryLinks.status, "linked"),
        isNull(companies.mergedIntoId),
      ),
    )
    .orderBy(asc(registryLinks.companyId));
  return new Map(rows.map((row) => [row.companyId, row.sicCodes]));
}

/**
 * Theme sectors for every company with a theme that has a sector, then SIC
 * sectors only for companies with no theme sector (spec-phase3 section 7.3).
 * Vague SIC codes add nothing.
 */
export async function computeCompanySectors(db: Db): Promise<SectorRow[]> {
  const [themeSectors, sicCodes] = await Promise.all([
    loadThemeSectors(db),
    loadSicCodes(db),
  ]);

  const rows: SectorRow[] = [];
  for (const [companyId, sectors] of themeSectors) {
    for (const sector of [...sectors].sort()) {
      rows.push({ companyId, sector, source: "theme" });
    }
  }
  for (const [companyId, codes] of sicCodes) {
    if (themeSectors.has(companyId)) continue;
    for (const sector of sectorsForSic(codes)) {
      rows.push({ companyId, sector, source: "sic" });
    }
  }
  return rows.sort(
    (a, b) => a.companyId - b.companyId || a.sector.localeCompare(b.sector),
  );
}

/**
 * Rebuilds `company_sectors` (spec-phase3 section 7.3, D37). Skipped when the
 * inputs have not changed, unless `force` is set. Writes only changed rows in
 * one transaction. The fingerprint is taken before the inputs are read, so a
 * change made in between makes the next run rebuild again.
 */
export async function rebuildCompanySectors({
  db,
  clock,
  force = false,
}: RebuildSectorsOptions): Promise<SectorStats> {
  const fingerprint = await sectorsFingerprint(db);
  if (!force && !(await shouldRebuild(db, SECTORS_REBUILD, fingerprint))) {
    return skipped();
  }

  const rows = await computeCompanySectors(db);
  const written = await db.transaction(async (tx) => {
    const counts = await writeDiff(
      tx,
      companySectors,
      ["companyId", "sector"],
      rows,
    );
    await recordRebuild(tx, SECTORS_REBUILD, fingerprint, clock.now());
    return counts;
  });

  const rowsBySource = emptySourceCounts();
  for (const row of rows) rowsBySource[row.source] += 1;
  return { written, rowsBySource };
}
