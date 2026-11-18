import Link from "next/link";
import type { FundingRoundEvent } from "@/core/read-models";
import { describeRoundMomentum } from "@/components/company-momentum";
import {
  confirmationText,
  eventDateLabel,
  isConfirmed,
} from "@/components/event-timeline";
import { Amount } from "@/components/ui/amount";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { StageChip } from "@/components/ui/stage-chip";
import { CompanyPanel } from "./panel";

/** The proof under a confirmed round: the record that backs it. */
function proofLine(round: FundingRoundEvent): string {
  const first = round.confirmations?.[0];
  if (!first) {
    return round.roundType === "grant"
      ? "From the UKRI Gateway to Research grant record."
      : "Backed by an official record.";
  }
  const body = first.text.replace(/^Confirmed:\s*/, "");
  const sentence = `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
  return first.confirmsAmount
    ? `${sentence} The filed amount agrees with the reports.`
    : sentence;
}

/**
 * The latest funding round: amount, stage, date, the lead investors, and
 * either the proof box (when an official record confirms it) or a plain
 * "from news reports only" line.
 */
export function LatestRound({
  round,
  companyName,
}: {
  round: FundingRoundEvent | null;
  companyName: string;
}) {
  if (!round) {
    return (
      <CompanyPanel title="Latest round" headingId="latest-round-heading">
        <EmptyState title="No funding round recorded yet">
          We have not seen a funding round for {companyName} in the news or in
          official records.
        </EmptyState>
      </CompanyPanel>
    );
  }

  const leads = round.investors.filter((investor) => investor.role === "lead");
  const momentum = describeRoundMomentum(round.momentum);
  const sources = round.sourceCount;

  return (
    <CompanyPanel
      title="Latest round"
      headingId="latest-round-heading"
      aside={
        <time
          dateTime={round.announcedOn.slice(0, 10)}
          className="tabular-nums"
        >
          {eventDateLabel(round)}
        </time>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Amount
          amount={round.amount}
          amountGbpMinor={round.amountGbpMinor}
          size="lg"
        />
        <StageChip
          roundType={round.roundType}
          label={round.roundLabel ?? undefined}
        />
      </div>
      <dl className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">Led by</dt>
        <dd className="min-w-0 text-ink">
          {leads.length > 0 ? (
            leads.map((lead, index) => (
              <span key={lead.slug}>
                {index > 0 ? ", " : null}
                <Link
                  href={`/investors/${lead.slug}`}
                  className="underline-offset-4 hover:text-brand hover:underline"
                >
                  {lead.name}
                </Link>
              </span>
            ))
          ) : (
            <span className="text-muted">Not named in reports yet</span>
          )}
        </dd>
        {momentum ? (
          <>
            <dt className="hidden text-muted sm:block">Momentum</dt>
            <dd className="hidden text-ink sm:block">{momentum}</dd>
          </>
        ) : null}
      </dl>
      {isConfirmed(round) ? (
        <p className="mt-3 rounded-[var(--radius-sm)] border border-line bg-surface-sunk p-2.5 text-[13px] leading-snug text-ink">
          <ConfirmedMark text={confirmationText(round)} /> {proofLine(round)}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          From news reports only
          {sources > 0
            ? ` · ${sources} ${sources === 1 ? "source" : "sources"}`
            : ""}
        </p>
      )}
    </CompanyPanel>
  );
}
