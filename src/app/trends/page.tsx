import type { Metadata } from "next";
import Link from "next/link";
import { EarlyMomentumTable } from "@/components/early-momentum-table";
import { RisingThemesTable } from "@/components/rising-themes-table";
import { listEarlyMomentum, listRisingThemes } from "@/db/queries/trends";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { toIsoDate } from "@/lib/weeks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Trends | SignalFeed" };

export default async function TrendsPage() {
  const now = new Date();
  const day = toIsoDate(now);
  const [rising, early] = await Promise.all([
    cached(() => listRisingThemes(getWebDb(), { now }), ["trends-rising", day]),
    cached(() => listEarlyMomentum(getWebDb(), { now }), ["trends-early", day]),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        Which themes are rising
      </h1>
      <p className="mt-3 max-w-2xl text-quiet">
        Themes with the most funding rounds in the last 8 weeks, compared with
        their usual share. Click a theme to see its companies and backers.
      </p>

      <section className="mt-8" aria-labelledby="rising-heading">
        <h2 id="rising-heading" className="mb-3 text-xl font-semibold">
          Rising themes
        </h2>
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
        <p className="mb-3 mt-1 max-w-2xl text-sm text-quiet">
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

      <section className="mt-12 max-w-2xl" aria-labelledby="score-heading">
        <h2 id="score-heading" className="text-xl font-semibold">
          How the score works
        </h2>
        <p className="mt-2 text-sm text-quiet">
          The score compares a theme&apos;s rounds in the last 8 weeks with what
          its share of the previous 26 weeks would predict. Small counts are
          pulled towards zero, so one round cannot top the list. It counts
          rounds, not money, and ignores grants. SignalFeed only sees what it
          has collected, so early figures are partial.{" "}
          <Link
            href="/about#rising-score"
            className="text-signal underline underline-offset-4"
          >
            Read the full method
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
