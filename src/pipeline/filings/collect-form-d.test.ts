import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FormDStats } from "@/core/domain";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  edgarIndexDays,
  events,
  formDFilings,
  fundingRounds,
  mergeCandidates,
  registryLinks,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { normaliseCompanyName } from "@/lib/normalise";
import { addDays, collectFormDStep, easternToday } from "./collect-form-d";
import { EdgarHttpError, type EdgarClient } from "./edgar-client";
import { linkFormDFilings } from "./link-form-d";
import { recordIndexDay } from "./store-form-d";
import {
  EDGAR_FIXTURE_DAY,
  EDGAR_FIXTURE_FILINGS,
  createFakeEdgarClient,
  readEdgarFixture,
} from "./testing";

// Thursday 12 November 2026, 10:00 in New York. Yesterday is Wednesday 11th.
const NOW = new Date("2026-11-12T15:00:00Z");
const clock = { now: () => NOW };
const FIXTURE_FILES = [
  "form-d-company.xml",
  "form-d-amendment.xml",
  "form-d-fund.xml",
];

let testDb: TestDb;
let db: Db;
let logs: string[];

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  logs = [];
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

function run(
  edgar: EdgarClient,
  options: { since?: string; maxDays?: number; maxRequests?: number } = {},
): Promise<FormDStats> {
  return collectFormDStep({
    db,
    edgar,
    clock,
    maxDays: options.maxDays ?? 10,
    maxRequests: options.maxRequests ?? 3000,
    log: (message) => logs.push(message),
    ...(options.since === undefined ? {} : { since: options.since }),
  });
}

async function indexDays() {
  const rows = await db.select().from(edgarIndexDays);
  return Object.fromEntries(rows.map((row) => [row.day, row.status]));
}

async function storedAccessionNumbers() {
  const rows = await db.select().from(formDFilings);
  return rows.map((row) => row.accessionNumber).sort();
}

/** Every person's name and street address in the fixtures (all invented). */
function personalDataInFixtures(): string[] {
  const found = new Set<string>();
  for (const file of FIXTURE_FILES) {
    const xml = readEdgarFixture(file);
    const people =
      /<firstName>([^<]+)<\/firstName>\s*<lastName>([^<]+)<\/lastName>/g;
    for (const match of xml.matchAll(people)) {
      found.add(`${match[1]} ${match[2]}`);
      found.add(match[2] ?? "");
    }
    const fields =
      /<(recipientName|associatedBDName|nameOfSigner|street1|street2)>([^<]+)</g;
    for (const match of xml.matchAll(fields)) found.add(match[2] ?? "");
  }
  found.delete("");
  return [...found];
}

