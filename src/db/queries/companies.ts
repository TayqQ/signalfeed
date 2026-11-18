import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Money } from "@/core/domain";
import type { LaunchKind, RoundType } from "@/core/enums";
import type {
  CompanyDetail,
  CompanyPreview,
  CompanyEvent,
  CompanyRegistryView,
  CompanyLocationView,
  EventInvestor,
  EventSourceLink,
  RoundMomentum,
  ThemeRef,
} from "@/core/read-models";
import { companiesHouseUrl, edgarCompanyUrl } from "@/core/registry";
import { isSector, SECTORS, type Sector } from "@/core/sectors";
import { roundsInLastMonths } from "@/lib/company-momentum";
import { chooseMainSector } from "@/lib/main-sector";
import { findPlaceBySlug } from "@/lib/geo/uk-places";
import { ukRegionByCode } from "@/lib/geo/uk-regions";
import { companyStatusLabel, companyTypeLabel } from "@/lib/registry/ch-labels";
import { sizeBandForAccounts } from "@/lib/registry/company-size";
import { sicLabel } from "@/lib/registry/sic-codes";
import { stageBucket } from "@/lib/stage";
import type { Db } from "../client";
import {
  fundingColumns,
  loadConfirmations,
  mainSectorOf,
  sicCodesSql,
  themeStrengthsSql,
  withConfirmations,
} from "./funding";
import {
  acquisitions,
  chCompanies,
  companies,
  companyLocations,
  companySectors,
  companyTags,
  companyThemes,
  eventInvestors,
  events,
  fundingRoundMomentum,
  fundingRounds,
  investors,
  launches,
  registryLinks,
  sourceItems,
  sources,
  tags,
  themes,
  eventSources,
} from "../schema";

