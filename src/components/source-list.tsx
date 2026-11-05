import type { EventSourceLink } from "@/core/read-models";
import { formatDate } from "@/lib/format";

export function SourceList({ sources }: { sources: EventSourceLink[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm text-quiet">
      {sources.map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            rel="noopener"
            className="text-ink underline underline-offset-4 hover:text-signal"
          >
            {source.title}
          </a>
          , {source.sourceName}
          {source.publishedAt ? `, ${formatDate(source.publishedAt)}` : ""}
        </li>
      ))}
    </ul>
  );
}
