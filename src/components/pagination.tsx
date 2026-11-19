import Link from "next/link";
import type { FundingFilters } from "@/core/read-models";
import { buttonClasses } from "@/components/ui/button";
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
  const linkClass = buttonClasses("secondary", "sm");
  return (
    <nav
      aria-label="Pages"
      className="mt-6 flex items-center justify-between gap-3 text-[13px] text-muted"
    >
      {page > 1 ? (
        <Link rel="prev" href={href(page - 1)} className={linkClass}>
          <span aria-hidden="true">←</span> Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="tabular-nums">
        Page {page.toLocaleString("en-GB")} of {pages.toLocaleString("en-GB")}
      </span>
      {page < pages ? (
        <Link rel="next" href={href(page + 1)} className={linkClass}>
          Next <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
