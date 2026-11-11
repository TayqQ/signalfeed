import { linearScale } from "@/lib/chart-scale";

const WIDTH = 96;
const HEIGHT = 24;
const PAD = 3;

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A small inline line with no axes, for a table cell beside the numbers.
 * `name` and `unit` build the accessible name, for example
 * "Weekly rounds over 26 weeks, from 2 to 9".
 */
export function Sparkline({
  values,
  name,
  unit = "weeks",
}: {
  values: readonly number[];
  name: string;
  unit?: string;
}) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return <span className="text-sm text-quiet">No data yet</span>;
  }

  const first = clean[0]!;
  const last = clean[clean.length - 1]!;
  const label = `${name} over ${clean.length} ${unit}, from ${formatCount(first)} to ${formatCount(last)}`;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const x = linearScale([0, Math.max(1, clean.length - 1)], [PAD, WIDTH - PAD]);
  // A flat series sits in the middle rather than on the floor.
  const y =
    max === min
      ? () => HEIGHT / 2
      : linearScale([min, max], [HEIGHT - PAD, PAD]);
  const points = clean.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const endX = x(clean.length - 1);
  const endY = y(last);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className="inline-block h-6 w-24 max-w-full align-middle"
    >
      {clean.length > 1 ? (
        <polyline
          points={points.join(" ")}
          fill="none"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ stroke: "var(--chart-line)" }}
        />
      ) : null}
      <circle
        cx={endX}
        cy={endY}
        r={2.5}
        style={{ fill: "var(--chart-line)" }}
      />
    </svg>
  );
}
