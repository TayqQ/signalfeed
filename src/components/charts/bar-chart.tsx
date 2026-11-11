import { formatAxisValue, linearScale } from "@/lib/chart-scale";
import { ChartFigure, EmptyChart } from "./chart-figure";

const WIDTH = 480;
const ROW_HEIGHT = 38;
const LABEL_BASELINE = 14;
const BAR_TOP = 21;
const BAR_HEIGHT = 11;
const FONT_SIZE = 13;
const MAX_LABEL = 40;

export interface BarItem {
  label: string;
  value: number;
}

function truncate(text: string): string {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/**
 * Horizontal bars with the label above each bar and the value at the right.
 * Every bar has its value written next to it, so length is never the only cue.
 */
export function BarChart({
  title,
  summary,
  items,
  valueLabel = "Count",
  formatValue = (n) => formatAxisValue(n),
}: {
  /** Accessible name of the SVG. */
  title: string;
  /** One sentence stating the main finding. */
  summary: string;
  items: readonly BarItem[];
  /** Name of the measure, for the table, such as "Rounds led". */
  valueLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const rows = items.filter((item) => Number.isFinite(item.value));
  if (rows.length === 0) return <EmptyChart summary={summary} />;

  const max = Math.max(...rows.map((r) => Math.max(0, r.value)));
  const x = linearScale([0, max], [0, WIDTH]);
  const height = rows.length * ROW_HEIGHT;

  return (
    <ChartFigure
      summary={summary}
      table={{
        caption: `${title}: data`,
        rowHeader: "Name",
        columns: [valueLabel],
        rows: rows.map((r) => ({
          label: r.label,
          values: [formatValue(r.value)],
        })),
      }}
    >
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
        fontSize={FONT_SIZE}
      >
        {rows.map((row, i) => {
          const top = i * ROW_HEIGHT;
          const barWidth = row.value > 0 ? Math.max(2, x(row.value)) : 0;
          return (
            <g key={`${row.label}-${i}`}>
              <title>{`${row.label}: ${formatValue(row.value)}`}</title>
              <text
                x={0}
                y={top + LABEL_BASELINE}
                style={{ fill: "var(--color-ink)" }}
              >
                {truncate(row.label)}
              </text>
              <text
                x={WIDTH}
                y={top + LABEL_BASELINE}
                textAnchor="end"
                fontWeight={600}
                style={{ fill: "var(--color-ink)" }}
              >
                {formatValue(row.value)}
              </text>
              <rect
                x={0}
                y={top + BAR_TOP}
                width={WIDTH}
                height={BAR_HEIGHT}
                style={{ fill: "var(--chart-grid)" }}
              />
              {barWidth > 0 ? (
                <rect
                  x={0}
                  y={top + BAR_TOP}
                  width={barWidth}
                  height={BAR_HEIGHT}
                  style={{ fill: "var(--chart-bar)" }}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}
