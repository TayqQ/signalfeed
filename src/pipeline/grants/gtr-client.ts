import type { z } from "zod";
import type { HttpFetcher } from "@/core/ports";
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
const RETRY_WAIT_MS = 10_000;
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
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Adapter over `HttpFetcher`. It waits 1 second between requests, asks for
 * JSON, and retries once, after 10 seconds, on HTTP 429 or 5xx.
 * It has no method for people, so person endpoints cannot be requested.
 */
export function createGtrClient(options: GtrClientOptions): GtrClient {
  const sleep = options.sleep ?? realSleep;
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
    let response = await request();
    if (response.status === 429 || response.status >= 500) {
      await sleep(RETRY_WAIT_MS);
      response = await request();
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GtR ${label} failed: HTTP ${response.status}`);
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
