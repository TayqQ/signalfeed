import Link from "next/link";
import type { InvestorActivityRow } from "@/core/read-models";
import { formatMoneyCompact } from "@/lib/format";

/** "3 of 4 with amounts". */
export function describeAmountCoverage(row: {
  roundsWithAmount: number;
  rounds: number;
}): string {
  return `${row.roundsWithAmount} of ${row.rounds} with amounts`;
}

export function InvestorActivityTable({
  rows,
  filtered,
}: {
  rows: readonly InvestorActivityRow[];
  /** True when a theme or sector is chosen, which changes the empty message. */
  filtered: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="border-y border-rule py-12">
        <p className="text-lg font-medium">
          {filtered
            ? "No investors match these filters"
            : "No investor activity yet"}
        </p>
        <p className="mt-2 max-w-xl text-quiet">
          {filtered ? (
            <>
              Investors need at least 2 early rounds in the window to be listed.
              Try another theme, or{" "}
              <Link
                href="/investors"
                className="text-signal underline underline-offset-4"
              >
                reset the filters
              </Link>
              .
            </>
          ) : (
            "Investors need at least 2 pre-seed or seed rounds in the last 12 months to be listed."
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption className="sr-only">First-cheque activity by investor</caption>
        <thead className="border-b-2 border-ink text-quiet">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Investor
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Led
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Joined
            </th>
            <th scope="col" className="py-2 pl-3 font-medium">
              Median round size
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.investor.slug}
              className="border-b border-rule align-top"
            >
              <td className="py-3 pr-3">
                <Link
                  href={`/investors/${row.investor.slug}`}
                  className="font-semibold text-ink underline-offset-4 hover:text-signal hover:underline"
                >
                  {row.investor.name}
                </Link>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{row.led}</td>
              <td className="px-3 py-3 text-right tabular-nums">
                {row.joined}
              </td>
              <td className="py-3 pl-3 tabular-nums">
                {row.medianRoundGbpMinor === null ? (
                  <span className="text-quiet">Not reported</span>
                ) : (
                  formatMoneyCompact(row.medianRoundGbpMinor, "GBP")
                )}
                <div className="text-xs text-quiet">
                  {describeAmountCoverage(row)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
