import Link from "next/link";
import type { InvestorActivityRow } from "@/core/read-models";
import { formatMoneyShort } from "@/lib/format";

/**
 * Phones (under 768 px): each row stacks as a block, and each cell with a
 * data-label shows "label ... value". The first cell (the name) has no label.
 */
const STACK_TABLE =
  "max-md:block max-md:[&_thead]:hidden max-md:[&_tbody]:block max-md:[&_tr]:block max-md:[&_tr]:py-3 max-md:[&_td]:block max-md:[&_th]:block max-md:[&_td]:p-0 max-md:[&_th]:p-0 max-md:[&_[data-label]]:flex max-md:[&_[data-label]]:justify-between max-md:[&_[data-label]]:gap-4 max-md:[&_[data-label]]:py-0.5 max-md:[&_[data-label]]:text-right max-md:[&_[data-label]]:before:text-left max-md:[&_[data-label]]:before:text-muted max-md:[&_[data-label]]:before:content-[attr(data-label)]";

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
      <div className="border-y border-line py-12">
        <p className="text-lg font-medium">
          {filtered
            ? "No investors match these filters"
            : "No investor activity yet"}
        </p>
        <p className="mt-2 max-w-xl text-muted">
          {filtered ? (
            <>
              Investors need at least 2 early rounds in the window to be listed.
              Try another theme, or{" "}
              <Link
                href="/investors"
                className="text-brand underline underline-offset-4"
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
      <table
        className={`w-full border-collapse text-left text-sm ${STACK_TABLE}`}
      >
        <caption className="sr-only">First-cheque activity by investor</caption>
        <thead className="border-b-2 border-ink text-muted">
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
              className="border-b border-line align-top"
            >
              <td className="py-3 pr-3">
                <Link
                  href={`/investors/${row.investor.slug}`}
                  className="font-semibold text-ink underline-offset-4 hover:text-brand hover:underline"
                >
                  {row.investor.name}
                </Link>
              </td>
              <td
                data-label="Led"
                className="px-3 py-3 text-right tabular-nums"
              >
                {row.led}
              </td>
              <td
                data-label="Joined"
                className="px-3 py-3 text-right tabular-nums"
              >
                {row.joined}
              </td>
              <td
                data-label="Median round size"
                className="py-3 pl-3 tabular-nums"
              >
                {row.medianRoundGbpMinor === null ? (
                  <span className="text-muted">Not reported</span>
                ) : (
                  formatMoneyShort(row.medianRoundGbpMinor, "GBP")
                )}
                <div className="text-xs text-muted">
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
