"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { SearchIcon } from "./icons";

const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
]);

/** True when key presses belong to what has focus: a text field, a select or editable content. */
export function isTextField(target: EventTarget | null): boolean {
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
 * True for the keys that focus search: "/" on its own, or ⌘K / Ctrl+K. Never
 * while the visitor is typing in a field.
 */
export function isSearchShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target"
  >,
): boolean {
  if (isTextField(event.target)) return false;
  if (event.key === "/") {
    return !event.ctrlKey && !event.metaKey && !event.altKey;
  }
  if (event.key === "k" || event.key === "K") {
    return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  }
  return false;
}

/**
 * Where a top-bar search goes from the funding list: the same filters with the
 * new search term, back to page one and with no open preview. Elsewhere a
 * search starts fresh on the funding list.
 */
export function searchHref(
  pathname: string,
  currentSearch: string,
  term: string,
): string {
  const params =
    pathname === "/"
      ? new URLSearchParams(currentSearch)
      : new URLSearchParams();
  const q = term.trim();
  if (q) params.set("q", q);
  else params.delete("q");
  params.delete("page");
  params.delete("open");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/**
 * The top bar's search: a plain GET form to the funding list with `q`, so it
 * works without JavaScript. "/" and ⌘K or Ctrl+K focus it.
 */
export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut(event)) return;
      // An open sheet or dialog keeps the keyboard.
      if (document.querySelector('[aria-modal="true"]')) return;
      const input = inputRef.current;
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    }
    // On window, so it runs after any page-level handler on document and the
    // top bar's search is the one that ends up focused.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      role="search"
      action="/"
      method="get"
      onSubmit={(event) => {
        // With JavaScript, keep the funding list's filters (without it, the
        // plain GET starts a fresh search).
        event.preventDefault();
        const term = inputRef.current?.value ?? "";
        router.push(
          searchHref(window.location.pathname, window.location.search, term),
        );
      }}
      className="relative min-w-0 max-w-[620px] flex-1"
    >
      <label htmlFor="global-search" className="sr-only">
        Search companies and investors
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-[18px] w-[18px] -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        id="global-search"
        name="q"
        type="search"
        placeholder="Search companies, investors…"
        autoComplete="off"
        enterKeyHint="search"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        className="h-10 w-full min-w-0 rounded-[var(--radius-sm)] border border-line-strong bg-paper pr-2.5 pl-9 text-[15px] text-ink placeholder:text-muted md:pr-10"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line-strong bg-surface px-1.5 text-[12px] leading-[18px] font-medium text-muted md:block"
      >
        /
      </kbd>
    </form>
  );
}
