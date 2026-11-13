import type { Metadata } from "next";
import type { EventType, IngestStatus, SourceItemStatus } from "@/core/enums";
import { EVENT_TYPES, SOURCE_ITEM_STATUSES } from "@/core/enums";
import { LLM_PURPOSES, type LlmPurpose } from "@/core/enums";
import type { IngestRunSummary } from "@/core/read-models";
import {
  getStatusSummary,
  type Phase2Status,
  type StatusReport,
} from "@/db/queries/status";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { formatMoneyCompact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Status — SignalFeed",
  description: "Pipeline health, ingest runs and LLM spend against the cap.",
};

/** What the budget guard uses when no rate is stored yet. */
const FALLBACK_USD_PER_GBP = 1;

export const dynamic = "force-dynamic";

function loadStatus(): Promise<StatusReport> {
  return cached(() => getStatusSummary(getWebDb()), ["status-summary"], {
    revalidateSeconds: 60,
  });
}

function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

function runDuration(run: IngestRunSummary): string | null {
  if (!run.finishedAt) return null;
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return formatDurationMs(end - start);
}

function formatUsdFromMicros(usdMicros: number): string {
  const dollars = usdMicros / 1_000_000;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

function gbpMinorFromUsdMicros(usdMicros: number, usdPerGbp: number): number {
  const gbp = usdMicros / 1_000_000 / usdPerGbp;
  return Math.round(gbp * 100);
}

function capUsdMicros(capGbp: number, usdPerGbp: number): number {
  return Math.floor(capGbp * usdPerGbp * 1_000_000);
}

function formatIngestStatus(status: IngestStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "budget_paused":
      return "Budget paused";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function formatItemStatus(status: SourceItemStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "filtered_out":
      return "Filtered out";
    case "extracted":
      return "Extracted";
    case "failed":
      return "Failed";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function formatEventType(type: EventType): string {
  switch (type) {
    case "funding_round":
      return "Funding rounds";
    case "acquisition":
      return "Acquisitions";
    case "launch":
      return "Launches";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function statusBadgeClass(status: IngestStatus): string {
  switch (status) {
    case "succeeded":
      return "bg-emerald-100 text-emerald-900";
    case "running":
      return "bg-blue-100 text-blue-900";
    case "failed":
      return "bg-red-100 text-red-900";
    case "budget_paused":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-zinc-100 text-zinc-800";
  }
}

function formatPurpose(purpose: LlmPurpose): string {
  switch (purpose) {
    case "extraction":
      return "Extraction";
    case "embedding":
      return "Embedding";
    case "theme_naming":
      return "Theme naming";
    case "tagging":
      return "Tagging";
    case "eval":
      return "Eval";
    default: {
      const exhaustive: never = purpose;
      return exhaustive;
    }
  }
}

function SpendByPurpose({ summary }: { summary: StatusReport }) {
  const byPurpose = summary.phase2.spendByPurposeUsdMicros;
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {LLM_PURPOSES.map((purpose) => (
        <div
          key={purpose}
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
        >
          <dt className="text-xs text-zinc-600">{formatPurpose(purpose)}</dt>
          <dd className="text-lg font-semibold tabular-nums text-zinc-900">
            {formatUsdFromMicros(byPurpose[purpose])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatGrid({
  items,
}: {
  items: { label: string; value: string | number }[];
}) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
        >
          <dt className="text-xs text-zinc-600">{item.label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-zinc-900">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatWhen(iso: string | null): string {
  return iso ? formatUtcDateTime(iso) : "Never";
}

function Phase2Sections({ phase2 }: { phase2: Phase2Status }) {
  const run = phase2.latestGrantsRun;
  return (
    <>
      <section className="mt-10">
        <h2 className="text-xl font-semibold">Tags and themes</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Pending tags wait for the next embedding run. Unnamed themes still
          carry the label of their first tag. Unreviewed themes have not been
          checked by a person.
        </p>
        <StatGrid
          items={[
            { label: "Tags embedded", value: phase2.tags.embedded },
            { label: "Tags pending", value: phase2.tags.pending },
            { label: "Active themes", value: phase2.themes.active },
            { label: "Unnamed themes", value: phase2.themes.unnamed },
            { label: "Unreviewed themes", value: phase2.themes.unreviewed },
          ]}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Grants</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Innovate UK projects from UKRI Gateway to Research. Skipped
          participants have no grant offer or start date. Organisations that may
          be individuals are never stored.
        </p>
        <StatGrid
          items={[
            { label: "Grant projects", value: phase2.grants.projects },
            { label: "Kept", value: phase2.grants.participantsKept },
            { label: "Skipped", value: phase2.grants.participantsSkipped },
            {
              label: "Unresolved",
              value: phase2.grants.participantsUnresolved,
            },
          ]}
        />
        {run ? (
          <p className="mt-3 text-sm text-zinc-700">
            Latest grants run: {formatUtcDateTime(run.startedAt)} UTC (
            {formatIngestStatus(run.status).toLowerCase()})
            {run.collect
              ? `, ${run.collect.projectsInserted} new projects and ${run.collect.participantsSkipped} participants left out as not organisations`
              : ""}
            {run.resolve
              ? `, ${run.resolve.eventsCreated} grant events created`
              : ""}
            .
          </p>
        ) : (
          <p className="mt-3 text-sm text-zinc-600">
            The grants collector has not run yet.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Derived data</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Trend figures and locations are rebuilt from stored events. A rebuild
          is skipped when nothing has changed, so an old time is not a fault.
        </p>
        <StatGrid
          items={[
            {
              label: "Trend stats rebuilt (UTC)",
              value: formatWhen(phase2.statsRebuiltAt),
            },
            {
              label: "Locations rebuilt (UTC)",
              value: formatWhen(phase2.locationsRebuiltAt),
            },
          ]}
        />
      </section>
    </>
  );
}

function SpendSection({ summary }: { summary: StatusReport }) {
  const { monthToDateUsdMicros, capGbp } = summary;
  const usdPerGbp = summary.usdPerGbp ?? FALLBACK_USD_PER_GBP;
  const gbpMinor = gbpMinorFromUsdMicros(monthToDateUsdMicros, usdPerGbp);

  if (capGbp == null) {
    return (
      <section className="mt-10">
        <h2 className="text-xl font-semibold">LLM spend this month</h2>
        <p className="mt-3 text-zinc-600">
          Spend tracking appears after the first ingest run completes.
        </p>
      </section>
    );
  }

  const capMicros = capUsdMicros(capGbp, usdPerGbp);
  const pct =
    capMicros > 0 ? Math.min(100, (monthToDateUsdMicros / capMicros) * 100) : 0;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">LLM spend this month</h2>
      <p className="mt-3 text-zinc-700">
        {formatMoneyCompact(gbpMinor, "GBP")} and{" "}
        {formatUsdFromMicros(monthToDateUsdMicros)} month-to-date, against a{" "}
        {formatMoneyCompact(capGbp * 100, "GBP")} (
        {formatUsdFromMicros(capMicros)}) cap
      </p>
      <div
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Month-to-date LLM spend against cap"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <h3 className="mt-6 text-sm font-medium text-zinc-700">By purpose</h3>
      <SpendByPurpose summary={summary} />
    </section>
  );
}

function RunsTable({ runs }: { runs: IngestRunSummary[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-medium">Started (UTC)</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Collected</th>
            <th className="px-3 py-2 font-medium text-right">Extracted</th>
            <th className="px-3 py-2 font-medium text-right">Run spend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {runs.map((run) => {
            const stats = run.stats;
            const collected = stats?.collect.itemsInserted ?? null;
            const extracted = stats?.extract.itemsExtracted ?? null;
            const spend = stats?.spendUsdMicros ?? null;
            const duration = runDuration(run);

            return (
              <tr key={run.id} className="text-zinc-800">
                <td className="whitespace-nowrap px-3 py-2">
                  {formatUtcDateTime(run.startedAt)}
                </td>
                <td className="px-3 py-2">{duration ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(run.status)}`}
                  >
                    {formatIngestStatus(run.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {collected ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {extracted ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {spend != null ? formatUsdFromMicros(spend) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CountGrid({
  title,
  labels,
  counts,
}: {
  title: string;
  labels: Record<string, string>;
  counts: Record<string, number>;
}) {
  const keys = Object.keys(labels);
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {keys.map((key) => (
          <div
            key={key}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
          >
            <dt className="text-xs text-zinc-600">{labels[key]}</dt>
            <dd className="text-lg font-semibold tabular-nums text-zinc-900">
              {counts[key] ?? 0}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function StatusPage() {
  const summary = await loadStatus();
  const latest = summary.recentRuns[0];
  const budgetPaused = latest?.status === "budget_paused";
  const empty = summary.recentRuns.length === 0;

  const itemLabels = Object.fromEntries(
    SOURCE_ITEM_STATUSES.map((s) => [s, formatItemStatus(s)]),
  ) as Record<SourceItemStatus, string>;

  const eventLabels = Object.fromEntries(
    EVENT_TYPES.map((t) => [t, formatEventType(t)]),
  ) as Record<EventType, string>;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 text-zinc-900">
      <h1 className="text-3xl font-semibold tracking-tight">Pipeline status</h1>
      <p className="mt-3 text-zinc-700">
        Ingestion health, item and event counts, and language-model spend
        against the monthly cap. Cached for about 60 seconds.
      </p>

      {budgetPaused ? (
        <div
          className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
          role="status"
        >
          <p className="font-medium">Budget paused</p>
          <p className="mt-1 text-sm">
            The latest ingest run hit the monthly LLM spend cap. New extractions
            are paused until the next calendar month or the cap is raised;
            pending items stay in the queue.
          </p>
        </div>
      ) : null}

      {latest?.stats?.extract.skipped ? (
        <div
          className="mt-6 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3"
          role="status"
        >
          <p className="font-medium">Extraction is off</p>
          <p className="mt-1 text-sm">
            Feeds are being collected and kept, but no language model key is
            set, so they are not being turned into events yet.
          </p>
        </div>
      ) : null}

      {latest?.stats?.extract.providerError ? (
        <div
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3"
          role="status"
        >
          <p className="font-medium">The language model provider refused</p>
          <p className="mt-1 text-sm">
            Items stay in the queue and will be retried on the next run.
          </p>
        </div>
      ) : null}

      {empty ? (
        <div className="mt-10 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center">
          <p className="text-lg font-medium text-zinc-800">
            No ingest runs yet
          </p>
          <p className="mt-2 text-zinc-600">
            Scheduled collection has not recorded a run. After the first
            pipeline run, recent activity and spend will appear here.
          </p>
        </div>
      ) : (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold">Recent ingest runs</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Last {summary.recentRuns.length} runs, newest first.
            </p>
            <RunsTable runs={summary.recentRuns} />
          </section>

          <SpendSection summary={summary} />
        </>
      )}

      {!empty ? (
        <>
          <CountGrid
            title="Source items by status"
            labels={itemLabels}
            counts={summary.itemCountsByStatus}
          />
          <CountGrid
            title="Events by type"
            labels={eventLabels}
            counts={summary.eventCountsByType}
          />
          <Phase2Sections phase2={summary.phase2} />
        </>
      ) : null}
    </main>
  );
}
