import { and, asc, count, eq, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  eventRecordSources,
  events,
  eventSources,
  fundingRounds,
} from "@/db/schema";
import {
  deleteOrphanEvents,
  recomputeEvent,
  storedFx,
  type FxLookup,
} from "../resolve/canonicalise";
import { matchGrantRecord } from "../resolve/event-matcher";

export interface RelinkGrantsArgs {
  db: Db;
  /** Defaults to the stored ECB rates. */
  fx?: FxLookup;
  now?: () => Date;
  /** Lists the pairs and changes nothing. */
  dryRun?: boolean;
}

/** A news grant event and the grant event its reports move to. */
export interface GrantRelinkPair {
  newsEventId: number;
  grantEventId: number;
  companyId: number;
  /** The news event's `event_sources` rows. */
  sources: number;
}

export interface RelinkGrantsResult {
  dryRun: boolean;
  /** News funding rounds of type `grant` that were compared. */
  newsEventsChecked: number;
  pairs: GrantRelinkPair[];
  sourcesMoved: number;
  grantEventsRecomputed: number;
  eventsDeleted: number;
}

interface NewsGrant {
  id: number;
  companyId: number;
  announcedOn: string;
  amountMinor: number | null;
  currency: string | null;
}

/** News events with round type `grant` and no official record behind them. */
async function newsGrantEvents(db: Db): Promise<NewsGrant[]> {
  return db
    .select({
      id: events.id,
      companyId: events.companyId,
      announcedOn: events.announcedOn,
      amountMinor: fundingRounds.amountMinor,
      currency: fundingRounds.currency,
    })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        eq(fundingRounds.roundType, "grant"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(eventRecordSources)
            .where(eq(eventRecordSources.eventId, events.id)),
        ),
      ),
    )
    .orderBy(asc(events.id));
}

async function findPairs(
  db: Db,
): Promise<{ checked: number; pairs: GrantRelinkPair[] }> {
  const candidates = await newsGrantEvents(db);
  const pairs: GrantRelinkPair[] = [];
  for (const news of candidates) {
    const grantEventId = await matchGrantRecord(db, {
      type: "funding_round",
      companyId: news.companyId,
      date: news.announcedOn,
      roundType: "grant",
      amount:
        news.amountMinor !== null && news.currency !== null
          ? { amountMinor: news.amountMinor, currency: news.currency }
          : null,
    });
    if (grantEventId === null) continue;
    const [row] = await db
      .select({ total: count() })
      .from(eventSources)
      .where(eq(eventSources.eventId, news.id));
    pairs.push({
      newsEventId: news.id,
      grantEventId,
      companyId: news.companyId,
      sources: row?.total ?? 0,
    });
  }
  return { checked: candidates.length, pairs };
}

/**
 * The one-off relink of spec-phase3 section 9.4 (D56). News grant events
 * stored before Phase 3 that match a grant event by the resolver's rule
 * (`matchGrantRecord`) give their reports to the grant event, which is then
 * recomputed; the emptied news events are deleted, as they are derived data.
 * Grant events keep their record facts and are never deleted. One
 * transaction. A second run finds nothing to do.
 */
export async function relinkGrantReports({
  db,
  fx = storedFx,
  now = () => new Date(),
  dryRun = false,
}: RelinkGrantsArgs): Promise<RelinkGrantsResult> {
  if (dryRun) {
    const { checked, pairs } = await findPairs(db);
    return {
      dryRun,
      newsEventsChecked: checked,
      pairs,
      sourcesMoved: 0,
      grantEventsRecomputed: 0,
      eventsDeleted: 0,
    };
  }

  return db.transaction(async (tx) => {
    const { checked, pairs } = await findPairs(tx);
    let sourcesMoved = 0;
    for (const pair of pairs) {
      const moved = await tx
        .update(eventSources)
        .set({ eventId: pair.grantEventId })
        .where(eq(eventSources.eventId, pair.newsEventId))
        .returning({ eventId: eventSources.eventId });
      sourcesMoved += moved.length;
    }

    const grantEventIds = [...new Set(pairs.map((pair) => pair.grantEventId))];
    for (const eventId of grantEventIds) {
      await recomputeEvent(tx, eventId, fx, now());
    }
    const eventsDeleted = await deleteOrphanEvents(
      tx,
      pairs.map((pair) => pair.newsEventId),
    );
    return {
      dryRun,
      newsEventsChecked: checked,
      pairs,
      sourcesMoved,
      grantEventsRecomputed: grantEventIds.length,
      eventsDeleted,
    };
  });
}
