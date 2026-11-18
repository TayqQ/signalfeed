"use client";

import { useId } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { slugify } from "@/lib/normalise";
import {
  ChoiceChip,
  CommitInput,
  Disclosure,
  FIELD,
  FIELD_LABEL,
  HINT,
  Segmented,
  firstValue,
  paramValues,
  paramsHref,
  roundsFor,
  roundsState,
  withToggled,
  withValues,
  type GrantsMode,
  type Layout,
  type Params,
  type PresetOption,
  type RoundsModel,
  type Update,
  type ViewParams,
} from "./filter-controls";

const GRANT_OPTIONS: readonly PresetOption[] = [
  { value: "hide", label: "Hide grants" },
  { value: "include", label: "Include grants" },
  { value: "only", label: "Grants only" },
];

/**
 * "Raising history" (first round vs repeat raiser) stays hidden until our
 * history is longer than a year (it starts November 2026; research.md section 2).
 * A URL that already sets `momentum` still shows the control so it can be changed.
 */
const SHOW_MOMENTUM_FILTER = false;

/** Filters most visitors do not need, behind "More filters". */
export function MoreFilters({
  params,
  update,
  enhanced,
  layout,
  rounds,
  companySizes,
  momentum,
  dateIsCustom,
  investorLabel,
  action,
  view,
}: {
  params: Params;
  update: Update;
  enhanced: boolean;
  layout: Layout;
  rounds: RoundsModel;
  /** `cosize` slugs and plain-word labels. */
  companySizes: readonly PresetOption[];
  /** Momentum values and their new names. */
  momentum: readonly PresetOption[];
  /** True when `from`/`to` do not match a date preset. */
  dateIsCustom: boolean;
  investorLabel: string;
  action: string;
  view: ViewParams;
}) {
  const ids = useId();
  const state = roundsState(paramValues(params, "round"), rounds);
  const sizes = paramValues(params, "cosize");
  const momentumValue = firstValue(params, "momentum");
  const investor = firstValue(params, "investor");
  const min = firstValue(params, "min");
  const max = firstValue(params, "max");

  const count =
    (state.grants === "hide" ? 0 : 1) +
    sizes.length +
    (momentumValue ? 1 : 0) +
    (investor ? 1 : 0) +
    (min ? 1 : 0) +
    (max ? 1 : 0) +
    (dateIsCustom ? 1 : 0);

  const grantsRounds = (mode: string) =>
    roundsFor(
      state.grants === "only" ? "all" : state.stage,
      mode as GrantsMode,
      state.rest,
      rounds,
    );

  return (
    <Disclosure
      enhanced={enhanced}
      layout={layout}
      label={count > 0 ? `More filters (${count})` : "More filters"}
      title="More filters"
    >
      <div className="space-y-5">
        <div>
          <p className={FIELD_LABEL}>Grants</p>
          <Segmented
            enhanced={enhanced}
            label="Grants"
            options={GRANT_OPTIONS}
            value={state.grants}
            onChange={(mode) =>
              update((p) => withValues(p, "round", grantsRounds(mode)))
            }
            hrefFor={(mode) =>
              paramsHref(
                action,
                withValues(params, "round", grantsRounds(mode)),
                view,
              )
            }
          />
          <p className={HINT}>Grants come from UKRI Gateway to Research.</p>
        </div>

        <fieldset>
          <legend className={FIELD_LABEL}>Company size</legend>
          <div className="flex flex-wrap gap-2">
            {companySizes.map((size) => (
              <ChoiceChip
                key={size.value}
                name="cosize"
                value={size.value}
                label={size.label}
                checked={sizes.includes(size.value)}
                onChange={(on) =>
                  update((p) => withToggled(p, "cosize", size.value, on))
                }
              />
            ))}
          </div>
          <p className={HINT}>
            From the latest accounts at Companies House. UK companies only.
          </p>
        </fieldset>

        {SHOW_MOMENTUM_FILTER || momentumValue ? (
          <div>
            {enhanced ? (
              <>
                <p className={FIELD_LABEL}>Raising history</p>
                <SegmentedControl
                  label="Raising history"
                  options={[{ value: "", label: "Any" }, ...momentum]}
                  value={momentumValue}
                  onChange={(value) =>
                    update((p) => withValues(p, "momentum", [value]))
                  }
                />
              </>
            ) : (
              <fieldset>
                <legend className={FIELD_LABEL}>Raising history</legend>
                <div className="flex flex-wrap gap-x-4 text-[13px]">
                  {[{ value: "", label: "Any" }, ...momentum].map((option) => (
                    <label
                      key={option.value || "any"}
                      className="flex items-center gap-2 py-1"
                    >
                      <input
                        type="radio"
                        name="momentum"
                        value={option.value}
                        defaultChecked={option.value === momentumValue}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className={HINT}>
              Our history starts in November 2026, so a first recorded round may
              not be the company&apos;s first ever.
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor={`${ids}-investor`} className={FIELD_LABEL}>
            Investor
          </label>
          <CommitInput
            id={`${ids}-investor`}
            name="investor"
            type="text"
            autoComplete="off"
            // Without JavaScript the box submits as typed, so it shows the
            // slug the URL needs; with it, names are turned into slugs.
            value={enhanced ? investorLabel : investor}
            placeholder={enhanced ? "Investor name" : "investor-name"}
            className={FIELD}
            onCommit={(text) =>
              update((p) =>
                withValues(p, "investor", text ? [slugify(text)] : []),
              )
            }
          />
        </div>

        <fieldset>
          <legend className={FIELD_LABEL}>Amount range (£)</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${ids}-min`} className="sr-only">
                Minimum £
              </label>
              <CommitInput
                id={`${ids}-min`}
                name="min"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="Min"
                value={min}
                className={FIELD}
                onCommit={(text) =>
                  update((p) => withValues(p, "min", text ? [text] : []))
                }
              />
            </div>
            <div>
              <label htmlFor={`${ids}-max`} className="sr-only">
                Maximum £
              </label>
              <CommitInput
                id={`${ids}-max`}
                name="max"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="Max"
                value={max}
                className={FIELD}
                onCommit={(text) =>
                  update((p) => withValues(p, "max", text ? [text] : []))
                }
              />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className={FIELD_LABEL}>Date range</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${ids}-from`} className="text-xs text-muted">
                From
              </label>
              <CommitInput
                id={`${ids}-from`}
                name="from"
                type="date"
                value={firstValue(params, "from")}
                debounceMs={800}
                className={FIELD}
                onCommit={(text) =>
                  update((p) => withValues(p, "from", text ? [text] : []))
                }
              />
            </div>
            <div>
              <label htmlFor={`${ids}-to`} className="text-xs text-muted">
                To
              </label>
              <CommitInput
                id={`${ids}-to`}
                name="to"
                type="date"
                value={firstValue(params, "to")}
                debounceMs={800}
                className={FIELD}
                onCommit={(text) =>
                  update((p) => withValues(p, "to", text ? [text] : []))
                }
              />
            </div>
          </div>
        </fieldset>
      </div>
    </Disclosure>
  );
}
