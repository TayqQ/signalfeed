import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatePrecision, RoundType } from "@/core/enums";
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
import { createTestDb, type TestDb } from "@/db/testing";
import { ensureEdgarSource } from "@/pipeline/filings/store-form-d";
import { insertCompany } from "@/pipeline/resolve/testing";
import { confirmStep } from "./confirm-events";

// Scores the labelled cases in fixtures/registry/confirmation-cases.json
// (spec-phase3 section 12). Every case is seeded into one database, so a
// record of one company can never confirm another's round. Target: no wrong
// confirmation, and every labelled confirmation found.

interface CaseEvent {
  key: string;
  roundType: RoundType;
  announcedOn: string;
  datePrecision?: DatePrecision;
  amountUsdMinor?: number | null;
  recordOrigin?: boolean;
  evidence?: "reported" | "confirmed";
}

interface CaseSh01 {
  key: string;
  actionDate: string | null;
  filedOn?: string;
}

interface CaseFormD {
  key: string;
  dateOfFirstSale: string | null;
  totalOfferingUsdMinor: number | null;
  totalSoldUsdMinor: number | null;
  isAmendment?: boolean;
  previousKey?: string;
  onMergedCompany?: boolean;
  otherCik?: boolean;
}

interface Expected {
  event: string;
  record: string;
  confirmsAmount: boolean;
}

interface ConfirmationCase {
  id: string;
  note: string;
  registry: "companies_house" | "sec_edgar";
  linkStatus?: "linked" | "candidate" | "rejected";
  events: CaseEvent[];
  sh01?: CaseSh01[];
  formD?: CaseFormD[];
  expected: Expected[];
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixture = JSON.parse(
  readFileSync(
    path.join(repoRoot, "fixtures/registry/confirmation-cases.json"),
    "utf8",
  ),
) as { version: number; cases: ConfirmationCase[] };
const CASES = fixture.cases;

const clock = { now: () => new Date("2026-11-12T12:00:00Z") };

interface Seeded {
  eventIds: Map<string, number>;
  /** "kind:id" to the record key. */
  recordKeys: Map<string, string>;
  initialEvidence: Map<string, "reported" | "confirmed">;
}

let testDb: TestDb;
let db: Db;
const seeded = new Map<string, Seeded>();
let firstRun: Awaited<ReturnType<typeof confirmStep>>;
const logLines: string[] = [];

function dayAfter(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function seedCase(
  item: ConfirmationCase,
  index: number,
  edgarSourceId: number,
): Promise<Seeded> {
  const uk = item.registry === "companies_house";
  const company = await insertCompany(db, {
    name: `Case ${item.id} Labs`,
    countryCode: uk ? "GB" : "US",
  });
  const number = String(9_000_000 + index).padStart(8, "0");
  const cik = String(1_990_000 + index);
  await db.insert(registryLinks).values({
    companyId: company.id,
    registry: item.registry,
    registryId: uk ? number : cik,
    registryName: `CASE ${item.id.toUpperCase()} LABS`,
    status: item.linkStatus ?? "linked",
    method: (item.linkStatus ?? "linked") === "linked" ? "manual" : null,
    reason: "confirmation case",
    decidedBy: "manual",
  });

  const result: Seeded = {
    eventIds: new Map(),
    recordKeys: new Map(),
    initialEvidence: new Map(),
  };
  for (const event of item.events) {
    const evidence = event.evidence ?? "reported";
    const [row] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: company.id,
        announcedOn: event.announcedOn,
        datePrecision: event.datePrecision ?? "day",
        evidence,
        sourceCount: event.recordOrigin ? 0 : 1,
      })
      .returning({ id: events.id });
    const eventId = row!.id;
    await db.insert(fundingRounds).values({
      eventId,
      roundType: event.roundType,
      amountUsdMinor: event.amountUsdMinor ?? null,
    });
    if (event.recordOrigin) {
      await db
        .insert(eventRecordSources)
        .values({ eventId, recordKind: "ukri_grant", recordId: index + 1 });
    }
    result.eventIds.set(event.key, eventId);
    result.initialEvidence.set(event.key, evidence);
  }

  for (const [n, filing] of (item.sh01 ?? []).entries()) {
    const [row] = await db
      .insert(chFilings)
      .values({
        companyNumber: number,
        transactionId: `case-${item.id}-${filing.key}`,
        type: "SH01",
        category: "capital",
        filedOn:
          filing.filedOn ?? dayAfter(filing.actionDate ?? "2026-01-01", 14 + n),
        actionDate: filing.actionDate,
      })
      .returning({ id: chFilings.id });
    result.recordKeys.set(`ch_allotment:${row!.id}`, filing.key);
  }

