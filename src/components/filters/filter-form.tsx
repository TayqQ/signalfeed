"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useTransition,
  type ReactNode,
} from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Sheet, useSheetClose } from "@/components/ui/sheet";
import {
  ChoiceChip,
  Group,
  Segmented,
  firstValue,
  paramValues,
  paramsHref,
  roundsFor,
  roundsState,
  withToggled,
  withValues,
  useEnhanced,
  type Layout,
  type Params,
  type PresetOption,
  type StageOption,
  type ViewParams,
} from "./filter-controls";
import { MoreFilters } from "./more-filters";
import { PlaceBox, type PlaceOption } from "./place-box";
import {
  SectorPicker,
  type SectorOption,
  type ThemeOption,
} from "./sector-picker";

/** Everything the form needs, prepared on the server (plain data only). */
export interface FilterFormData {
  action: string;
  /** The current criteria as canonical URL parameters. */
  params: Params;
  view: ViewParams;
  total: number;
  stages: readonly StageOption[];
  nonGrantRounds: readonly string[];
  dates: ReadonlyArray<PresetOption & { from: string }>;
  /** Busiest first (see `getSectorCounts`). */
  sectors: readonly SectorOption[];
  /** How `sectors` is ordered, shown in the list. */
  sectorCaption?: string;
  themes: readonly ThemeOption[];
  sizes: readonly PresetOption[];
  companySizes: readonly PresetOption[];
  momentum: readonly PresetOption[];
  places: readonly PlaceOption[];
  /** Town names for the "near" and town suggestions. */
  towns: readonly string[];
  radii: readonly number[];
  /** `key:value` to a display name for chosen values. */
  labels: Readonly<Record<string, string>>;
}

/** Applied values, not counting the search, for "Filters (n)". */
function filterCount(params: Params): number {
  let count = 0;
  for (const [key, values] of Object.entries(params)) {
    if (key === "q" || key === "km") continue;
    if (key === "round") count += values.length > 0 ? 1 : 0;
    else if (key === "to") count += params.from?.length ? 0 : values.length;
    else count += values.length;
  }
  return count;
}

/** The sheet's primary button: closes the sheet, whose changes already applied. */
function ShowResultsButton({ children }: { children: ReactNode }) {
  const close = useSheetClose();
  return (
    <Button variant="primary" onClick={close}>
      {children}
    </Button>
  );
}

/**
 * The filter bar's form. It is a GET form whose fields carry every value, so
 * it works with JavaScript off. With JavaScript, each change applies at once
 * (search after a 300 ms pause) and the URL follows with `router.replace`,
 * so no history entry is added per keystroke.
 */
