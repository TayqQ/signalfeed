import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ROUND_TYPES } from "@/core/enums";
import { RoundAmount } from "@/components/round-amount";
import { getInvestorDetail } from "@/db/queries/investors";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { formatDate, formatRoundType } from "@/lib/format";

/**
 * Phones (under 768 px): each row stacks as a block, and each cell with a
 * data-label shows "label ... value". The first cell (the name) has no label.
 */
const STACK_TABLE =
  "max-md:block max-md:[&_thead]:hidden max-md:[&_tbody]:block max-md:[&_tr]:block max-md:[&_tr]:py-3 max-md:[&_td]:block max-md:[&_th]:block max-md:[&_td]:p-0 max-md:[&_th]:p-0 max-md:[&_[data-label]]:flex max-md:[&_[data-label]]:justify-between max-md:[&_[data-label]]:gap-4 max-md:[&_[data-label]]:py-0.5 max-md:[&_[data-label]]:text-right max-md:[&_[data-label]]:before:text-left max-md:[&_[data-label]]:before:text-muted max-md:[&_[data-label]]:before:content-[attr(data-label)]";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function load(slug: string) {
  return cached(() => getInvestorDetail(getWebDb(), slug), ["investor", slug]);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const investor = await load((await params).slug);
  return {
    title: investor ? `${investor.name} investments` : "Investor not found",
  };
}

const ROLE_LABEL = {
  lead: "Lead",
  participant: "Participant",
  unknown: "Unknown",
};

export default async function InvestorPage({ params }: Params) {
  const investor = await load((await params).slug);
  if (!investor) notFound();
  if (investor.redirectToSlug) {
    permanentRedirect(`/investors/${investor.redirectToSlug}`);
  }

  const counts = ROUND_TYPES.filter(
    (round) => investor.roundTypeCounts[round] > 0,
  );

  return (
    <main>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {investor.name}
      </h1>
      {investor.rounds.length > 0 ? (
        <p className="mt-3 text-muted">
          {counts
            .map(
              (round) =>
                `${investor.roundTypeCounts[round]} ${formatRoundType(round).toLowerCase()}`,
            )
            .join(", ")}
        </p>
      ) : null}

      <section className="mt-8" aria-label="Rounds">
        {investor.rounds.length === 0 ? (
          <p className="text-muted">No rounds recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className={`w-full border-collapse text-left text-sm ${STACK_TABLE}`}
            >
              <thead className="border-b-2 border-ink text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Company
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Round
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Role
                  </th>
                  <th scope="col" className="py-2 pl-3 font-medium">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {investor.rounds.map((row) => (
                  <tr
                    key={row.eventId}
                    className="border-b border-line align-top"
                  >
                    <td className="py-3 pr-3">
                      <Link
                        href={`/companies/${row.companySlug}`}
                        className="font-semibold underline-offset-4 hover:text-brand hover:underline"
                      >
                        {row.companyName}
                      </Link>
                    </td>
                    <td
                      data-label="Round"
                      className="whitespace-nowrap px-3 py-3"
                    >
                      {row.roundLabel ?? formatRoundType(row.roundType)}
                    </td>
                    <td data-label="Amount" className="px-3 py-3">
                      <RoundAmount
                        amount={row.amount}
                        amountGbpMinor={row.amountGbpMinor}
                        roundType={row.roundType}
                      />
                    </td>
                    <td data-label="Role" className="px-3 py-3">
                      {ROLE_LABEL[row.role]}
                    </td>
                    <td
                      data-label="Date"
                      className="whitespace-nowrap py-3 pl-3 tabular-nums"
                    >
                      {formatDate(row.announcedOn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
