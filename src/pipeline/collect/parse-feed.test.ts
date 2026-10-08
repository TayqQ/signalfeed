import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFeed } from "./parse-feed";

const feedsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/feeds",
);

function readFeed(name: string): string {
  return readFileSync(join(feedsDir, name), "utf8");
}

describe("parseFeed", () => {
  it("parses RSS 2.0 items, keeping the guid and the raw link", () => {
    const items = parseFeed(readFeed("rss2-basic.xml"), "example-feed");

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      sourceSlug: "example-feed",
      externalId: "example-robotics-seed",
      url: "https://example.com/robotics?utm_source=rss&utm_medium=feed",
      title: "Example Robotics raises £4M seed",
      summary: "Example Robotics raised a seed round for warehouse robots.",
      publishedAt: new Date("2026-10-08T09:30:00.000Z"),
    });
  });

  it("falls back to the link when guid is missing and drops an invalid date", () => {
    const items = parseFeed(readFeed("rss2-basic.xml"), "example-feed");
    const second = items[1];

    expect(second).toMatchObject({
      externalId: "https://example.com/northwind-london",
      url: "https://example.com/northwind-london",
      title: "Northwind Labs opens a London office",
      summary: "No guid on this item.",
      publishedAt: null,
    });
  });

  it("strips HTML, decodes entities, and collapses whitespace", () => {
    const items = parseFeed(
      readFeed("rss2-html-description.xml"),
      "example-feed",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe(
      "Tom & Jerry <b>bold</b> raised £4M in a seed round.",
    );
    expect(items[0]?.summary).not.toContain("alert");
  });

  it("parses Atom entries, preferring alternate links and published dates", () => {
    const items = parseFeed(readFeed("atom-basic.xml"), "example-feed");

    expect(items).toEqual([
      {
        sourceSlug: "example-feed",
        externalId: "tag:example.com,2026:robotics-seed",
        url: "https://example.com/atom/robotics",
        title: "Example Robotics raises £4M seed",
        summary: "Synthetic summary for Example Robotics.",
        publishedAt: new Date("2026-10-08T09:30:00.000Z"),
      },
      {
        sourceSlug: "example-feed",
        externalId: "tag:example.com,2026:northwind",
        url: "https://example.com/atom/northwind",
        title: "Northwind Labs launches a warehouse pilot",
        summary: "Only content, no summary element.",
        publishedAt: new Date("2026-10-07T15:00:00.000Z"),
      },
    ]);
  });

  it("skips malformed items and keeps the others", () => {
    const items = parseFeed(readFeed("malformed-item.xml"), "example-feed");

    expect(items.map((item) => item.externalId)).toEqual([
      "kept-first",
      "kept-last",
    ]);
    expect(items[0]?.summary).toBe("Kept before the bad items.");
    expect(items[1]?.summary).toBe("Kept after the bad items.");
  });

  it("limits a summary to 1,000 characters", () => {
    const summary = `${"a".repeat(1000)}MORE`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
  <title>Long summary</title>
  <link>https://example.com/long</link>
  <description><![CDATA[${summary}]]></description>
</item></channel></rss>`;

    const items = parseFeed(xml, "example-feed");

    expect(items[0]?.summary).toHaveLength(1000);
    expect(items[0]?.summary?.endsWith("MORE")).toBe(false);
  });
});