describe("easternToday", () => {
  it("uses the New York date", () => {
    expect(easternToday(new Date("2026-11-12T03:00:00Z"))).toBe("2026-11-11");
    expect(easternToday(NOW)).toBe("2026-11-12");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("collectFormDStep", () => {
  it("stores the company and amendment, skips the fund and records the days", async () => {
    const edgar = createFakeEdgarClient();
    const stats = await run(edgar);

    expect(await storedAccessionNumbers()).toEqual([
      EDGAR_FIXTURE_FILINGS.company.accession,
      EDGAR_FIXTURE_FILINGS.amendment.accession,
    ]);
    expect(stats).toEqual({
      daysFetched: 1,
      daysMissing: 4,
      filingsFound: 5,
      filingsStored: 2,
      fundsSkipped: 1,
      // Two index rows have no document in the fake.
      parseFailures: 2,
      linkedByCik: 0,
      linkedByName: 0,
      candidates: 0,
      requests: 12,
    });
    // Old weekdays and the weekend are missing. Monday 9th and Wednesday 11th
    // are recent, so they are left for the next run.
    expect(await indexDays()).toEqual({
      "2026-11-05": "missing",
      "2026-11-06": "missing",
      "2026-11-07": "missing",
      "2026-11-08": "missing",
      [EDGAR_FIXTURE_DAY]: "done",
    });
    const [day] = await db
      .select()
      .from(edgarIndexDays)
      .where(eq(edgarIndexDays.day, EDGAR_FIXTURE_DAY));
    expect(day).toMatchObject({
      formDFound: 5,
      formDStored: 2,
      fundSkipped: 1,
    });
    const [source] = await db.select().from(sources);
    expect(source).toMatchObject({ slug: "sec-edgar", kind: "sec_edgar" });
    expect(
      (await db.select().from(formDFilings)).every(
        (row) => row.sourceId === source?.id,
      ),
    ).toBe(true);
  });

  it("makes no duplicate on a second run and asks only for open days", async () => {
    await run(createFakeEdgarClient());
    const second = createFakeEdgarClient();
    const stats = await run(second);

    expect(await storedAccessionNumbers()).toHaveLength(2);
    expect(stats.filingsStored).toBe(0);
    expect(second.requests).toEqual(["index:2026-11-09", "index:2026-11-11"]);
  });

  it("resumes from the last done day", async () => {
    await recordIndexDay(db, {
      day: "2026-11-08",
      status: "done",
      formDFound: 0,
      formDStored: 0,
      fundSkipped: 0,
      now: NOW,
    });
    const edgar = createFakeEdgarClient();
    await run(edgar);
    expect(edgar.requests.filter((r) => r.startsWith("index:"))).toEqual([
      "index:2026-11-09",
      "index:2026-11-10",
      "index:2026-11-11",
    ]);
  });

  it("looks again at a recent 404 and records it missing once it is old", async () => {
    await run(createFakeEdgarClient());
    expect((await indexDays())["2026-11-09"]).toBeUndefined();

    const later = new Date("2026-11-16T15:00:00Z");
    const edgar = createFakeEdgarClient();
    await collectFormDStep({
      db,
      edgar,
      clock: { now: () => later },
      maxDays: 10,
      maxRequests: 100,
    });
    expect(edgar.requests[0]).toBe("index:2026-11-09");
    expect((await indexDays())["2026-11-09"]).toBe("missing");
  });

  it("respects maxDays", async () => {
    const edgar = createFakeEdgarClient();
    const stats = await run(edgar, { since: "2026-11-05", maxDays: 2 });
    expect(edgar.requests).toEqual(["index:2026-11-05", "index:2026-11-06"]);
    expect(stats.daysMissing).toBe(2);
  });

  it("stops before maxRequests and finishes the day on the next run", async () => {
    const first = createFakeEdgarClient();
    const stats = await run(first, {
      since: EDGAR_FIXTURE_DAY,
      maxRequests: 2,
    });
    expect(first.requests).toHaveLength(2);
    expect(stats.requests).toBe(2);
    expect(await indexDays()).toEqual({});
    const partly = await storedAccessionNumbers();
    expect(partly.length).toBeLessThanOrEqual(1);

    const second = createFakeEdgarClient();
    await run(second, { since: EDGAR_FIXTURE_DAY, maxDays: 1 });
    expect(await storedAccessionNumbers()).toHaveLength(2);
    expect((await indexDays())[EDGAR_FIXTURE_DAY]).toBe("done");
    // Stored filings are not fetched again.
    for (const accession of partly) {
      expect(second.requests.some((r) => r.endsWith(accession))).toBe(false);
    }
  });

  it("treats weekend 404s as missing", async () => {
    const edgar = createFakeEdgarClient({ indexes: {} });
    await run(edgar, { since: "2026-11-07", maxDays: 2 });
    expect(await indexDays()).toEqual({
      "2026-11-07": "missing",
      "2026-11-08": "missing",
    });
  });

  it("counts and logs a parse failure without stopping the day", async () => {
    const edgar = createFakeEdgarClient({
      filings: {
        [EDGAR_FIXTURE_FILINGS.company.accession]: "<edgarSubmission/>",
        [EDGAR_FIXTURE_FILINGS.amendment.accession]: readEdgarFixture(
          "form-d-amendment.xml",
        ),
      },
    });
    const stats = await run(edgar, { since: EDGAR_FIXTURE_DAY, maxDays: 1 });
    expect(await storedAccessionNumbers()).toEqual([
      EDGAR_FIXTURE_FILINGS.amendment.accession,
    ]);
    expect(stats.parseFailures).toBe(4);
    expect(
      logs.some((line) =>
        line.includes(
          `${EDGAR_FIXTURE_FILINGS.company.accession} could not be parsed`,
        ),
      ),
    ).toBe(true);
    expect((await indexDays())[EDGAR_FIXTURE_DAY]).toBe("done");
  });

  it("leaves a day open when a filing fails with an HTTP error", async () => {
    const fake = createFakeEdgarClient();
    const edgar: EdgarClient = {
      ...fake,
      getFormD(cik, accession) {
        if (accession === EDGAR_FIXTURE_FILINGS.company.accession) {
          return Promise.reject(new EdgarHttpError(500, "test"));
        }
        return fake.getFormD(cik, accession);
      },
    };
    await run(edgar, { since: EDGAR_FIXTURE_DAY, maxDays: 1 });
    expect(await storedAccessionNumbers()).toEqual([
      EDGAR_FIXTURE_FILINGS.amendment.accession,
    ]);
    expect(await indexDays()).toEqual({});
  });

  it("stores no person's name or street address, end to end", async () => {
    const [company] = await db
      .insert(companies)
      .values({
        slug: "example-harbor-medical",
        name: "Example Harbor Medical",
        normalisedName: normaliseCompanyName("Example Harbor Medical"),
        countryCode: "US",
      })
      .returning();
    const [event] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: company!.id,
        announcedOn: "2024-11-01",
        datePrecision: "day",
      })
      .returning();
    await db.insert(fundingRounds).values({
      eventId: event!.id,
      roundType: "seed",
      amountMinor: 160_000_000,
      currency: "USD",
      amountUsdMinor: 160_000_000,
    });

    await run(createFakeEdgarClient());
    const stats = await linkFormDFilings({ db, now: NOW });
    expect(stats.linkedByName).toBe(1);

    const tables = await Promise.all([
      db.select().from(formDFilings),
      db.select().from(edgarIndexDays),
      db.select().from(sources),
      db.select().from(companies),
      db.select().from(companyAliases),
      db.select().from(registryLinks),
      db.select().from(mergeCandidates),
    ]);
    const stored = JSON.stringify(tables).toLowerCase();
    expect(stored).toContain("example harbor medical inc.");
    const personal = personalDataInFixtures();
    expect(personal).toEqual(
      expect.arrayContaining([
        "Example Person One",
        "Example Person Three",
        "Example Person Five",
        "Example Securities L.L.C.",
        "#8 - 200 Example Road",
      ]),
    );
    for (const value of personal) {
      expect(stored).not.toContain(value.toLowerCase());
    }
  });
});
