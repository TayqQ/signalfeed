import type { z } from "zod";
import type { HttpFetcher, HttpResponse } from "@/core/ports";
import {
  gtrOrganisationSchema,
  gtrProjectsPageSchema,
  type GtrOrganisation,
  type GtrProjectsPage,
} from "./gtr-schemas";

/** The only place the API address lives. A move to the new API changes this file. */
export const GTR_API_BASE = "https://gtr.ukri.org/gtr/api/";

/** The most Gateway to Research lets us ask for in one page. */
export const GTR_PAGE_SIZE = 100;

const MIN_GAP_MS = 1_000;
/** Waits before retry 1 to 4. About 2, 5, 15 and 30 seconds, before jitter. */
export const GTR_RETRY_WAITS_MS: readonly number[] = [
  2_000, 5_000, 15_000, 30_000,
];
const JITTER = 0.25;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const ORGANISATION_ID = /^[0-9A-Za-z-]+$/;

export interface GtrClient {
  /** Innovate UK projects, newest start first. `page` starts at 1. */
  listInnovateUkProjects(page: number): Promise<GtrProjectsPage>;
  getOrganisation(id: string): Promise<GtrOrganisation>;
}

export interface GtrClientOptions {
  http: HttpFetcher;
  /** Test double. Production waits for real. */
  sleep?: (ms: number) => Promise<void>;
  /** Test double for jitter. Returns a number from 0 up to 1. */
  random?: () => number;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adapter over `HttpFetcher`. It waits 1 second between requests and asks for
 * JSON. It retries transient failures (HTTP 429, 500, 502, 503, 504 and
 * network errors or timeouts) up to 4 times, waiting about 2, 5, 15 and 30
 * seconds with jitter. Other 4xx answers are not retried.
 * `HttpResponse` does not expose `Retry-After`, so it is not honoured.
 * It has no method for people, so person endpoints cannot be requested.
 */
export function createGtrClient(options: GtrClientOptions): GtrClient {
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  let requested = false;

  async function getJson<T>(
    path: string,
    schema: z.ZodType<T>,
    label: string,
  ): Promise<T> {
    const url = `${GTR_API_BASE}${path}`;
    if (requested) await sleep(MIN_GAP_MS);
    requested = true;

    const request = () =>
      options.http.get(url, { headers: { Accept: "application/json" } });
    let response: HttpResponse | undefined;
    let failure = "";
    for (let attempt = 0; ; attempt += 1) {
      let transient: boolean;
      try {
        response = await request();
        transient = TRANSIENT_STATUSES.has(response.status);
        failure = `HTTP ${response.status}`;
      } catch (error) {
        response = undefined;
        transient = true;
        failure = errorText(error);
      }
      if (!transient) break;
      const base = GTR_RETRY_WAITS_MS[attempt];
      if (base === undefined) break;
      await sleep(Math.round(base * (1 + JITTER * (random() * 2 - 1))));
    }
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error(`GtR ${label} failed: ${failure}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new Error(`GtR ${label} returned invalid JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `GtR ${label} did not match the expected shape: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  return {
    listInnovateUkProjects(page) {
      if (!Number.isInteger(page) || page < 1) {
        throw new Error(`Invalid GtR page number: ${page}`);
      }
      const query = [
        `q=${encodeURIComponent("Innovate UK")}`,
        "f=pro.lf",
        "sf=pro.sd",
        "so=D",
        `s=${GTR_PAGE_SIZE}`,
        `p=${page}`,
      ].join("&");
      return getJson(
        `projects.json?${query}`,
        gtrProjectsPageSchema,
        `projects page ${page}`,
      );
    },
    getOrganisation(id) {
      if (!ORGANISATION_ID.test(id)) {
        throw new Error("Invalid GtR organisation id");
      }
      return getJson(
        `organisations/${id}`,
        gtrOrganisationSchema,
        "organisation",
      );
    },
  };
}
