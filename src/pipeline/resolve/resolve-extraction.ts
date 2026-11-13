import { and, eq, ne } from "drizzle-orm";
import type { Money } from "@/core/domain";
import type { Db } from "@/db/client";
import {
  acquisitions,
  companies,
  events,
  eventSources,
  extractions,
  fundingRounds,
  launches,
  sourceItems,
  sourceItemTexts,
} from "@/db/schema";
import {
  convert,
  deleteOrphanEvents,
  recomputeEvent,
  storedFx,
  type FxLookup,
} from "./canonicalise";
import { resolveCompany } from "./company-matcher";
import {
  corroboratesFor,
  findMatchingEvent,
  matchGrantRecord,
  type IncomingEvent,
} from "./event-matcher";
import { postProcess, type ProcessedEvent } from "./post-process";

export interface ResolveOutcome {
  alreadyResolved: boolean;
  companiesCreated: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  /** Reports attached to a grant event from an official record (D56). */
  grantReportsAttached: number;
}

export interface ResolveExtractionOptions {
  fx?: FxLookup;
}

async function insertEvent(
  db: Db,
  event: ProcessedEvent,
  companyId: number,
  date: string,
  acquirerCompanyId: number | null,
): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({ type: event.type, companyId, announcedOn: date })
    .returning({ id: events.id });
  if (!row) throw new Error("Event insert returned no row");

  if (event.type === "funding_round") {
    await db
      .insert(fundingRounds)
      .values({ eventId: row.id, roundType: event.funding.roundType });
  } else if (event.type === "acquisition") {
    await db.insert(acquisitions).values({
      eventId: row.id,
      acquirerCompanyId,
      acquirerName: event.acquisition.acquirerName,
    });
  } else {
    await db.insert(launches).values({
      eventId: row.id,
      kind: event.launch.kind,
      productName: event.launch.productName,
      url: event.launch.url,
    });
  }
  return row.id;
}

function amountOf(event: ProcessedEvent): Money | null {
  if (event.type === "funding_round") return event.funding.amount;
  if (event.type === "acquisition") return event.acquisition.price;
  return null;
}

/** Removes links from older extractions of this item, so re-extraction can move or drop events. */
async function unlinkSuperseded(
  db: Db,
  extractionId: number,
  sourceItemId: number,
): Promise<number[]> {
  const stale = await db
    .select({ eventId: eventSources.eventId })
    .from(eventSources)
    .where(
      and(
        eq(eventSources.sourceItemId, sourceItemId),
        ne(eventSources.extractionId, extractionId),
      ),
    );
  if (stale.length === 0) return [];
  await db
    .delete(eventSources)
    .where(
      and(
        eq(eventSources.sourceItemId, sourceItemId),
        ne(eventSources.extractionId, extractionId),
      ),
    );
  return [...new Set(stale.map((row) => row.eventId))];
}

/**
 * Turns one stored extraction into resolved events in a single transaction.
 * Running it twice changes nothing: a resolved extraction is left alone.
 */
export async function resolveExtraction(
  db: Db,
  extractionId: number,
  options: ResolveExtractionOptions = {},
): Promise<ResolveOutcome> {
  const fx = options.fx ?? storedFx;

  return db.transaction(async (tx) => {
    const outcome: ResolveOutcome = {
      alreadyResolved: false,
      companiesCreated: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      eventsDeleted: 0,
      grantReportsAttached: 0,
    };

    const [row] = await tx
      .select({
        resolvedAt: extractions.resolvedAt,
        result: extractions.result,
        sourceItemId: extractions.sourceItemId,
        title: sourceItems.title,
        url: sourceItems.url,
        publishedAt: sourceItems.publishedAt,
        fetchedAt: sourceItems.fetchedAt,
        summary: sourceItemTexts.summary,
      })
      .from(extractions)
      .innerJoin(sourceItems, eq(sourceItems.id, extractions.sourceItemId))
      .leftJoin(
        sourceItemTexts,
        eq(sourceItemTexts.sourceItemId, sourceItems.id),
      )
      .where(eq(extractions.id, extractionId));
    if (!row) throw new Error(`Extraction ${extractionId} does not exist`);
    if (row.resolvedAt) return { ...outcome, alreadyResolved: true };

    const touched = await unlinkSuperseded(tx, extractionId, row.sourceItemId);
    const fallbackDate = (row.publishedAt ?? row.fetchedAt)
      .toISOString()
      .slice(0, 10);

    const processed = postProcess(row.result, {
      title: row.title,
      summary: row.summary,
      url: row.url,
      publishedAt: row.publishedAt,
    });

    const linked = new Set<number>();
    for (const event of processed) {
      const date = event.announcedOn ?? fallbackDate;
      const money = amountOf(event);
      const converted = await convert(tx, money, date, fx);

      const incoming: Omit<IncomingEvent, "companyId"> = {
        type: event.type,
        date,
        amount: money,
        amountUsdMinor: converted.usd,
        roundType:
          event.type === "funding_round" ? event.funding.roundType : null,
        acquirerName:
          event.type === "acquisition" ? event.acquisition.acquirerName : null,
        productName: event.type === "launch" ? event.launch.productName : null,
        url: event.type === "launch" ? event.launch.url : null,
      };

      let acquirerCompanyId: number | null = null;
      if (event.type === "acquisition") {
        const acquirer = await resolveCompany(
          tx,
          {
            name: event.acquisition.acquirerName,
            websiteDomain: event.acquisition.acquirerDomain,
            description: null,
            countryCode: event.acquisition.acquirerCountryCode,
            city: null,
            foundedYear: null,
            tags: [],
          },
          { corroborates: () => Promise.resolve(false) },
        );
        acquirerCompanyId = acquirer.companyId;
        if (acquirer.created) outcome.companiesCreated += 1;
      }

      const company = await resolveCompany(tx, event.company, {
        corroborates: corroboratesFor(tx, { ...incoming, acquirerCompanyId }),
      });
      if (company.created) outcome.companiesCreated += 1;

      // A company cannot buy itself; this is an extraction error, not an event.
      if (
        acquirerCompanyId !== null &&
        acquirerCompanyId === company.companyId
      ) {
        continue;
      }

      const candidate: IncomingEvent = {
        ...incoming,
        companyId: company.companyId,
        acquirerCompanyId,
      };
      // A news report of a grant attaches to the grant event (D56). Other
      // news events never match a record-origin event.
      const grantId = await matchGrantRecord(tx, candidate);
      if (grantId !== null) outcome.grantReportsAttached += 1;
      const matchId = grantId ?? (await findMatchingEvent(tx, candidate));
      const eventId =
        matchId ??
        (await insertEvent(
          tx,
          event,
          company.companyId,
          date,
          acquirerCompanyId,
        ));
      if (matchId === null) outcome.eventsCreated += 1;
      else outcome.eventsUpdated += 1;

      await tx.insert(eventSources).values({
        eventId,
        extractionId,
        sourceItemId: row.sourceItemId,
        eventIndex: event.eventIndex,
      });
      linked.add(eventId);

      if (event.type === "acquisition") {
        await tx
          .update(companies)
          .set({ status: "acquired" })
          .where(eq(companies.id, company.companyId));
      }

      await recomputeEvent(tx, eventId, fx);
    }

    for (const eventId of touched) {
      if (!linked.has(eventId)) await recomputeEvent(tx, eventId, fx);
    }
    outcome.eventsDeleted = await deleteOrphanEvents(tx, touched);

    await tx
      .update(extractions)
      .set({ resolvedAt: new Date() })
      .where(eq(extractions.id, extractionId));
    return outcome;
  });
}
