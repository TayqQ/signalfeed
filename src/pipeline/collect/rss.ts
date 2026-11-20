import type { HttpFetcher, Collector } from "@/core/ports";
import { RobotsSkipError, type RobotsChecker } from "@/lib/robots";
import { parseFeed } from "./parse-feed";

/**
 * RSS/Atom collector. URLs are returned raw; the store canonicalises them.
 * The feed URL is checked against the host's robots.txt first (D68). A
 * disallowed feed, or a host whose robots.txt could not be read, throws
 * `RobotsSkipError` before any request to the feed.
 */
export function createRssCollector(
  fetcher: HttpFetcher,
  robots: RobotsChecker,
): Collector {
  return {
    async collect(source, state) {
      const decision = await robots.beforeFetch(source.url);
      if (!decision.allowed) {
        throw new RobotsSkipError(source.url, decision.reason);
      }
      const response = await fetcher.get(source.url, {
        etag: state.etag,
        lastModified: state.lastModified,
      });

      if (response.status === 304) {
        return {
          items: [],
          etag: response.etag,
          lastModified: response.lastModified,
          notModified: true,
        };
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Failed to fetch RSS feed "${source.slug}" from ${source.url}: HTTP ${response.status}`,
        );
      }

      return {
        items: parseFeed(response.body, source.slug),
        etag: response.etag,
        lastModified: response.lastModified,
        notModified: false,
      };
    },
  };
}
