import type { DerivedStats } from "@/core/domain";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companyThemes,
  fundingRoundMomentum,
  themeWeeklyStats,
  weeklyTotals,
} from "@/db/schema";
import { computeCompanyThemes } from "./company-themes";
import { emptyDiffCounts, writeDiff } from "./diff-write";
import { recordRebuild, shouldRebuild, statsFingerprint } from "./fingerprint";
import { computeRoundMomentumRows } from "./round-momentum";
import {
  computeThemeWeekly,
  computeWeeklyTotals,
  loadStatEvents,
} from "./theme-weekly";

/** The `derived_rebuilds` name of this rebuild. */
export const STATS_REBUILD = "stats";

export interface RebuildStatsOptions {
  db: Db;
  clock: Clock;
  /** Rebuild even when the input fingerprint has not changed. */
  force?: boolean;
}

function skipped(): DerivedStats {
  return {
    companyThemes: emptyDiffCounts(),
    themeWeeklyStats: emptyDiffCounts(),
    weeklyTotals: emptyDiffCounts(),
    fundingRoundMomentum: emptyDiffCounts(),
    skipped: true,
  };
}

/**
 * Rebuilds `company_themes`, `theme_weekly_stats`, `weekly_totals` and
 * `funding_round_momentum` from source tables (spec-phase2 section 5.3,
 * D37). Skipped when the inputs have not changed, unless `force` is set.
 * Writes only changed rows, all in one transaction, and never touches a
 * source table.
 *
 * The fingerprint is taken before the inputs are read. If something changes
 * in between, the stored fingerprint is already stale, so the next run
 * rebuilds again rather than missing the change.
 */
export async function rebuildStatsStep({
  db,
  clock,
  force = false,
}: RebuildStatsOptions): Promise<DerivedStats> {
  const fingerprint = await statsFingerprint(db);
  if (!force && !(await shouldRebuild(db, STATS_REBUILD, fingerprint))) {
    return skipped();
  }

  return db.transaction(async (tx) => {
    const companyThemeRows = await computeCompanyThemes(tx);
    const statEvents = await loadStatEvents(tx);
    const momentumRows = await computeRoundMomentumRows(tx);

    const stats: DerivedStats = {
      companyThemes: await writeDiff(
        tx,
        companyThemes,
        ["companyId", "themeId"],
        companyThemeRows,
      ),
      themeWeeklyStats: await writeDiff(
        tx,
        themeWeeklyStats,
        ["themeId", "weekStart"],
        computeThemeWeekly(statEvents, companyThemeRows),
      ),
      weeklyTotals: await writeDiff(
        tx,
        weeklyTotals,
        ["weekStart"],
        computeWeeklyTotals(statEvents),
      ),
      fundingRoundMomentum: await writeDiff(
        tx,
        fundingRoundMomentum,
        ["eventId"],
        momentumRows,
      ),
    };
    await recordRebuild(tx, STATS_REBUILD, fingerprint, clock.now());
    return stats;
  });
}
