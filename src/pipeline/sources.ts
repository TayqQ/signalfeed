import type { SourceConfig } from "@/core/domain";

/**
 * Phase 1 RSS sources from the final table in `docs/sources.md`.
 * Sifted stays disabled: its feed has no summary, and its terms conflict
 * with sending text to an LLM.
 */
export const SOURCES: SourceConfig[] = [
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
];
