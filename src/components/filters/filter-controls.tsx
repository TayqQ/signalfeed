"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { buttonClasses } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * The filter state as URL parameters: key to values, in the server's canonical
 * form. The client never re-implements parsing; it only edits these lists and
 * the server parses the URL it produces.
 */
export type Params = Readonly<Record<string, readonly string[]>>;
/** `sort`, `dir` and `pageSize`, kept across filter changes. */
export type ViewParams = Readonly<Record<string, string>>;
/** Where the controls render: in the bar on desktop, or stacked in the sheet. */
export type Layout = "bar" | "sheet";
export type Update = (change: (params: Params) => Params) => void;

export function paramValues(params: Params, key: string): readonly string[] {
  return params[key] ?? [];
}

export function firstValue(params: Params, key: string): string {
  return params[key]?.[0] ?? "";
}

export function withValues(
  params: Params,
  key: string,
  values: readonly string[],
): Params {
  const next: Record<string, readonly string[]> = { ...params };
  const kept = values.filter((value) => value.length > 0);
  if (kept.length > 0) next[key] = kept;
  else delete next[key];
  return next;
}

export function withToggled(
  params: Params,
  key: string,
  value: string,
  on: boolean,
): Params {
  const others = paramValues(params, key).filter((item) => item !== value);
  return withValues(params, key, on ? [...others, value] : others);
}

