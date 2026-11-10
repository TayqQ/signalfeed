import Link from "next/link";
import type { FundingFilters } from "@/core/read-models";
import { serialiseFundingFilters } from "@/lib/funding-filters";

export function Pagination({
  filters,
  total,
  page,
  pageSize,
}: {
  filters: FundingFilters;
  total: number;
  page: number;
  pageSize: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = serialiseFundingFilters({ ...filters, page: target });
    return query ? `/?${query}` : "/";
  };
  const linkClass = "underline underline-offset-4 hover:text-signal";
  return (
    <nav
      aria-label="Pages"
      className="mt-4 flex items-center justify-between text-sm text-quiet"
    >
      {page > 1 ? (
        <Link rel="prev" href={href(page - 1)} className={linkClass}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link rel="next" href={href(page + 1)} className={linkClass}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
