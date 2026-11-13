import { useId } from "react";
import {
  bandLayout,
  formatAxisValue,
  linearScale,
  niceTicks,
  stack,
} from "@/lib/chart-scale";
import { ChartFigure, EmptyChart } from "./chart-figure";

const WIDTH = 480;
const HEIGHT = 240;
const MARGIN = { top: 10, right: 8, bottom: 30, left: 38 };
const FONT_SIZE = 12;
const PATTERN_SIZE = 6;
const SERIES_COUNT = 4;

export interface ColumnCategory {
  /** Full label, used in the data table and the column tooltip. */
  label: string;
  /** Short label for the x-axis, shown only on every few columns. */
  axisLabel?: string;
}

export interface ColumnSeries {
  key: string;
  label: string;
  values: readonly number[];
}

function seriesFill(prefix: string, index: number): string {
  return `url(#${prefix}-${index % SERIES_COUNT})`;
}

/** Four fills that differ by pattern as well as colour. */
function PatternDefs({ prefix }: { prefix: string }) {
  const size = PATTERN_SIZE;
  const base = (i: number) => ({
    id: `${prefix}-${i}`,
    patternUnits: "userSpaceOnUse" as const,
    width: size,
    height: size,
  });
  const ground = (i: number) => (
    <rect
      width={size}
      height={size}
      style={{ fill: `var(--chart-${i + 1})` }}
    />
  );
  const mark = { stroke: "var(--chart-mark)", strokeWidth: 1.5 };
  return (
    <defs>
      <pattern {...base(0)}>{ground(0)}</pattern>
      <pattern {...base(1)} patternTransform="rotate(45)">
        {ground(1)}
        <line x1={0} y1={0} x2={0} y2={size} style={mark} />
      </pattern>
      <pattern {...base(2)}>
        {ground(2)}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={1.3}
          style={{ fill: "var(--chart-mark)" }}
        />
      </pattern>
      <pattern {...base(3)} patternTransform="rotate(45)">
        {ground(3)}
        <line x1={0} y1={0} x2={0} y2={size} style={mark} />
        <line x1={0} y1={0} x2={size} y2={0} style={mark} />
      </pattern>
    </defs>
  );
}

function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Weekly columns, stacked when there is more than one series. Stacked series
 * differ by fill pattern as well as colour, and have a text legend.
 */
export function ColumnChart({
  title,
  summary,
  categories,
  series,
  valueLabel = "Count",
  labelEvery = 4,
  formatValue = (n) => formatAxisValue(n),
}: {
  /** Accessible name of the SVG. */
  title: string;
  /** One sentence stating the main finding. */
  summary: string;
  categories: readonly ColumnCategory[];
  series: readonly ColumnSeries[];
  /** Name of the measure, for the table, such as "Rounds". */
  valueLabel?: string;
  /** Show an x label on every nth column. */
  labelEvery?: number;
  /** Formats y-axis labels. */
  formatValue?: (value: number) => string;
}) {
  const id = safeId(useId());
  const hasData =
    categories.length > 0 &&
    series.length > 0 &&
    series.some((s) => s.values.some((v) => Number.isFinite(v) && v > 0));
  if (!hasData) return <EmptyChart summary={summary} />;

  const stacked = series.length > 1;
  const { layers, totals } = stack(
    series.map((s) => ({ key: s.key, values: s.values })),
  );
  const ticks = niceTicks(Math.max(...totals.slice(0, categories.length)), 4);
  const yMax = ticks[ticks.length - 1]!;
  const plotLeft = MARGIN.left;
  const plotRight = WIDTH - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const y = linearScale([0, yMax], [plotBottom, plotTop]);
  const bands = bandLayout(
    categories.length,
    plotRight - plotLeft,
    categories.length > 26 ? 2 : 6,
  );
  const every = Math.max(1, Math.floor(labelEvery));
  const patternPrefix = `${id}-fill`;
  const swatchPrefix = `${id}-key`;

  const legend = stacked ? (
    <ul
      aria-label="Legend"
      className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm"
    >
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
            <PatternDefs prefix={swatchPrefix} />
            <rect
              width={14}
              height={14}
              fill={seriesFill(swatchPrefix, i)}
              style={{ stroke: "var(--chart-axis)", strokeWidth: 0.5 }}
            />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  ) : null;

  const tableColumns = stacked
    ? [...series.map((s) => s.label), "Total"]
    : [valueLabel];
  const tableRows = categories.map((category, i) => {
    const values = series.map((s) => s.values[i] ?? 0);
    return {
      label: category.label,
      values: stacked ? [...values, totals[i] ?? 0] : values,
    };
  });

  return (
    <ChartFigure
      summary={summary}
      legend={legend}
      table={{
        caption: `${title}: data`,
        rowHeader: "Period",
        columns: tableColumns,
        rows: tableRows,
      }}
    >
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
        fontSize={FONT_SIZE}
      >
        <PatternDefs prefix={patternPrefix} />
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={y(tick)}
              y2={y(tick)}
              style={{ stroke: "var(--chart-grid)" }}
              strokeWidth={1}
            />
            <text
              x={plotLeft - 6}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              style={{ fill: "var(--chart-text)" }}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          style={{ stroke: "var(--chart-axis)" }}
          strokeWidth={1}
        />
        {bands.map((band, i) => {
          const category = categories[i]!;
          return (
            <g key={`${category.label}-${i}`}>
              <title>{`${category.label}: ${formatValue(totals[i] ?? 0)}`}</title>
              {layers.map((layer, layerIndex) => {
                const segment = layer.segments[i]!;
                const top = y(segment.end);
                const height = y(segment.start) - top;
                if (height <= 0) return null;
                return (
                  <rect
                    key={layer.key}
                    x={plotLeft + band.x}
                    y={top}
                    width={band.width}
                    height={height}
                    fill={seriesFill(patternPrefix, layerIndex)}
                    style={{ stroke: "var(--chart-gap)", strokeWidth: 0.5 }}
                  />
                );
              })}
              {i % every === 0 ? (
                <text
                  x={plotLeft + band.x + band.width / 2}
                  y={plotBottom + 16}
                  textAnchor="middle"
                  style={{ fill: "var(--chart-text)" }}
                >
                  {category.axisLabel ?? category.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}
