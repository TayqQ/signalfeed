import packageJson from "../../package.json";
import type { HttpFetcher, HttpGetOptions, HttpResponse } from "@/core/ports";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKOFF_MS = 200;
const RETRIES = 2;

export interface FetchLike {
  (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Pick<Response, "headers" | "status" | "text">>;
}

export interface CreateHttpFetcherOptions {
  userAgent: string;
  /** Test double. Production uses the platform `fetch`. */
  fetch?: FetchLike;
  /** First retry waits this long; the second waits twice as long. Default 200ms. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function toHttpResponse(
  response: Pick<Response, "headers" | "status" | "text">,
): Promise<HttpResponse> {
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  if (response.status === 304) {
    return { status: 304, body: "", etag, lastModified };
  }
  return {
    status: response.status,
    body: await response.text(),
    etag,
    lastModified,
  };
}

function requestHeaders(userAgent: string, options: HttpGetOptions): Headers {
  const headers = new Headers(options.headers);
  if (options.etag) headers.set("if-none-match", options.etag);
  if (options.lastModified)
    headers.set("if-modified-since", options.lastModified);
  headers.set("user-agent", userAgent);
  return headers;
}

/**
 * `HttpFetcher` over platform `fetch`.
 * Sends conditional headers, aborts after 15s by default, and retries twice
 * with exponential backoff on HTTP 5xx and network errors. 4xx is not retried.
 * A 304 is returned with an empty body.
 */
export function createHttpFetcher(
  options: CreateHttpFetcherOptions,
): HttpFetcher {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = options.sleep ?? delay;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  return {
    async get(
      url: string,
      getOptions: HttpGetOptions = {},
    ): Promise<HttpResponse> {
      const timeoutMs = getOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let lastError: unknown;
      for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
        try {
          const response = await fetchImpl(url, {
            headers: requestHeaders(options.userAgent, getOptions),
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (response.status >= 500 && attempt < RETRIES) {
            await sleep(backoffMs * 2 ** attempt);
            continue;
          }
          return await toHttpResponse(response);
        } catch (error) {
          lastError = error;
          if (attempt >= RETRIES) throw error;
          await sleep(backoffMs * 2 ** attempt);
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("HTTP request failed");
    },
  };
}

/** `SignalFeed/<version> (+<contact>)`, using the package version. */
export function buildUserAgent(contact: string): string {
  return `SignalFeed/${packageJson.version} (+${contact})`;
}
