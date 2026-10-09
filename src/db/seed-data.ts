import type { IngestStats } from "@/core/domain";
import type {
  AliasSource,
  CompanyStatus,
  FoundedYearSource,
  IngestStatus,
  IngestTrigger,
  InvestorKind,
  InvestorRole,
  LaunchKind,
  LlmPurpose,
  RoundType,
  SourceItemStatus,
  SourceKind,
} from "@/core/enums";
import { LAUNCH_KINDS, ROUND_TYPES } from "@/core/enums";
import { slugify } from "@/lib/normalise";

const CURRENT_MONTH_SPEND = [120_000, 80_000] as const;
const PREVIOUS_MONTH_SPEND = 500_000;

export const SEEDED_LISTED_ROUND_COUNT = 60;

export const SEED_REFERENCE = {
  liveCompanySlug: slugify("Northwind Robotics"),
  mergedCompanySlug: slugify("Old Northwind Labs"),
  investorSlug: slugify("Northstar Capital"),
  mergedInvestorSlug: slugify("Old Lumen Partners"),
  survivingInvestorSlug: slugify("Lumen Ventures"),
  acquiredCompanySlug: slugify("Pennywhistle Health"),
  tagSlug: "robotics",
  sourceName: "Example Wire",
  latestCapGbp: 3,
  olderCapGbp: 9,
  currentMonthUsdMicros: CURRENT_MONTH_SPEND[0] + CURRENT_MONTH_SPEND[1],
  previousMonthUsdMicros: PREVIOUS_MONTH_SPEND,
  listedFundingRounds: SEEDED_LISTED_ROUND_COUNT,
} as const;

export interface SeedCompany {
  slug: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  description: string;
  websiteDomain: string | null;
  foundedYear: number | null;
  foundedYearSource: FoundedYearSource | null;
  status: CompanyStatus;
  ukCompanyNumber: string | null;
  ycBatch: string | null;
  githubOrg: string | null;
  mergedIntoSlug: string | null;
  tags: string[];
}

export interface SeedAlias {
  companySlug: string;
  alias: string;
  source: AliasSource;
}

export interface SeedTag {
  slug: string;
  label: string;
}

export interface SeedCompanyTag {
  companySlug: string;
  tagSlug: string;
}

export interface SeedInvestor {
  slug: string;
  name: string;
  kind: InvestorKind;
  countryCode: string | null;
  websiteDomain: string | null;
  mergedIntoSlug: string | null;
}

export interface SeedArticle {
  externalId: string;
  title: string;
  url: string;
  publishedAt: string;
}

interface SeedEventBase {
  companySlug: string;
  announcedOn: string;
  articles: SeedArticle[];
}

export interface SeedFundingEvent extends SeedEventBase {
  type: "funding_round";
  roundType: RoundType;
  roundLabel: string | null;
  amountMinor: number | null;
  currency: string | null;
  amountGbpMinor: number | null;
  amountUsdMinor: number | null;
  fxRateDate: string | null;
  includesIndividualAngels: boolean;
  investors: Array<{ slug: string; role: InvestorRole }>;
}

export interface SeedAcquisitionEvent extends SeedEventBase {
  type: "acquisition";
  acquirerSlug: string | null;
  acquirerName: string;
  priceMinor: number | null;
  currency: string | null;
  priceGbpMinor: number | null;
  priceUsdMinor: number | null;
  fxRateDate: string | null;
}

export interface SeedLaunchEvent extends SeedEventBase {
  type: "launch";
  kind: LaunchKind;
  productName: string | null;
  url: string | null;
  externalRef: string | null;
}

export type SeedEvent =
  SeedFundingEvent | SeedAcquisitionEvent | SeedLaunchEvent;

export interface SeedSource {
  slug: string;
  name: string;
  kind: SourceKind;
  url: string;
  priority: number;
}

export interface SeedLooseItem {
  externalId: string;
  title: string;
  url: string;
  status: SourceItemStatus;
  publishedAt: string;
}

export interface SeedRun {
  startedAt: Date;
  finishedAt: Date | null;
  trigger: IngestTrigger;
  status: IngestStatus;
  stats: IngestStats | null;
  error: string | null;
}

export interface SeedUsage {
  occurredAt: Date;
  purpose: LlmPurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  runIndex: number | null;
}

