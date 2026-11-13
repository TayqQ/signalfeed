import { and, asc, eq, inArray } from "drizzle-orm";
import type { FxRates, Money } from "@/core/domain";
import type { DatePrecision, InvestorRole, RecordKind } from "@/core/enums";
import type { Db } from "@/db/client";
import {
  acquisitions,
  eventInvestors,
  eventRecordSources,
  events,
  eventSources,
  extractions,
  fundingRounds,
  launches,
  sourceItems,
  sourceItemTexts,
  sources,
} from "@/db/schema";
import { convertMinor } from "@/lib/money";
import { getRatesOnOrBefore } from "@/pipeline/store/fx-rates";
import { resolveInvestor } from "./investor-matcher";
import { postProcess, type ProcessedEvent } from "./post-process";
import type { InvestorFacts } from "./types";

/**
 * The investors an official record names, as lead. A grant event's funder must
 * stay when reports add their own investors (spec-phase3 section 9.4). It must
 * match `GRANT_FUNDER` in `grants/resolve-grants.ts`, which creates the event;
 * a test checks this. Filings never create events, so they name none.
 */
export const RECORD_INVESTORS: Readonly<
  Record<RecordKind, readonly InvestorFacts[]>
> = {
  ukri_grant: [
    { name: "Innovate UK", kind: "government", websiteDomain: null },
  ],
  ch_allotment: [],
  sec_form_d: [],
};

/** Takes the database so lookups stay inside the caller's transaction. */
export interface FxLookup {
  getRatesOnOrBefore(db: Db, date: string): Promise<FxRates | null>;
}

export const storedFx: FxLookup = {
  getRatesOnOrBefore: (db, date) => getRatesOnOrBefore(db, date),
};

/** One report linked to an event, with what is needed to break ties. */
interface Evidence {
  event: ProcessedEvent;
  /** How many events the report's extraction contained. */
  siblingCount: number;
  sourceItemId: number;
  priority: number;
  publishedAt: Date | null;
  fetchedAt: Date;
}

export interface Converted {
  usd: number | null;
  gbp: number | null;
  rateDate: string | null;
}

function evidenceDate(evidence: Evidence): Date {
  return evidence.publishedAt ?? evidence.fetchedAt;
}

function compareForTies(left: Evidence, right: Evidence): number {
  return (
    right.priority - left.priority ||
    evidenceDate(left).getTime() - evidenceDate(right).getTime() ||
    left.sourceItemId - right.sourceItemId
  );
}

/**
 * The most frequent non-null value, then the highest-priority source, then the
 * earliest item. `key` decides when two values count as the same.
 */
function majority<T>(
  evidence: readonly Evidence[],
  value: (item: Evidence) => T | null,
  key: (candidate: T) => string = String,
): T | null {
  const groups = new Map<string, { value: T; items: Evidence[] }>();
  for (const item of evidence) {
    const candidate = value(item);
    if (candidate === null) continue;
    const groupKey = key(candidate);
    const group = groups.get(groupKey);
    if (group) group.items.push(item);
    else groups.set(groupKey, { value: candidate, items: [item] });
  }
  const ranked = [...groups.values()].map((group) => ({
    value: group.value,
    count: group.items.length,
    best: [...group.items].sort(compareForTies)[0] as Evidence,
  }));
  ranked.sort((a, b) => b.count - a.count || compareForTies(a.best, b.best));
  return ranked[0]?.value ?? null;
}

async function loadEvidence(db: Db, eventId: number): Promise<Evidence[]> {
  const rows = await db
    .select({
      eventIndex: eventSources.eventIndex,
      sourceItemId: eventSources.sourceItemId,
      result: extractions.result,
      title: sourceItems.title,
      url: sourceItems.url,
      publishedAt: sourceItems.publishedAt,
      fetchedAt: sourceItems.fetchedAt,
      summary: sourceItemTexts.summary,
      priority: sources.priority,
    })
    .from(eventSources)
    .innerJoin(extractions, eq(extractions.id, eventSources.extractionId))
    .innerJoin(sourceItems, eq(sourceItems.id, eventSources.sourceItemId))
    .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
    .leftJoin(sourceItemTexts, eq(sourceItemTexts.sourceItemId, sourceItems.id))
    .where(eq(eventSources.eventId, eventId))
    .orderBy(asc(eventSources.sourceItemId), asc(eventSources.eventIndex));

  const evidence: Evidence[] = [];
  for (const row of rows) {
    const processed = postProcess(row.result, {
      title: row.title,
      summary: row.summary,
      url: row.url,
      publishedAt: row.publishedAt,
    });
    const event = processed.find((item) => item.eventIndex === row.eventIndex);
    if (!event) continue;
    evidence.push({
      event,
      siblingCount: row.result.events.length,
      sourceItemId: row.sourceItemId,
      priority: row.priority,
      publishedAt: row.publishedAt,
      fetchedAt: row.fetchedAt,
    });
  }
  return evidence;
}

