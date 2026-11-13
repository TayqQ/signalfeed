import Link from "next/link";
import type { RisingThemeRow } from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import { describeScore } from "@/lib/rising-score";
import { Sparkline } from "./charts/sparkline";

/** The "not enough history" notice shared by both trend tables. */
export function HistoryNotice({ firstWeek }: { firstWeek: string | null }) {
  return (
    <p
      role="note"
      className="mb-4 max-w-2xl border-l-4 border-signal bg-zinc-50 px-3 py-2 text-sm"
    >
      Trends need at least 16 weeks of data.{" "}
      {firstWeek
        ? `Collection started on ${formatDate(firstWeek)}.`
        : "Collection has not started yet."}{" "}
      Scores appear once there is enough history. Recent counts are shown now.
    </p>
  );
}

/** Text label for a score, so colour is never the only cue. */
export function scoreLabel(score: number | null): string {
  if (score === null) return "not enough history yet";
  if (score >= 0.1) return `rising: ${describeScore(score)}`;
  if (score <= -0.1) return `falling: ${describeScore(score)}`;
  return `steady: ${describeScore(score)}`;
}

/**
 * Themes with at least 3 recent rounds, in the order given. Without history
 * the score cell says so and the counts still show.
 */
export function RisingThemesTable({
  rows,
  notEnoughHistory,
  firstWeek,
}: {
  rows: RisingThemeRow[];
  notEnoughHistory: boolean;
  firstWeek: string | null;
}) {
  return (
    <div>
      {notEnoughHistory ? <HistoryNotice firstWeek={firstWeek} /> : null}
      {rows.length === 0 ? (
        <p className="border-y border-rule py-8 text-quiet">
          No theme has 3 or more rounds in the last 8 weeks yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Themes with the most rounds against their usual share
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
                  Rounds, last 8 weeks
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Rising score
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Total raised
                </th>
                <th scope="col" className="py-2 pl-3 font-medium">
                  26 weeks
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
                    {row.recentRounds}
                  </td>
                  <td className="px-3 py-3">
                    {row.score === null ? (
                      <span className="text-quiet">
                        {scoreLabel(row.score)}
                      </span>
                    ) : (
                      <>
                        <span className="tabular-nums font-medium">
                          {row.score >= 0 ? "+" : "−"}
                          {Math.abs(row.score).toFixed(2)}
                        </span>{" "}
                        <span className="text-quiet">
                          {scoreLabel(row.score)}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.recentGbpMinor > 0
                      ? formatMoneyCompact(row.recentGbpMinor, "GBP")
                      : "Not known"}
                  </td>
                  <td className="py-3 pl-3">
                    <Sparkline
                      name={`Weekly rounds in ${row.theme.name}`}
                      values={row.sparkline}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
