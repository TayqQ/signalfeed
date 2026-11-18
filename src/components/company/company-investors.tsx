import Link from "next/link";
import type { CompanyEvent } from "@/core/read-models";
import { fundingRoundsOf } from "@/components/event-timeline";
import { formatRoundType } from "@/lib/format";
import { CompanyPanel } from "./panel";

export interface CompanyInvestor {
  slug: string;
  name: string;
  /** Led at least one of the company's rounds. */
  lead: boolean;
  /** The rounds the investor took part in, newest first, for example "Series A". */
  rounds: string[];
}

/** Every investor across the company's rounds, leads first, then by name. */
export function companyInvestors(
  events: readonly CompanyEvent[],
): CompanyInvestor[] {
  const bySlug = new Map<string, CompanyInvestor>();
  for (const round of fundingRoundsOf(events)) {
    const label = round.roundLabel ?? formatRoundType(round.roundType);
    for (const investor of round.investors) {
      const entry = bySlug.get(investor.slug) ?? {
        slug: investor.slug,
        name: investor.name,
        lead: false,
        rounds: [],
      };
      entry.lead ||= investor.role === "lead";
      if (!entry.rounds.includes(label)) entry.rounds.push(label);
      bySlug.set(investor.slug, entry);
    }
  }
  return [...bySlug.values()].sort(
    (a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name),
  );
}

export function CompanyInvestors({
  events,
}: {
  events: readonly CompanyEvent[];
}) {
  const investors = companyInvestors(events);
  const angels = fundingRoundsOf(events).some(
    (round) => round.includesIndividualAngels,
  );
  return (
    <CompanyPanel
      headingId="investors-heading"
      title={
        <>
          Investors
          {investors.length > 0 ? (
            <span className="ml-1.5 font-sans text-[13px] font-normal text-muted">
              ({investors.length})
            </span>
          ) : null}
        </>
      }
    >
      {investors.length > 0 ? (
        <ul className="divide-y divide-line">
          {investors.map((investor) => (
            <li
              key={investor.slug}
              className="flex items-start justify-between gap-3 py-2 text-[13px] first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <Link
                  href={`/investors/${investor.slug}`}
                  className="font-medium text-ink underline-offset-4 hover:text-brand hover:underline"
                >
                  {investor.name}
                </Link>
                <span className="block text-xs text-muted">
                  {investor.rounds.join(", ")}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs ${investor.lead ? "font-semibold text-ink" : "text-muted"}`}
              >
                {investor.lead ? "Lead" : "Participant"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">
          No investors named in the reports yet.
        </p>
      )}
      {angels ? (
        <p className="mt-3 text-xs text-muted">
          Individual angels also took part.
        </p>
      ) : null}
    </CompanyPanel>
  );
}
