"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, buttonClasses } from "./button";
import { useOverlay } from "./use-overlay";

const SheetCloseContext = createContext<() => void>(() => {});

/** Closes the sheet this component sits inside (for "Show results" style buttons). */
export function useSheetClose(): () => void {
  return useContext(SheetCloseContext);
}

/**
 * A button that opens a modal sheet from the bottom edge (filters on phones).
 * Focus is trapped inside; Escape, the backdrop or Close dismiss it and focus
 * returns to the button.
 */
export function Sheet({
  triggerLabel,
  title,
  children,
  defaultOpen = false,
}: {
  triggerLabel: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={buttonClasses("secondary", "sm")}
      >
        {triggerLabel}
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <div
                data-testid="sheet-backdrop"
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
                className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-lg)] border border-b-0 border-line bg-surface p-4 text-ink shadow-[var(--shadow-2)] motion-safe:animate-[ui-rise_200ms_ease-out]"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id={titleId} className="text-[17px] font-semibold">
                    {title}
                  </h2>
                  <Button variant="ghost" size="sm" onClick={close}>
                    Close
                  </Button>
                </div>
                <SheetCloseContext.Provider value={close}>
                  {children}
                </SheetCloseContext.Provider>
              </div>
            </div>,
            // Rendered at the end of <body> so no ancestor's stacking context
            // (sticky headers, transforms) can draw over it.
            document.body,
          )
        : null}
    </>
  );
}
