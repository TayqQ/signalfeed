import Link from "next/link";
import { FilterChip } from "@/components/ui/chip";

export interface AppliedChip {
  id: string;
  label: string;
  /** The current URL without this value. */
  href: string;
}

/**
 * Every applied value as a removable chip, each a plain link, so it works
 * without JavaScript. "Clear all" appears once two or more are applied.
 */
export function AppliedChips({
  chips,
  clearHref,
}: {
  chips: readonly AppliedChip[];
  clearHref: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="sr-only">Applied filters</h2>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li key={chip.id}>
            <FilterChip label={chip.label} removeHref={chip.href} />
          </li>
        ))}
      </ul>
      {chips.length >= 2 ? (
        <Link
          href={clearHref}
          className="text-[13px] font-medium text-brand underline underline-offset-4"
        >
          Clear all
        </Link>
      ) : null}
    </div>
  );
}
