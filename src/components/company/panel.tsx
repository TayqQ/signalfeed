import type { ReactNode } from "react";

/**
 * A company page section: a hairline panel with a heading. `headingId` names
 * the section, so it must be unique on the page (the phone and desktop copies
 * of the side column pass different ids).
 */
export function CompanyPanel({
  title,
  headingId,
  aside,
  children,
}: {
  title: ReactNode;
  headingId: string;
  /** Shown on the heading's right, for example the round date. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-[var(--radius)] border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={headingId}
          className="font-display text-[17px] font-semibold text-ink"
        >
          {title}
        </h2>
        {aside ? (
          <div className="shrink-0 text-[13px] text-muted">{aside}</div>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