function isoTimestamp(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function requiredTimestamp(value: Date | string): string {
  const iso = isoTimestamp(value);
  if (!iso) throw new Error("Expected a timestamp");
  return iso;
}

function trimOrNull(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function calendarDate(value: string): string {
  return value.slice(0, 10);
}

function money(
  amount: number | null,
  currency: string | null,
): { amountMinor: number; currency: string } | null {
  const code = trimOrNull(currency);
  if (amount == null || code == null) return null;
  return { amountMinor: amount, currency: code };
}

async function redirectSlug(
  db: Db,
  mergedIntoId: number | null,
): Promise<string | null> {
  let current = mergedIntoId;
  const seen = new Set<number>();
  while (current != null && !seen.has(current)) {
    seen.add(current);
    const [row] = await db
      .select({
        id: companies.id,
        slug: companies.slug,
        mergedIntoId: companies.mergedIntoId,
      })
      .from(companies)
      .where(eq(companies.id, current))
      .limit(1);
    if (!row) return null;
    if (row.mergedIntoId == null) return row.slug;
    current = row.mergedIntoId;
  }
  return null;
}

const basisEvent = alias(events, "basis_event");

const ROLE_RANK = { lead: 0, participant: 1, unknown: 2 } as const;

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

/**
 * Linked registry records only. Candidate and rejected links are never read.
 * The full registered office postcode is never selected: only the district.
 */
async function loadRegistry(
  db: Db,
  companyId: number,
): Promise<CompanyRegistryView | null> {
  const links = await db
    .select({
      registry: registryLinks.registry,
      registryId: registryLinks.registryId,
    })
    .from(registryLinks)
    .where(
      and(
        eq(registryLinks.companyId, companyId),
        eq(registryLinks.status, "linked"),
      ),
    )
    .orderBy(asc(registryLinks.id));

  const chLink = links.find((link) => link.registry === "companies_house");
  const secLink = links.find((link) => link.registry === "sec_edgar");

  let companiesHouse: CompanyRegistryView["companiesHouse"] = null;
  if (chLink) {
    const [row] = await db
      .select({
        companyNumber: chCompanies.companyNumber,
        name: chCompanies.name,
        status: chCompanies.status,
        statusDetail: chCompanies.statusDetail,
        companyType: chCompanies.companyType,
        incorporatedOn: chCompanies.incorporatedOn,
        ceasedOn: chCompanies.ceasedOn,
        sicCodes: chCompanies.sicCodes,
        accountsType: chCompanies.accountsType,
        accountsMadeUpTo: chCompanies.accountsMadeUpTo,
        officeOutcode: chCompanies.officeOutcode,
      })
      .from(chCompanies)
      .where(eq(chCompanies.companyNumber, chLink.registryId))
      .limit(1);
    if (row) {
      companiesHouse = {
        companyNumber: row.companyNumber,
        url: companiesHouseUrl(row.companyNumber),
        name: row.name,
        statusLabel:
          companyStatusLabel(row.status, row.statusDetail) ?? row.status,
        typeLabel: companyTypeLabel(row.companyType) ?? row.companyType,
        incorporatedOn: calendarDate(row.incorporatedOn),
        ceasedOn: row.ceasedOn == null ? null : calendarDate(row.ceasedOn),
        sicCodes: row.sicCodes.map((code) => ({
          code,
          label: sicLabel(code),
        })),
        sizeBand: sizeBandForAccounts(row.accountsType),
        accountsMadeUpTo:
          row.accountsMadeUpTo == null
            ? null
            : calendarDate(row.accountsMadeUpTo),
        officeOutcode: trimOrNull(row.officeOutcode),
      };
    }
  }

  const sec = secLink
    ? { cik: secLink.registryId, url: edgarCompanyUrl(secLink.registryId) }
    : null;
  if (!companiesHouse && !sec) return null;
  return { companiesHouse, sec };
}

/**
 * `now` is the date "rounds in the last 24 months" is counted against. Pages
 * leave it out; tests pass a fixed date.
 */
export async function getCompanyDetail(
  db: Db,
  slug: string,
  now: Date | string = new Date(),
): Promise<CompanyDetail | null> {
  const [company] = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      name: companies.name,
      description: companies.description,
      websiteDomain: companies.websiteDomain,
      countryCode: companies.countryCode,
      city: companies.city,
      foundedYear: companies.foundedYear,
      foundedYearSource: companies.foundedYearSource,
      status: companies.status,
      ukCompanyNumber: companies.ukCompanyNumber,
      secCik: companies.secCik,
      ycBatch: companies.ycBatch,
      githubOrg: companies.githubOrg,
      mergedIntoId: companies.mergedIntoId,
      firstSeenAt: companies.firstSeenAt,
      updatedAt: companies.updatedAt,
    })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);
  if (!company) return null;

  const [
    redirectToSlug,
    tagRows,
    eventRows,
    themeRows,
    locationRows,
    momentumRows,
    sectorRows,
    registry,
  ] = await Promise.all([
    redirectSlug(db, company.mergedIntoId),
    db
      .select({ slug: tags.slug, label: tags.label })
      .from(companyTags)
      .innerJoin(tags, eq(tags.id, companyTags.tagId))
      .where(eq(companyTags.companyId, company.id))
      .orderBy(asc(tags.label)),
    db
      .select({
        id: events.id,
        type: events.type,
        announcedOn: events.announcedOn,
        datePrecision: events.datePrecision,
        evidence: events.evidence,
        sourceCount: events.sourceCount,
      })
      .from(events)
      .where(eq(events.companyId, company.id))
      .orderBy(desc(events.announcedOn), desc(events.id)),
    db
      .select({ slug: themes.slug, name: themes.name, sector: themes.sector })
      .from(companyThemes)
      .innerJoin(themes, eq(themes.id, companyThemes.themeId))
      .where(eq(companyThemes.companyId, company.id))
      .orderBy(asc(themes.name), asc(themes.slug)),
    db
      .select({
        precision: companyLocations.precision,
        countryCode: companyLocations.countryCode,
        itl1Code: companyLocations.itl1Code,
        placeSlug: companyLocations.placeSlug,
        outcode: companyLocations.outcode,
      })
      .from(companyLocations)
      .where(eq(companyLocations.companyId, company.id))
      .limit(1),
    db
      .select({
        eventId: fundingRoundMomentum.eventId,
        equityRoundNumber: fundingRoundMomentum.equityRoundNumber,
        monthsSincePrevious: fundingRoundMomentum.monthsSincePrevious,
        stepUpRatio: fundingRoundMomentum.stepUpRatio,
        stepUpBasisOn: basisEvent.announcedOn,
      })
      .from(fundingRoundMomentum)
      .leftJoin(
        basisEvent,
        eq(basisEvent.id, fundingRoundMomentum.stepUpBasisEventId),
      )
      .where(eq(fundingRoundMomentum.companyId, company.id)),
    db
      .select({ sector: companySectors.sector })
      .from(companySectors)
      .where(eq(companySectors.companyId, company.id)),
    loadRegistry(db, company.id),
  ]);

  const momentumByEvent = new Map<number, RoundMomentum>(
    momentumRows.map((row) => [
      row.eventId,
      {
        equityRoundNumber: row.equityRoundNumber,
        monthsSincePrevious: row.monthsSincePrevious,
        stepUpRatio: row.stepUpRatio,
        stepUpBasisOn:
          row.stepUpRatio == null || row.stepUpBasisOn == null
            ? null
            : calendarDate(row.stepUpBasisOn),
      },
    ]),
  );
  const companyEvents = (await loadEvents(db, eventRows)).map((event) =>
    event.type === "funding_round"
      ? { ...event, momentum: momentumByEvent.get(event.id) ?? null }
      : event,
  );

  const themeRefs: ThemeRef[] = themeRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    sector: row.sector != null && isSector(row.sector) ? row.sector : null,
  }));
  // company_sectors when it has rows, else the theme sectors as before.
  const sectors: Sector[] = [];
  const stored = new Set(sectorRows.map((row) => row.sector));
  if (stored.size > 0) {
    for (const sector of SECTORS) {
      if (stored.has(sector)) sectors.push(sector);
    }
  } else {
    for (const theme of themeRefs) {
      if (theme.sector && !sectors.includes(theme.sector)) {
        sectors.push(theme.sector);
      }
    }
  }
  const fundingEvents = companyEvents.flatMap((event) =>
    event.type === "funding_round" ? [event] : [],
  );

  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    description: company.description,
    websiteDomain: company.websiteDomain,
    countryCode: trimOrNull(company.countryCode),
    city: company.city,
    foundedYear: company.foundedYear,
    foundedYearSource: company.foundedYearSource,
    status: company.status,
    ukCompanyNumber: company.ukCompanyNumber,
    secCik: company.secCik,
    ycBatch: company.ycBatch,
    githubOrg: company.githubOrg,
    firstSeenAt: requiredTimestamp(company.firstSeenAt),
    updatedAt: requiredTimestamp(company.updatedAt),
    tags: tagRows,
    redirectToSlug,
    events: companyEvents,
    themes: themeRefs,
    sectors,
    location: toLocationView(locationRows[0], company.city),
    registry,
    roundsInLast24Months: roundsInLastMonths(
      fundingEvents.map((event) => ({
        announcedOn: event.announcedOn,
        roundType: event.roundType,
      })),
      now,
    ),
  };
}

