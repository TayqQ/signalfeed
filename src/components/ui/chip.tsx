import Link from "next/link";
import type { ReactNode } from "react";

const CHIP =
  "inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-line px-2.5 py-0.5 text-xs font-medium";

/** A static label, for example a sector or theme. */
export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand";
}) {
  const colours =
    tone === "brand" ? "bg-brand-soft text-brand" : "bg-surface-sunk text-ink";
  return <span className={`${CHIP} ${colours}`}>{children}</span>;
}

/**
 * An applied filter. A link to the same page without the value, so removing it
 * works without JavaScript. `label` is the visible text, e.g. "Seed".
 */
export function FilterChip({
  label,
  removeHref,
}: {
  label: string;
  removeHref: string;
}) {
  return (
    <Link
      href={removeHref}
      aria-label={`Remove filter: ${label}`}
      className={`${CHIP} bg-brand-soft text-brand transition-colors duration-[120ms] ease-out hover:bg-surface-sunk motion-reduce:transition-none`}
    >
      {label}
      <svg
        viewBox="0 0 16 16"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </Link>
  );
}
