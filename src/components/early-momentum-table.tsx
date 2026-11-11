import Link from "next/link";
import type { EarlyMomentumRow } from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import { describeScore } from "@/lib/rising-score";
import { HistoryNotice } from "./rising-themes-table";

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
      <p className="border-y border-rule py-8 text-quiet">
        No theme meets all three tests yet: 3 or more early rounds in the last 8
        weeks, a score above 0, and 25% or fewer of its companies at Series A or
        later.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">
          Themes with rising early-stage activity
        </caption>
        <thead className="border-b-2 border-ink text-quiet">
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
            <tr key={row.theme.slug} className="border-b border-rule">
              <th scope="row" className="py-3 pr-3 font-medium">
                <Link
                  href={`/themes/${row.theme.slug}`}
                  className="text-signal underline underline-offset-4"
                >
                  {row.theme.name}
                </Link>
              </th>
              <td className="px-3 py-3 text-quiet">
                {row.theme.sector ? SECTOR_LABELS[row.theme.sector] : ""}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {row.recentEarlyRounds}
              </td>
              <td className="px-3 py-3">
                <span className="tabular-nums font-medium">
                  +{row.score.toFixed(2)}
                </span>{" "}
                <span className="text-quiet">{describeScore(row.score)}</span>
              </td>
              <td className="py-3 pl-3 text-right tabular-nums">
                {percent(row.lateShare)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
