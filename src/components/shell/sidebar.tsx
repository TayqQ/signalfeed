"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RaisoryLogo } from "@/components/raisory-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { RaisoryMark, SourceIcon } from "./icons";
import {
  LICENCE_URL,
  LOWER_NAV,
  NavItem,
  PRIMARY_NAV,
  REPO_URL,
  isNavActive,
} from "./nav-item";

/**
 * The left column from 768 px: 240 px wide with labels from 1280 px, a 64 px
 * icon rail below that. It stays in place while the page scrolls (sticky, so
 * the window keeps its own scroll and anchors). Hidden on phones, where the
 * bottom tab bar takes over.
 */
export function Sidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <div className="sticky top-0 hidden h-dvh flex-col items-center gap-3 self-start overflow-y-auto border-r border-nav-line bg-nav px-2 py-3 text-nav-ink md:flex xl:items-stretch xl:px-3 xl:py-3.5">
      <Link
        href="/"
        aria-label="Raisory home"
        title="Raisory home"
        className="flex h-10 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] xl:w-auto xl:justify-start xl:px-2.5"
      >
        <RaisoryMark className="h-7 w-7 xl:hidden" />
        <RaisoryLogo className="hidden h-[22px] w-auto xl:block" />
      </Link>

      <nav
        aria-label="Main"
        className="flex min-h-0 flex-1 flex-col items-center xl:items-stretch"
      >
        <ul className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((entry) => (
            <li key={entry.href}>
              <NavItem entry={entry} active={isNavActive(entry, pathname)} />
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-col items-center gap-2 pt-4 xl:items-stretch">
          <ul className="flex flex-col gap-0.5">
            {LOWER_NAV.map((entry) => (
              <li key={entry.href}>
                <NavItem entry={entry} active={isNavActive(entry, pathname)} />
              </li>
            ))}
          </ul>
          {/* The licence asks for a visible link to the source. */}
          <a
            href={REPO_URL}
            title="Source code (AGPL-3.0)"
            className="flex h-9 w-11 items-center justify-center rounded-[var(--radius-sm)] text-nav-muted hover:bg-nav-ink/8 hover:text-nav-ink xl:hidden"
          >
            <SourceIcon className="h-5 w-5" />
            <span className="sr-only">Source code</span>
          </a>
          <p className="hidden gap-3 px-2.5 text-[12px] text-nav-muted xl:flex">
            <a
              href={REPO_URL}
              className="underline underline-offset-4 hover:text-nav-ink"
            >
              Source code
            </a>
            <a
              href={LICENCE_URL}
              className="underline underline-offset-4 hover:text-nav-ink"
            >
              AGPL-3.0
            </a>
          </p>
        </div>
      </nav>

      <div className="flex w-full shrink-0 items-center justify-center border-t border-nav-line pt-3 xl:justify-between xl:pl-2.5">
        <span className="hidden text-[13px] text-nav-muted xl:inline">
          Theme
        </span>
        <ThemeToggle />
      </div>
    </div>
  );
}
