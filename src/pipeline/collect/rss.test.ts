import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceConfig } from "@/core/domain";
import type { HttpFetcher, HttpGetOptions } from "@/core/ports";
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
  it("matches the phase 1 source table", () => {
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

    const result = await createRssCollector(fetcher).collect(source, {
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

    const result = await createRssCollector(fetcher).collect(source, {
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
      createRssCollector(fetcher).collect(source, {
        etag: null,
        lastModified: null,
      }),
    ).rejects.toThrow(
      'Failed to fetch RSS feed "example-feed" from https://example.com/feed.xml: HTTP 503',
    );
  });
});
