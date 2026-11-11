import type { Metadata } from "next";
import { z } from "zod";
import { InvestorActivityTable } from "@/components/investor-activity-table";
import { ThemeSelect } from "@/components/theme-select";
import { SECTORS, type Sector } from "@/core/sectors";
import { listInvestorActivity } from "@/db/queries/investor-activity";
import { listThemes } from "@/db/queries/themes";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investors | SignalFeed",
  description:
    "Investors leading pre-seed and seed rounds, by theme, with round sizes.",
};

const WINDOW_MONTHS = 12;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const themeResult = z
    .string()
    .regex(/^[a-z0-9-]{1,120}$/)
    .safeParse(first(params.theme));
  const sectorResult = z.enum(SECTORS).safeParse(first(params.sector));
  const theme = themeResult.success ? themeResult.data : undefined;
  const sector: Sector | undefined = sectorResult.success
    ? sectorResult.data
    : undefined;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [rows, themes] = await Promise.all([
    cached(
      () =>
        listInvestorActivity(getWebDb(), {
          theme,
          sector,
          months: WINDOW_MONTHS,
          now,
        }),
      ["investor-activity", theme ?? "", sector ?? "", today],
    ),
    cached(() => listThemes(getWebDb()), ["themes", "active"]),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        Who leads first cheques
      </h1>
      <p className="mt-3 max-w-2xl text-quiet">
        Investors in pre-seed and seed rounds over the last {WINDOW_MONTHS}{" "}
        months. Led counts rounds where they led. Joined counts rounds where
        they took part or their role is not reported. Investors need at least 2
        rounds to be listed.
      </p>
      <p className="mt-3 max-w-2xl text-sm text-quiet">
        Individual cheque sizes are rarely reported, so these pages show the
        size of the whole round instead. The median uses only rounds with a
        known amount, and each row says how many that is.
      </p>

      <div className="mt-8">
        <ThemeSelect
          action="/investors"
          themes={themes}
          theme={theme}
          sector={sector}
        />
      </div>

      <section aria-label="Investor activity" className="mt-8">
        <p className="mb-3 text-sm tabular-nums text-quiet" role="status">
          {rows.length === 1 ? "1 investor" : `${rows.length} investors`}
        </p>
        <InvestorActivityTable
          rows={rows}
          filtered={theme !== undefined || sector !== undefined}
        />
      </section>
    </main>
  );
}
