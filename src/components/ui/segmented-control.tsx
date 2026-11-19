"use client";

import { useRef, useState, type KeyboardEvent } from "react";

export interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Shown as a tooltip, for example why an option is unavailable. */
  title?: string;
}

/**
 * A single-choice control with radio-group semantics: one tab stop, and the
 * arrow keys move the selection. Used for Stage, the view switch and the
 * £/rounds toggle.
 */
export function SegmentedControl({
  label,
  options,
  value,
  defaultValue,
  onChange,
}: {
  /** The accessible name of the group. */
  label: string;
  options: readonly SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const [inner, setInner] = useState(
    defaultValue ?? options.find((o) => !o.disabled)?.value ?? "",
  );
  const selected = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(next: string) {
    if (value === undefined) setInner(next);
    onChange?.(next);
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const step = forward ? 1 : -1;
    for (let i = 1; i <= options.length; i++) {
      const at = (index + step * i + options.length * i) % options.length;
      const option = options[at];
      if (option && !option.disabled) {
        select(option.value);
        refs.current[at]?.focus();
        return;
      }
    }
  }

  const tabStop = options.findIndex((o) => o.value === selected && !o.disabled);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-[var(--radius-sm)] border border-line-strong bg-surface-sunk p-0.5"
    >
      {options.map((option, index) => {
        const checked = option.value === selected;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={option.disabled || undefined}
            disabled={option.disabled}
            title={option.title}
            tabIndex={index === (tabStop === -1 ? 0 : tabStop) ? 0 : -1}
            onClick={() => select(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`h-7 shrink-0 whitespace-nowrap rounded-[4px] px-3 text-[13px] font-medium transition-colors duration-[120ms] ease-out motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
              checked
                ? "bg-surface text-ink shadow-[var(--shadow-1)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
