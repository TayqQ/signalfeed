import { and, asc, eq, gte, lte, notExists, sql } from "drizzle-orm";
import type { Money } from "@/core/domain";
import type { EventType, RoundType } from "@/core/enums";
import type { Db } from "@/db/client";
import {
  acquisitions,
  eventRecordSources,
  events,
  fundingRounds,
  grantParticipants,
  launches,
} from "@/db/schema";
import { normaliseCompanyName } from "@/lib/normalise";
import type { Corroboration } from "./types";

const FUNDING_WINDOW_DAYS = 45;
const ACQUISITION_WINDOW_DAYS = 60;
const LAUNCH_WINDOW_DAYS = 14;
const AMOUNT_TOLERANCE = 0.15;
/** A news report of a grant comes up to 180 days before to 60 days after its start (D56). */
const GRANT_NEWS_DAYS_BEFORE_START = 180;
const GRANT_NEWS_DAYS_AFTER_START = 60;
/** Percent, against the record's figure. */
const GRANT_AMOUNT_TOLERANCE_PERCENT = 15;

/**
 * Events created from an official record (grants) are never matched by news
 * reports, so news can neither overwrite nor absorb them (spec-phase2 section
 * 10.4). The test is the `event_record_sources` row, not `evidence`: news
 * events can be `confirmed` too, and later reports must still match them
 * (spec-phase3 section 9.3).
 */
function notFromRecord(db: Db) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(eventRecordSources)
      .where(eq(eventRecordSources.eventId, events.id)),
  );
}

export interface IncomingEvent {
  type: EventType;
  companyId: number;
  /** YYYY-MM-DD: the stated date, or the item's published date. */
  date: string;
  roundType?: RoundType | null;
  amount?: Money | null;
  amountUsdMinor?: number | null;
  acquirerCompanyId?: number | null;
  acquirerName?: string | null;
  productName?: string | null;
  url?: string | null;
}

function shiftDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dayGap(left: string, right: string): number {
  return (
    Math.abs(
      new Date(`${left}T00:00:00Z`).getTime() -
        new Date(`${right}T00:00:00Z`).getTime(),
    ) / 86_400_000
  );
}

function withinTolerance(left: number, right: number): boolean {
  const larger = Math.max(left, right);
  return larger === 0 || Math.abs(left - right) / larger <= AMOUNT_TOLERANCE;
}

interface ComparableRound {
  roundType: RoundType;
  amountMinor: number | null;
  currency: string | null;
  amountUsdMinor: number | null;
}

/**
 * True or false when the two amounts can be compared; null when one is missing
 * or they are in different currencies with no USD figure yet.
 */
function amountsClose(
  incoming: IncomingEvent,
  existing: ComparableRound,
): boolean | null {
  const money = incoming.amount ?? null;
  if (money && existing.amountMinor !== null) {
    if (money.currency === existing.currency) {
      return withinTolerance(money.amountMinor, existing.amountMinor);
    }
  }
  const usd = incoming.amountUsdMinor ?? null;
  if (usd !== null && existing.amountUsdMinor !== null) {
    return withinTolerance(usd, existing.amountUsdMinor);
  }
  return null;
}

function isKnownRound(roundType: RoundType | null | undefined): boolean {
  return Boolean(roundType) && roundType !== "unknown";
}

function roundMatches(
  incoming: IncomingEvent,
  existing: ComparableRound,
  isOnlyRoundInWindow: boolean,
): boolean {
  const incomingType = incoming.roundType ?? "unknown";
  if (isKnownRound(incomingType) && incomingType === existing.roundType) {
    return true;
  }
  if (amountsClose(incoming, existing) === true) return true;

  const incomingHasNothing = !isKnownRound(incomingType) && !incoming.amount;
  const existingHasNothing =
    !isKnownRound(existing.roundType) && existing.amountMinor === null;
  return (incomingHasNothing || existingHasNothing) && isOnlyRoundInWindow;
}

