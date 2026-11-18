import Link from "next/link";
import type { RecordKind } from "@/core/enums";
import type {
  CompanyPreview,
  CompanyPreviewRound,
  FundingRow,
} from "@/core/read-models";
import { ActionRow } from "@/components/company/action-row";
import { Icon, type IconName } from "@/components/company/icons";
import { KeyFacts, type KeyFact } from "@/components/company/key-facts";
import { CompanyPanel } from "@/components/company/panel";
import { RECENT_ROUND_DAYS } from "@/components/company/signals";
import { HISTORY_STARTS } from "@/components/company-momentum";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { Monogram } from "@/components/ui/monogram";
import { PlaceBadge } from "@/components/ui/place-badge";
import { daysSince, relativeDateLabel } from "@/components/ui/relative-date";
import { SectorLabel } from "@/components/ui/sector-label";
import { StageChip } from "@/components/ui/stage-chip";
import {
  formatCompanyAge,
  formatDate,
  formatMoneyShort,
  formatRoundType,
} from "@/lib/format";
import { NO_DESCRIPTION, chipLabel } from "./round-row-parts";

/**
 * What the preview pane shows for the selected row:
 * - `ready`: the company preview;
 * - `waiting`: the request is under 150 ms old, so the previous preview stays
 *   (dimmed and inert) rather than flashing a skeleton;
 * - `loading`: the skeleton, after 150 ms;
 * - `missing`: the company has no preview (404);
 * - `error`: the request failed.
 */
export type PreviewState =
  | { kind: "ready"; preview: CompanyPreview }
  | { kind: "waiting"; held: CompanyPreview | null }
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" };

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function roundAmountLabel(round: CompanyPreviewRound): string | null {
  if (round.amountGbpMinor !== null) {
    return formatMoneyShort(round.amountGbpMinor, "GBP");
  }
  if (round.amount) {
    return formatMoneyShort(round.amount.amountMinor, round.amount.currency);
  }
  return null;
}

function roundStageLabel(round: CompanyPreviewRound): string | null {
  const clean = chipLabel(round.roundLabel);
  if (clean) return clean;
  if (round.roundType !== "unknown") return formatRoundType(round.roundType);
  return round.roundLabel?.trim() || null;
}

/**
 * The six preview facts: last round, stage, founded, recent rounds, sources
 * and the Companies House number. Missing values are null ("Not known"), or
 * a muted note where "Not known" would mislead.
 */
export function previewFacts(preview: CompanyPreview, now: Date): KeyFact[] {
  const round = preview.latestRound;
  const amount = round ? roundAmountLabel(round) : null;

  let founded: KeyFact = { label: "Founded", value: null, sub: null };
  if (preview.foundedYear !== null) {
    const age = formatCompanyAge(preview.foundedYear, now.toISOString());
    founded = {
      label: "Founded",
      value: String(preview.foundedYear),
      sub: age ? `${age} old` : null,
    };
  } else if (preview.registry) {
    founded = {
      label: "Founded",
      value: preview.registry.incorporatedOn.slice(0, 4),
      sub: "Incorporated",
    };
  }

  const registry = preview.registry;
  const outsideUk =
    preview.countryCode !== null && preview.countryCode !== "GB";
  const companiesHouse: KeyFact = registry
    ? {
        label: "Companies House",
        value: registry.companyNumber,
        sub: registry.statusLabel,
      }
    : {
        label: "Companies House",
        value: outsideUk ? "UK companies only" : "No match yet",
        sub: null,
        quiet: true,
      };

  return [
    {
      label: "Last round",
      value: round ? (amount ?? "Undisclosed") : null,
      sub: round ? formatDate(round.announcedOn) : null,
      quiet: round !== null && amount === null,
    },
    { label: "Stage", value: round ? roundStageLabel(round) : null, sub: null },
    founded,
    {
      label: "Recent rounds",
      value: String(preview.roundsInLast24Months),
      sub: "In 24 months",
    },
    {
      label: "Sources",
      value: round ? String(round.sourceCount) : null,
      sub: round ? plural(round.sourceCount, "report", "reports") : null,
    },
    companiesHouse,
  ];
}

export interface PreviewSignal {
  id: "confirmed" | "recent" | "first" | "again" | "sources" | "registry";
  icon: IconName;
  text: string;
  detail: string | null;
}

const CONFIRMED_BY: Readonly<Record<RecordKind, string>> = {
  ch_allotment: "Confirmed by a Companies House filing",
  sec_form_d: "Confirmed by an SEC Form D filing",
  ukri_grant: "Confirmed by a UKRI grant record",
};

