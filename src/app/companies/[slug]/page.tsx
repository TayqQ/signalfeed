import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ActionRow } from "@/components/company/action-row";
import { CompanyHeader } from "@/components/company/company-header";
import { CompanyInvestors } from "@/components/company/company-investors";
import { KeyFacts, keyFacts } from "@/components/company/key-facts";
import { LatestRound } from "@/components/company/latest-round";
import {
  OfficialRecords,
  registryStatusFact,
} from "@/components/company/official-records";
import { CompanyPanel } from "@/components/company/panel";
import { CompanySignals } from "@/components/company/signals";
import { SimilarCompanies } from "@/components/company/similar-companies";
import { describeCompanyLocation } from "@/components/company-location";
import {
  CompanyMomentum,
  HISTORY_STARTS,
  latestIsFirstRecorded,
} from "@/components/company-momentum";
import { EventTimeline, fundingRoundsOf } from "@/components/event-timeline";
import { companySources, SourceList } from "@/components/source-list";
import type { CompanyDetail } from "@/core/read-models";
import { getCompanyDetail, getSimilarCompanies } from "@/db/queries/companies";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function load(slug: string) {
  return cached(() => getCompanyDetail(getWebDb(), slug), ["company", slug]);
}

function loadSimilar(slug: string) {
  return cached(
    () => getSimilarCompanies(getWebDb(), slug),
    ["company-similar", slug],
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const company = await load((await params).slug);
  if (!company) return { title: "Company not found" };
  return {
    title: `${company.name} funding history`,
    description:
      company.description ??
      `Funding rounds, acquisitions and launches reported for ${company.name}.`,
  };
}

/** Town and region for the place badge; the country code sits beside it. */
function placeText(company: CompanyDetail): string | null {
  return describeCompanyLocation(company.location, {
    city: company.city,
    countryCode: null,
  });
}

function statuses(company: CompanyDetail): string[] {
  return [
    company.status === "acquired" ? "Acquired" : null,
    company.status === "closed" ? "Closed" : null,
    registryStatusFact(company.registry),
  ].filter((fact): fact is string => Boolean(fact));
}

export default async function CompanyPage({ params }: Params) {
  const { slug } = await params;
  const [company, similar] = await Promise.all([load(slug), loadSimilar(slug)]);
  if (!company) notFound();
  if (company.redirectToSlug) {
    permanentRedirect(`/companies/${company.redirectToSlug}`);
  }

  const now = new Date();
  const ch = company.registry?.companiesHouse ?? null;
  const countryCode = company.location?.countryCode ?? company.countryCode;
  const latest = fundingRoundsOf(company.events)[0] ?? null;
  const signals = (headingId: string) => (
    <CompanySignals events={company.events} now={now} headingId={headingId} />
  );
  const records = (headingId: string) => (
    <OfficialRecords
      registry={company.registry}
      companyName={company.name}
      countryCode={countryCode}
      headingId={headingId}
    />
  );

  return (
    <main className="w-full">
      <CompanyHeader
        name={company.name}
        description={company.description}
        countryCode={countryCode}
        place={placeText(company)}
        mainSector={similar?.mainSector ?? null}
        statuses={statuses(company)}
        themes={company.themes ?? []}
      />
      <ActionRow
        companyName={company.name}
        websiteDomain={company.websiteDomain}
        companiesHouse={
          ch ? { companyNumber: ch.companyNumber, url: ch.url } : null
        }
      />
      <KeyFacts
        facts={keyFacts({
          events: company.events,
          foundedYear: company.foundedYear,
          companiesHouse: ch,
          now,
        })}
      />

      {/*
        One column below lg, in the phone order: latest round, signals,
        history, investors, records, sources. From lg the signals and records
        move to a sticky side column; the inline copies are hidden there, so
        each appears once at any width.
      */}
      <div className="mt-3 flex flex-col gap-3 sm:mt-6 sm:gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-col gap-3 sm:gap-6">
          <LatestRound round={latest} companyName={company.name} />
          <div className="lg:hidden">{signals("signals-heading-inline")}</div>
          <CompanyPanel title="History" headingId="history-heading">
            <EventTimeline
              events={company.events}
              foundedYear={company.foundedYear}
            />
            <div className="mt-4 border-t border-line pt-3">
              <CompanyMomentum
                events={company.events}
                roundsInLast24Months={company.roundsInLast24Months}
              />
              {latestIsFirstRecorded(company.events) ? null : (
                <p className="mt-1 text-[13px] text-muted">
                  History starts in {HISTORY_STARTS}, so earlier rounds may be
                  missing.
                </p>
              )}
            </div>
          </CompanyPanel>
          <CompanyInvestors events={company.events} />
          <div className="lg:hidden">{records("records-heading-inline")}</div>
          <CompanyPanel title="Sources" headingId="sources-heading">
            <SourceList sources={companySources(company.events)} />
          </CompanyPanel>
        </div>
        <aside
          aria-label="Signals and official records"
          className="hidden min-w-0 lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-6"
        >
          {signals("signals-heading")}
          {records("records-heading")}
        </aside>
      </div>

      <SimilarCompanies similar={similar} now={now} />
    </main>
  );
}
