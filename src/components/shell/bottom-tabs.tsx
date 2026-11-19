"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useOverlay } from "@/components/ui/use-overlay";
import { MoreIcon, SourceIcon } from "./icons";
import {
  LICENCE_URL,
  MORE_NAV,
  REPO_URL,
  TAB_NAV,
  isNavActive,
  type NavEntry,
} from "./nav-item";

const TAB =
  "flex w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] px-0.5 py-1 text-[12px] leading-4";
const TAB_IDLE = "font-medium text-nav-muted hover:text-nav-ink";
const TAB_ACTIVE = "bg-nav-active font-semibold text-nav-active-ink";

function Tab({ entry, active }: { entry: NavEntry; active: boolean }) {
  const { Icon } = entry;
  return (
    <li className="flex min-w-0">
      <Link
        href={entry.href}
        aria-current={active ? "page" : undefined}
        className={`${TAB} ${active ? TAB_ACTIVE : TAB_IDLE}`}
      >
        <Icon className="h-[22px] w-[22px]" />
        <span className="max-w-full truncate">{entry.label}</span>
      </Link>
    </li>
  );
}

function SheetLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-[15px] ${
        active
          ? "bg-nav-active font-semibold text-nav-active-ink"
          : "font-medium text-ink hover:bg-surface-sunk"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * The phone navigation (under 768 px): four tabs and More, which opens a sheet
 * with the rest. It sits at the end of the column and sticks to the bottom
 * edge, so it takes up its own space and never covers the last of the content.
 */
export function BottomTabs() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);
  useOverlay({ open, onClose: close, panelRef, triggerRef });

  // Keep the page behind the sheet from scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const moreActive = MORE_NAV.some((entry) => isNavActive(entry, pathname));

  return (
    <nav
      aria-label="Main (mobile)"
      className="sticky bottom-0 z-30 border-t border-nav-line bg-nav px-1 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] md:hidden"
    >
      <ul className="grid grid-cols-5 gap-0.5">
        {TAB_NAV.map((entry) => (
          <Tab
            key={entry.href}
            entry={entry}
            active={isNavActive(entry, pathname)}
          />
        ))}
        <li className="flex min-w-0">
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={`${TAB} ${moreActive ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <MoreIcon className="h-[22px] w-[22px]" />
            <span>More</span>
          </button>
        </li>
      </ul>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <div
                data-testid="more-backdrop"
                aria-hidden="true"
                onClick={close}
                className="absolute inset-0 bg-ink/40 motion-safe:animate-[ui-fade_200ms_ease-out]"
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-lg)] border border-b-0 border-line bg-overlay p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-ink shadow-[var(--shadow-2)] motion-safe:animate-[ui-rise_200ms_ease-out]"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 id={titleId} className="text-[17px] font-semibold">
                    More
                  </h2>
                  <Button variant="ghost" size="sm" onClick={close}>
                    Close
                  </Button>
                </div>
                <ul className="flex flex-col gap-0.5">
                  {MORE_NAV.map((entry) => {
                    const active = isNavActive(entry, pathname);
                    const { Icon } = entry;
                    return (
                      <li key={entry.href}>
                        <SheetLink
                          href={entry.href}
                          active={active}
                          onNavigate={close}
                        >
                          <Icon
                            className={`h-5 w-5 ${active ? "" : "text-muted"}`}
                          />
                          {entry.label}
                        </SheetLink>
                      </li>
                    );
                  })}
                  <li>
                    <a
                      href={REPO_URL}
                      className="flex h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-[15px] font-medium text-ink hover:bg-surface-sunk"
                    >
                      <SourceIcon className="h-5 w-5 text-muted" />
                      Source code
                    </a>
                  </li>
                </ul>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 pl-3">
                  <span className="text-[15px] font-medium">Theme</span>
                  <ThemeToggle />
                </div>
                <p className="mt-2 px-3 text-[13px] text-muted">
                  Licensed under{" "}
                  <a
                    href={LICENCE_URL}
                    className="underline underline-offset-4 hover:text-ink"
                  >
                    AGPL-3.0
                  </a>
                  .
                </p>
              </div>
            </div>,
            // At the end of <body>, so no sticky ancestor's stacking context
            // can draw over it.
            document.body,
          )
        : null}
    </nav>
  );
}
