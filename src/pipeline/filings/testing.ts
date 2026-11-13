import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EdgarClient } from "./edgar-client";

const FIXTURE_DIR = join(process.cwd(), "fixtures", "edgar");

/** Fixture filings by accession number (all invented). */
export const EDGAR_FIXTURE_FILINGS = {
  company: { cik: "1999001", accession: "0001999001-26-000001" },
  amendment: { cik: "1999002", accession: "0001999002-26-000003" },
  fund: { cik: "1999003", accession: "0001999003-26-000001" },
} as const;

export const EDGAR_FIXTURE_DAY = "2026-11-10";

export function readEdgarFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

export interface FakeEdgarClientOptions {
  /** Index text by day (`yyyy-mm-dd`). Other days are `missing`. */
  indexes?: Record<string, string>;
  /** Form D XML by accession number. Other filings are `missing`. */
  filings?: Record<string, string>;
}

/**
 * An `EdgarClient` that answers from memory. Defaults to the three fixture
 * filings and the 10 November 2026 index. No network.
 */
export function createFakeEdgarClient(
  options: FakeEdgarClientOptions = {},
): EdgarClient & { requests: string[] } {
  const indexes = options.indexes ?? {
    [EDGAR_FIXTURE_DAY]: readEdgarFixture("form-index.idx"),
  };
  const filings = options.filings ?? {
    [EDGAR_FIXTURE_FILINGS.company.accession]:
      readEdgarFixture("form-d-company.xml"),
    [EDGAR_FIXTURE_FILINGS.amendment.accession]: readEdgarFixture(
      "form-d-amendment.xml",
    ),
    [EDGAR_FIXTURE_FILINGS.fund.accession]: readEdgarFixture("form-d-fund.xml"),
  };
  const requests: string[] = [];
  return {
    requests,
    getFormIndex(day) {
      requests.push(`index:${day}`);
      const text = indexes[day];
      return Promise.resolve(
        text === undefined ? { status: "missing" } : { status: "ok", text },
      );
    },
    getFormD(cik, accessionNumber) {
      requests.push(`formd:${cik}:${accessionNumber}`);
      const xml = filings[accessionNumber];
      return Promise.resolve(
        xml === undefined ? { status: "missing" } : { status: "ok", xml },
      );
    },
    requestCount: () => requests.length,
  };
}
