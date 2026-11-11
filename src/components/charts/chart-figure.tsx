import type { ReactNode } from "react";

export interface ChartTable {
  /** Names the table for screen readers. */
  caption: string;
  /** Header of the first column, for example "Week starting". */
  rowHeader: string;
  /** Headers of the value columns. */
  columns: readonly string[];
  rows: ReadonlyArray<{
    label: string;
    values: ReadonlyArray<string | number>;
  }>;
}

/**
 * A chart as a figure: the graphic, a one-sentence finding as the caption, an
 * optional legend, and the same data as a table under "Show data".
 */
export function ChartFigure({
  summary,
  table,
  legend,
  children,
}: {
  summary: string;
  table: ChartTable;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="my-0">
      {children}
      {legend}
      <figcaption className="mt-2 text-sm text-quiet">{summary}</figcaption>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-signal">Show data</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full border-collapse text-left tabular-nums">
            <caption className="sr-only">{table.caption}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-rule py-1 pr-4">
                  {table.rowHeader}
                </th>
                {table.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-rule py-1 pr-4 text-right"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={`${row.label}-${index}`}>
                  <th
                    scope="row"
                    className="border-b border-rule py-1 pr-4 font-normal"
                  >
                    {row.label}
                  </th>
                  {row.values.map((value, i) => (
                    <td
                      key={i}
                      className="border-b border-rule py-1 pr-4 text-right"
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Shown instead of an empty SVG. */
export function EmptyChart({ summary }: { summary: string }) {
  return (
    <figure className="my-0">
      <p className="rounded border border-dashed border-rule p-4 text-sm text-quiet">
        No data yet
      </p>
      <figcaption className="mt-2 text-sm text-quiet">{summary}</figcaption>
    </figure>
  );
}
