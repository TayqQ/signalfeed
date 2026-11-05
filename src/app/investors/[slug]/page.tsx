import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ROUND_TYPES } from "@/core/enums";
import { RoundAmount } from "@/components/round-amount";
import { getInvestorDetail } from "@/db/queries/investors";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { formatDate, formatRoundType } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function load(slug: string) {
  return cached(() => getInvestorDetail(getWebDb(), slug), ["investor", slug]);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const investor = await load((await params).slug);
  return {
    title: investor
      ? `${investor.name} investments | SignalFeed`
      : "Investor not found | SignalFeed",
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
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        {investor.name}
      </h1>
      {investor.rounds.length > 0 ? (
        <p className="mt-3 text-quiet">
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
          <p className="text-quiet">No rounds recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="border-b-2 border-ink text-quiet">
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
                    className="border-b border-rule align-top"
                  >
                    <td className="py-3 pr-3">
                      <Link
                        href={`/companies/${row.companySlug}`}
                        className="font-semibold underline-offset-4 hover:text-signal hover:underline"
                      >
                        {row.companyName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {row.roundLabel ?? formatRoundType(row.roundType)}
                    </td>
                    <td className="px-3 py-3">
                      <RoundAmount
                        amount={row.amount}
                        amountGbpMinor={row.amountGbpMinor}
                        roundType={row.roundType}
                      />
                    </td>
                    <td className="px-3 py-3">{ROLE_LABEL[row.role]}</td>
                    <td className="whitespace-nowrap py-3 pl-3 tabular-nums">
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