export interface SeedDataset {
  companies: SeedCompany[];
  aliases: SeedAlias[];
  tags: SeedTag[];
  companyTags: SeedCompanyTag[];
  investors: SeedInvestor[];
  events: SeedEvent[];
  source: SeedSource;
  looseItems: SeedLooseItem[];
  runs: SeedRun[];
  usage: SeedUsage[];
}

interface CompanySpec {
  name: string;
  country: string | null;
  city: string | null;
  tags: string[];
  status?: CompanyStatus;
  websiteDomain?: string | null;
  foundedYear?: number;
  ukCompanyNumber?: string;
  ycBatch?: string;
  githubOrg?: string;
  description?: string;
}

const COMPANY_SPECS: CompanySpec[] = [
  {
    name: "Northwind Robotics",
    country: "GB",
    city: "London",
    tags: ["robotics", "industrial"],
    websiteDomain: "northwindrobotics.example",
    foundedYear: 2016,
    ukCompanyNumber: "10482931",
    ycBatch: "S24",
    githubOrg: "northwind-robotics",
    description: "Builds warehouse robots for regional factories.",
  },
  {
    name: "Harbour Ledger",
    country: "GB",
    city: "Manchester",
    tags: ["fintech"],
  },
  {
    name: "Cotswold Carbon",
    country: "GB",
    city: "Bristol",
    tags: ["climate"],
  },
  {
    name: "Pennywhistle Health",
    country: "GB",
    city: "Edinburgh",
    tags: ["health"],
    status: "acquired",
  },
  { name: "Thames Grid", country: "GB", city: "London", tags: ["energy"] },
  {
    name: "Larkspur Legal",
    country: "GB",
    city: "Cambridge",
    tags: ["legal"],
  },
  {
    name: "Bramble Market",
    country: "GB",
    city: "Leeds",
    tags: ["commerce"],
  },
  {
    name: "Fjord Packet",
    country: "SE",
    city: "Stockholm",
    tags: ["logistics"],
  },
  { name: "Amberloft", country: "DE", city: "Berlin", tags: ["housing"] },
  { name: "Cinder Rye", country: "FR", city: "Paris", tags: ["food"] },
  {
    name: "Canal Metric",
    country: "NL",
    city: "Amsterdam",
    tags: ["analytics"],
    status: "closed",
  },
  {
    name: "Liffey Signal",
    country: "IE",
    city: "Dublin",
    tags: ["communications"],
  },
  { name: "Sierra Malt", country: "ES", city: "Madrid", tags: ["food"] },
  {
    name: "Danube Metals",
    country: "AT",
    city: "Vienna",
    tags: ["industrial"],
  },
  { name: "Baltic Kiln", country: "FI", city: "Helsinki", tags: ["climate"] },
  {
    name: "Maple Circuit",
    country: "CA",
    city: "Toronto",
    tags: ["hardware"],
  },
  {
    name: "Redwood Census",
    country: "US",
    city: "San Francisco",
    tags: ["data", "robotics"],
  },
  {
    name: "Prairie Relay",
    country: "US",
    city: "Chicago",
    tags: ["logistics"],
  },
  { name: "Hudson Yarn", country: "US", city: "New York", tags: ["commerce"] },
  {
    name: "Cascadia Drift",
    country: "US",
    city: "Seattle",
    tags: ["climate"],
  },
  { name: "Mesa Foundry", country: "US", city: "Austin", tags: ["industrial"] },
  {
    name: "Cerrado Cloud",
    country: "BR",
    city: "Sao Paulo",
    tags: ["software"],
  },
  {
    name: "Andes Parcel",
    country: "MX",
    city: "Mexico City",
    tags: ["logistics"],
  },
  {
    name: "Pampas Ledger",
    country: "AR",
    city: "Buenos Aires",
    tags: ["fintech"],
  },
  {
    name: "Kite Harbour",
    country: "SG",
    city: "Singapore",
    tags: ["logistics"],
  },
  { name: "Neon Koi", country: "JP", city: "Tokyo", tags: ["robotics"] },
  {
    name: "Monsoon Works",
    country: "IN",
    city: "Bengaluru",
    tags: ["software"],
  },
  { name: "Han River Labs", country: "KR", city: "Seoul", tags: ["health"] },
  {
    name: "Orchid Payments",
    country: "HK",
    city: "Hong Kong",
    tags: ["fintech"],
  },
  { name: "Dune Alloy", country: "AE", city: "Dubai", tags: ["industrial"] },
  {
    name: "Cedar Route",
    country: "IL",
    city: "Tel Aviv",
    tags: ["logistics"],
  },
  { name: "Baobab Grid", country: "NG", city: "Lagos", tags: ["energy"] },
  {
    name: "Table Mountain Bio",
    country: "ZA",
    city: "Cape Town",
    tags: ["health"],
  },
  {
    name: "Kauri Dynamics",
    country: "NZ",
    city: "Auckland",
    tags: ["robotics"],
  },
  { name: "Spinifex Solar", country: "AU", city: "Perth", tags: ["energy"] },
  { name: "Coral Ledger", country: "AU", city: "Sydney", tags: ["fintech"] },
  { name: "Polar Survey", country: "AQ", city: null, tags: ["climate"] },
  {
    name: "Uncharted Mill",
    country: null,
    city: null,
    tags: ["industrial"],
    status: "unknown",
  },
  {
    name: "Glasshouse Logic",
    country: "GB",
    city: "London",
    tags: ["software"],
  },
  {
    name: "Wicklow Sensors",
    country: "IE",
    city: "Galway",
    tags: ["hardware"],
  },
];

