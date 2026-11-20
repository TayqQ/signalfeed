import { describe, expect, it } from "vitest";
import type { HttpFetcher } from "@/core/ports";
import {
  createRobotsChecker,
  isPathAllowed,
  MAX_CRAWL_DELAY_MS,
  parseRobots,
} from "./robots";

// Rules for the news hosts. Tech.eu and UKTN are the lines found on
// 20 November 2026 (task 087). The EU-Startups text is the usual WordPress
// block, written here as a representative fixture: it does not mention feeds.
const TECH_EU = `User-agent: *
Disallow: /feed/
`;
const UKTN = `User-agent: *
Disallow: /feed
`;
const EU_STARTUPS = `User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
`;

function allowed(text: string, path: string): boolean {
  return isPathAllowed(parseRobots(text), path);
}

describe("parseRobots on the news hosts", () => {
  it("disallows Tech.eu's /feed/ for SignalFeed", () => {
    expect(allowed(TECH_EU, "/feed/")).toBe(false);
    expect(allowed(TECH_EU, "/feed/?paged=2")).toBe(false);
    expect(allowed(TECH_EU, "/news/some-article")).toBe(true);
  });

  it("disallows UKTN's /feed (and /feed/)", () => {
    expect(allowed(UKTN, "/feed/")).toBe(false);
    expect(allowed(UKTN, "/feed")).toBe(false);
    expect(allowed(UKTN, "/news/x")).toBe(true);
  });

  it("allows EU-Startups' feed", () => {
    expect(allowed(EU_STARTUPS, "/feed/")).toBe(true);
    expect(allowed(EU_STARTUPS, "/wp-admin/options.php")).toBe(false);
    expect(allowed(EU_STARTUPS, "/wp-admin/admin-ajax.php")).toBe(true);
  });
});

describe("parseRobots matching", () => {
  it("lets a specific SignalFeed group override *", () => {
    const text = `User-agent: *
Disallow: /feed/

User-agent: SignalFeed
Allow: /feed/
`;
    expect(allowed(text, "/feed/")).toBe(true);
  });

  it("matches tokens case-insensitively and knows Raisory", () => {
    const text = `User-agent: signalfeed
Disallow: /a/

User-agent: RAISORY
Disallow: /b/

User-agent: *
Disallow: /
`;
    expect(allowed(text, "/a/x")).toBe(false);
    expect(allowed(text, "/b/x")).toBe(false);
    expect(allowed(text, "/c")).toBe(true);
  });

  it("falls back to * and ignores other bots' groups", () => {
    const text = `User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /private/
`;
    expect(allowed(text, "/news")).toBe(true);
    expect(allowed(text, "/private/x")).toBe(false);
  });

  it("shares one group across consecutive user-agent lines", () => {
    const text = `User-agent: Other
User-agent: SignalFeed
Disallow: /x
`;
    expect(allowed(text, "/x")).toBe(false);
  });

  it("merges several groups that name us", () => {
    const text = `User-agent: SignalFeed
Disallow: /a

User-agent: Raisory
Disallow: /b
`;
    expect(allowed(text, "/a")).toBe(false);
    expect(allowed(text, "/b")).toBe(false);
  });

  it("supports * and $ wildcards", () => {
    const text = `User-agent: *
Disallow: /*.json$
Disallow: /tmp*/cache
`;
    expect(allowed(text, "/data/x.json")).toBe(false);
    expect(allowed(text, "/data/x.json?v=1")).toBe(true);
    expect(allowed(text, "/data/x.jsonp")).toBe(true);
    expect(allowed(text, "/tmp123/cache")).toBe(false);
    expect(allowed(text, "/other/cache")).toBe(true);
  });

  it("uses the longest match", () => {
    const text = `User-agent: *
Disallow: /feed/
Allow: /feed/public/
`;
    expect(allowed(text, "/feed/private")).toBe(false);
    expect(allowed(text, "/feed/public/a")).toBe(true);
  });

  it("gives a tie to Allow, whatever the order", () => {
    expect(
      allowed("User-agent: *\nDisallow: /feed/\nAllow: /feed/", "/feed/"),
    ).toBe(true);
    expect(
      allowed("User-agent: *\nAllow: /feed/\nDisallow: /feed/", "/feed/"),
    ).toBe(true);
  });

  it("treats an empty Disallow as allow-all and ignores comments", () => {
    const text = `# hello
User-agent: * # everyone
Disallow: # nothing
`;
    expect(allowed(text, "/anything")).toBe(true);
  });

  it("has no rules without a matching group", () => {
    expect(allowed("", "/feed/")).toBe(true);
    expect(allowed("User-agent: Other\nDisallow: /", "/feed/")).toBe(true);
  });

  it("compares percent escapes case-insensitively", () => {
    expect(allowed("User-agent: *\nDisallow: /a%2fb", "/a%2Fb")).toBe(false);
  });
});