  let mergedId: number | null = null;
  const accessions = new Map<string, string>();
  for (const [n, filing] of (item.formD ?? []).entries()) {
    let filingCompanyId = company.id;
    if (filing.onMergedCompany) {
      if (mergedId === null) {
        const loser = await insertCompany(db, {
          name: `Case ${item.id} Labs Duplicate`,
          countryCode: "US",
        });
        await db
          .update(companies)
          .set({ mergedIntoId: company.id })
          .where(eq(companies.id, loser.id));
        mergedId = loser.id;
      }
      filingCompanyId = mergedId;
    }
    const filingCik = filing.otherCik ? String(1_980_000 + index) : cik;
    const accession = `000${filingCik}-26-${String(n + 1).padStart(6, "0")}`;
    accessions.set(filing.key, accession);
    const [row] = await db
      .insert(formDFilings)
      .values({
        sourceId: edgarSourceId,
        accessionNumber: accession,
        cik: filingCik,
        issuerName: `CASE ${item.id.toUpperCase()} LABS INC`,
        isAmendment: filing.isAmendment ?? false,
        previousAccessionNumber: filing.previousKey
          ? (accessions.get(filing.previousKey) ?? null)
          : null,
        dateOfFirstSale: filing.dateOfFirstSale,
        totalOfferingUsdMinor: filing.totalOfferingUsdMinor,
        totalSoldUsdMinor: filing.totalSoldUsdMinor,
        securities: ["equity"],
        exemptions: ["06b"],
        filedOn: dayAfter(filing.dateOfFirstSale ?? "2026-01-01", 10 + n),
        companyId: filingCompanyId,
        linkedAt: clock.now(),
      })
      .returning({ id: formDFilings.id });
    result.recordKeys.set(`sec_form_d:${row!.id}`, filing.key);
  }
  return result;
}

async function confirmationsFor(item: ConfirmationCase): Promise<Expected[]> {
  const seed = seeded.get(item.id)!;
  const keyByEvent = new Map(
    [...seed.eventIds].map(([key, id]) => [id, key] as const),
  );
  const rows = await db.select().from(eventConfirmations);
  return rows
    .filter((row) => keyByEvent.has(row.eventId))
    .map((row) => ({
      event: keyByEvent.get(row.eventId)!,
      record:
        seed.recordKeys.get(`${row.recordKind}:${row.recordId}`) ??
        `unknown:${row.recordKind}:${row.recordId}`,
      confirmsAmount: row.confirmsAmount,
    }))
    .sort(
      (a, b) =>
        a.event.localeCompare(b.event) || a.record.localeCompare(b.record),
    );
}

function sorted(list: readonly Expected[]): Expected[] {
  return [...list].sort(
    (a, b) =>
      a.event.localeCompare(b.event) || a.record.localeCompare(b.record),
  );
}

beforeAll(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  const edgarSourceId = await ensureEdgarSource(db);
  for (const [index, item] of CASES.entries()) {
    seeded.set(item.id, await seedCase(item, index, edgarSourceId));
  }
  firstRun = await confirmStep({
    db,
    clock,
    log: (line) => logLines.push(line),
  });
}, 60_000);

afterAll(async () => {
  await testDb.close();
});

describe("confirmation cases", () => {
  it("has about 20 cases, including C1-C6, with unique ids", () => {
    expect(fixture.version).toBe(1);
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    const ids = CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
      expect(ids).toContain(id);
    }
  });

  it.each(CASES.map((item) => [item.id, item] as const))(
    "%s gives the labelled confirmations",
    async (_id, item) => {
      expect(await confirmationsFor(item)).toEqual(sorted(item.expected));
    },
  );

  it.each(CASES.map((item) => [item.id, item] as const))(
    "%s sets evidence to match",
    async (_id, item) => {
      const seed = seeded.get(item.id)!;
      const confirmedKeys = new Set(item.expected.map((e) => e.event));
      for (const event of item.events) {
        const [row] = await db
          .select({ evidence: events.evidence })
          .from(events)
          .where(eq(events.id, seed.eventIds.get(event.key)!));
        const want = event.recordOrigin
          ? seed.initialEvidence.get(event.key)
          : confirmedKeys.has(event.key)
            ? "confirmed"
            : "reported";
        expect(row?.evidence).toBe(want);
      }
    },
  );

  it("makes no wrong confirmation and misses none on the whole set", async () => {
    let wrong = 0;
    let missed = 0;
    for (const item of CASES) {
      const got = await confirmationsFor(item);
      const want = new Set(item.expected.map((e) => JSON.stringify(e)));
      const have = new Set(got.map((e) => JSON.stringify(e)));
      wrong += [...have].filter((e) => !want.has(e)).length;
      missed += [...want].filter((e) => !have.has(e)).length;
    }
    expect({ wrong, missed }).toEqual({ wrong: 0, missed: 0 });
    const total = CASES.reduce((sum, item) => sum + item.expected.length, 0);
    expect(firstRun.confirmations.inserted).toBe(total);
  });

  it("logs why each ambiguous record confirmed nothing", () => {
    // two-rounds-close (one SH01) and duplicate-reports (one SH01).
    expect(logLines).toHaveLength(2);
    for (const line of logLines) {
      expect(line).toMatch(
        /^Ambiguous ch_allotment record \d+ .*fits 2 rounds/,
      );
    }
  });

  it("writes nothing on a second run, even when forced", async () => {
    const again = await confirmStep({ db, clock });
    expect(again.skipped).toBe(true);
    const forced = await confirmStep({ db, clock, force: true });
    expect(forced).toEqual({
      confirmations: { inserted: 0, updated: 0, deleted: 0 },
      eventsConfirmed: 0,
      eventsSetToReported: 0,
    });
  });
});