function toLocationView(
  row:
    | {
        precision: CompanyLocationView["precision"];
        countryCode: string;
        itl1Code: string | null;
        placeSlug: string | null;
        outcode: string | null;
      }
    | undefined,
  city: string | null,
): CompanyLocationView | null {
  if (!row) return null;
  const place = row.placeSlug ? findPlaceBySlug(row.placeSlug) : null;
  // Non-UK locations have no place slug; the news city is the name.
  const placeName =
    place?.name ??
    (row.placeSlug == null && row.precision === "town"
      ? trimOrNull(city)
      : null);
  return {
    precision: row.precision,
    ukRegion: row.itl1Code
      ? (ukRegionByCode(row.itl1Code)?.slug ?? null)
      : null,
    placeName,
    outcode: row.outcode,
    countryCode: row.countryCode.trim(),
  };
}

async function loadEvents(
  db: Db,
  eventRows: Array<{
    id: number;
    type: "funding_round" | "acquisition" | "launch";
    announcedOn: string;
    datePrecision: "day" | "month" | "year";
    evidence: "reported" | "confirmed";
    sourceCount: number;
  }>,
): Promise<CompanyEvent[]> {
  if (eventRows.length === 0) return [];
  const eventIds = eventRows.map((event) => event.id);

  const [fundingRows, acquisitionRows, launchRows, investorRows, sourceRows] =
    await Promise.all([
      db
        .select({
          eventId: fundingRounds.eventId,
          roundType: fundingRounds.roundType,
          roundLabel: fundingRounds.roundLabel,
          amountMinor: fundingRounds.amountMinor,
          currency: fundingRounds.currency,
          amountUsdMinor: fundingRounds.amountUsdMinor,
          amountGbpMinor: fundingRounds.amountGbpMinor,
          fxRateDate: fundingRounds.fxRateDate,
          includesIndividualAngels: fundingRounds.includesIndividualAngels,
        })
        .from(fundingRounds)
        .where(inArray(fundingRounds.eventId, eventIds)),
      db
        .select({
          eventId: acquisitions.eventId,
          acquirerName: acquisitions.acquirerName,
          acquirerSlug: companies.slug,
          acquirerCompanyName: companies.name,
          priceMinor: acquisitions.priceMinor,
          currency: acquisitions.currency,
          priceUsdMinor: acquisitions.priceUsdMinor,
          priceGbpMinor: acquisitions.priceGbpMinor,
          fxRateDate: acquisitions.fxRateDate,
        })
        .from(acquisitions)
        .leftJoin(companies, eq(companies.id, acquisitions.acquirerCompanyId))
        .where(inArray(acquisitions.eventId, eventIds)),
      db
        .select({
          eventId: launches.eventId,
          kind: launches.kind,
          productName: launches.productName,
          url: launches.url,
          externalRef: launches.externalRef,
        })
        .from(launches)
        .where(inArray(launches.eventId, eventIds)),
      db
        .select({
          eventId: eventInvestors.eventId,
          slug: investors.slug,
          name: investors.name,
          role: eventInvestors.role,
        })
        .from(eventInvestors)
        .innerJoin(investors, eq(investors.id, eventInvestors.investorId))
        .where(inArray(eventInvestors.eventId, eventIds)),
      db
        .select({
          eventId: eventSources.eventId,
          title: sourceItems.title,
          url: sourceItems.url,
          sourceName: sources.name,
          publishedAt: sourceItems.publishedAt,
        })
        .from(eventSources)
        .innerJoin(sourceItems, eq(sourceItems.id, eventSources.sourceItemId))
        .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
        .where(inArray(eventSources.eventId, eventIds)),
    ]);

  const fundingByEvent = new Map(fundingRows.map((row) => [row.eventId, row]));
  const acquisitionByEvent = new Map(
    acquisitionRows.map((row) => [row.eventId, row]),
  );
  const launchByEvent = new Map(launchRows.map((row) => [row.eventId, row]));
  const investorsByEvent = groupBy(investorRows, (row) => row.eventId);
  const sourcesByEvent = groupBy(sourceRows, (row) => row.eventId);

  const confirmationsByEvent = await loadConfirmations(
    db,
    eventRows.map((event) => ({
      eventId: event.id,
      announcedOn: event.announcedOn,
      evidence: event.evidence,
      isGrant: fundingByEvent.get(event.id)?.roundType === "grant",
    })),
  );

  const loaded: CompanyEvent[] = [];
  for (const event of eventRows) {
    const built = toCompanyEvent(
      event,
      fundingByEvent.get(event.id),
      acquisitionByEvent.get(event.id),
      launchByEvent.get(event.id),
      investorsByEvent.get(event.id) ?? [],
      sourcesFor(sourcesByEvent.get(event.id) ?? []),
    );
    if (built) {
      loaded.push({
        ...built,
        confirmations: confirmationsByEvent.get(event.id) ?? [],
      });
    }
  }
  return loaded;
}

