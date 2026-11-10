import Link from "next/link";
import type { TagRef } from "@/core/read-models";

export function TagList({ tags }: { tags: TagRef[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Themes">
      {tags.map((tag) => (
        <li key={tag.slug}>
          <Link
            href={`/?tag=${encodeURIComponent(tag.slug)}`}
            className="border border-zinc-300 px-2 py-0.5 hover:border-signal hover:text-signal"
          >
            {tag.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
