import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceConfig } from "@/core/domain";
import type { HttpFetcher, HttpGetOptions } from "@/core/ports";
import { createRobotsChecker, RobotsSkipError } from "@/lib/robots";
import { SOURCES } from "@/pipeline/sources";
import { createRssCollector } from "./rss";

const feedsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/feeds",
);

function readFeed(name: string): string {
  return readFileSync(join(feedsDir, name), "utf8");
}

const source: SourceConfig = {
  slug: "example-feed",
  name: "Example Feed",
  kind: "rss",
  url: "https://example.com/feed.xml",
  priority: 1,
  enabled: true,
};

describe("SOURCES", () => {
  it("matches the source table", () => {
    expect(SOURCES).toEqual([
      {
        slug: "techcrunch-venture",
        name: "TechCrunch Venture",
        kind: "rss",
        url: "https://techcrunch.com/category/venture/feed/",
        priority: 9,
        enabled: true,
      },
      {
        slug: "crunchbase-news",
        name: "Crunchbase News",
        kind: "rss",
        url: "https://news.crunchbase.com/feed/",
        priority: 8,
        enabled: true,
      },
      {
        slug: "tech-eu",
        name: "Tech.eu",
        kind: "rss",
        url: "https://tech.eu/feed/",
        priority: 8,
        enabled: true,
      },
      {
        slug: "eu-startups",
        name: "EU-Startups",
        kind: "rss",
        url: "https://www.eu-startups.com/feed/",
        priority: 7,
        enabled: true,
      },
      {
        slug: "uktech-news",
        name: "UKTN",
        kind: "rss",
        url: "https://www.uktech.news/feed/",
        priority: 7,
        enabled: true,
      },
      {
        slug: "tech-funding-news",
        name: "Tech Funding News",
        kind: "rss",
        url: "https://techfundingnews.com/category/funding/feed/",
        priority: 8,
        enabled: true,
      },
      {
        slug: "the-recursive",
        name: "The Recursive",
        kind: "rss",
        url: "https://www.therecursive.com/rss/",
        priority: 6,
        enabled: true,
      },
      {
        slug: "businesscloud",
        name: "BusinessCloud",
        kind: "rss",
        url: "https://businesscloud.co.uk/feed/",
        priority: 6,
        enabled: true,
      },
      {
        slug: "silicon-republic",
        name: "Silicon Republic",
        kind: "rss",
        url: "https://www.siliconrepublic.com/feed/",
        priority: 6,
        enabled: true,
      },
      {
        slug: "sifted",
        name: "Sifted",
        kind: "rss",
        url: "https://sifted.eu/feed",
        priority: 6,
        enabled: false,
      },
    ]);
  });

  it("gives every entry a unique slug and a valid URL", () => {
    const slugs = SOURCES.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const entry of SOURCES) {
      const url = new URL(entry.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.length).toBeGreaterThan(0);
    }
  });
});

/** A robots checker over fake robots.txt answers; `null` throws like a network error. */
function robotsFor(
  answers: Record<string, { status: number; body: string } | null>,
  asked: string[] = [],
) {
  return createRobotsChecker({
    fetcher: {
      get(url) {
        asked.push(url);
        const answer = answers[new URL(url).origin];
        if (!answer) return Promise.reject(new Error("network down"));
        return Promise.resolve({ ...answer, etag: null, lastModified: null });
      },
    },
  });
}

const allowAll = robotsFor({
  "https://example.com": { status: 404, body: "" },
});

