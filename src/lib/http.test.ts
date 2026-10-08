import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { buildUserAgent, createHttpFetcher, type FetchLike } from "./http";

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Pick<Response, "headers" | "status" | "text"> {
  return {
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
  };
}

describe("buildUserAgent", () => {
  it("includes the package version and contact", () => {
    expect(buildUserAgent("https://example.com/about")).toBe(
      `SignalFeed/${packageJson.version} (+https://example.com/about)`,
    );
  });
});

describe("createHttpFetcher", () => {
  it("sends conditional headers and the user agent", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: FetchLike = (input, init) => {
      calls.push({ url: requestUrl(input), init });
      return Promise.resolve(
        response(200, "feed", {
          etag: '"abc"',
          "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
        }),
      );
    };
    const fetcher = createHttpFetcher({
      userAgent: "SignalFeed/test",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
    });

    const result = await fetcher.get("https://example.com/feed.xml", {
      etag: '"abc"',
      lastModified: "Tue, 20 Oct 2015 07:28:00 GMT",
    });

    expect(result).toEqual({
      status: 200,
      body: "feed",
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("user-agent")).toBe("SignalFeed/test");
    expect(headers.get("if-none-match")).toBe('"abc"');
    expect(headers.get("if-modified-since")).toBe(
      "Tue, 20 Oct 2015 07:28:00 GMT",
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries twice on 5xx with exponential backoff, then returns the last response", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return Promise.resolve(response(503, `down-${calls}`));
    };
    const fetcher = createHttpFetcher({
      userAgent: "test",
      fetch: fetchImpl,
      backoffMs: 100,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(fetcher.get("https://example.com/feed.xml")).resolves.toEqual({
      status: 503,
      body: "down-3",
      etag: null,
      lastModified: null,
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("retries network errors and then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      if (calls < 3) return Promise.reject(new TypeError("network down"));
      return Promise.resolve(response(200, "ok"));
    };
    const fetcher = createHttpFetcher({
      userAgent: "test",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
    });

    await expect(
      fetcher.get("https://example.com/feed.xml"),
    ).resolves.toMatchObject({
      status: 200,
      body: "ok",
    });
    expect(calls).toBe(3);
  });

  it("does not retry a 404", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return Promise.resolve(response(404, "missing"));
    };
    const fetcher = createHttpFetcher({
      userAgent: "test",
      fetch: fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(
      fetcher.get("https://example.com/missing"),
    ).resolves.toMatchObject({
      status: 404,
      body: "missing",
    });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("returns a 304 with an empty body", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        response(304, "should be ignored", {
          etag: '"same"',
          "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
        }),
      );
    const fetcher = createHttpFetcher({
      userAgent: "test",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
    });

    await expect(fetcher.get("https://example.com/feed.xml")).resolves.toEqual({
      status: 304,
      body: "",
      etag: '"same"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });
  });

  it("aborts with AbortSignal.timeout and retries the timeout", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        calls += 1;
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing timeout signal"));
          return;
        }
        const onAbort = () => {
          reject(new Error("aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    const fetcher = createHttpFetcher({
      userAgent: "test",
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
    });

    await expect(
      fetcher.get("https://example.com/slow", { timeoutMs: 30 }),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });
});
