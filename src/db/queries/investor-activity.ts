import { and, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import type { InvestorActivityRow, InvestorRef } from "@/core/read-models";
import type { Sector } from "@/core/sectors";
import { median } from "@/lib/trend-stats";
import { toIsoDate } from "@/lib/weeks";
import type { Db } from "../client";
import {
  companies,
  eventInvestors,
  events,
  fundingRounds,
  investors,
} from "../schema";
import { themeScopeCondition } from "./themes";

/** Investors need this many early rounds in the window to be listed. */
export const MIN_INVESTOR_ROUNDS = 2;

/** The date `months` calendar months before `now`, clamped to the month end. */
function monthsBefore(now: Date, months: number): string {
  const index = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10);
}

/**
 * First-cheque activity (spec section 8.5): early rounds (`pre_seed`, `seed`)
 * in the window, per investor. `led` counts rounds as lead and `joined`
 * counts participant or unknown roles. The median is over rounds with a known
 * GBP amount. Investors with fewer than 2 rounds are left out. Order: led,
 * then joined, then name. Merged investors count under the one they merged
 * into, and a round counts once per investor.
 */
export async function listInvestorActivity(
  db: Db,
  options: { theme?: string; sector?: Sector; months?: number; now: Date },
): Promise<InvestorActivityRow[]> {
  const months =
    options.months !== undefined &&
    Number.isInteger(options.months) &&
    options.months >= 1
      ? options.months
      : 12;
  const conditions: SQL[] = [
    eq(events.type, "funding_round"),
    inArray(fundingRounds.roundType, ["pre_seed", "seed"]),
    isNull(companies.mergedIntoId),
    gte(events.announcedOn, monthsBefore(options.now, months)),
    lte(events.announcedOn, toIsoDate(options.now)),
  ];
  const scope = await themeScopeCondition(db, options, companies.id);
  if (scope) conditions.push(scope);

  const rows = await db
    .select({
      eventId: events.id,
      amountGbpMinor: fundingRounds.amountGbpMinor,
      role: eventInvestors.role,
      investorId: investors.id,
      investorSlug: investors.slug,
      investorName: investors.name,
      mergedIntoId: investors.mergedIntoId,
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .innerJoin(eventInvestors, eq(eventInvestors.eventId, events.id))
    .innerJoin(investors, eq(investors.id, eventInvestors.investorId))
    .where(and(...conditions));

  // Follow one merge hop to the surviving investor.
  const survivorIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.mergedIntoId == null ? [] : [row.mergedIntoId],
      ),
    ),
  ];
  const survivors = new Map<number, InvestorRef>();
  if (survivorIds.length > 0) {
    const found = await db
      .select({ id: investors.id, slug: investors.slug, name: investors.name })
      .from(investors)
      .where(inArray(investors.id, survivorIds));
    for (const row of found) {
      survivors.set(row.id, { slug: row.slug, name: row.name });
    }
  }

  interface Round {
    led: boolean;
    amount: number | null;
  }
  const perInvestor = new Map<
    string,
    { investor: InvestorRef; rounds: Map<number, Round> }
  >();
  for (const row of rows) {
    const survivor =
      row.mergedIntoId == null ? undefined : survivors.get(row.mergedIntoId);
    const investor: InvestorRef = survivor ?? {
      slug: row.investorSlug,
      name: row.investorName,
    };
    const entry = perInvestor.get(investor.slug) ?? {
      investor,
      rounds: new Map<number, Round>(),
    };
    perInvestor.set(investor.slug, entry);
    const existing = entry.rounds.get(row.eventId);
    const led = row.role === "lead" || existing?.led === true;
    entry.rounds.set(row.eventId, { led, amount: row.amountGbpMinor });
  }

  const result: InvestorActivityRow[] = [];
  for (const { investor, rounds } of perInvestor.values()) {
    if (rounds.size < MIN_INVESTOR_ROUNDS) continue;
    const list = [...rounds.values()];
    const led = list.filter((round) => round.led).length;
    const amounts = list
      .map((round) => round.amount)
      .filter((amount): amount is number => amount !== null);
    result.push({
      investor,
      led,
      joined: list.length - led,
      medianRoundGbpMinor: median(amounts),
      roundsWithAmount: amounts.length,
      rounds: list.length,
    });
  }
  return result.sort(
    (a, b) =>
      b.led - a.led ||
      b.joined - a.joined ||
      a.investor.name.localeCompare(b.investor.name, "en-GB"),
  );
}