describe("createRssCollector", () => {
  it("sends conditional validators and returns the response validators", async () => {
    let seenUrl = "";
    let seenOptions: HttpGetOptions | undefined;
    const fetcher: HttpFetcher = {
      get(url, options) {
        seenUrl = url;
        seenOptions = options;
        return Promise.resolve({
          status: 200,
          body: readFeed("rss2-basic.xml"),
          etag: "new-etag",
          lastModified: "Thu, 08 Oct 2026 10:00:00 GMT",
        });
      },
    };

    const result = await createRssCollector(fetcher, allowAll).collect(source, {
      etag: "old-etag",
      lastModified: "Wed, 07 Oct 2026 10:00:00 GMT",
    });

    expect(seenUrl).toBe(source.url);
    expect(seenOptions).toEqual({
      etag: "old-etag",
      lastModified: "Wed, 07 Oct 2026 10:00:00 GMT",
    });
    expect(result.notModified).toBe(false);
    expect(result.etag).toBe("new-etag");
    expect(result.lastModified).toBe("Thu, 08 Oct 2026 10:00:00 GMT");
    expect(result.items[0]?.url).toBe(
      "https://example.com/robotics?utm_source=rss&utm_medium=feed",
    );
  });

  it("returns no items when the feed is not modified", async () => {
    const fetcher: HttpFetcher = {
      get() {
        return Promise.resolve({
          status: 304,
          body: readFeed("rss2-basic.xml"),
          etag: "etag-1",
          lastModified: "Thu, 08 Oct 2026 09:30:00 GMT",
        });
      },
    };

    const result = await createRssCollector(fetcher, allowAll).collect(source, {
      etag: "etag-1",
      lastModified: "Wed, 07 Oct 2026 09:30:00 GMT",
    });

    expect(result).toEqual({
      items: [],
      etag: "etag-1",
      lastModified: "Thu, 08 Oct 2026 09:30:00 GMT",
      notModified: true,
    });
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    const fetcher: HttpFetcher = {
      get() {
        return Promise.resolve({
          status: 503,
          body: "",
          etag: null,
          lastModified: null,
        });
      },
    };

    await expect(
      createRssCollector(fetcher, allowAll).collect(source, {
        etag: null,
        lastModified: null,
      }),
    ).rejects.toThrow(
      'Failed to fetch RSS feed "example-feed" from https://example.com/feed.xml: HTTP 503',
    );
  });
});

describe("createRssCollector and robots.txt", () => {
  const techEu: SourceConfig = {
    ...source,
    slug: "tech-eu",
    url: "https://tech.eu/feed/",
  };

  function countingFeedFetcher(urls: string[]): HttpFetcher {
    return {
      get(url) {
        urls.push(url);
        return Promise.resolve({
          status: 200,
          body: readFeed("rss2-basic.xml"),
          etag: null,
          lastModified: null,
        });
      },
    };
  }

  it("skips a disallowed feed without ever requesting it", async () => {
    const feedUrls: string[] = [];
    const robots = robotsFor({
      "https://tech.eu": {
        status: 200,
        body: "User-agent: *\nDisallow: /feed/\n",
      },
    });
    const error = await createRssCollector(
      countingFeedFetcher(feedUrls),
      robots,
    )
      .collect(techEu, { etag: null, lastModified: null })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RobotsSkipError);
    expect((error as RobotsSkipError).reason).toBe("disallowed");
    expect(feedUrls).toEqual([]);
  });

  it("fetches the feed when robots.txt is 404 (no rules)", async () => {
    const feedUrls: string[] = [];
    const robots = robotsFor({ "https://tech.eu": { status: 404, body: "" } });
    const result = await createRssCollector(
      countingFeedFetcher(feedUrls),
      robots,
    ).collect(techEu, { etag: null, lastModified: null });
    expect(feedUrls).toEqual(["https://tech.eu/feed/"]);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("skips the host for this run when robots.txt is 503", async () => {
    const feedUrls: string[] = [];
    const robots = robotsFor({ "https://tech.eu": { status: 503, body: "" } });
    const error = await createRssCollector(
      countingFeedFetcher(feedUrls),
      robots,
    )
      .collect(techEu, { etag: null, lastModified: null })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RobotsSkipError);
    expect((error as RobotsSkipError).reason).toBe("unavailable");
    expect(feedUrls).toEqual([]);
  });

  it("skips the host when the robots.txt request fails", async () => {
    const robots = robotsFor({ "https://tech.eu": null });
    await expect(
      createRssCollector(countingFeedFetcher([]), robots).collect(techEu, {
        etag: null,
        lastModified: null,
      }),
    ).rejects.toBeInstanceOf(RobotsSkipError);
  });
});