/** "Confirmed: shares allotted on ..." as "Shares allotted on ...". */
function recordDetail(text: string): string {
  const body = text.replace(/^Confirmed:\s*/, "");
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/**
 * The company page's plain-words signals (077), worked out from the preview's
 * inputs. Each is a rule over stored facts; a signal whose fact is missing is
 * left out. The preview has no round history, so "raised again" becomes the
 * count of equity rounds in the last 24 months, and the Companies House
 * status (the company page's records panel) joins the list.
 */
export function previewSignals(
  preview: CompanyPreview,
  now: Date,
): PreviewSignal[] {
  const round = preview.latestRound;
  const signals: PreviewSignal[] = [];
  if (round) {
    if (preview.signals.confirmed) {
      const kind =
        round.confirmation?.kind ??
        (round.roundType === "grant" ? "ukri_grant" : null);
      signals.push({
        id: "confirmed",
        icon: "check",
        text: kind ? CONFIRMED_BY[kind] : "Confirmed by an official record",
        detail: round.confirmation
          ? recordDetail(round.confirmation.text)
          : null,
      });
    }
    const days = daysSince(round.announcedOn, now);
    if (days >= 0 && days <= RECENT_ROUND_DAYS) {
      signals.push({
        id: "recent",
        icon: "clock",
        text: `Raised in the last ${RECENT_ROUND_DAYS} days`,
        detail: relativeDateLabel(round.announcedOn, now),
      });
    }
    if (preview.signals.firstRoundOn === round.announcedOn) {
      signals.push({
        id: "first",
        icon: "flag",
        text: "First round we have recorded",
        detail: `History starts in ${HISTORY_STARTS}`,
      });
    }
  }
  if (preview.roundsInLast24Months >= 2) {
    signals.push({
      id: "again",
      icon: "repeat",
      text: `${preview.roundsInLast24Months} equity rounds in the last 24 months`,
      detail: null,
    });
  }
  if (round && round.sourceCount >= 2) {
    signals.push({
      id: "sources",
      icon: "doc",
      text: `Reported by ${round.sourceCount} sources`,
      detail: null,
    });
  }
  if (preview.registry) {
    signals.push({
      id: "registry",
      icon: "building",
      text: `Companies House status: ${preview.registry.statusLabel}`,
      detail: `Company number ${preview.registry.companyNumber}`,
    });
  }
  return signals;
}

function statusChips(preview: CompanyPreview): string[] {
  if (preview.status === "acquired") return ["Acquired"];
  if (preview.status === "closed") return ["Closed"];
  return [];
}

function PreviewRound({ round }: { round: CompanyPreviewRound | null }) {
  if (!round) {
    return (
      <CompanyPanel title="Latest round" headingId="preview-round-heading">
        <p className="text-[13px] text-muted">No funding round recorded yet.</p>
      </CompanyPanel>
    );
  }
  const sources = round.sourceCount;
  return (
    <CompanyPanel
      title="Latest round"
      headingId="preview-round-heading"
      aside={
        <time dateTime={round.announcedOn} className="tabular-nums">
          {formatDate(round.announcedOn)}
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
          label={chipLabel(round.roundLabel)}
        />
      </div>
      <dl className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">Led by</dt>
        <dd className="min-w-0 text-ink">
          {round.leadInvestors.length > 0 ? (
            round.leadInvestors.map((lead, index) => (
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
        <dt className="text-muted">Investors</dt>
        <dd className="text-ink">
          {round.investorCount > 0 ? (
            `${round.investorCount} ${plural(round.investorCount, "investor", "investors")}`
          ) : (
            <span className="text-muted">Not reported</span>
          )}
        </dd>
      </dl>
      {round.confirmation ? (
        <p className="mt-3 rounded-[var(--radius-sm)] border border-line bg-surface-sunk p-2.5 text-[13px] leading-snug text-ink">
          <ConfirmedMark text={round.confirmation.text} />{" "}
          {recordDetail(round.confirmation.text)}.
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          From news reports only
          {sources > 0
            ? ` · ${sources} ${plural(sources, "source", "sources")}`
            : ""}
        </p>
      )}
    </CompanyPanel>
  );
}

function PreviewSignals({
  preview,
  now,
}: {
  preview: CompanyPreview;
  now: Date;
}) {
  const signals = previewSignals(preview, now);
  return (
    <CompanyPanel title="Signals" headingId="preview-signals-heading">
      {signals.length > 0 ? (
        <ul className="divide-y divide-line">
          {signals.map((signal) => (
            <li
              key={signal.id}
              data-signal={signal.id}
              className="flex gap-2.5 py-2 text-[13px] first:pt-0 last:pb-0"
            >
              <Icon
                name={signal.icon}
                className={`mt-0.5 ${signal.id === "confirmed" ? "text-up" : "text-muted"}`}
              />
              <span className="min-w-0">
                <span className="font-medium text-ink">{signal.text}</span>
                {signal.detail ? (
                  <span className="block text-xs text-muted">
                    {signal.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">
          No signals yet. They appear once we hold a funding round for this
          company.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Facts from the rounds and filings we hold. Nothing here is a score.
      </p>
    </CompanyPanel>
  );
}

function PreviewBody({ preview, now }: { preview: CompanyPreview; now: Date }) {
  const statuses = statusChips(preview);
  return (
    <>
      {statuses.length > 0 ? (
        <p className="mt-3 flex gap-1.5">
          {statuses.map((status) => (
            <Chip key={status}>{status}</Chip>
          ))}
        </p>
      ) : null}
      <ActionRow
        companyName={preview.name}
        websiteDomain={preview.websiteDomain}
        companiesHouse={
          preview.registry
            ? {
                companyNumber: preview.registry.companyNumber,
                url: preview.registry.url,
              }
            : null
        }
      />
      <KeyFacts facts={previewFacts(preview, now)} />
      <div className="mt-5 space-y-4">
        <PreviewRound round={preview.latestRound} />
        <PreviewSignals preview={preview} now={now} />
      </div>
    </>
  );
}

const BLOCK =
  "rounded-[var(--radius)] bg-surface-sunk animate-pulse motion-reduce:animate-none";

/** Grey blocks the size of the preview's parts, so the content lands without a jump. */
export function PreviewSkeleton() {
  return (
    <div data-testid="preview-skeleton" aria-hidden="true">
      <div className="mt-3 flex gap-2 sm:mt-5">
        <div className={`${BLOCK} h-8 w-32`} />
        <div className={`${BLOCK} h-8 w-36`} />
        <div className={`${BLOCK} h-8 w-20`} />
      </div>
      <div className={`${BLOCK} mt-4 h-[74px] sm:mt-6`} />
      <div className="mt-5 space-y-4">
        <div className={`${BLOCK} h-44`} />
        <div className={`${BLOCK} h-36`} />
      </div>
    </div>
  );
}

/**
 * The split view's preview of one company. The header (name, place, sector,
 * description and "Open full page") comes from the row, so it changes as soon
 * as the selection does; the name is a polite live region, so screen readers
 * hear each selection. The rest comes from `CompanyPreview` and reuses the
 * company page's action row, key facts strip and panels.
 */
export function RoundPreview({
  row,
  state,
  nameId,
  onRetry,
  now = new Date(),
}: {
  row: FundingRow;
  state: PreviewState;
  /** The id of the company name, which labels nothing else on the page. */
  nameId: string;
  onRetry?: () => void;
  now?: Date;
}) {
  const ready = state.kind === "ready" ? state.preview : null;
  const fullHref = `/companies/${ready?.redirectToSlug ?? row.companySlug}`;
  const description = row.companyDescription?.trim() || null;

  let body;
  switch (state.kind) {
    case "ready":
      body = <PreviewBody preview={state.preview} now={now} />;
      break;
    case "waiting":
      body = state.held ? (
        <div inert className="opacity-60">
          <PreviewBody preview={state.held} now={now} />
        </div>
      ) : (
        <div className="min-h-[24rem]" />
      );
      break;
    case "loading":
      body = <PreviewSkeleton />;
      break;
    case "missing":
      body = (
        <div className="mt-5">
          <EmptyState
            title="No preview for this company"
            action={
              <Button href={fullHref} size="sm">
                Open full page
              </Button>
            }
          >
            It may have been merged into another company. The full page has the
            latest.
          </EmptyState>
        </div>
      );
      break;
    case "error":
      body = (
        <div className="mt-5">
          <EmptyState
            title="The preview didn't load"
            action={
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          >
            Check your connection, or open the full page.
          </EmptyState>
        </div>
      );
      break;
  }

  return (
    <div className="px-6 py-5">
      <header className="flex items-start gap-3">
        <Monogram name={row.companyName} size={40} />
        <div className="min-w-0 flex-1">
          <h2
            id={nameId}
            aria-live="polite"
            className="break-words font-display text-[24px] font-semibold leading-tight tracking-tight text-ink"
          >
            {row.companyName}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <PlaceBadge countryCode={row.countryCode} city={row.city} />
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <SectorLabel sector={row.mainSector} />
          </p>
        </div>
        <span className="shrink-0">
          <Button href={fullHref} size="sm">
            Open full page
          </Button>
        </span>
      </header>
      <p
        className={`mt-3 text-[15px] leading-snug ${description ? "text-ink" : "text-muted"}`}
      >
        {description ?? NO_DESCRIPTION}
      </p>
      <div aria-busy={state.kind === "waiting" || state.kind === "loading"}>
        {body}
      </div>
    </div>
  );
}
