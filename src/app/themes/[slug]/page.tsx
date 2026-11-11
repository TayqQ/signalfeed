import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { BarChart } from "@/components/charts/bar-chart";
import { ColumnChart } from "@/components/charts/column-chart";
import { FundingTable } from "@/components/funding-table";
import { ThemeHeader, describeWeeklyChange } from "@/components/theme-header";
import { ThemeAcquisitions, ThemeLeaders } from "@/components/theme-leaders";
import { ROUND_TYPES } from "@/core/enums";
import type { FundingFilters } from "@/core/read-models";
import { listAcquisitions } from "@/db/queries/acquisitions";
import { listFundingRounds } from "@/db/queries/funding";
import { listInvestorActivity } from "@/db/queries/investor-activity";
import { getThemeDetail } from "@/db/queries/themes";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { formatDate, formatRoundType } from "@/lib/format";
import { toIsoDate } from "@/lib/weeks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function loadDetail(slug: string, now: Date) {
  return cached(
    () => getThemeDetail(getWebDb(), slug, { now }),
    ["theme", slug, toIsoDate(now)],
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const detail = await loadDetail(slug, new Date());
  return {
    title: detail
      ? `${detail.summary.name} | SignalFeed`
      : "Theme not found | SignalFeed",
  };
}

export default async function ThemePage({ params }: Params) {
  const { slug } = await params;
  const now = new Date();
  const detail = await loadDetail(slug, now);
  if (!detail) notFound();
  if (detail.redirectToSlug)
    permanentRedirect(`/themes/${detail.redirectToSlug}`);
  if (detail.summary.slug !== slug) notFound();

  const day = toIsoDate(now);
  const filters: FundingFilters = { themes: [slug], page: 1, pageSize: 10 };
  const [rounds, leaders, acquisitions] = await Promise.all([
    cached(
      () => listFundingRounds(getWebDb(), filters),
      ["theme-rounds", slug, day],
    ),
    cached(
      () => listInvestorActivity(getWebDb(), { theme: slug, now }),
      ["theme-leaders", slug, day],
    ),
    cached(
      () => listAcquisitions(getWebDb(), { theme: slug, page: 1, pageSize: 5 }),
      ["theme-acquisitions", slug, day],
    ),
  ]);

  const { summary, weekly, stageMix } = detail;
  const firstWeek = weekly[0]?.weekStart;
  const lastWeek = weekly[weekly.length - 1]?.weekStart;
  const stageItems = ROUND_TYPES.filter(
    (type) => type !== "grant" && stageMix[type] > 0,
  ).map((type) => ({ label: formatRoundType(type), value: stageMix[type] }));
  const stageTotal = stageItems.reduce((sum, item) => sum + item.value, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-3 text-sm">
        <Link
          href="/themes"
          className="text-signal underline underline-offset-4"
        >
          All themes
        </Link>
      </p>
      <ThemeHeader summary={summary} tags={detail.tags} />

      <section className="mt-8" aria-labelledby="weekly-heading">
        <h2 id="weekly-heading" className="mb-3 text-xl font-semibold">
          Rounds by week
        </h2>
        <ColumnChart
          title={`Weekly rounds in ${summary.name}, last 52 weeks`}
          summary={describeWeeklyChange(summary.name, weekly)}
          categories={weekly.map((point) => ({
            label: `Week of ${formatDate(point.weekStart)}`,
            axisLabel: formatDate(point.weekStart).slice(0, -5),
          }))}
          series={[
            {
              key: "early",
              label: "Early stage",
              values: weekly.map((p) => p.earlyRounds),
            },
            {
              key: "later",
              label: "Later stage",
              values: weekly.map((p) => p.laterRounds),
            },
            {
              key: "unknown",
              label: "Unknown stage",
              values: weekly.map((p) => p.unknownStageRounds),
            },
          ]}
          valueLabel="Rounds"
          labelEvery={8}
        />
        <p className="mt-2 max-w-2xl text-sm text-quiet">
          {firstWeek && lastWeek
            ? `Weeks from ${formatDate(firstWeek)} to ${formatDate(lastWeek)}. `
            : ""}
          SignalFeed only counts rounds it has collected, so weeks before
          collection began show as empty. Grants are not counted.
        </p>
      </section>

      <section className="mt-10" aria-labelledby="stage-heading">
        <h2 id="stage-heading" className="mb-3 text-xl font-semibold">
          Stage mix
        </h2>
        <BarChart
          title={`Rounds by stage in ${summary.name}`}
          summary={
            stageTotal === 0
              ? `No rounds recorded for ${summary.name} yet.`
              : `${stageTotal} recorded rounds in ${summary.name}, most often ${stageItems.reduce((a, b) => (b.value > a.value ? b : a)).label.toLowerCase()}.`
          }
          items={stageItems}
          valueLabel="Rounds"
        />
      </section>

      <section className="mt-10" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-xl font-semibold">
          Recent rounds
        </h2>
        <FundingTable page={rounds} filters={filters} />
        <p className="mt-3 text-sm">
          <Link
            href={`/?theme=${encodeURIComponent(slug)}`}
            className="text-signal underline underline-offset-4"
          >
            See all rounds in this theme
          </Link>
        </p>
      </section>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <ThemeLeaders leaders={leaders.slice(0, 5)} themeSlug={slug} />
        <ThemeAcquisitions acquisitions={acquisitions.items} themeSlug={slug} />
      </div>
    </main>
  );
}