export function paramsQuery(params: Params, view: ViewParams): string {
  const search = new URLSearchParams();
  for (const [key, values] of Object.entries(params)) {
    for (const value of values) if (value) search.append(key, value);
  }
  for (const [key, value] of Object.entries(view)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

export function paramsHref(
  action: string,
  params: Params,
  view: ViewParams,
): string {
  const query = paramsQuery(params, view);
  return query ? `${action}?${query}` : action;
}

const noSubscribe = () => () => {};

/**
 * False on the server and during hydration, true once JavaScript runs. Before
 * that the bar renders its no-JavaScript form: links for presets and
 * `<details>` for popovers.
 */
export function useEnhanced(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

// ----- Stage and grants ----------------------------------------------------

export interface StageOption {
  value: string;
  label: string;
  rounds: readonly string[];
}

export type GrantsMode = "hide" | "include" | "only";

export interface RoundsModel {
  stages: readonly StageOption[];
  nonGrantRounds: readonly string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/** The Stage and Grants controls' values for a `round` list. */
export function roundsState(
  rounds: readonly string[],
  model: RoundsModel,
): { stage: string; grants: GrantsMode; rest: readonly string[] } {
  const rest = rounds.filter((round) => round !== "grant");
  const hasGrant = rest.length !== rounds.length;
  const grants: GrantsMode = hasGrant
    ? rest.length === 0
      ? "only"
      : "include"
    : "hide";
  let stage = "custom";
  if (rest.length === 0 || sameSet(rest, model.nonGrantRounds)) stage = "all";
  else {
    const preset = model.stages.find((item) => sameSet(item.rounds, rest));
    if (preset) stage = preset.value;
  }
  return { stage, grants, rest };
}

/** The `round` list for a Stage and Grants choice. `custom` keeps `rest`. */
export function roundsFor(
  stage: string,
  grants: GrantsMode,
  rest: readonly string[],
  model: RoundsModel,
): string[] {
  if (grants === "only") return ["grant"];
  let base: readonly string[] = [];
  if (stage === "custom") base = rest;
  else if (stage !== "all") {
    base = model.stages.find((item) => item.value === stage)?.rounds ?? [];
  }
  if (grants === "include") {
    return [...(base.length > 0 ? base : model.nonGrantRounds), "grant"];
  }
  return [...base];
}

// ----- Building blocks -----------------------------------------------------

const CHOICE =
  "relative inline-flex h-7 shrink-0 cursor-pointer select-none items-center gap-1 whitespace-nowrap rounded-[var(--radius-pill)] border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors duration-[120ms] ease-out hover:bg-surface-sunk motion-reduce:transition-none has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--focus)]";

/**
 * A chip that is a checkbox, so a multi-select works as a plain form field
 * without JavaScript. A tick shows when chosen, so colour is not the only cue.
 */
export function ChoiceChip({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={CHOICE}>
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="peer sr-only"
      />
      <svg
        viewBox="0 0 16 16"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="hidden peer-checked:block"
      >
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
      {label}
    </label>
  );
}

export interface PresetOption {
  value: string;
  label: string;
}

/**
 * A single choice: the `SegmentedControl` with JavaScript, and a row of links
 * that look the same without it (`hrefFor` gives each option's URL).
 */
export function Segmented({
  enhanced,
  label,
  options,
  value,
  onChange,
  hrefFor,
}: {
  enhanced: boolean;
  label: string;
  options: readonly PresetOption[];
  value: string;
  onChange: (value: string) => void;
  hrefFor: (value: string) => string;
}) {
  if (enhanced) {
    return (
      <SegmentedControl
        label={label}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-[var(--radius-sm)] border border-line-strong bg-surface-sunk p-0.5"
    >
      {options.map((option) => {
        const current = option.value === value;
        return (
          <Link
            key={option.value}
            href={hrefFor(option.value)}
            prefetch={false}
            aria-current={current ? "true" : undefined}
            className={`inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-[4px] px-3 text-[13px] font-medium ${
              current
                ? "bg-surface text-ink shadow-[var(--shadow-1)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

/** A labelled block in the sheet; in the bar the control speaks for itself. */
export function Group({
  layout,
  title,
  children,
}: {
  layout: Layout;
  title: string;
  children: ReactNode;
}) {
  if (layout === "bar") return <>{children}</>;
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold">{title}</p>
      {children}
    </div>
  );
}

/**
 * A panel of extra controls: the `Popover` with JavaScript, `<details>`
 * without it (its fields still submit with the form), and an inline section
 * inside the phone sheet.
 */
export function Disclosure({
  enhanced,
  layout,
  label,
  title,
  children,
}: {
  enhanced: boolean;
  layout: Layout;
  /** The trigger text, e.g. "More filters (2)". */
  label: string;
  title: string;
  children: ReactNode;
}) {
  if (layout === "sheet") {
    return (
      <section aria-label={title}>
        <h3 className="mb-1.5 text-[13px] font-semibold">{title}</h3>
        {children}
      </section>
    );
  }
  if (enhanced) {
    return (
      <Popover triggerLabel={label} title={title}>
        {children}
      </Popover>
    );
  }
  return (
    <details className="relative">
      <summary
        className={`${buttonClasses("secondary", "sm")} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        {label}
      </summary>
      <div
        role="group"
        aria-label={title}
        className="z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-line bg-surface p-4 text-ink shadow-[var(--shadow-2)] md:absolute md:left-0 md:top-full"
      >
        {children}
      </div>
    </details>
  );
}

export const FIELD =
  "h-9 w-full min-w-0 rounded-[var(--radius-sm)] border border-line-strong bg-surface px-2.5 text-[15px] text-ink placeholder:text-faint";
export const FIELD_LABEL = "mb-1 block text-[13px] font-medium";
export const HINT = "mt-1 text-xs text-muted";

type CommitInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "onBlur" | "onFocus" | "onKeyDown"
> & {
  value: string;
  /** Called with the trimmed text on Enter, on blur, or after `debounceMs`. */
  onCommit: (value: string) => void;
  debounceMs?: number;
  ref?: Ref<HTMLInputElement>;
};

/**
 * A text box that applies its value when the visitor is done (Enter, blur, or
 * a pause in typing) rather than on every key. It follows `value` from the URL
 * unless it has focus, so typing is never overwritten by a slower response.
 */
export function CommitInput({
  value,
  onCommit,
  debounceMs,
  ref,
  ...rest
}: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  const committed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(onCommit);

  if (value !== seen) {
    setSeen(value);
    if (!focused) setDraft(value);
  }

  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    committed.current = value;
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(text: string) {
    clearTimeout(timer.current);
    const next = text.trim();
    if (next === committed.current) return;
    committed.current = next;
    commitRef.current(next);
  }

  return (
    <input
      {...rest}
      ref={ref}
      value={draft}
      onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft(text);
        if (debounceMs != null) {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(text), debounceMs);
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit(draft);
      }}
    />
  );
}
