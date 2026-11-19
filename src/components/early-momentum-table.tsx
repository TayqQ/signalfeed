import Link from "next/link";
import type { EarlyMomentumRow } from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import { describeScore } from "@/lib/rising-score";
import { HistoryNotice } from "./rising-themes-table";

/**
 * Phones (under 768 px): each row stacks as a block, and each cell with a
 * data-label shows "label ... value". The first cell (the name) has no label.
 */
const STACK_TABLE =
  "max-md:block max-md:[&_thead]:hidden max-md:[&_tbody]:block max-md:[&_tr]:block max-md:[&_tr]:py-3 max-md:[&_td]:block max-md:[&_th]:block max-md:[&_td]:p-0 max-md:[&_th]:p-0 max-md:[&_[data-label]]:flex max-md:[&_[data-label]]:justify-between max-md:[&_[data-label]]:gap-4 max-md:[&_[data-label]]:py-0.5 max-md:[&_[data-label]]:text-right max-md:[&_[data-label]]:before:text-left max-md:[&_[data-label]]:before:text-muted max-md:[&_[data-label]]:before:content-[attr(data-label)]";

function percent(share: number | null): string {
  return share === null ? "Too few companies" : `${Math.round(share * 100)}%`;
}

/**
 * Themes where pre-seed and seed rounds are picking up and few companies have
 * reached Series A. Empty while there is not enough history.
 */
export function EarlyMomentumTable({
  rows,
  notEnoughHistory,
  firstWeek,
}: {
  rows: EarlyMomentumRow[];
  notEnoughHistory: boolean;
  firstWeek: string | null;
}) {
  if (notEnoughHistory) return <HistoryNotice firstWeek={firstWeek} />;
  if (rows.length === 0) {
    return (
      <p className="border-y border-line py-8 text-muted">
        No theme meets all three tests yet: 3 or more early rounds in the last 8
        weeks, a score above 0, and 25% or fewer of its companies at Series A or
        later.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full border-collapse text-left text-sm ${STACK_TABLE}`}
      >
        <caption className="sr-only">
          Themes with rising early-stage activity
        </caption>
        <thead className="border-b-2 border-ink text-muted">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Theme
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Sector
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Early rounds, last 8 weeks
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Early score
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Late share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.theme.slug} className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-medium">
                <Link
                  href={`/themes/${row.theme.slug}`}
                  className="text-brand underline underline-offset-4"
                >
                  {row.theme.name}
                </Link>
              </th>
              <td data-label="Sector" className="px-3 py-3 text-muted">
                {row.theme.sector ? SECTOR_LABELS[row.theme.sector] : ""}
              </td>
              <td
                data-label="Early rounds, last 8 weeks"
                className="px-3 py-3 text-right tabular-nums"
              >
                {row.recentEarlyRounds}
              </td>
              <td data-label="Early score" className="px-3 py-3">
                <span className="tabular-nums font-medium">
                  +{row.score.toFixed(2)}
                </span>{" "}
                <span className="text-muted">{describeScore(row.score)}</span>
              </td>
              <td
                data-label="Late share"
                className="py-3 pl-3 text-right tabular-nums"
              >
                {percent(row.lateShare)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
