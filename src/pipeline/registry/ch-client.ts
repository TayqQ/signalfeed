import type { HttpFetcher, HttpResponse } from "@/core/ports";
import {
  normaliseCompanyNumber,
  type CapitalFiling,
  type RegistryCompanyFacts,
} from "@/core/registry";
import { parseUkPostcode } from "@/lib/geo/postcode";
import {
  chAdvancedSearchSchema,
  chFilingHistorySchema,
  chProfileSchema,
  chSearchResponseSchema,
  type ChProfile,
} from "./ch-schemas";
import type { WindowLimiter } from "./rate-limit";

/** The only place the API address lives. */
export const CH_API_BASE = "https://api.company-information.service.gov.uk";

/** The largest page the API gives (A38). */
const SEARCH_PAGE_SIZE = 50;
const FILING_PAGE_SIZE = 100;
const RATE_WINDOW_MS = 300_000;

export class RateLimitedError extends Error {
  constructor() {
    super("Companies House rate limit reached");
    this.name = "RateLimitedError";
  }
}

export class ChApiError extends Error {
  constructor(
    readonly status: number,
    label: string,
  ) {
    super(`Companies House ${label} failed: HTTP ${status}`);
    this.name = "ChApiError";
  }
}

export interface ChSearchHit {
  companyNumber: string;
  name: string;
  status: string | null;
  companyType: string | null;
  incorporatedOn: string | null;
  ceasedOn: string | null;
  postcode: string | null;
  locality: string | null;
}

export interface ChClient {
  searchCompanies(name: string): Promise<ChSearchHit[]>;
  /** Null when the company does not exist (404). */
  getCompany(companyNumber: string): Promise<RegistryCompanyFacts | null>;
  /** SH01 filings, newest first, stopping at those filed before `since`. */
  getCapitalFilings(
    companyNumber: string,
    options?: { since?: string },
  ): Promise<CapitalFiling[]>;
  /** Active companies registered at a postcode, or null if it cannot be counted. */
  countActiveAtPostcode(postcode: string): Promise<number | null>;
  requestsMade(): number;
}