function sourcesFor(
  rows: Array<{
    title: string;
    url: string;
    sourceName: string;
    publishedAt: Date | null;
  }>,
): EventSourceLink[] {
  const links = rows.map((row) => ({
    title: row.title,
    url: row.url,
    sourceName: row.sourceName,
    publishedAt: isoTimestamp(row.publishedAt),
  }));
  links.sort((left, right) => {
    if (left.publishedAt == null && right.publishedAt == null) {
      return left.title.localeCompare(right.title);
    }
    if (left.publishedAt == null) return 1;
    if (right.publishedAt == null) return -1;
    if (left.publishedAt === right.publishedAt) {
      return left.title.localeCompare(right.title);
    }
    return left.publishedAt < right.publishedAt ? 1 : -1;
  });
  return links;
}

function toCompanyEvent(
  event: {
    id: number;
    type: "funding_round" | "acquisition" | "launch";
    announcedOn: string;
    datePrecision: "day" | "month" | "year";
    evidence: "reported" | "confirmed";
    sourceCount: number;
  },
  funding:
    | {
        roundType: RoundType;
        roundLabel: string | null;
        amountMinor: number | null;
        currency: string | null;
        amountUsdMinor: number | null;
        amountGbpMinor: number | null;
        fxRateDate: string | null;
        includesIndividualAngels: boolean;
      }
    | undefined,
  acquisition:
    | {
        acquirerName: string;
        acquirerSlug: string | null;
        acquirerCompanyName: string | null;
        priceMinor: number | null;
        currency: string | null;
        priceUsdMinor: number | null;
        priceGbpMinor: number | null;
        fxRateDate: string | null;
      }
    | undefined,
  launch:
    | {
        kind: LaunchKind;
        productName: string | null;
        url: string | null;
        externalRef: string | null;
      }
    | undefined,
  investorRows: Array<{
    slug: string;
    name: string;
    role: EventInvestor["role"];
  }>,
  sources: EventSourceLink[],
): CompanyEvent | null {
  const base = {
    id: event.id,
    announcedOn: calendarDate(event.announcedOn),
    datePrecision: event.datePrecision,
    evidence: event.evidence,
    sourceCount: event.sourceCount,
    sources,
  };

  if (event.type === "funding_round") {
    if (!funding) return null;
    const investorsOnRound: EventInvestor[] = investorRows
      .map((row) => ({ slug: row.slug, name: row.name, role: row.role }))
      .sort((left, right) => {
        const byRole = ROLE_RANK[left.role] - ROLE_RANK[right.role];
        return byRole === 0 ? left.name.localeCompare(right.name) : byRole;
      });
    return {
      ...base,
      type: "funding_round",
      roundType: funding.roundType,
      roundLabel: funding.roundLabel,
      amount: money(funding.amountMinor, funding.currency),
      amountUsdMinor: funding.amountUsdMinor,
      amountGbpMinor: funding.amountGbpMinor,
      fxRateDate: funding.fxRateDate,
      includesIndividualAngels: funding.includesIndividualAngels,
      investors: investorsOnRound,
    };
  }

  if (event.type === "acquisition") {
    if (!acquisition) return null;
    const acquirer =
      acquisition.acquirerSlug != null &&
      acquisition.acquirerCompanyName != null
        ? {
            slug: acquisition.acquirerSlug,
            name: acquisition.acquirerCompanyName,
          }
        : null;
    return {
      ...base,
      type: "acquisition",
      acquirer,
      acquirerName: acquisition.acquirerName,
      price: money(acquisition.priceMinor, acquisition.currency),
      priceUsdMinor: acquisition.priceUsdMinor,
      priceGbpMinor: acquisition.priceGbpMinor,
      fxRateDate: acquisition.fxRateDate,
    };
  }

  if (!launch) return null;
  return {
    ...base,
    type: "launch",
    kind: launch.kind,
    productName: launch.productName,
    url: launch.url,
    externalRef: launch.externalRef,
  };
}

