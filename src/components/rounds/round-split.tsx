"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { CompanyPreview, FundingRow } from "@/core/read-models";
import { Amount } from "@/components/ui/amount";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { Monogram } from "@/components/ui/monogram";
import { NewMark } from "@/components/ui/new-mark";
import { RelativeDate } from "@/components/ui/relative-date";
import { SectorLabel } from "@/components/ui/sector-label";
import { StageChip } from "@/components/ui/stage-chip";
import {
  OPEN_PARAM,
  parseOpenSlug,
  withOpenParam,
} from "@/lib/view-preference";
import { RoundPreview, type PreviewState } from "./round-preview";
import { NO_DESCRIPTION, chipLabel, companyHref } from "./round-row-parts";
import { focusedRowIndex, rowLinks, stepIndex, useRowKeys } from "./row-keys";

/** A preview that takes longer than this shows the skeleton. */
export const SKELETON_DELAY_MS = 150;

/**
 * Loads one company preview from the route handler. Null for an unknown
 * company (404); throws for any other failure, or when `signal` aborts.
 */
export async function fetchCompanyPreview(
  slug: string,
  signal: AbortSignal,
): Promise<CompanyPreview | null> {
  const response = await fetch(
    `/api/company-preview/${encodeURIComponent(slug)}`,
    { signal, headers: { accept: "application/json" } },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Company preview failed with status ${response.status}`);
  }
  return (await response.json()) as CompanyPreview;
}

/** Loaded previews by slug. Null records a company with no preview (404). */
type PreviewCache = ReadonlyMap<string, CompanyPreview | null>;

/**
 * The selection after the rows or the URL change: the URL's `?open=` when it
 * is on this page, else the current selection when it is still on the page
 * (so a sort or filter link keeps it), else the first row.
 */
export function nextSelection(
  slugs: readonly string[],
  requested: string | null,
  current: string | null,
): string | null {
  if (requested && slugs.includes(requested)) return requested;
  if (current && slugs.includes(current)) return current;
  return slugs[0] ?? null;
}

function plainClick(event: MouseEvent | KeyboardEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/**
 * The Split view (from direction C): compact rows on the left (about 40%) and
 * a preview of the selected company on the right, both scrolling inside a
 * frame that sticks to the top of the window.
 *
 * - The selection is `?open=<slug>`, else the first row. Each row is a link to
 *   its `?open=` URL, so without JavaScript the server renders the preview.
 * - With JavaScript a click, j/k or the arrow keys (inside the list) select a
 *   row without a request for the page: the URL is updated in place with
 *   `history.replaceState`, so there is no history entry per keypress, and
 *   Back or a shared link restores the selection. Focus stays in the list.
 *   Enter or "Open full page" goes to the company page.
 * - The first preview is server-rendered. Later ones are fetched from
 *   `/api/company-preview/<slug>` and kept for the visit. A newer selection
 *   aborts the older request and its response is ignored. Under 150 ms the
 *   previous preview stays (dimmed); after that a same-sized skeleton shows.
 */
export function RoundSplit({
  rows,
  href,
  preview,
  previewSlug,
  now,
}: {
  rows: readonly FundingRow[];
  /** The current path and query without `?open=`, for the row links. */
  href: string;
  /** The server-rendered preview of `previewSlug`: null for a 404, undefined when not loaded. */
  preview?: CompanyPreview | null;
  previewSlug?: string | null;
  now?: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = parseOpenSlug(searchParams?.get(OPEN_PARAM)) ?? null;
  const slugs = useMemo(() => rows.map((row) => row.companySlug), [rows]);
  const nameId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);

  const [selected, setSelected] = useState(() =>
    nextSelection(slugs, requested, null),
  );
  const [cache, setCache] = useState<PreviewCache>(() =>
    previewSlug && preview !== undefined
      ? new Map([[previewSlug, preview]])
      : new Map(),
  );
  /** The slug whose preview stays on screen while a new one loads. */
  const [held, setHeld] = useState<string | null>(null);
  /** The slug whose request has passed the skeleton delay. */
  const [slow, setSlow] = useState<string | null>(null);
  /** The slug whose request failed. */
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const entry = selected !== null ? cache.get(selected) : undefined;
  let state: PreviewState;
  if (entry !== undefined) {
    state = entry ? { kind: "ready", preview: entry } : { kind: "missing" };
  } else if (failed === selected) {
    state = { kind: "error" };
  } else if (slow === selected) {
    state = { kind: "loading" };
  } else {
    state = { kind: "waiting", held: (held && cache.get(held)) || null };
  }

  /** What stays on screen when the selection moves away from now. */
  function heldAfterMove(): string | null {
    if (state.kind === "ready") return selected;
    if (state.kind === "waiting") return held;
    return null;
  }

  // New rows mean a navigation (sort, filter, paging, Back): take the new
  // URL's `?open=` if it is on the page, else keep the selection if the page
  // still has it, and take in the server-rendered preview. A `?open=` change
  // on its own is only this component's `replaceState` catching up, which can
  // lag a fast j/k, so it is not read back.
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    if (previewSlug && preview !== undefined && !cache.has(previewSlug)) {
      setCache(new Map(cache).set(previewSlug, preview));
    }
    const next = nextSelection(slugs, requested, selected);
    if (next !== selected) {
      setHeld(heldAfterMove());
      setSelected(next);
    }
  }

  function select(slug: string) {
    if (slug === selected) return;
    setHeld(heldAfterMove());
    setFailed(null);
    setSlow(null);
    setSelected(slug);
  }

  // Keep `?open=` in step with the selection, in place. A first-row selection
  // on a URL without `?open=` is left alone, so the plain URL stays canonical.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = parseOpenSlug(url.searchParams.get(OPEN_PARAM)) ?? null;
    const wanted = current === null && selected === slugs[0] ? null : selected;
    if (current === wanted) return;
    window.history.replaceState(
      null,
      "",
      withOpenParam(`${url.pathname}${url.search}`, wanted),
    );
  }, [selected, slugs]);

  // A new company starts at the top of the preview.
  useEffect(() => {
    previewRef.current?.scrollTo?.({ top: 0 });
  }, [selected]);

  const needsFetch = selected !== null && !cache.has(selected);
  useEffect(() => {
    if (!needsFetch || selected === null) return;
    const slug = selected;
    const controller = new AbortController();
    const timer = window.setTimeout(() => setSlow(slug), SKELETON_DELAY_MS);
    void fetchCompanyPreview(slug, controller.signal)
      .then(
        (data) => {
          // A newer selection aborted this request: its answer is stale.
          if (controller.signal.aborted) return;
          setCache((previous) => new Map(previous).set(slug, data));
        },
        () => {
          if (controller.signal.aborted) return;
          setFailed(slug);
        },
      )
      .finally(() => window.clearTimeout(timer));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [selected, needsFetch, attempt]);

  useRowKeys(listRef, (step, container) => {
    const links = rowLinks(container);
    const focused = focusedRowIndex(container, links);
    const from = focused >= 0 ? focused : slugs.indexOf(selected ?? "");
    const next = stepIndex(from, step, links.length);
    const slug = slugs[next];
    if (slug === undefined) return;
    select(slug);
    links[next]?.focus();
  });

  function onRowClick(event: MouseEvent<HTMLAnchorElement>, slug: string) {
    // Modified clicks open the `?open=` link in a new tab or window.
    if (event.button !== 0 || !plainClick(event)) return;
    event.preventDefault();
    select(slug);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLAnchorElement>, slug: string) {
    if (event.key !== "Enter" || !plainClick(event)) return;
    event.preventDefault();
    router.push(companyHref({ companySlug: slug }));
  }

  const selectedRow = rows.find((row) => row.companySlug === selected);

  return (
    <div className="sticky top-2 grid h-[calc(100dvh-1rem)] min-h-[32rem] grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
      <div
        ref={listRef}
        className="min-h-0 overflow-y-auto border-r border-line"
      >
        <ul aria-label="Funding rounds">
          {rows.map((row) => (
            <li key={row.eventId}>
              <SplitRow
                row={row}
                href={withOpenParam(href, row.companySlug)}
                current={row.companySlug === selected}
                now={now}
                onClick={(event) => onRowClick(event, row.companySlug)}
                onKeyDown={(event) => onRowKeyDown(event, row.companySlug)}
              />
            </li>
          ))}
        </ul>
      </div>
      <section
        ref={previewRef}
        aria-label="Company preview"
        className="min-h-0 overflow-y-auto bg-paper"
      >
        {selectedRow ? (
          <RoundPreview
            row={selectedRow}
            state={state}
            nameId={nameId}
            now={now}
            onRetry={() => {
              setFailed(null);
              setAttempt((count) => count + 1);
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

/**
 * One compact row: monogram, name and amount; stage and sector; the
 * description and date. The whole row is one link to its `?open=` URL.
 */
function SplitRow({
  row,
  href,
  current,
  now,
  onClick,
  onKeyDown,
}: {
  row: FundingRow;
  href: string;
  current: boolean;
  now?: Date;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void;
}) {
  const description = row.companyDescription?.trim() || null;
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      data-row-link=""
      aria-current={current ? "true" : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-[13px] transition-colors duration-[120ms] ease-out hover:bg-surface-sunk focus-visible:-outline-offset-2 motion-reduce:transition-none aria-[current=true]:bg-sel aria-[current=true]:shadow-[inset_3px_0_0_var(--sel-bar)]"
    >
      <span className="row-span-3 pt-px">
        <Monogram name={row.companyName} size={28} />
      </span>
      <span className="col-start-2 flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold leading-snug text-ink">
          {row.companyName}
        </span>
        <NewMark date={row.announcedOn} now={now} />
      </span>
      <span className="col-start-3 row-span-2 text-right">
        <Amount amount={row.amount} amountGbpMinor={row.amountGbpMinor} />
        {row.confirmation ? (
          <span className="mt-1 block">
            <ConfirmedMark text={row.confirmation.text} />
          </span>
        ) : null}
      </span>
      <span className="col-start-2 flex min-w-0 items-center gap-2">
        <StageChip
          roundType={row.roundType}
          label={chipLabel(row.roundLabel)}
        />
        <span className="min-w-0 truncate">
          <SectorLabel sector={row.mainSector} />
        </span>
      </span>
      <span className="col-span-2 col-start-2 flex min-w-0 items-baseline justify-between gap-3">
        <span
          className={`min-w-0 truncate ${description ? "text-muted" : "text-faint"}`}
        >
          {description ?? NO_DESCRIPTION}
        </span>
        <span className="shrink-0 text-xs">
          <RelativeDate date={row.announcedOn} now={now} />
        </span>
      </span>
    </Link>
  );
}
