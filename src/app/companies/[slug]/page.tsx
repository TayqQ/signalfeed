import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { describeCompanyLocation } from "@/components/company-location";
import { CompanyMomentum } from "@/components/company-momentum";
import {
  CompanyRegistry,
  registryStatusFact,
} from "@/components/company-registry";
import { EventTimeline } from "@/components/event-timeline";
import { TagList } from "@/components/tag-list";
import { SECTOR_LABELS } from "@/core/sectors";
import { getCompanyDetail } from "@/db/queries/companies";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";
import { formatCompanyAge } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function load(slug: string) {
  return cached(() => getCompanyDetail(getWebDb(), slug), ["company", slug]);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const company = await load((await params).slug);
  if (!company) return { title: "Company not found | SignalFeed" };
  return {
    title: `${company.name} funding history | SignalFeed`,
    description:
      company.description ??
      `Funding rounds, acquisitions and launches reported for ${company.name}.`,
  };
}

function foundedFact(foundedYear: number | null): string | null {
  if (!foundedYear) return null;
  const age = formatCompanyAge(foundedYear, new Date().toISOString());
  if (!age) return `Founded ${foundedYear}`;
  const prefix = age === "under 1 year" ? "" : "about ";
  return `Founded ${foundedYear} (${prefix}${age} old)`;
}

export default async function CompanyPage({ params }: Params) {
  const company = await load((await params).slug);
  if (!company) notFound();
  if (company.redirectToSlug) {
    permanentRedirect(`/companies/${company.redirectToSlug}`);
  }

  const location = describeCompanyLocation(company.location, {
    city: company.city,
    countryCode: company.countryCode,
  });
  const facts = [
    location,
    foundedFact(company.foundedYear),
    company.status === "acquired" ? "Acquired" : null,
    company.status === "closed" ? "Closed" : null,
    registryStatusFact(company.registry),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        {company.name}
      </h1>
      {facts.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 text-sm text-quiet">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}
      {company.description ? (
        <p className="mt-4 max-w-2xl text-lg">{company.description}</p>
      ) : null}
      {company.websiteDomain ? (
        <p className="mt-2 text-sm">
          <a
            href={`https://${company.websiteDomain}`}
            rel="noopener"
            className="text-signal underline underline-offset-4"
          >
            {company.websiteDomain}
          </a>
        </p>
      ) : null}
      {company.themes && company.themes.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Themes">
          {company.themes.map((theme) => (
            <li key={theme.slug}>
              <Link
                href={`/themes/${encodeURIComponent(theme.slug)}`}
                className="border border-zinc-300 px-2 py-0.5 hover:border-signal hover:text-signal"
              >
                {theme.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {company.sectors && company.sectors.length > 0 ? (
        <p className="mt-2 text-sm text-quiet">
          Sector:{" "}
          {company.sectors.map((sector, index) => (
            <span key={sector}>
              {index > 0 ? ", " : null}
              <Link
                href={`/?sector=${encodeURIComponent(sector)}`}
                className="underline underline-offset-4 hover:text-signal"
              >
                {SECTOR_LABELS[sector]}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      <TagList tags={company.tags} />
      <CompanyMomentum
        events={company.events}
        roundsInLast24Months={company.roundsInLast24Months}
      />

      <CompanyRegistry registry={company.registry} />

      <section className="mt-10">
        <h2 className="text-xl font-semibold">History</h2>
        <EventTimeline
          events={company.events}
          foundedYear={company.foundedYear}
        />
      </section>
    </main>
  );
}
