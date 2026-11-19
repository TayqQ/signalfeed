import type { Metadata } from "next";
import Link from "next/link";
import { EarlyMomentumTable } from "@/components/early-momentum-table";
import { RisingThemesTable } from "@/components/rising-themes-table";
import { listEarlyMomentum, listRisingThemes } from "@/db/queries/trends";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { toIsoDate } from "@/lib/weeks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Trends" };

export default async function TrendsPage() {
  const now = new Date();
  const day = toIsoDate(now);
  const [rising, early] = await Promise.all([
    cached(() => listRisingThemes(getWebDb(), { now }), ["trends-rising", day]),
    cached(() => listEarlyMomentum(getWebDb(), { now }), ["trends-early", day]),
  ]);

  return (
    <main>
      <h1 className="sr-only">Trends</h1>

      <section aria-labelledby="rising-heading">
        <h2 id="rising-heading" className="text-xl font-semibold">
          Rising themes
        </h2>
        <p className="mb-3 mt-1 text-[13px] text-muted">
          Themes with the most funding rounds in the last 8 weeks, compared with
          their usual share. Click a theme to see its companies and backers.
        </p>
        <RisingThemesTable
          rows={rising.rows}
          notEnoughHistory={rising.notEnoughHistory}
          firstWeek={rising.firstWeek}
        />
      </section>

      <section className="mt-12" aria-labelledby="early-heading">
        <h2 id="early-heading" className="text-xl font-semibold">
          Early momentum
        </h2>
        <p className="mb-3 mt-1 text-[13px] text-muted">
          Pre-seed and seed rounds picking up in themes where few companies have
          reached Series A. Late share is the share of companies with a known
          round type that have raised a Series A or later.
        </p>
        <EarlyMomentumTable
          rows={early.rows}
          notEnoughHistory={early.notEnoughHistory}
          firstWeek={early.firstWeek}
        />
      </section>

      <section className="mt-12" aria-labelledby="score-heading">
        <h2 id="score-heading" className="text-xl font-semibold">
          How the score works
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          The score compares a theme&apos;s rounds in the last 8 weeks with what
          its share of the previous 26 weeks would predict. Small counts are
          pulled towards zero, so one round cannot top the list. It counts
          rounds, not money, and ignores grants. Raisory only sees what it has
          collected, so early figures are partial.{" "}
          <Link
            href="/about#rising-score"
            className="text-brand underline underline-offset-4"
          >
            Read the full method
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