interface InvestorSpec {
  name: string;
  kind: InvestorKind;
  country: string | null;
}

const INVESTOR_SPECS: InvestorSpec[] = [
  { name: "Northstar Capital", kind: "vc", country: "GB" },
  { name: "Lumen Ventures", kind: "vc", country: "US" },
  { name: "Harbour Equity", kind: "private_equity", country: "GB" },
  { name: "Cedar Accelerator", kind: "accelerator", country: "GB" },
  { name: "Baltic Bridge", kind: "vc", country: "SE" },
  { name: "Sahara Growth", kind: "vc", country: "AE" },
  { name: "Kite Corporate", kind: "corporate", country: "SG" },
  { name: "Pampas Fund", kind: "vc", country: "BR" },
  { name: "Kauri Angels", kind: "angel_network", country: "NZ" },
  { name: "Public Works Capital", kind: "government", country: "GB" },
  { name: "Family Oak Office", kind: "family_office", country: "US" },
  { name: "Glasshouse Partners", kind: "vc", country: "DE" },
  { name: "Mesa Unknown Partners", kind: "unknown", country: "US" },
  { name: "Coral Other Capital", kind: "other", country: "AU" },
  { name: "Fjord Seed Fund", kind: "vc", country: "SE" },
];

const CURRENCIES = ["GBP", "USD", "EUR", "SEK", "JPY", "BRL", "AUD"] as const;

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fundingDate(index: number): string {
  const year = 2023 + Math.floor(index / 20);
  const month = (index % 12) + 1;
  const day = (index % 27) + 1;
  return iso(year, month, day);
}

function gbpMinor(index: number): number | null {
  if (index === 7) return null;
  const pounds = 50_000 + ((index * 37) % 400) * 100_000;
  return pounds * 100;
}

function tagLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function descriptionFor(spec: CompanySpec): string {
  return (
    spec.description ??
    `${spec.name} is a fictional company in the local seed dataset.`
  );
}

function ingestStats(
  capGbp: number,
  spendUsdMicros: number,
  budgetPaused: boolean,
): IngestStats {
  return {
    collect: {
      sourcesAttempted: 1,
      sourcesNotModified: 0,
      sourcesFailed: 0,
      itemsFound: 12,
      itemsInserted: 10,
    },
    prefilter: { itemsChecked: 10, itemsPassed: 8, itemsFilteredOut: 2 },
    extract: {
      itemsAttempted: 8,
      itemsExtracted: 7,
      itemsRelevant: 6,
      itemsErrored: 0,
      itemsFailed: 1,
    },
    resolve: {
      extractionsResolved: 7,
      companiesCreated: 4,
      investorsCreated: 2,
      eventsCreated: 6,
      eventsUpdated: 1,
      mergeCandidatesCreated: 1,
    },
    fx: { ratesFetched: 4, eventsConverted: 5, eventsMissingRate: 1 },
    spendUsdMicros,
    monthToDateUsdMicros: spendUsdMicros,
    capGbp,
    budgetPaused,
  };
}

