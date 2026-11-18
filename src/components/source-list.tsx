import type { CompanyEvent, EventSourceLink } from "@/core/read-models";
import { formatDate } from "@/lib/format";

/** Every article behind the company's events, once each, newest first. */
export function companySources(
  events: readonly CompanyEvent[],
): EventSourceLink[] {
  const byUrl = new Map<string, EventSourceLink>();
  for (const event of events) {
    for (const source of event.sources) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
    }
  }
  return [...byUrl.values()].sort((a, b) => {
    if (a.publishedAt === b.publishedAt) return a.title.localeCompare(b.title);
    if (a.publishedAt === null) return 1;
    if (b.publishedAt === null) return -1;
    return a.publishedAt < b.publishedAt ? 1 : -1;
  });
}

/** Headlines linked to the original articles, with outlet and date. Never article text. */
export function SourceList({ sources }: { sources: EventSourceLink[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        No news articles yet. Rounds from official records have no article.
      </p>
    );
  }
  return (
    <ul className="space-y-3 text-[13px]">
      {sources.map((source) => (
        <li key={source.url} className="min-w-0">
          <span className="font-medium text-ink">{source.sourceName}</span>
          {source.publishedAt ? (
            <span className="text-muted">
              {" "}
              · {formatDate(source.publishedAt)}
            </span>
          ) : null}
          <a
            href={source.url}
            rel="noopener"
            className="mt-0.5 block break-words text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {source.title}
          </a>
        </li>
      ))}
    </ul>
  );
}