async function matchFunding(
  db: Db,
  incoming: IncomingEvent,
): Promise<number | null> {
  const rows = await db
    .select({
      id: events.id,
      announcedOn: events.announcedOn,
      roundType: fundingRounds.roundType,
      amountMinor: fundingRounds.amountMinor,
      currency: fundingRounds.currency,
      amountUsdMinor: fundingRounds.amountUsdMinor,
    })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        eq(events.companyId, incoming.companyId),
        notFromRecord(db),
        gte(events.announcedOn, shiftDays(incoming.date, -FUNDING_WINDOW_DAYS)),
        lte(events.announcedOn, shiftDays(incoming.date, FUNDING_WINDOW_DAYS)),
      ),
    )
    .orderBy(asc(events.id));

  const matches = rows.filter((row) =>
    roundMatches(incoming, row, rows.length === 1),
  );
  matches.sort(
    (a, b) =>
      dayGap(a.announcedOn, incoming.date) -
        dayGap(b.announcedOn, incoming.date) || a.id - b.id,
  );
  return matches[0]?.id ?? null;
}

async function matchAcquisition(
  db: Db,
  incoming: IncomingEvent,
): Promise<number | null> {
  const rows = await db
    .select({
      id: events.id,
      acquirerCompanyId: acquisitions.acquirerCompanyId,
      acquirerName: acquisitions.acquirerName,
    })
    .from(events)
    .innerJoin(acquisitions, eq(acquisitions.eventId, events.id))
    .where(
      and(
        eq(events.companyId, incoming.companyId),
        notFromRecord(db),
        gte(
          events.announcedOn,
          shiftDays(incoming.date, -ACQUISITION_WINDOW_DAYS),
        ),
        lte(
          events.announcedOn,
          shiftDays(incoming.date, ACQUISITION_WINDOW_DAYS),
        ),
      ),
    )
    .orderBy(asc(events.id));

  const incomingId = incoming.acquirerCompanyId ?? null;
  const incomingName = normaliseCompanyName(incoming.acquirerName ?? "");
  const match = rows.find((row) => {
    if (incomingId === null || row.acquirerCompanyId === null) return true;
    return (
      incomingId === row.acquirerCompanyId ||
      incomingName === normaliseCompanyName(row.acquirerName)
    );
  });
  return match?.id ?? null;
}

async function matchLaunch(
  db: Db,
  incoming: IncomingEvent,
): Promise<number | null> {
  const rows = await db
    .select({
      id: events.id,
      productName: launches.productName,
      url: launches.url,
    })
    .from(events)
    .innerJoin(launches, eq(launches.eventId, events.id))
    .where(
      and(
        eq(events.companyId, incoming.companyId),
        notFromRecord(db),
        gte(events.announcedOn, shiftDays(incoming.date, -LAUNCH_WINDOW_DAYS)),
        lte(events.announcedOn, shiftDays(incoming.date, LAUNCH_WINDOW_DAYS)),
      ),
    )
    .orderBy(asc(events.id));

  const product = normaliseCompanyName(incoming.productName ?? "");
  const match = rows.find((row) => {
    if (incoming.url && row.url === incoming.url) return true;
    const existing = normaliseCompanyName(row.productName ?? "");
    return existing === product;
  });
  return match?.id ?? null;
}

/** The existing event this report describes, or null for a new event. Spec section 7. */
export async function findMatchingEvent(
  db: Db,
  incoming: IncomingEvent,
): Promise<number | null> {
  switch (incoming.type) {
    case "funding_round":
      return matchFunding(db, incoming);
    case "acquisition":
      return matchAcquisition(db, incoming);
    case "launch":
      return matchLaunch(db, incoming);
  }
}

/**
 * Whether the incoming event confirms a fuzzy company match. Stricter than the
 * event match: for funding, the amounts must agree. A shared round type alone is
 * weak evidence that two similar names are one company, and a wrong merge is
 * harder to undo than a pair left in the review queue (D29). Events created
 * from an official record never corroborate, whatever their evidence; news
 * events do, even when confirmed (spec-phase3 section 9.3).
 */
