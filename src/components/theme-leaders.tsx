import Link from "next/link";
import type { AcquisitionRow, InvestorActivityRow } from "@/core/read-models";
import { formatDate, formatMoneyShort } from "@/lib/format";

export function ThemeLeaders({
  leaders,
  themeSlug,
}: {
  leaders: InvestorActivityRow[];
  themeSlug: string;
}) {
  return (
    <section aria-labelledby="leaders-heading">
      <h2 id="leaders-heading" className="text-xl font-semibold">
        First-cheque leaders
      </h2>
      <p className="mt-1 text-sm text-muted">
        Investors with the most early rounds led in the last 12 months. We show
        round size, not cheque size, because cheques are rarely reported.
      </p>
      {leaders.length === 0 ? (
        <p className="mt-3 text-muted">
          No investor has 2 or more early rounds here in the last 12 months.
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-line border-y border-line">
          {leaders.map((row) => (
            <li key={row.investor.slug} className="py-2 text-sm">
              <Link
                href={`/investors/${row.investor.slug}`}
                className="font-medium text-brand underline underline-offset-4"
              >
                {row.investor.name}
              </Link>
              <span className="block text-muted">
                Led {row.led}, joined {row.joined}.{" "}
                {row.medianRoundGbpMinor === null
                  ? "No round sizes known."
                  : `Median round ${formatMoneyShort(row.medianRoundGbpMinor, "GBP")} (${row.roundsWithAmount} of ${row.rounds} with amounts).`}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-sm">
        <Link
          href={`/investors?theme=${encodeURIComponent(themeSlug)}`}
          className="text-brand underline underline-offset-4"
        >
          All investors in this theme
        </Link>
      </p>
    </section>
  );
}

export function ThemeAcquisitions({
  acquisitions,
  themeSlug,
}: {
  acquisitions: AcquisitionRow[];
  themeSlug: string;
}) {
  return (
    <section aria-labelledby="acquisitions-heading">
      <h2 id="acquisitions-heading" className="text-xl font-semibold">
        Latest acquisitions
      </h2>
      {acquisitions.length === 0 ? (
        <p className="mt-3 text-muted">
          No acquisitions of companies in this theme have been recorded.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {acquisitions.map((row) => (
            <li key={row.eventId} className="py-2 text-sm">
              <Link
                href={`/companies/${row.target.slug}`}
                className="font-medium text-brand underline underline-offset-4"
              >
                {row.target.name}
              </Link>{" "}
              bought by{" "}
              {row.acquirer ? (
                <Link
                  href={`/companies/${row.acquirer.slug}`}
                  className="underline underline-offset-4"
                >
                  {row.acquirer.name}
                </Link>
              ) : (
                row.acquirerName
              )}
              <span className="block text-muted">
                {formatDate(row.announcedOn)}
                {row.priceGbpMinor !== null
                  ? `, ${formatMoneyShort(row.priceGbpMinor, "GBP")}`
                  : ", price not known"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm">
        <Link
          href={`/acquisitions?theme=${encodeURIComponent(themeSlug)}`}
          className="text-brand underline underline-offset-4"
        >
          All acquisitions in this theme
        </Link>
      </p>
    </section>
  );
}