const DAY_MS = 86_400_000;

function utcDay(value: Date | string): number {
  const date = typeof value === "string" ? new Date(value) : value;
  return Math.floor(date.getTime() / DAY_MS);
}

/**
 * The light company view for the split preview: header and key facts, the
 * latest round with its leads and confirmation, the registry summary and the
 * inputs of the signals. No history and no source list; the company page has
 * those. `now` is the date the days since the last round are counted to.
 */
export async function getCompanyPreview(
  db: Db,
  slug: string,
  now: Date | string = new Date(),
): Promise<CompanyPreview | null> {
  const [company] = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      name: companies.name,
      description: companies.description,
      websiteDomain: companies.websiteDomain,
      countryCode: companies.countryCode,
      city: companies.city,
      foundedYear: companies.foundedYear,
      foundedYearSource: companies.foundedYearSource,
      status: companies.status,
      mergedIntoId: companies.mergedIntoId,
    })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);
  if (!company) return null;

  const [redirectToSlug, themeRows, roundDates, latestRows, registry] =
    await Promise.all([
      redirectSlug(db, company.mergedIntoId),
      db
        .select({
          themeId: companyThemes.themeId,
          tagCount: companyThemes.tagCount,
          sector: themes.sector,
        })
        .from(companyThemes)
        .innerJoin(themes, eq(themes.id, companyThemes.themeId))
        .where(eq(companyThemes.companyId, company.id)),
      db
        .select({
          announcedOn: events.announcedOn,
          roundType: fundingRounds.roundType,
        })
        .from(events)
        .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
        .where(eq(events.companyId, company.id)),
      db
        .select(fundingColumns())
        .from(events)
        .innerJoin(companies, eq(companies.id, events.companyId))
        .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
        .where(eq(events.companyId, company.id))
        .orderBy(desc(events.announcedOn), desc(events.id))
        .limit(1),
      loadRegistry(db, company.id),
    ]);

  const [latest] = await withConfirmations(db, latestRows);
  const confirmation = latest?.confirmation ?? null;
  const firstRoundOn =
    roundDates.map((round) => calendarDate(round.announcedOn)).sort()[0] ??
    null;
  const ch = registry?.companiesHouse ?? null;

  return {
    slug: company.slug,
    name: company.name,
    description: trimOrNull(company.description),
    websiteDomain: trimOrNull(company.websiteDomain),
    countryCode: trimOrNull(company.countryCode),
    city: company.city,
    mainSector: chooseMainSector({
      themes: themeRows,
      sicCodes: ch?.sicCodes.map((sic) => sic.code) ?? [],
    }),
    foundedYear: company.foundedYear,
    foundedYearSource: company.foundedYearSource,
    status: company.status,
    roundsInLast24Months: roundsInLastMonths(
      roundDates.map((round) => ({
        announcedOn: calendarDate(round.announcedOn),
        roundType: round.roundType,
      })),
      now,
    ),
    redirectToSlug,
    latestRound: latest
      ? {
          eventId: latest.eventId,
          roundType: latest.roundType,
          roundLabel: latest.roundLabel,
          amount: latest.amount,
          amountGbpMinor: latest.amountGbpMinor,
          announcedOn: calendarDate(latest.announcedOn),
          leadInvestors: latest.leadInvestors,
          investorCount: latest.investorCount,
          sourceCount: latest.sourceCount,
          evidence: latest.evidence ?? "reported",
          confirmation,
        }
      : null,
    registry: ch
      ? {
          companyNumber: ch.companyNumber,
          url: ch.url,
          statusLabel: ch.statusLabel,
          sizeBand: ch.sizeBand,
          incorporatedOn: ch.incorporatedOn,
        }
      : null,
    signals: {
      confirmed: latest
        ? latest.evidence === "confirmed" || confirmation !== null
        : false,
      daysSinceLastRound: latest
        ? Math.max(
            0,
            utcDay(now) -
              utcDay(`${calendarDate(latest.announcedOn)}T00:00:00Z`),
          )
        : null,
      firstRoundOn,
      sourceCount: latest?.sourceCount ?? 0,
    },
  };
}