describe("parseRobots Crawl-delay", () => {
  it("exposes the delay of the matched group", () => {
    const text = `User-agent: *
Crawl-delay: 10

User-agent: SignalFeed
Crawl-delay: 2.5
`;
    expect(parseRobots(text).crawlDelaySeconds).toBe(2.5);
    expect(
      parseRobots("User-agent: *\nCrawl-delay: 10").crawlDelaySeconds,
    ).toBe(10);
    expect(
      parseRobots("User-agent: *\nDisallow: /x").crawlDelaySeconds,
    ).toBeNull();
    expect(
      parseRobots("User-agent: *\nCrawl-delay: soon").crawlDelaySeconds,
    ).toBeNull();
  });
});

function fakeFetcher(
  handler: (url: string) => { status: number; body: string } | Error,
  asked: string[],
): HttpFetcher {
  return {
    get(url) {
      asked.push(url);
      const answer = handler(url);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ ...answer, etag: null, lastModified: null });
    },
  };
}

describe("createRobotsChecker", () => {
  it("requests /robots.txt once per host and caches for 24 hours", async () => {
    const asked: string[] = [];
    let now = 0;
    const checker = createRobotsChecker({
      fetcher: fakeFetcher(
        () => ({ status: 200, body: "User-agent: *\nDisallow: /feed/" }),
        asked,
      ),
      now: () => now,
    });
    expect((await checker.check("https://tech.eu/feed/")).allowed).toBe(false);
    expect((await checker.check("https://tech.eu/news")).allowed).toBe(true);
    expect(asked).toEqual(["https://tech.eu/robots.txt"]);

    now = 23 * 60 * 60 * 1000;
    await checker.check("https://tech.eu/news");
    expect(asked).toHaveLength(1);

    now = 25 * 60 * 60 * 1000;
    await checker.check("https://tech.eu/news");
    expect(asked).toHaveLength(2);

    await checker.check("https://www.eu-startups.com/feed/");
    expect(asked).toContain("https://www.eu-startups.com/robots.txt");
  });

  it("allows everything when robots.txt is missing (404, 410)", async () => {
    for (const status of [404, 410]) {
      const checker = createRobotsChecker({
        fetcher: fakeFetcher(() => ({ status, body: "Disallow: /" }), []),
      });
      expect((await checker.check("https://a.example/feed")).allowed).toBe(
        true,
      );
    }
  });

  it("disallows the host when robots.txt is refused (401, 403, 429)", async () => {
    for (const status of [401, 403, 429]) {
      const checker = createRobotsChecker({
        fetcher: fakeFetcher(() => ({ status, body: "" }), []),
      });
      expect(await checker.check("https://tech.eu/feed/")).toEqual({
        allowed: false,
        reason: "unavailable",
      });
    }
  });

  it("disallows the host on 5xx, network errors and timeouts", async () => {
    const cases = [
      { status: 500, body: "" },
      { status: 503, body: "" },
      new Error("network down"),
      new Error("The operation was aborted due to timeout"),
    ];
    for (const answer of cases) {
      const checker = createRobotsChecker({
        fetcher: fakeFetcher(() => answer, []),
      });
      expect(await checker.check("https://a.example/feed")).toEqual({
        allowed: false,
        reason: "unavailable",
      });
    }
  });

  it("reports a disallowed path as disallowed", async () => {
    const checker = createRobotsChecker({
      fetcher: fakeFetcher(
        () => ({ status: 200, body: "User-agent: *\nDisallow: /feed" }),
        [],
      ),
    });
    expect(await checker.check("https://www.uktech.news/feed/")).toEqual({
      allowed: false,
      reason: "disallowed",
    });
  });

  it("spaces requests to one host by Crawl-delay", async () => {
    const sleeps: number[] = [];
    let now = 1_000_000;
    const checker = createRobotsChecker({
      fetcher: fakeFetcher(
        () => ({ status: 200, body: "User-agent: *\nCrawl-delay: 5" }),
        [],
      ),
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await checker.beforeFetch("https://a.example/one");
    expect(sleeps).toEqual([]);
    now += 1_000;
    await checker.beforeFetch("https://a.example/two");
    expect(sleeps).toEqual([4_000]);
    await checker.beforeFetch("https://b.example/one");
    expect(sleeps).toEqual([4_000]);
  });

  it("caps a huge Crawl-delay", async () => {
    const checker = createRobotsChecker({
      fetcher: fakeFetcher(
        () => ({ status: 200, body: "User-agent: *\nCrawl-delay: 3600" }),
        [],
      ),
    });
    expect(await checker.check("https://a.example/x")).toEqual({
      allowed: true,
      crawlDelayMs: MAX_CRAWL_DELAY_MS,
    });
  });

  it("never waits for a disallowed URL", async () => {
    const sleeps: number[] = [];
    const checker = createRobotsChecker({
      fetcher: fakeFetcher(
        () => ({ status: 200, body: "User-agent: *\nDisallow: /feed/" }),
        [],
      ),
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect((await checker.beforeFetch("https://a.example/feed/")).allowed).toBe(
      false,
    );
    expect(sleeps).toEqual([]);
  });
});
