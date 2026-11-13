import type { Clock, HttpFetcher, HttpResponse } from "@/core/ports";
import { normaliseCik } from "@/core/registry";
import { buildUserAgent } from "@/lib/http";

const BASE = "https://www.sec.gov/Archives/edgar";
const MAX_REQUESTS_PER_SECOND = 5;
const WINDOW_MS = 1000;
const THROTTLE_WAIT_MS = 10 * 60 * 1000;
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/;

export type EdgarResult<T> = ({ status: "ok" } & T) | { status: "missing" };

export interface EdgarClient {
  /** The daily form index for `day` (`yyyy-mm-dd`). 404 is `missing`. */
  getFormIndex(day: string): Promise<EdgarResult<{ text: string }>>;
  /** `primary_doc.xml` for one filing. 404 is `missing`. */
  getFormD(
    cik: string,
    accessionNumber: string,
  ): Promise<EdgarResult<{ xml: string }>>;
  /** Requests sent so far, retries included. */
  requestCount(): number;
}

export interface CreateEdgarClientOptions {
  http: HttpFetcher;
  /** `HTTP_CONTACT`. Must contain an email address (SEC fair access). */
  contact: string;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
}

export class EdgarThrottledError extends Error {
  constructor(url: string) {
    super(`SEC EDGAR throttled the request twice: ${url}`);
    this.name = "EdgarThrottledError";
  }
}

export class EdgarHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`SEC EDGAR answered ${status}: ${url}`);
    this.name = "EdgarHttpError";
  }
}

/** URL of a daily form index. `day` is `yyyy-mm-dd`. */
export function formIndexUrl(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const [, year, mm, dd] = match ?? [];
  const month = Number(mm);
  if (!year || !mm || !dd || month < 1 || month > 12) {
    throw new Error(`Invalid index day: ${day}`);
  }
  const quarter = Math.ceil(month / 3);
  return `${BASE}/daily-index/${year}/QTR${quarter}/form.${year}${mm}${dd}.idx`;
}

/** URL of a filing's `primary_doc.xml`. */
export function formDUrl(cik: string, accessionNumber: string): string {
  const cleanCik = normaliseCik(cik);
  const compact = accessionNumber.replace(/-/g, "");
  if (!cleanCik || !/^\d{18}$/.test(compact)) {
    throw new Error(
      `Invalid CIK or accession number: ${cik} ${accessionNumber}`,
    );
  }
  return `${BASE}/data/${cleanCik}/${compact}/primary_doc.xml`;
}

export function createEdgarClient(
  options: CreateEdgarClientOptions,
): EdgarClient {
  const { http, contact, sleep, clock } = options;
  if (!EMAIL.test(contact)) {
    throw new Error(
      "HTTP_CONTACT must contain an email address (SEC EDGAR fair access)",
    );
  }
  const headers = {
    "user-agent": buildUserAgent(contact),
    "accept-encoding": "gzip, deflate",
  };
  const sent: number[] = [];
  let count = 0;

  /** Waits until fewer than 5 requests fall in the last second, then records one. */
  async function takeSlot(): Promise<void> {
    for (;;) {
      const now = clock.now().getTime();
      while (sent.length > 0 && now - (sent[0] ?? now) > WINDOW_MS) {
        sent.shift();
      }
      const oldest = sent[0];
      if (oldest === undefined || sent.length < MAX_REQUESTS_PER_SECOND) {
        sent.push(now);
        return;
      }
      await sleep(oldest + WINDOW_MS - now + 1);
    }
  }

  async function send(url: string): Promise<HttpResponse> {
    await takeSlot();
    count += 1;
    return http.get(url, { headers });
  }

  async function get(url: string): Promise<EdgarResult<{ body: string }>> {
    let response = await send(url);
    if (response.status === 429 || response.status === 403) {
      await sleep(THROTTLE_WAIT_MS);
      response = await send(url);
      if (response.status === 429 || response.status === 403) {
        throw new EdgarThrottledError(url);
      }
    }
    if (response.status === 404) return { status: "missing" };
    if (response.status !== 200) throw new EdgarHttpError(response.status, url);
    return { status: "ok", body: response.body };
  }

  return {
    async getFormIndex(day) {
      const result = await get(formIndexUrl(day));
      return result.status === "ok"
        ? { status: "ok", text: result.body }
        : result;
    },
    async getFormD(cik, accessionNumber) {
      const result = await get(formDUrl(cik, accessionNumber));
      return result.status === "ok"
        ? { status: "ok", xml: result.body }
        : result;
    },
    requestCount: () => count,
  };
}