function moneyKey(money: Money): string {
  return `${money.amountMinor} ${money.currency}`;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function canonicalDate(evidence: readonly Evidence[]): {
  announcedOn: string;
  datePrecision: DatePrecision;
} {
  const stated = evidence
    .map((item) => item.event.announcedOn)
    .filter((date): date is string => date !== null)
    .sort();
  const earliestStated = stated[0];
  if (earliestStated) {
    return { announcedOn: earliestStated, datePrecision: "day" };
  }
  const earliest = [...evidence].sort(
    (a, b) => evidenceDate(a).getTime() - evidenceDate(b).getTime(),
  )[0] as Evidence;
  // A roundup can recap older rounds, so its publish date is only approximate.
  const onlyRoundups = evidence.every((item) => item.siblingCount > 1);
  return {
    announcedOn: toIsoDate(evidenceDate(earliest)),
    datePrecision: onlyRoundups ? "month" : "day",
  };
}

/** USD and GBP at the rate on or before `date`. Unknown rates leave nulls for the FX step. */
export async function convert(
  db: Db,
  money: Money | null,
  date: string,
  fx: FxLookup,
): Promise<Converted> {
  if (!money) return { usd: null, gbp: null, rateDate: null };
  const rates = await fx.getRatesOnOrBefore(db, date);
  if (!rates) return { usd: null, gbp: null, rateDate: null };
  try {
    return {
      usd: convertMinor(money.amountMinor, money.currency, "USD", rates.perEur),
      gbp: convertMinor(money.amountMinor, money.currency, "GBP", rates.perEur),
      rateDate: rates.date,
    };
  } catch {
    // The ECB does not publish every currency; keep the original amount alone.
    return { usd: null, gbp: null, rateDate: null };
  }
}

async function rewriteInvestors(
  db: Db,
  eventId: number,
  evidence: readonly Evidence[],
  recordInvestors: readonly InvestorFacts[] = [],
): Promise<void> {
  const roles = new Map<number, InvestorRole>();
  for (const investor of recordInvestors) {
    const { investorId } = await resolveInvestor(db, investor);
    roles.set(investorId, "lead");
  }
  const ordered = [...evidence].sort(compareForTies);
  for (const item of ordered) {
    if (item.event.type !== "funding_round") continue;
    for (const investor of item.event.funding.investors) {
      const { investorId } = await resolveInvestor(db, {
        name: investor.name,
        kind: investor.kind,
        websiteDomain: null,
      });
      const lead = investor.isLead || roles.get(investorId) === "lead";
      roles.set(investorId, lead ? "lead" : "participant");
    }
  }
  await db.delete(eventInvestors).where(eq(eventInvestors.eventId, eventId));
  if (roles.size > 0) {
    await db
      .insert(eventInvestors)
      .values(
        [...roles].map(([investorId, role]) => ({ eventId, investorId, role })),
      );
  }
}

/**
 * An event from an official record (a grant) has no reports to rebuild from,
 * so its stored facts stand. Only a missing USD figure is filled in. This is
 * how the FX step converts a grant amount once a rate is known.
 */
async function convertRecordAmount(
  db: Db,
  eventId: number,
  fx: FxLookup,
): Promise<void> {
  const [row] = await db
    .select({
      announcedOn: events.announcedOn,
      amountMinor: fundingRounds.amountMinor,
      currency: fundingRounds.currency,
      amountUsdMinor: fundingRounds.amountUsdMinor,
      amountGbpMinor: fundingRounds.amountGbpMinor,
    })
    .from(events)
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .innerJoin(eventRecordSources, eq(eventRecordSources.eventId, events.id))
    .where(eq(events.id, eventId))
    .limit(1);
  if (
    !row ||
    row.amountMinor === null ||
    row.currency === null ||
    row.amountUsdMinor !== null
  ) {
    return;
  }
  const money = { amountMinor: row.amountMinor, currency: row.currency };
  const converted = await convert(db, money, row.announcedOn, fx);
  if (converted.usd === null) return;
  await db
    .update(fundingRounds)
    .set({
      amountUsdMinor: converted.usd,
      amountGbpMinor: row.amountGbpMinor ?? converted.gbp,
      fxRateDate: converted.rateDate,
    })
    .where(eq(fundingRounds.eventId, eventId));
}

async function recordKindsOf(db: Db, eventId: number): Promise<RecordKind[]> {
  const rows = await db
    .selectDistinct({ recordKind: eventRecordSources.recordKind })
    .from(eventRecordSources)
    .where(eq(eventRecordSources.eventId, eventId))
    .orderBy(asc(eventRecordSources.recordKind));
  return rows.map((row) => row.recordKind);
}

/**
 * An event from an official record keeps the record's date, precision, round
 * type, label, amounts and FX fields. Reports attached to it (a news report of
 * a grant, D56) give only `source_count`, the headline links and investors:
 * the record's investors as lead, joined by the reports' investors.
 */
async function recomputeRecordEvent(
  db: Db,
  eventId: number,
  recordKinds: readonly RecordKind[],
  evidence: readonly Evidence[],
  fx: FxLookup,
  now: Date,
): Promise<void> {
  const sourceCount = new Set(evidence.map((item) => item.sourceItemId)).size;
  await db
    .update(events)
    .set({ sourceCount, updatedAt: now })
    .where(eq(events.id, eventId));
  await convertRecordAmount(db, eventId, fx);
  await rewriteInvestors(
    db,
    eventId,
    evidence,
    recordKinds.flatMap((kind) => RECORD_INVESTORS[kind]),
  );
}

/**
 * Rebuilds every canonical field from all linked reports, so the result does
 * not depend on arrival order and new evidence can correct old values (D12).
 * An event with no usable report is left for the caller to delete. An event
 * from an official record keeps its stored facts (see `recomputeRecordEvent`).
 */
export async function recomputeEvent(
  db: Db,
  eventId: number,
  fx: FxLookup,
  now: Date = new Date(),
): Promise<void> {
  const evidence = await loadEvidence(db, eventId);
  const recordKinds = await recordKindsOf(db, eventId);
  if (recordKinds.length > 0) {
    await recomputeRecordEvent(db, eventId, recordKinds, evidence, fx, now);
    return;
  }
  const sourceCount = new Set(evidence.map((item) => item.sourceItemId)).size;
  if (evidence.length === 0) {
    await db
      .update(events)
      .set({ sourceCount: 0, updatedAt: now })
      .where(eq(events.id, eventId));
    return;
  }

  const { announcedOn, datePrecision } = canonicalDate(evidence);
  await db
    .update(events)
    .set({ announcedOn, datePrecision, sourceCount, updatedAt: now })
    .where(eq(events.id, eventId));

  const first = evidence[0] as Evidence;
  if (first.event.type === "funding_round") {
    const funding = (item: Evidence) =>
      item.event.type === "funding_round" ? item.event.funding : null;
    const amount = majority(
      evidence,
      (item) => funding(item)?.amount ?? null,
      moneyKey,
    );
    const converted = await convert(db, amount, announcedOn, fx);
    await db
      .update(fundingRounds)
      .set({
        roundType:
          majority(evidence, (item) => {
            const roundType = funding(item)?.roundType ?? null;
            return roundType === "unknown" ? null : roundType;
          }) ?? "unknown",
        roundLabel: majority(
          evidence,
          (item) => funding(item)?.roundLabel ?? null,
        ),
        amountMinor: amount?.amountMinor ?? null,
        currency: amount?.currency ?? null,
        amountUsdMinor: converted.usd,
        amountGbpMinor: converted.gbp,
        fxRateDate: converted.rateDate,
        includesIndividualAngels: evidence.some((item) =>
          Boolean(funding(item)?.includesIndividualAngels),
        ),
      })
      .where(eq(fundingRounds.eventId, eventId));
    await rewriteInvestors(db, eventId, evidence);
  } else if (first.event.type === "acquisition") {
    const acquisition = (item: Evidence) =>
      item.event.type === "acquisition" ? item.event.acquisition : null;
    const price = majority(
      evidence,
      (item) => acquisition(item)?.price ?? null,
      moneyKey,
    );
    const converted = await convert(db, price, announcedOn, fx);
    await db
      .update(acquisitions)
      .set({
        acquirerName:
          majority(
            evidence,
            (item) => acquisition(item)?.acquirerName ?? null,
          ) ?? first.event.acquisition.acquirerName,
        priceMinor: price?.amountMinor ?? null,
        currency: price?.currency ?? null,
        priceUsdMinor: converted.usd,
        priceGbpMinor: converted.gbp,
        fxRateDate: converted.rateDate,
      })
      .where(eq(acquisitions.eventId, eventId));
  } else {
    const launch = (item: Evidence) =>
      item.event.type === "launch" ? item.event.launch : null;
    await db
      .update(launches)
      .set({
        kind:
          majority(evidence, (item) => launch(item)?.kind ?? null) ?? "other",
        productName: majority(
          evidence,
          (item) => launch(item)?.productName ?? null,
        ),
        url: majority(evidence, (item) => launch(item)?.url ?? null),
      })
      .where(eq(launches.eventId, eventId));
  }
}

export async function recomputeEventsForCompany(
  db: Db,
  companyId: number,
  fx: FxLookup,
): Promise<void> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.companyId, companyId));
  for (const row of rows) await recomputeEvent(db, row.id, fx);
}

/**
 * Removes events left with no reports. Events are derived data (D12), except
 * those linked to an official record, which are always kept.
 */
export async function deleteOrphanEvents(
  db: Db,
  eventIds: readonly number[],
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const linked = await db
    .selectDistinct({ eventId: eventSources.eventId })
    .from(eventSources)
    .where(inArray(eventSources.eventId, [...eventIds]));
  const recorded = await db
    .selectDistinct({ eventId: eventRecordSources.eventId })
    .from(eventRecordSources)
    .where(inArray(eventRecordSources.eventId, [...eventIds]));
  const keep = new Set([...linked, ...recorded].map((row) => row.eventId));
  const orphans = eventIds.filter((id) => !keep.has(id));
  if (orphans.length === 0) return 0;
  await db.delete(events).where(and(inArray(events.id, orphans)));
  return orphans.length;
}