function atUtc(now: Date, monthOffset: number, day: number, hour = 12): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + monthOffset,
      day,
      hour,
      0,
      0,
    ),
  );
}

function inCurrentMonth(now: Date, minutesAgo: number): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const candidate = new Date(now.getTime() - minutesAgo * 60_000);
  return candidate < start ? start : candidate;
}

function assertUnique(label: string, slugs: string[]): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug)) throw new Error(`Duplicate seed ${label} slug ${slug}`);
    seen.add(slug);
  }
}

export function buildSeedDataset(now = new Date()): SeedDataset {
  let articleSeq = 0;
  const article = (title: string, announcedOn: string): SeedArticle => {
    articleSeq += 1;
    return {
      externalId: `story-${articleSeq}`,
      title,
      url: `https://example.com/stories/${articleSeq}`,
      publishedAt: `${announcedOn}T09:00:00.000Z`,
    };
  };

  const companies: SeedCompany[] = COMPANY_SPECS.map((spec, index) => {
    const slug = slugify(spec.name);
    const foundedYear =
      spec.foundedYear ?? (index % 6 === 0 ? null : 2012 + (index % 10));
    const websiteDomain =
      spec.websiteDomain !== undefined
        ? spec.websiteDomain
        : index % 3 === 0
          ? null
          : `${slug}.example`;
    return {
      slug,
      name: spec.name,
      countryCode: spec.country,
      city: spec.city,
      description: descriptionFor(spec),
      websiteDomain,
      foundedYear,
      foundedYearSource: foundedYear == null ? null : "news",
      status: spec.status ?? "active",
      ukCompanyNumber: spec.ukCompanyNumber ?? null,
      ycBatch: spec.ycBatch ?? null,
      githubOrg: spec.githubOrg ?? null,
      mergedIntoSlug: null,
      tags: spec.tags,
    };
  });

  companies.push({
    slug: SEED_REFERENCE.mergedCompanySlug,
    name: "Old Northwind Labs",
    countryCode: "GB",
    city: "London",
    description: "Earlier name kept so merged slugs can redirect.",
    websiteDomain: null,
    foundedYear: 2014,
    foundedYearSource: "manual",
    status: "active",
    ukCompanyNumber: null,
    ycBatch: null,
    githubOrg: null,
    mergedIntoSlug: SEED_REFERENCE.liveCompanySlug,
    tags: [],
  });

  const investors: SeedInvestor[] = INVESTOR_SPECS.map((spec) => ({
    slug: slugify(spec.name),
    name: spec.name,
    kind: spec.kind,
    countryCode: spec.country,
    websiteDomain: `${slugify(spec.name)}.example`,
    mergedIntoSlug: null,
  }));
  investors.push({
    slug: SEED_REFERENCE.mergedInvestorSlug,
    name: "Old Lumen Partners",
    kind: "vc",
    countryCode: "US",
    websiteDomain: null,
    mergedIntoSlug: SEED_REFERENCE.survivingInvestorSlug,
  });

  const liveCompanies = companies.filter((company) => !company.mergedIntoSlug);
  const liveInvestors = investors.filter(
    (investor) => !investor.mergedIntoSlug,
  );
  const northstar = liveInvestors[0];
  if (!northstar || liveInvestors.length !== 15) {
    throw new Error(`Expected 15 investors, built ${liveInvestors.length}`);
  }
  if (liveCompanies.length !== 40) {
    throw new Error(`Expected 40 companies, built ${liveCompanies.length}`);
  }

  const funding: SeedFundingEvent[] = [];
  for (let index = 0; index < SEEDED_LISTED_ROUND_COUNT; index += 1) {
    const company = liveCompanies[index % liveCompanies.length];
    if (!company) throw new Error(`Missing company for round ${index}`);
    const announcedOn = fundingDate(index);
    const gbp = gbpMinor(index);
    const currency = gbp == null ? null : CURRENCIES[index % CURRENCIES.length];
    const lead = index % 4 === 0 ? northstar : liveInvestors[(index % 14) + 1];
    if (!lead) throw new Error(`Missing lead investor for round ${index}`);
    const roundInvestors: SeedFundingEvent["investors"] = [
      { slug: lead.slug, role: "lead" },
    ];
    if (index % 3 === 0) {
      const participant = liveInvestors[(index % 13) + 1];
      if (participant && participant.slug !== lead.slug) {
        roundInvestors.push({ slug: participant.slug, role: "participant" });
      }
    }
    const articles = [
      article(`${company.name} announces funding`, announcedOn),
    ];
    if (index === 40) {
      articles.push(
        article(`${company.name} funding round, second report`, announcedOn),
      );
    }
    funding.push({
      type: "funding_round",
      companySlug: company.slug,
      announcedOn,
      roundType: ROUND_TYPES[index % ROUND_TYPES.length] ?? "unknown",
      roundLabel: index === 11 ? "seed extension" : null,
      amountMinor:
        gbp == null ? null : currency === "GBP" ? gbp : Math.round(gbp * 1.15),
      currency: currency ?? null,
      amountGbpMinor: gbp,
      amountUsdMinor: gbp == null ? null : Math.round(gbp * 1.27),
      fxRateDate: gbp == null ? null : announcedOn,
      includesIndividualAngels: index % 17 === 0,
      investors: roundInvestors,
      articles,
    });
  }

  const mergedAnnounced = "2020-05-01";
  funding.push({
    type: "funding_round",
    companySlug: SEED_REFERENCE.mergedCompanySlug,
    announcedOn: mergedAnnounced,
    roundType: "seed",
    roundLabel: null,
    amountMinor: 2_000_000_00,
    currency: "GBP",
    amountGbpMinor: 2_000_000_00,
    amountUsdMinor: 2_500_000_00,
    fxRateDate: mergedAnnounced,
    includesIndividualAngels: false,
    investors: [{ slug: northstar.slug, role: "lead" }],
    articles: [
      article("Old Northwind Labs raises a seed round", mergedAnnounced),
    ],
  });

  const acquisitionTargets = [3, 11, 16, 22, 30];
  const acquisitionDates = [
    "2024-03-12",
    "2024-07-19",
    "2025-02-02",
    "2025-11-08",
    "2026-04-21",
  ];
  const acquisitions: SeedAcquisitionEvent[] = acquisitionTargets.map(
    (companyIndex, index) => {
      const company = liveCompanies[companyIndex];
      const announcedOn = acquisitionDates[index];
      if (!company || !announcedOn) {
        throw new Error(`Missing acquisition target ${companyIndex}`);
      }
      const priced = index !== 1;
      const currency = index === 2 ? "USD" : index === 3 ? "EUR" : "GBP";
      const price = priced ? 500_000_000 + index * 25_000_000 : null;
      return {
        type: "acquisition",
        companySlug: company.slug,
        announcedOn,
        acquirerSlug: index === 0 ? SEED_REFERENCE.liveCompanySlug : null,
        acquirerName:
          index === 0 ? "Northwind Robotics" : `Example Holdco ${index + 1}`,
        priceMinor: price,
        currency: priced ? currency : null,
        priceGbpMinor: priced ? 480_000_000 : null,
        priceUsdMinor: priced ? 620_000_000 : null,
        fxRateDate: priced ? announcedOn : null,
        articles: [article(`${company.name} is acquired`, announcedOn)],
      };
    },
  );

  const launchTargets = [0, 8, 17, 25, 33];
  const launchDates = [
    "2026-06-09",
    "2024-05-05",
    "2025-01-18",
    "2025-08-30",
    "2026-02-14",
  ];
  const launches: SeedLaunchEvent[] = launchTargets.map(
    (companyIndex, index) => {
      const company = liveCompanies[companyIndex];
      const announcedOn = launchDates[index];
      const kind = LAUNCH_KINDS[index];
      if (!company || !announcedOn || !kind) {
        throw new Error(`Missing launch target ${companyIndex}`);
      }
      return {
        type: "launch",
        companySlug: company.slug,
        announcedOn,
        kind,
        productName:
          index === 0 ? "Warehouse Sorter" : `${company.name} Launch`,
        url:
          index === 0
            ? "https://example.com/products/warehouse-sorter"
            : `https://example.com/products/${company.slug}`,
        externalRef: kind === "open_source" ? "example/demo" : null,
        articles: [article(`${company.name} launches a product`, announcedOn)],
      };
    },
  );

  const tagSlugs = [
    ...new Set(companies.flatMap((company) => company.tags)),
  ].sort();
  const tags = tagSlugs.map((slug) => ({ slug, label: tagLabel(slug) }));
  const companyTags = companies.flatMap((company) =>
    company.tags.map((tagSlug) => ({ companySlug: company.slug, tagSlug })),
  );

  const latestStart = new Date(now.getTime() - 60 * 60 * 1000);
  const middleStart = atUtc(now, -1, 3);
  const oldestStart = atUtc(now, -2, 3);
  const runs: SeedRun[] = [
    {
      startedAt: oldestStart,
      finishedAt: new Date(oldestStart.getTime() + 60_000),
      trigger: "schedule",
      status: "failed",
      stats: ingestStats(SEED_REFERENCE.olderCapGbp, 40_000, false),
      error: "Example feed timed out",
    },
    {
      startedAt: middleStart,
      finishedAt: new Date(middleStart.getTime() + 60_000),
      trigger: "manual",
      status: "budget_paused",
      stats: ingestStats(5, 90_000, true),
      error: null,
    },
    {
      startedAt: latestStart,
      finishedAt: new Date(latestStart.getTime() + 60_000),
      trigger: "schedule",
      status: "succeeded",
      stats: ingestStats(SEED_REFERENCE.latestCapGbp, 200_000, false),
      error: null,
    },
  ];

  const usage: SeedUsage[] = [
    {
      occurredAt: inCurrentMonth(now, 5),
      purpose: "extraction",
      model: "gpt-4.1-nano",
      inputTokens: 800,
      outputTokens: 200,
      costUsdMicros: CURRENT_MONTH_SPEND[0],
      runIndex: 2,
    },
    {
      occurredAt: inCurrentMonth(now, 2),
      purpose: "extraction",
      model: "gpt-4.1-nano",
      inputTokens: 600,
      outputTokens: 150,
      costUsdMicros: CURRENT_MONTH_SPEND[1],
      runIndex: 2,
    },
    {
      occurredAt: atUtc(now, -1, 15),
      purpose: "extraction",
      model: "gpt-4.1-nano",
      inputTokens: 900,
      outputTokens: 220,
      costUsdMicros: PREVIOUS_MONTH_SPEND,
      runIndex: 1,
    },
  ];

  assertUnique(
    "company",
    companies.map((company) => company.slug),
  );
  assertUnique(
    "investor",
    investors.map((investor) => investor.slug),
  );
  const liveFunding = funding.filter(
    (event) => event.companySlug !== SEED_REFERENCE.mergedCompanySlug,
  );
  if (liveFunding.length !== SEEDED_LISTED_ROUND_COUNT) {
    throw new Error(
      `Expected ${SEEDED_LISTED_ROUND_COUNT} live funding rounds, built ${liveFunding.length}`,
    );
  }
  if (acquisitions.length !== 5 || launches.length !== 5) {
    throw new Error("Expected 5 acquisitions and 5 launches");
  }

  return {
    companies,
    aliases: [
      {
        companySlug: SEED_REFERENCE.liveCompanySlug,
        alias: "Northwind Bots",
        source: "manual",
      },
    ],
    tags,
    companyTags,
    investors,
    events: [...funding, ...acquisitions, ...launches],
    source: {
      slug: "example-wire",
      name: SEED_REFERENCE.sourceName,
      kind: "rss",
      url: "https://example.com/feed",
      priority: 1,
    },
    looseItems: [
      {
        externalId: "pending-1",
        title: "Unprocessed example item",
        url: "https://example.com/queue/pending-1",
        status: "pending",
        publishedAt: "2024-01-04T09:00:00.000Z",
      },
      {
        externalId: "filtered-1",
        title: "Filtered example item",
        url: "https://example.com/queue/filtered-1",
        status: "filtered_out",
        publishedAt: "2024-02-04T09:00:00.000Z",
      },
      {
        externalId: "failed-1",
        title: "Failed example item",
        url: "https://example.com/queue/failed-1",
        status: "failed",
        publishedAt: "2024-03-04T09:00:00.000Z",
      },
    ],
    runs,
    usage,
  };
}
