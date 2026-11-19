"use client";

import { useState, type ReactNode } from "react";
import { summaryCookie } from "@/lib/view-preference";

/**
 * The summary's open and closed state: a native `<details>`, so it works
 * without JavaScript, whose toggle is remembered in the `raisory_summary`
 * cookie. The server reads the cookie, so a closed summary paints closed.
 */
export function SummaryDisclosure({
  defaultOpen,
  headingId,
  title,
  subtitle,
  children,
}: {
  defaultOpen: boolean;
  headingId: string;
  title: string;
  /** The window it covers, shown beside the title. */
  subtitle: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        try {
          document.cookie = summaryCookie(next);
        } catch {
          // Cookies can be blocked; the choice then lasts for this page view.
        }
      }}
      className="group/summary rounded-[var(--radius-lg)] border border-line bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-[var(--radius-lg)] px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <h2
            id={headingId}
            className="font-display text-[20px] font-semibold text-ink"
          >
            {title}
          </h2>
          <span className="mt-0.5 block text-[13px] text-muted">
            {subtitle}
          </span>
        </span>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-muted">
          <span className="group-open/summary:hidden">Show</span>
          <span className="hidden group-open/summary:inline">Hide</span>
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="transition-transform duration-[200ms] ease-out group-open/summary:rotate-180 motion-reduce:transition-none"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </summary>
      <div className="border-t border-line px-4 pb-5 pt-4 sm:px-5">
        {children}
      </div>
    </details>
  );
}
