import Link from "next/link";
import { GlobalSearch } from "./global-search";
import { RaisoryMark } from "./icons";

/**
 * Across the top of the content column, sticky: the logo mark on phones (the
 * sidebar has it from 768 px), then global search, which fills the rest of
 * the bar on phones.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface px-4 md:h-14 md:gap-3 md:px-6">
      <Link
        href="/"
        aria-label="Raisory home"
        className="flex h-10 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] md:hidden"
      >
        <RaisoryMark className="h-7 w-7" />
      </Link>
      <GlobalSearch />
    </header>
  );
}