export interface ChClientOptions {
  http: HttpFetcher;
  apiKey: string;
  limiter: WindowLimiter;
  sleep?: (ms: number) => Promise<void>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Maps a profile to the core type. Exported for the fake client. */
export function profileToFacts(profile: ChProfile): RegistryCompanyFacts {
  const companyNumber = normaliseCompanyNumber(profile.company_number);
  if (companyNumber === null) {
    throw new Error("Companies House returned an invalid company number");
  }
  const postcode = profile.registered_office_address?.postal_code?.trim();
  const last = profile.accounts?.last_accounts;
  return {
    companyNumber,
    name: profile.company_name,
    previousNames: profile.previous_company_names.map((p) => p.name),
    status: profile.company_status,
    companyType: profile.type,
    incorporatedOn: profile.date_of_creation,
    ceasedOn: profile.date_of_cessation ?? null,
    sicCodes: profile.sic_codes,
    officePostcode: postcode ? postcode : null,
    officeOutcode: postcode
      ? (parseUkPostcode(postcode)?.outcode ?? null)
      : null,
    accountsType: last?.type ?? null,
    accountsMadeUpTo: last?.period_end_on ?? last?.made_up_to ?? null,
    statusDetail: profile.company_status_detail ?? null,
    officeLocality: profile.registered_office_address?.locality ?? null,
    hasInsolvencyHistory:
      profile.links?.insolvency !== undefined ||
      profile.has_insolvency_history === true,
    etag: profile.etag ?? null,
  };
}

export function createChClient(options: ChClientOptions): ChClient {
  const { http, limiter } = options;
  const sleep = options.sleep ?? realSleep;
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString("base64")}`;
  let made = 0;

  /** Removes the key, in plain and encoded forms, from any text. */
  function scrub(text: string): string {
    let out = text;
    for (const secret of [
      options.apiKey,
      authorization,
      authorization.slice("Basic ".length),
    ]) {
      if (secret) out = out.split(secret).join("[redacted]");
    }
    return out;
  }

  async function send(path: string): Promise<HttpResponse> {
    await limiter.take();
    made += 1;
    try {
      return await http.get(`${CH_API_BASE}${path}`, {
        headers: { Authorization: authorization, Accept: "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(scrub(message));
    }
  }

  async function request(path: string): Promise<HttpResponse> {
    let response = await send(path);
    if (response.status === 429) {
      // `HttpFetcher` does not expose headers, so the reset time is not
      // known. Wait out a whole window, which always ends the block.
      await sleep(RATE_WINDOW_MS);
      response = await send(path);
      if (response.status === 429) throw new RateLimitedError();
    }
    return response;
  }

  async function getJson<T>(
    path: string,
    schema: { safeParse(v: unknown): { success: boolean; data?: T } },
    label: string,
    allowNotFound = false,
  ): Promise<T | null> {
    const response = await request(path);
    if (allowNotFound && response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw new ChApiError(response.status, label);
    }
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new Error(`Companies House ${label} returned invalid JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Companies House ${label} did not match the expected shape`,
      );
    }
    return parsed.data as T;
  }

  function requireNumber(companyNumber: string): string {
    const number = normaliseCompanyNumber(companyNumber);
    if (number === null) throw new Error("Invalid Companies House number");
    return number;
  }

  return {
    async searchCompanies(name) {
      const page = await getJson(
        `/search/companies?q=${encodeURIComponent(name)}&items_per_page=${SEARCH_PAGE_SIZE}`,
        chSearchResponseSchema,
        "search",
      );
      const hits: ChSearchHit[] = [];
      for (const item of page?.items ?? []) {
        const companyNumber = normaliseCompanyNumber(item.company_number);
        if (companyNumber === null) continue;
        hits.push({
          companyNumber,
          name: item.title,
          status: item.company_status ?? null,
          companyType: item.company_type ?? null,
          incorporatedOn: item.date_of_creation ?? null,
          ceasedOn: item.date_of_cessation ?? null,
          postcode: item.address?.postal_code?.trim() || null,
          locality: item.address?.locality ?? null,
        });
      }
      return hits;
    },

    async getCompany(companyNumber) {
      const number = requireNumber(companyNumber);
      const profile = await getJson(
        `/company/${number}`,
        chProfileSchema,
        "company profile",
        true,
      );
      return profile === null ? null : profileToFacts(profile);
    },

    /**
     * The list resource carries `action_date` and the capital figures on each
     * SH01 item (A35, verified by Task 049), so no per-item request is made.
     * SH19, SH10, SH02 and SH20 share the capital category and are dropped.
     */
    async getCapitalFilings(companyNumber, opts = {}) {
      const number = requireNumber(companyNumber);
      const filings: CapitalFiling[] = [];
      let start = 0;
      for (;;) {
        const page = await getJson(
          `/company/${number}/filing-history?category=capital&items_per_page=${FILING_PAGE_SIZE}&start_index=${start}`,
          chFilingHistorySchema,
          "filing history",
          true,
        );
        if (page === null || page.items.length === 0) break;
        let reachedSince = false;
        for (const item of page.items) {
          if (opts.since !== undefined && item.date < opts.since) {
            reachedSince = true;
            break;
          }
          if (item.type !== "SH01") continue;
          const documentId =
            item.links?.document_metadata?.split("/").pop() ?? null;
          filings.push({
            transactionId: item.transaction_id,
            type: item.type,
            filedOn: item.date,
            actionDate: item.action_date ?? null,
            capital: item.description_values?.capital ?? null,
            documentId: documentId || null,
          });
        }
        start += page.items.length;
        if (reachedSince || page.items.length < FILING_PAGE_SIZE) break;
        if (page.total_count !== undefined && start >= page.total_count) break;
      }
      filings.sort((a, b) => b.filedOn.localeCompare(a.filedOn));
      return filings;
    },

    async countActiveAtPostcode(postcode) {
      const parsed = parseUkPostcode(postcode);
      if (parsed === null) return null;
      const result = await getJson(
        `/advanced-search/companies?location=${encodeURIComponent(`${parsed.outcode} ${parsed.incode}`)}&company_status=active&size=1`,
        chAdvancedSearchSchema,
        "advanced search",
      );
      return result?.hits ?? null;
    },

    requestsMade: () => made,
  };
}