/** One compact item in "Companies like this": the company and its latest round. */
export interface SimilarCompany {
  slug: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  roundType: RoundType;
  roundLabel: string | null;
  amount: Money | null;
  amountGbpMinor: number | null;
  /** YYYY-MM-DD of the latest round. */
  announcedOn: string;
}

export interface SimilarCompanies {
  /** This company's main sector. Null means nothing is compared ("Sector pending"). */
  mainSector: Sector | null;
  /** The round type of this company's latest funding round, or null. */
  roundType: RoundType | null;
  /** At most `limit`: the same stage first, then the newest rounds. */
  items: SimilarCompany[];
}

export const SIMILAR_COMPANIES_LIMIT = 5;
/** How many of the newest candidate rounds are read before ranking. */
const SIMILAR_POOL = 400;

/**
 * "Companies like this" (docs/design/design-system.md section 2): other
 * companies with the same main sector, ranked by the same stage (the exact
 * round type, then the same stage bucket), then by their latest round, newest
 * first. Only companies with a funding round count; merged companies and this
 * company never appear. The main sector is worked out as for list rows
 * (`src/lib/main-sector.ts`), so the sector shown here and in lists agrees.
 * Returns null for an unknown slug.
 */
export async function getSimilarCompanies(
  db: Db,
  slug: string,
  limit: number = SIMILAR_COMPANIES_LIMIT,
): Promise<SimilarCompanies | null> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);
  if (!company) return null;

  const [themeRows, sicRows, latestRows] = await Promise.all([
    db
      .select({
        themeId: companyThemes.themeId,
        tagCount: companyThemes.tagCount,
        sector: themes.sector,
      })
      .from(companyThemes)
      .innerJoin(themes, eq(themes.id, companyThemes.themeId))
      .where(eq(companyThemes.companyId, company.id)),
    db
      .select({ sicCodes: chCompanies.sicCodes })
      .from(registryLinks)
      .innerJoin(
        chCompanies,
        eq(chCompanies.companyNumber, registryLinks.registryId),
      )
      .where(
        and(
          eq(registryLinks.companyId, company.id),
          eq(registryLinks.registry, "companies_house"),
          eq(registryLinks.status, "linked"),
        ),
      )
      .orderBy(asc(registryLinks.id))
      .limit(1),
    db
      .select({ roundType: fundingRounds.roundType })
      .from(events)
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(eq(events.companyId, company.id))
      .orderBy(desc(events.announcedOn), desc(events.id))
      .limit(1),
  ]);
  const roundType = latestRows[0]?.roundType ?? null;
  const mainSector = chooseMainSector({
    themes: themeRows,
    sicCodes: sicRows[0]?.sicCodes ?? [],
  });
  if (mainSector === null) return { mainSector, roundType, items: [] };

  // Candidates: a theme in the sector, or no sector theme at all and a linked
  // Companies House record (their main sector comes from SIC codes). The exact
  // main sector is checked below, so this only narrows the read.
  const sectorTheme = sql`exists (
    select 1 from ${companyThemes}
    inner join ${themes} on ${themes.id} = ${companyThemes.themeId}
    where ${companyThemes.companyId} = ${companies.id}
      and ${themes.sector} = ${mainSector}
  )`;
  const sicOnly = sql`(not exists (
    select 1 from ${companyThemes}
    inner join ${themes} on ${themes.id} = ${companyThemes.themeId}
    where ${companyThemes.companyId} = ${companies.id}
      and ${themes.sector} is not null
      and ${themes.sector} <> 'other'
  ) and exists (
    select 1 from ${registryLinks}
    where ${registryLinks.companyId} = ${companies.id}
      and ${registryLinks.registry} = 'companies_house'
      and ${registryLinks.status} = 'linked'
  ))`;

  const rows = await db
    .select({
      companyId: companies.id,
      slug: companies.slug,
      name: companies.name,
      countryCode: companies.countryCode,
      city: companies.city,
      themeStrengths: themeStrengthsSql(),
      sicCodes: sicCodesSql(),
      roundType: fundingRounds.roundType,
      roundLabel: fundingRounds.roundLabel,
      amountMinor: fundingRounds.amountMinor,
      currency: fundingRounds.currency,
      amountGbpMinor: fundingRounds.amountGbpMinor,
      announcedOn: events.announcedOn,
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(
      and(
        ne(companies.id, company.id),
        isNull(companies.mergedIntoId),
        or(sectorTheme, sicOnly),
      ),
    )
    .orderBy(desc(events.announcedOn), desc(events.id))
    .limit(SIMILAR_POOL);

  // Newest first, so the first row seen per company is its latest round.
  const seen = new Set<number>();
  const ranked: Array<{ item: SimilarCompany; rank: number }> = [];
  for (const row of rows) {
    if (seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    if (mainSectorOf(row) !== mainSector) continue;
    ranked.push({
      rank: stageRank(row.roundType, roundType),
      item: {
        slug: row.slug,
        name: row.name,
        countryCode: trimOrNull(row.countryCode),
        city: trimOrNull(row.city),
        roundType: row.roundType,
        roundLabel: row.roundLabel,
        amount: money(row.amountMinor, row.currency),
        amountGbpMinor: row.amountGbpMinor,
        announcedOn: calendarDate(row.announcedOn),
      },
    });
  }
  // A stable sort keeps the newest first within each rank.
  ranked.sort((a, b) => a.rank - b.rank);
  return {
    mainSector,
    roundType,
    items: ranked.slice(0, limit).map((entry) => entry.item),
  };
}

/** 0 for the same round type, 1 for the same stage bucket, 2 otherwise. */
function stageRank(candidate: RoundType, own: RoundType | null): number {
  if (own === null) return 2;
  if (candidate === own) return 0;
  return stageBucket(candidate) === stageBucket(own) ? 1 : 2;
}