export function FilterForm({ data }: { data: FilterFormData }) {
  const enhanced = useEnhanced();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [params, setOptimisticParams] = useOptimistic<Params, Params>(
    data.params,
    (_current, next) => next,
  );
  const latest = useRef(params);
  const ids = useId();
  const townListId = `${ids}-towns`;
  const toggleId = `${ids}-toggle`;
  const { action, view } = data;

  useEffect(() => {
    latest.current = params;
  });

  const update = useCallback(
    (change: (current: Params) => Params) => {
      const next = change(latest.current);
      latest.current = next;
      startTransition(() => {
        setOptimisticParams(next);
        router.replace(paramsHref(action, next, view), { scroll: false });
      });
    },
    [action, router, setOptimisticParams, view],
  );

  const rounds = { stages: data.stages, nonGrantRounds: data.nonGrantRounds };
  const roundState = roundsState(paramValues(params, "round"), rounds);
  const stageRounds = (stage: string) =>
    roundsFor(
      stage,
      roundState.grants === "only" ? "hide" : roundState.grants,
      roundState.rest,
      rounds,
    );

  const from = firstValue(params, "from");
  const to = firstValue(params, "to");
  const datePreset = data.dates.find((d) => d.from === from && !to);
  const dateValue = !from && !to ? "any" : (datePreset?.value ?? "custom");
  const dateParams = (value: string) => {
    const preset = data.dates.find((d) => d.value === value);
    return withValues(withValues(params, "to", []), "from", [
      preset?.from ?? "",
    ]);
  };

  const sizes = paramValues(params, "size");
  const confirmed = firstValue(params, "evidence") === "confirmed";
  const count = filterCount(params);
  const investor = firstValue(params, "investor");

  function controls(layout: Layout) {
    return (
      <div
        className={
          layout === "bar"
            ? "flex flex-wrap items-center gap-x-3 gap-y-2"
            : "space-y-5"
        }
      >
        <SectorPicker
          params={params}
          update={update}
          enhanced={enhanced}
          layout={layout}
          sectors={data.sectors}
          themes={data.themes}
          caption={data.sectorCaption}
        />
        <Group layout={layout} title="Stage">
          <Segmented
            enhanced={enhanced}
            label="Stage"
            options={[{ value: "all", label: "All stages" }, ...data.stages]}
            value={roundState.stage}
            onChange={(stage) =>
              update((p) => withValues(p, "round", stageRounds(stage)))
            }
            hrefFor={(stage) =>
              paramsHref(
                action,
                withValues(params, "round", stageRounds(stage)),
                view,
              )
            }
          />
        </Group>
        <fieldset>
          <legend
            className={
              layout === "sheet"
                ? "mb-1.5 text-[13px] font-semibold"
                : "sr-only"
            }
          >
            Amount
          </legend>
          <div className="flex flex-wrap gap-2">
            {data.sizes.map((size) => (
              <ChoiceChip
                key={size.value}
                name="size"
                value={size.value}
                label={size.label}
                checked={sizes.includes(size.value)}
                onChange={(on) =>
                  update((p) => withToggled(p, "size", size.value, on))
                }
              />
            ))}
          </div>
        </fieldset>
        <Group layout={layout} title="Date">
          <Segmented
            enhanced={enhanced}
            label="Date"
            options={[{ value: "any", label: "Any time" }, ...data.dates]}
            value={dateValue}
            onChange={(value) => update(() => dateParams(value))}
            hrefFor={(value) => paramsHref(action, dateParams(value), view)}
          />
        </Group>
        <PlaceBox
          params={params}
          update={update}
          enhanced={enhanced}
          layout={layout}
          places={data.places}
          labels={data.labels}
          radii={data.radii}
          townListId={townListId}
        />
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium">
          <input
            type="checkbox"
            role="switch"
            name="evidence"
            value="confirmed"
            checked={confirmed}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              update((p) => withValues(p, "evidence", on ? ["confirmed"] : []));
            }}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-4 w-7 shrink-0 rounded-full bg-line-strong transition-colors duration-[120ms] after:absolute after:left-0.5 after:top-0.5 after:size-3 after:rounded-full after:bg-surface after:transition-transform after:duration-[120ms] peer-checked:bg-brand peer-checked:after:translate-x-3 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none motion-reduce:after:transition-none"
          />
          Confirmed only
        </label>
        <MoreFilters
          params={params}
          update={update}
          enhanced={enhanced}
          layout={layout}
          rounds={rounds}
          companySizes={data.companySizes}
          momentum={data.momentum}
          dateIsCustom={dateValue === "custom"}
          investorLabel={
            investor ? (data.labels[`investor:${investor}`] ?? investor) : ""
          }
          action={action}
          view={view}
        />
      </div>
    );
  }

  const resultLabel = data.total === 1 ? "result" : "results";

  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label="Filter rounds"
      onSubmit={(event) => {
        // With JavaScript every change has already applied.
        event.preventDefault();
      }}
    >
      {!enhanced ? (
        // Without JavaScript, phones toggle the controls with this checkbox.
        <input type="checkbox" id={toggleId} className="peer sr-only" />
      ) : null}
      <div className="flex items-center gap-2 peer-focus-visible:[&_[data-filters-toggle]]:outline-2 peer-focus-visible:[&_[data-filters-toggle]]:outline-offset-2 peer-focus-visible:[&_[data-filters-toggle]]:outline-[color:var(--focus)]">
        {/* Search lives in the top bar (app shell). Keep the term in the
            no-JavaScript submit; with JavaScript, `update` keeps it. */}
        {firstValue(params, "q") ? (
          <input type="hidden" name="q" value={firstValue(params, "q")} />
        ) : null}
        <div className="min-w-0 flex-1 max-md:hidden" />
        {enhanced ? (
          <div className="md:hidden">
            <Sheet
              triggerLabel={count > 0 ? `Filters (${count})` : "Filters"}
              title="Filters"
            >
              {controls("sheet")}
              <div className="sticky -bottom-4 -mx-4 -mb-4 mt-6 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
                <Button variant="ghost" onClick={() => update(() => ({}))}>
                  Clear
                </Button>
                <ShowResultsButton>
                  {isPending
                    ? "Updating…"
                    : `Show ${data.total.toLocaleString("en-GB")} ${resultLabel}`}
                </ShowResultsButton>
              </div>
            </Sheet>
          </div>
        ) : (
          <label
            htmlFor={toggleId}
            data-filters-toggle=""
            className={`${buttonClasses("secondary", "sm")} cursor-pointer md:hidden`}
          >
            {count > 0 ? `Filters (${count})` : "Filters"}
          </label>
        )}
      </div>

      <div
        className={`mt-3 max-md:hidden ${enhanced ? "" : "max-md:peer-checked:block"}`}
      >
        {controls("bar")}
        {!enhanced ? (
          <div className="mt-3">
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Apply filters
            </button>
          </div>
        ) : null}
      </div>

      <datalist id={townListId}>
        {data.towns.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {/* Values with no named field of their own. They stay in the URL. */}
      {!enhanced
        ? paramValues(params, "round").map((round) => (
            <input key={round} type="hidden" name="round" value={round} />
          ))
        : null}
      {paramValues(params, "tag").map((tag) => (
        <input key={tag} type="hidden" name="tag" value={tag} />
      ))}
      {Object.entries(view).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </form>
  );
}
