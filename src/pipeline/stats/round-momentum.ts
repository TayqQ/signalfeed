import { asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, events, fundingRounds } from "@/db/schema";
import {
  computeRoundMomentum,
  type MomentumRoundInput,
} from "@/lib/company-momentum";

/**
 * `funding_round_momentum` (docs/spec-phase2.md sections 5.3 and 8.3, D43).
 * One row per equity round of each non-merged company. A Phase 1 merge has
 * already moved a merged company's events to the survivor.
 */

export type RoundMomentumRow = {
  eventId: number;
  companyId: number;
  equityRoundNumber: number;
  previousEventId: number | null;
  monthsSincePrevious: number | null;
  stepUpBasisEventId: number | null;
  /** Rounded to float32, as the `real` column stores it. */
  stepUpRatio: number | null;
  roundsIn24mToDate: number;
};

/** Momentum rows for every company, ordered by company, then round number. */
export async function computeRoundMomentumRows(
  db: Db,
): Promise<RoundMomentumRow[]> {
  const rows = await db
    .select({
      companyId: events.companyId,
      eventId: events.id,
      announcedOn: events.announcedOn,
      datePrecision: events.datePrecision,
      roundType: fundingRounds.roundType,
      amountGbpMinor: fundingRounds.amountGbpMinor,
    })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .innerJoin(companies, eq(companies.id, events.companyId))
    .where(isNull(companies.mergedIntoId))
    .orderBy(asc(events.companyId), asc(events.id));

  const byCompany = new Map<number, MomentumRoundInput[]>();
  for (const { companyId, ...round } of rows) {
    const list = byCompany.get(companyId) ?? [];
    list.push(round);
    byCompany.set(companyId, list);
  }

  const out: RoundMomentumRow[] = [];
  for (const [companyId, rounds] of byCompany) {
    for (const result of computeRoundMomentum(rounds)) {
      out.push({
        eventId: result.eventId,
        companyId,
        equityRoundNumber: result.equityRoundNumber,
        previousEventId: result.previousEventId,
        monthsSincePrevious: result.monthsSincePrevious,
        stepUpBasisEventId: result.stepUpBasisEventId,
        stepUpRatio:
          result.stepUpRatio === null ? null : Math.fround(result.stepUpRatio),
        roundsIn24mToDate: result.roundsIn24mToDate,
      });
    }
  }
  return out;
}
