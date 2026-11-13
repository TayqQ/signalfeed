// The confirm step (docs/spec-phase3.md section 9, D54, D37). Rebuilds
// `event_confirmations` from stored SH01 and Form D filings with the rules in
// `confirm-rules.ts`, then sets `events.evidence` on news events to match.
//
// - Only funding rounds of companies with a `linked` registry row (not merged)
//   are considered. A Form D counts only when its company, after following
//   merges, holds a `linked` row for the filing's CIK.
// - Events created from an official record (an `event_record_sources` row)
//   are never confirmed here and never changed.
// - A confirmation never touches canonical fields: amount, round type, date
//   and investors stay as reported (D54). Only `evidence` follows.
// - Precision first: a record that fits two or more events of its company is
//   ambiguous and confirms none of them. Each such record is reported with
//   the reason, so a reviewer can see why a round stayed `reported`.

import { and, eq, exists, inArray, isNull, not, sql } from "drizzle-orm";
import type { ConfirmStats, DiffCounts } from "@/core/domain";
import type { Clock } from "@/core/ports";
import type { CapitalFiling, FormDFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import {
  chFilings,
  companies,
  eventConfirmations,
  eventRecordSources,
  events,
  formDFilings,
  fundingRounds,
  registryLinks,
} from "@/db/schema";
import {
  computeFingerprint,
  recordRebuild,
  shouldRebuild,
  type FingerprintInput,
} from "@/pipeline/stats/fingerprint";
import {
  allotmentConfirms,
  assignRecords,
  formDConfirms,
  type ConfirmableEvent,
  type ConfirmationRecord,
} from "./confirm-rules";

/** The `derived_rebuilds` name of this step. */
export const CONFIRM_REBUILD = "confirm";

/** Bumped when the confirm logic changes, so the next run rebuilds. */
export const CONFIRM_LOGIC_VERSION = "confirm-v1";

const CHUNK = 1_000;
const MAX_MERGE_DEPTH = 32;

type ConfirmationRow = typeof eventConfirmations.$inferInsert;
type ConfirmationKind = "ch_allotment" | "sec_form_d";

/**
 * The inputs of the confirm step. `events.evidence` and `updated_at` are left
 * out on purpose: the step writes them, so including them would make every
 * run after a change rebuild once more for nothing.
 */
export const CONFIRM_INPUTS: readonly FingerprintInput[] = [
  {
    table: events,
    sums: [
      events.id,
      events.companyId,
      sql`(${events.announcedOn} - date '2000-01-01')`,
      sql`hashtext(${events.type}::text || '|' || ${events.datePrecision}::text)`,
    ],
  },
  {
    table: fundingRounds,
    sums: [
      fundingRounds.eventId,
      fundingRounds.amountUsdMinor,
      sql`hashtext(${fundingRounds.roundType}::text)`,
    ],
  },
  {
    table: eventRecordSources,
    sums: [eventRecordSources.eventId],
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
    table: chFilings,
    sums: [
      chFilings.id,
      sql`hashtext(${chFilings.companyNumber} || '|' || ${chFilings.type} || '|' || coalesce(${chFilings.actionDate}::text, ''))`,
    ],
  },
  {
    table: formDFilings,
    sums: [
      formDFilings.id,
      formDFilings.companyId,
      sql`hashtext(${formDFilings.cik} || '|' || coalesce(${formDFilings.dateOfFirstSale}::text, '') || '|' || coalesce(${formDFilings.totalOfferingUsdMinor}::text, '') || '|' || coalesce(${formDFilings.totalSoldUsdMinor}::text, ''))`,
    ],
  },
];

export function confirmFingerprint(db: Db): Promise<string> {
  return computeFingerprint(db, CONFIRM_LOGIC_VERSION, CONFIRM_INPUTS);
}

/** A record that fitted more than one event, so it confirmed none. */
export interface AmbiguousRecord {
  companyId: number;
  recordKind: ConfirmationKind;
  /** A `ch_filings.id` or a `form_d_filings.id`. */
  recordId: number;
  /** The events it fitted, lowest id first. */
  eventIds: number[];
  reason: string;
}

export interface ComputedConfirmations {
  /** Rows for `event_confirmations`, without `computed_at`. */
  rows: ConfirmationRow[];
  ambiguous: AmbiguousRecord[];
}

interface CompanyInputs {
  events: ConfirmableEvent[];
  records: ConfirmationRecord[];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function inputsFor(
  byCompany: Map<number, CompanyInputs>,
  companyId: number,
): CompanyInputs {
  let inputs = byCompany.get(companyId);
  if (!inputs) {
    inputs = { events: [], records: [] };
    byCompany.set(companyId, inputs);
  }
  return inputs;
}

/** `linked` rows of companies that are not merged, by registry. */
async function loadLinks(db: Db): Promise<{
  companyByChNumber: Map<string, number>;
  cikByCompany: Map<number, string>;
}> {
  const rows = await db
    .select({
      companyId: registryLinks.companyId,
      registry: registryLinks.registry,
      registryId: registryLinks.registryId,
    })
    .from(registryLinks)
    .innerJoin(companies, eq(companies.id, registryLinks.companyId))
    .where(
      and(eq(registryLinks.status, "linked"), isNull(companies.mergedIntoId)),
    );
  const companyByChNumber = new Map<string, number>();
  const cikByCompany = new Map<number, string>();
  for (const row of rows) {
    if (row.registry === "companies_house") {
      companyByChNumber.set(row.registryId, row.companyId);
    } else {
      cikByCompany.set(row.companyId, row.registryId);
    }
  }
  return { companyByChNumber, cikByCompany };
}

/** Follows `merged_into_id` to the surviving company. */
async function loadSurvivors(db: Db): Promise<(id: number) => number> {
  const merged = await db
    .select({ id: companies.id, mergedIntoId: companies.mergedIntoId })
    .from(companies)
    .where(sql`${companies.mergedIntoId} IS NOT NULL`);
  const next = new Map(merged.map((row) => [row.id, row.mergedIntoId]));
  return (id) => {
    let current = id;
    for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
      const target = next.get(current);
      if (target === undefined || target === null) return current;
      current = target;
    }
    return current;
  };
}

/** News funding rounds (no record source) of the given companies. */
async function loadNewsRounds(
  db: Db,
  companyIds: readonly number[],
): Promise<Array<ConfirmableEvent & { companyId: number }>> {
  const out: Array<ConfirmableEvent & { companyId: number }> = [];
  for (const ids of chunks(companyIds, CHUNK)) {
    const rows = await db
      .select({
        id: events.id,
        companyId: events.companyId,
        type: events.type,
        announcedOn: events.announcedOn,
        datePrecision: events.datePrecision,
        roundType: fundingRounds.roundType,
        amountUsdMinor: fundingRounds.amountUsdMinor,
      })
      .from(events)
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(
        and(
          inArray(events.companyId, ids),
          eq(events.type, "funding_round"),
          not(
            exists(
              db
                .select({ one: sql`1` })
                .from(eventRecordSources)
                .where(eq(eventRecordSources.eventId, events.id)),
            ),
          ),
        ),
      );
    out.push(...rows);
  }
  return out;
}

async function loadAllotments(
  db: Db,
  numbers: readonly string[],
): Promise<
  Array<{ id: number; companyNumber: string; filing: CapitalFiling }>
> {
  const out: Array<{
    id: number;
    companyNumber: string;
    filing: CapitalFiling;
  }> = [];
  for (const batch of chunks(numbers, CHUNK)) {
    const rows = await db
      .select()
      .from(chFilings)
      .where(
        and(
          inArray(chFilings.companyNumber, batch),
          sql`upper(${chFilings.type}) = 'SH01'`,
        ),
      );
    for (const row of rows) {
      out.push({
        id: row.id,
        companyNumber: row.companyNumber,
        filing: {
          transactionId: row.transactionId,
          type: row.type,
          filedOn: row.filedOn,
          actionDate: row.actionDate,
          capital: row.capital,
        },
      });
    }
  }
  return out;
}

function toFormDFacts(row: typeof formDFilings.$inferSelect): FormDFacts {
  return {
    accessionNumber: row.accessionNumber,
    cik: row.cik,
    issuerName: row.issuerName,
    entityType: row.entityType,
    issuerState: row.issuerState,
    issuerCity: row.issuerCity,
    yearOfInc: row.yearOfInc,
    industryGroup: row.industryGroup,
    isAmendment: row.isAmendment,
    dateOfFirstSale: row.dateOfFirstSale,
    totalOfferingUsdMinor: row.totalOfferingUsdMinor,
    totalSoldUsdMinor: row.totalSoldUsdMinor,
    filedOn: row.filedOn,
  };
}

function fits(event: ConfirmableEvent, record: ConfirmationRecord): boolean {
  return record.kind === "ch_allotment"
    ? allotmentConfirms(event, record.filing).confirms
    : formDConfirms(event, record.filing).confirms;
}

/**
 * Applies the rules of spec-phase3 section 9.2 to every news funding round of
 * a linked company. Reads only; writes nothing.
 */
export async function computeConfirmations(
  db: Db,
): Promise<ComputedConfirmations> {
  const { companyByChNumber, cikByCompany } = await loadLinks(db);
  const survivorOf = await loadSurvivors(db);
  const byCompany = new Map<number, CompanyInputs>();

  for (const item of await loadAllotments(db, [...companyByChNumber.keys()])) {
    const companyId = companyByChNumber.get(item.companyNumber);
    if (companyId === undefined) continue;
    inputsFor(byCompany, companyId).records.push({
      kind: "ch_allotment",
      id: String(item.id),
      filing: item.filing,
    });
  }

  if (cikByCompany.size > 0) {
    const rows = await db
      .select()
      .from(formDFilings)
      .where(sql`${formDFilings.companyId} IS NOT NULL`);
    for (const row of rows) {
      if (row.companyId === null) continue;
      const companyId = survivorOf(row.companyId);
      // The survivor must hold a `linked` row for this very CIK.
      if (cikByCompany.get(companyId) !== row.cik) continue;
      inputsFor(byCompany, companyId).records.push({
        kind: "sec_form_d",
        id: String(row.id),
        filing: toFormDFacts(row),
      });
    }
  }

  const companyIds = [...byCompany.keys()].sort((a, b) => a - b);
  for (const event of await loadNewsRounds(db, companyIds)) {
    inputsFor(byCompany, event.companyId).events.push(event);
  }

  const rows: ConfirmationRow[] = [];
  const ambiguous: AmbiguousRecord[] = [];
  for (const companyId of companyIds) {
    const inputs = byCompany.get(companyId);
    if (!inputs || inputs.events.length === 0) continue;
    const clear: ConfirmationRecord[] = [];
    for (const record of inputs.records) {
      const fitted = inputs.events
        .filter((event) => fits(event, record))
        .map((event) => event.id)
        .sort((a, b) => a - b);
      if (fitted.length > 1) {
        ambiguous.push({
          companyId,
          recordKind: record.kind,
          recordId: Number(record.id),
          eventIds: fitted,
          reason: `fits ${fitted.length} rounds (events ${fitted.join(", ")}); not confirmed`,
        });
        continue;
      }
      if (fitted.length === 1) clear.push(record);
    }
    for (const assignment of assignRecords(inputs.events, clear)) {
      rows.push({
        eventId: assignment.eventId,
        recordKind: assignment.recordKind,
        recordId: Number(assignment.recordId),
        rule: assignment.rule,
        recordDate: assignment.recordDate,
        confirmsAmount: assignment.confirmsAmount,
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.eventId - b.eventId ||
      a.recordKind.localeCompare(b.recordKind) ||
      a.recordId - b.recordId,
  );
  ambiguous.sort(
    (a, b) =>
      a.companyId - b.companyId ||
      a.recordKind.localeCompare(b.recordKind) ||
      a.recordId - b.recordId,
  );
  return { rows, ambiguous };
}

function confirmationKey(row: {
  eventId: number;
  recordKind: string;
  recordId: number;
}): string {
  return `${row.eventId}|${row.recordKind}|${row.recordId}`;
}

/**
 * Makes `event_confirmations` hold exactly `rows`, writing only changed rows
 * (D37). The shared `writeDiff` only accepts the tables listed in
 * `stats/diff-write.ts`, which does not include this table yet, so the same
 * diff is done here. Run inside a transaction.
 */
async function writeConfirmations(
  db: Db,
  rows: readonly ConfirmationRow[],
): Promise<DiffCounts> {
  const wanted = new Map<string, ConfirmationRow>();
  for (const row of rows) {
    const key = confirmationKey(row);
    if (wanted.has(key)) throw new Error(`Duplicate confirmation ${key}`);
    wanted.set(key, row);
  }
  const current = new Map(
    (await db.select().from(eventConfirmations)).map((row) => [
      confirmationKey(row),
      row,
    ]),
  );

  const counts: DiffCounts = { inserted: 0, updated: 0, deleted: 0 };
  const keyOf = (row: ConfirmationRow) =>
    and(
      eq(eventConfirmations.eventId, row.eventId),
      eq(eventConfirmations.recordKind, row.recordKind),
      eq(eventConfirmations.recordId, row.recordId),
    );

  for (const [key, row] of current) {
    if (wanted.has(key)) continue;
    await db.delete(eventConfirmations).where(keyOf(row));
    counts.deleted += 1;
  }
  const inserts: ConfirmationRow[] = [];
  for (const [key, row] of wanted) {
    const before = current.get(key);
    if (!before) {
      inserts.push(row);
      continue;
    }
    const confirmsAmount = row.confirmsAmount ?? false;
    if (
      before.rule === row.rule &&
      before.recordDate === row.recordDate &&
      before.confirmsAmount === confirmsAmount
    ) {
      continue;
    }
    await db
      .update(eventConfirmations)
      .set({ rule: row.rule, recordDate: row.recordDate, confirmsAmount })
      .where(keyOf(row));
    counts.updated += 1;
  }
  for (const batch of chunks(inserts, 500)) {
    await db.insert(eventConfirmations).values(batch);
    counts.inserted += batch.length;
  }
  return counts;
}

/**
 * Sets `evidence` on news events from `event_confirmations` (spec-phase3
 * section 9.3). Events with a record source are never touched.
 */
async function syncEvidence(
  db: Db,
  now: Date,
): Promise<{ confirmed: number; reported: number }> {
  const isNews = not(
    exists(
      db
        .select({ one: sql`1` })
        .from(eventRecordSources)
        .where(eq(eventRecordSources.eventId, events.id)),
    ),
  );
  const hasConfirmation = exists(
    db
      .select({ one: sql`1` })
      .from(eventConfirmations)
      .where(eq(eventConfirmations.eventId, events.id)),
  );
  const confirmed = await db
    .update(events)
    .set({ evidence: "confirmed", updatedAt: now })
    .where(and(eq(events.evidence, "reported"), isNews, hasConfirmation))
    .returning({ id: events.id });
  const reported = await db
    .update(events)
    .set({ evidence: "reported", updatedAt: now })
    .where(and(eq(events.evidence, "confirmed"), isNews, not(hasConfirmation)))
    .returning({ id: events.id });
  return { confirmed: confirmed.length, reported: reported.length };
}

export interface ConfirmStepOptions {
  db: Db;
  clock: Clock;
  /** Rebuild even when the input fingerprint has not changed. */
  force?: boolean;
  /** Receives one line per record left unconfirmed because it was ambiguous. */
  log?: (message: string) => void;
}

/**
 * Rebuilds `event_confirmations` and `events.evidence` in one transaction.
 * Skipped when the inputs have not changed, unless `force` is set. The
 * fingerprint is taken before the inputs are read, so a change made in
 * between makes the next run rebuild again rather than being missed.
 */
export async function confirmStep({
  db,
  clock,
  force = false,
  log,
}: ConfirmStepOptions): Promise<ConfirmStats> {
  const fingerprint = await confirmFingerprint(db);
  if (!force && !(await shouldRebuild(db, CONFIRM_REBUILD, fingerprint))) {
    return {
      confirmations: { inserted: 0, updated: 0, deleted: 0 },
      eventsConfirmed: 0,
      eventsSetToReported: 0,
      skipped: true,
    };
  }

  const computed = await computeConfirmations(db);
  const now = clock.now();
  const result = await db.transaction(async (tx) => {
    const confirmations = await writeConfirmations(tx, computed.rows);
    const evidence = await syncEvidence(tx, now);
    await recordRebuild(tx, CONFIRM_REBUILD, fingerprint, now);
    return { confirmations, evidence };
  });

  if (log) {
    for (const item of computed.ambiguous) {
      log(
        `Ambiguous ${item.recordKind} record ${item.recordId} (company ${item.companyId}): ${item.reason}`,
      );
    }
  }

  return {
    confirmations: result.confirmations,
    eventsConfirmed: result.evidence.confirmed,
    eventsSetToReported: result.evidence.reported,
  };
}
