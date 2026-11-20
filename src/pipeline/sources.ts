import type { SourceConfig } from "@/core/domain";

/**
 * Phase 1 RSS sources from the final table in `docs/sources.md`.
 * Sifted stays disabled: its feed has no summary, and its terms conflict
 * with sending text to an LLM.
 */
export const SOURCES: SourceConfig[] = [
  {
    // robots.txt: checked every run (D68); not known to disallow this feed.
    slug: "techcrunch-venture",
    name: "TechCrunch Venture",
    kind: "rss",
    url: "https://techcrunch.com/category/venture/feed/",
    priority: 9,
    enabled: true,
  },
  {
    // robots.txt: checked every run (D68); not known to disallow this feed.
    slug: "crunchbase-news",
    name: "Crunchbase News",
    kind: "rss",
    url: "https://news.crunchbase.com/feed/",
    priority: 8,
    enabled: true,
  },
  {
    // robots.txt: disallows /feed/ for all agents (20 Nov 2026), so the reader
    // skips it (D68) until Tech.eu gives permission. Permission asked.
    slug: "tech-eu",
    name: "Tech.eu",
    kind: "rss",
    url: "https://tech.eu/feed/",
    priority: 8,
    enabled: true,
  },
  {
    // robots.txt: allows the feed (20 Nov 2026).
    slug: "eu-startups",
    name: "EU-Startups",
    kind: "rss",
    url: "https://www.eu-startups.com/feed/",
    priority: 7,
    enabled: true,
  },
  {
    // robots.txt: disallows /feed for all agents (20 Nov 2026), so the reader
    // skips it (D68) until UKTN gives permission. Permission asked.
    slug: "uktech-news",
    name: "UKTN",
    kind: "rss",
    url: "https://www.uktech.news/feed/",
    priority: 7,
    enabled: true,
  },
  {
    // Disabled, so never fetched and never checked.
    slug: "sifted",
    name: "Sifted",
    kind: "rss",
    url: "https://sifted.eu/feed",
    priority: 6,
    enabled: false,
  },
];

/**
 * Sources that report on companies from one country only (D62). A report
 * from one of these is a hint for registry searches, never a stated country:
 * it is not written to `companies.country_code`. UKTN covers UK tech. No
 * source is US-only: TechCrunch and Crunchbase News report worldwide.
 * Review this list when a source is added.
 */
export const SOURCE_COUNTRY_HINTS: Readonly<Record<string, "GB" | "US">> = {
  "uktech-news": "GB",
};
