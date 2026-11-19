"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

/** Input types that take typed text, so j and k must reach them. */
const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
]);

/** True when the keys belong to what has focus: a text field, a select or editable content. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * The row step a key asks for: j or ArrowDown is the next row, k or ArrowUp
 * the previous one, anything else 0. j and k work wherever focus is, except in
 * a text field or an open dialog; the arrow keys only while focus is in the
 * list, so they still scroll the page elsewhere. Keys with Ctrl, Alt or Meta
 * are left alone.
 */
export function rowStep(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "defaultPrevented" | "target"
  >,
  focusInList: boolean,
): 1 | -1 | 0 {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return 0;
  }
  if (isTypingTarget(event.target)) return 0;
  if (
    event.target instanceof Element &&
    event.target.closest('[role="dialog"], dialog')
  ) {
    return 0;
  }
  switch (event.key) {
    case "j":
      return 1;
    case "k":
      return -1;
    case "ArrowDown":
      return focusInList ? 1 : 0;
    case "ArrowUp":
      return focusInList ? -1 : 0;
    default:
      return 0;
  }
}

/** The row links inside `container`, in order. */
export function rowLinks(container: HTMLElement): HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>("a[data-row-link]")];
}

/** The index of the row link that has focus (or contains it), else -1. */
export function focusedRowIndex(
  container: HTMLElement,
  links: readonly HTMLAnchorElement[],
): number {
  const active = document.activeElement;
  if (!active || !container.contains(active)) return -1;
  return links.findIndex((link) => link === active || link.contains(active));
}

/** The index `step` rows from `from`, kept inside the list. From -1 it starts at the first row. */
export function stepIndex(from: number, step: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (from < 0) return 0;
  return Math.min(count - 1, Math.max(0, from + step));
}

/**
 * Hidden copies of a list (the phone list under the cards, the list under the
 * split view) stay mounted, so only a rendered list answers the keys.
 * Browsers without `checkVisibility` count every list as shown.
 */
function isShown(element: HTMLElement): boolean {
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : true;
}

/**
 * Calls `onStep` with the row step for each j/k or arrow key meant for the
 * list in `containerRef`, after preventing the key's default (page scroll).
 */
export function useRowKeys(
  containerRef: RefObject<HTMLElement | null>,
  onStep: (step: 1 | -1, container: HTMLElement) => void,
): void {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    const container = containerRef.current;
    if (!container || !isShown(container)) return;
    const inside =
      document.activeElement !== null &&
      container.contains(document.activeElement);
    const step = rowStep(event, inside);
    if (step === 0) return;
    event.preventDefault();
    onStep(step, container);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
}

/**
 * Keyboard support for the List view: j/k (and the arrow keys while focus is
 * in the list) move focus between the row links; Enter follows the focused
 * link to the company page, as any link does.
 */
export function ListRowKeys({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useRowKeys(ref, (step, container) => {
    const links = rowLinks(container);
    const next = stepIndex(
      focusedRowIndex(container, links),
      step,
      links.length,
    );
    links[next]?.focus();
  });
  return <div ref={ref}>{children}</div>;
}
