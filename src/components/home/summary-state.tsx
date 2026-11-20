"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { buttonClasses } from "@/components/ui/button";
import { summaryCookie, type SummaryState } from "@/lib/view-preference";

/** Element ids, so focus can move between the close and show buttons. */
const CLOSE_ID = "summary-close";
const SHOW_ID = "summary-show";

interface SummaryContextValue {
  visible: boolean;
  hiddenByDefault: boolean;
  close: () => void;
  show: () => void;
  setHiddenByDefault: (on: boolean) => void;
}

const SummaryContext = createContext<SummaryContextValue>({
  visible: true,
  hiddenByDefault: false,
  close: () => {},
  show: () => {},
  setHiddenByDefault: () => {},
});

function writeCookie(state: SummaryState) {
  try {
    document.cookie = summaryCookie(state);
  } catch {
    // Cookies can be blocked; the choice then lasts for this page view.
  }
}

/**
 * Whether the "What's happening" summary is on the page, from the
 * `raisory_summary` cookie the server read (so the first paint is right):
 * - close removes it and sets the session cookie `closed`;
 * - "Show summary" brings it back and clears that cookie;
 * - "Keep hidden by default" sets the one-year cookie `hidden`. With it, the
 *   page loads without the summary, and "Show summary" opens it for this
 *   visit only, leaving the cookie as it is.
 *
 * The state lives here, above the page's content, so it survives filter
 * changes (which re-render the page on the server) until the next page load.
 */
export function SummaryProvider({
  initial,
  children,
}: {
  initial: SummaryState;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(initial === "open");
  const [hiddenByDefault, setHidden] = useState(initial === "hidden");
  // Where focus goes once the button that had it has been removed.
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    document.getElementById(id)?.focus();
  }, [visible]);

  const close = useCallback(() => {
    setVisible(false);
    focusNext.current = SHOW_ID;
    // Hidden by default already keeps it away; don't replace that cookie.
    if (!hiddenByDefault) writeCookie("closed");
  }, [hiddenByDefault]);

  const show = useCallback(() => {
    setVisible(true);
    focusNext.current = CLOSE_ID;
    if (!hiddenByDefault) writeCookie("open");
  }, [hiddenByDefault]);

  const setHiddenByDefault = useCallback((on: boolean) => {
    setHidden(on);
    writeCookie(on ? "hidden" : "open");
  }, []);

  const value = useMemo(
    () => ({ visible, hiddenByDefault, close, show, setHiddenByDefault }),
    [visible, hiddenByDefault, close, show, setHiddenByDefault],
  );
  return (
    <SummaryContext.Provider value={value}>{children}</SummaryContext.Provider>
  );
}

/** The summary itself: rendered on the server, and off the page when closed. */
export function SummaryFrame({ children }: { children: ReactNode }) {
  const { visible } = useContext(SummaryContext);
  return <div hidden={!visible}>{children}</div>;
}

/** The summary header's right side: "Keep hidden by default" and close. */
export function SummaryControls() {
  const { hiddenByDefault, close, setHiddenByDefault } =
    useContext(SummaryContext);
  const checkboxId = useId();
  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      <label
        htmlFor={checkboxId}
        className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={hiddenByDefault}
          onChange={(event) => setHiddenByDefault(event.currentTarget.checked)}
          className="size-3.5 accent-[var(--brand)]"
        />
        Keep hidden <span className="max-sm:sr-only">by default</span>
      </label>
      <button
        id={CLOSE_ID}
        type="button"
        aria-label="Hide summary"
        title="Hide summary"
        onClick={close}
        className={`${buttonClasses("ghost", "sm")} w-8 !px-0 text-muted hover:text-ink`}
      >
        <svg
          className="shrink-0"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

/** "Show summary", at the right of the funding toolbar while it is hidden. */
export function ShowSummaryButton() {
  const { visible, show } = useContext(SummaryContext);
  if (visible) return null;
  return (
    <button
      id={SHOW_ID}
      type="button"
      aria-label="Show summary"
      onClick={show}
      className={`${buttonClasses("ghost", "sm")} shrink-0 gap-1.5 px-2 text-muted hover:text-ink`}
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 13.5V9M8 13.5V3M13 13.5V6.5M1.5 13.5h13" />
      </svg>
      <span>
        <span className="max-sm:sr-only">Show</span> summary
      </span>
    </button>
  );
}