export function corroboratesFor(
  db: Db,
  incoming: Omit<IncomingEvent, "companyId">,
): Corroboration {
  return async (candidateCompanyId) => {
    const candidate: IncomingEvent = {
      ...incoming,
      companyId: candidateCompanyId,
    };
    if (incoming.type !== "funding_round") {
      return (await findMatchingEvent(db, candidate)) !== null;
    }

    const rows = await db
      .select({
        roundType: fundingRounds.roundType,
        amountMinor: fundingRounds.amountMinor,
        currency: fundingRounds.currency,
        amountUsdMinor: fundingRounds.amountUsdMinor,
      })
      .from(events)
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(
        and(
          eq(events.companyId, candidateCompanyId),
          notFromRecord(db),
          gte(
            events.announcedOn,
            shiftDays(incoming.date, -FUNDING_WINDOW_DAYS),
          ),
          lte(
            events.announcedOn,
            shiftDays(incoming.date, FUNDING_WINDOW_DAYS),
          ),
        ),
      );

    return rows.some((row) => amountsClose(candidate, row) === true);
  };
}

/** True when `reported` is within 15% of the record's figure. Integer maths only. */
function nearRecordAmount(reported: number, record: number | null): boolean {
  if (record === null || record <= 0) return false;
  return (
    Math.abs(reported - record) * 100 <= GRANT_AMOUNT_TOLERANCE_PERCENT * record
  );
}

/**
 * The record-origin grant event a news report of a grant describes, or null
 * (spec-phase3 section 9.4, D56). Only a funding round of type `grant` is
 * compared, and only with the company's events linked to a UKRI grant record.
 * The news date must fall from 180 days before to 60 days after the grant
 * start. With a news amount, it must be in GBP and within 15% of the
 * participant's grant offer or project cost; the nearest start wins, then the
 * lower event id. With no news amount, it matches only when exactly one grant
 * event is in the window. Anything less certain stays a separate event.
 */
export async function matchGrantRecord(
  db: Db,
  incoming: IncomingEvent,
): Promise<number | null> {
  if (incoming.type !== "funding_round" || incoming.roundType !== "grant") {
    return null;
  }
  const rows = await db
    .select({
      id: events.id,
      announcedOn: events.announcedOn,
      grantOfferMinor: grantParticipants.grantOfferMinor,
      projectCostMinor: grantParticipants.projectCostMinor,
    })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .innerJoin(eventRecordSources, eq(eventRecordSources.eventId, events.id))
    .innerJoin(
      grantParticipants,
      eq(grantParticipants.id, eventRecordSources.recordId),
    )
    .where(
      and(
        eq(events.companyId, incoming.companyId),
        eq(fundingRounds.roundType, "grant"),
        eq(eventRecordSources.recordKind, "ukri_grant"),
        gte(
          events.announcedOn,
          shiftDays(incoming.date, -GRANT_NEWS_DAYS_AFTER_START),
        ),
        lte(
          events.announcedOn,
          shiftDays(incoming.date, GRANT_NEWS_DAYS_BEFORE_START),
        ),
      ),
    )
    .orderBy(asc(events.id));

  const eventIds = new Set(rows.map((row) => row.id));
  const money = incoming.amount ?? null;
  if (!money) {
    return eventIds.size === 1 ? (rows[0]?.id ?? null) : null;
  }
  if (money.currency !== "GBP") return null;

  const matches = rows.filter(
    (row) =>
      nearRecordAmount(money.amountMinor, row.grantOfferMinor) ||
      nearRecordAmount(money.amountMinor, row.projectCostMinor),
  );
  matches.sort(
    (a, b) =>
      dayGap(a.announcedOn, incoming.date) -
        dayGap(b.announcedOn, incoming.date) || a.id - b.id,
  );
  return matches[0]?.id ?? null;
}
