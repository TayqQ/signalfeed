import Link from "next/link";

export interface RankedBarItem {
  label: string;
  value: number;
  /** The text shown for the value, for example "£12.4M". */
  valueLabel: string;
  /** When set, the row is a link (for example, a list filter). */
  href?: string;
}

/** Bars ranked by value, each with its value as text. Bars are scaled to the largest value. */
export function RankedBars({ items }: { items: readonly RankedBarItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-muted">Nothing to show for this window.</p>
    );
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ol className="space-y-2">
      {items.map((item) => {
        const width = Math.max(2, Math.round((item.value / max) * 100));
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-ink">{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">
                {item.valueLabel}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="mt-1 block h-1.5 w-full rounded-full bg-surface-sunk"
            >
              <span
                data-testid="ranked-bar"
                className="block h-full rounded-full bg-data-1"
                style={{ width: `${width}%` }}
              />
            </span>
          </>
        );
        return (
          <li key={item.label}>
            {item.href !== undefined ? (
              <Link
                href={item.href}
                className="-mx-1 block rounded-[var(--radius-sm)] px-1 py-0.5 transition-colors duration-[120ms] hover:bg-surface-sunk motion-reduce:transition-none"
              >
                {body}
              </Link>
            ) : (
              <div className="py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
