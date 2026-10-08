import type { HttpFetcher, Collector } from "@/core/ports";
import { parseFeed } from "./parse-feed";

/** RSS/Atom collector. URLs are returned raw; the store canonicalises them. */
export function createRssCollector(fetcher: HttpFetcher): Collector {
  return {
    async collect(source, state) {
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
