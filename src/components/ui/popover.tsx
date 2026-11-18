"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { buttonClasses } from "./button";
import { useOverlay } from "./use-overlay";

/**
 * A button that opens a small panel beneath it (filter popovers on desktop).
 * Focus moves into the panel and is kept there; Escape or a click outside
 * closes it and focus returns to the button.
 */
export function Popover({
  triggerLabel,
  title,
  children,
  defaultOpen = false,
}: {
  triggerLabel: string;
  /** The panel's accessible name. */
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useOverlay({ open, onClose: close, panelRef, triggerRef, onOutside: true });

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={buttonClasses("secondary", "sm")}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={title}
          tabIndex={-1}
          className="absolute left-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-line bg-surface p-4 text-ink shadow-[var(--shadow-2)] motion-safe:animate-[ui-pop_200ms_ease-out]"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
