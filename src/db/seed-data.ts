import type { IngestStats } from "@/core/domain";
import type {
  AliasSource,
  CompanyStatus,
  EvidenceLevel,
  FoundedYearSource,
  IngestStatus,
  IngestTrigger,
  InvestorKind,
  InvestorRole,
  LaunchKind,
  LlmPurpose,
  LocationPrecision,
  LocationSource,
  RecordKind,
  RegistryKind,
  RegistryLinkMethod,
  RoundType,
  SourceItemStatus,
  SourceKind,
  ThemeAssignedBy,
  ThemeNameSource,
} from "@/core/enums";
import { LAUNCH_KINDS, ROUND_TYPES } from "@/core/enums";
import type { CapitalAmount } from "@/core/registry";
import type { Sector } from "@/core/sectors";
import { slugify } from "@/lib/normalise";
import { addWeeks, lastCompleteWeek, toUtcDay, weekStart } from "@/lib/weeks";

const CURRENT_MONTH_SPEND = [120_000, 80_000] as const;
const PREVIOUS_MONTH_SPEND = 500_000;

/** Funding events the Phase 1 seed builds. Every tenth one has round type `grant`. */
const PHASE1_ROUND_COUNT = 60;
/**
 * Funding events the Phase 2 seed adds: 31 rounds and 5 grants. Grants are
 * `funding_round` events with round type `grant`.
 */
const PHASE2_EVENT_COUNT = 36;

/** Grants in the seed: 6 from Phase 1 and 5 from Phase 2. */
export const SEEDED_GRANT_COUNT = 11;

/**
 * Rounds the funding table lists by default. Grants are hidden unless the
 * `grant` round type is chosen (D44, D45), so they are not counted here.
 */
export const SEEDED_LISTED_ROUND_COUNT =
  PHASE1_ROUND_COUNT + PHASE2_EVENT_COUNT - SEEDED_GRANT_COUNT;

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
  grantRounds: SEEDED_GRANT_COUNT,
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
  /** Defaults to `reported`. Grants are `confirmed` because they come from an official record. */
  evidence?: EvidenceLevel;
  /** Official records such as grants have no news articles. */
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

export interface SeedTheme {
  slug: string;
  name: string;
  nameSource: ThemeNameSource;
  sector: Sector;
  seedTagSlug: string;
  mergedIntoSlug: string | null;
  reviewed: boolean;
}

export interface SeedTagTheme {
  tagSlug: string;
  themeSlug: string;
  similarity: number | null;
  assignedBy: ThemeAssignedBy;
}

export interface SeedCompanyTheme {
  companySlug: string;
  themeSlug: string;
  tagCount: number;
}

export interface SeedThemeWeek {
  themeSlug: string;
  weekStart: string;
  rounds: number;
  roundsWithAmount: number;
  totalGbpMinor: number;
  earlyRounds: number;
  laterRounds: number;
  unknownStageRounds: number;
  grants: number;
  grantGbpMinor: number;
  acquisitions: number;
  launches: number;
  companies: number;
}

export interface SeedWeeklyTotal {
  weekStart: string;
  rounds: number;
  earlyRounds: number;
  grants: number;
  acquisitions: number;
  launches: number;
}

export interface SeedLocation {
  companySlug: string;
  countryCode: string;
  itl1Code: string | null;
  placeSlug: string | null;
  outcode: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: LocationPrecision;
  source: LocationSource;
}

// Phase 3 registry rows. Every number below is invented: the Companies House
// numbers and CIKs are in the real format but belong to nobody, and no row
// holds the name of a person.

export interface SeedChCompany {
  companyNumber: string;
  name: string;
  status: string;
  statusDetail: string | null;
  companyType: string;
  incorporatedOn: string;
  ceasedOn: string | null;
  sicCodes: string[];
  officePostcode: string | null;
  officeOutcode: string | null;
  officeLocality: string | null;
  accountsType: string | null;
  accountsMadeUpTo: string | null;
}

export interface SeedRegistryLink {
  companySlug: string;
  registry: RegistryKind;
  registryId: string;
  registryName: string;
  method: RegistryLinkMethod;
  reason: string;
}

export interface SeedChFiling {
  companyNumber: string;
  transactionId: string;
  type: string;
  category: string;
  filedOn: string;
  actionDate: string | null;
  capital: CapitalAmount[] | null;
}

export interface SeedFormDFiling {
  accessionNumber: string;
  cik: string;
  issuerName: string;
  entityType: string;
  jurisdiction: string;
  issuerState: string;
  issuerCity: string;
  industryGroup: string;
  dateOfFirstSale: string;
  totalOfferingUsdMinor: number;
  totalSoldUsdMinor: number;
  investorCount: number;
  filedOn: string;
  companySlug: string;
}

/** Points at the event and the filing by their natural keys, so the seed can resolve ids. */
export interface SeedConfirmation {
  /** Index into `SeedDataset.events`. */
  eventIndex: number;
  recordKind: RecordKind;
  /** A `SeedChFiling.transactionId` or a `SeedFormDFiling.accessionNumber`. */
  recordKey: string;
  rule: string;
  recordDate: string;
  confirmsAmount: boolean;
}

export interface SeedRegistry {
  chCompanies: SeedChCompany[];
  links: SeedRegistryLink[];
  chFilings: SeedChFiling[];
  formDFilings: SeedFormDFiling[];
  confirmations: SeedConfirmation[];
  /** The `sources` row the Form D filings belong to. */
  edgarSource: SeedSource;
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
  themes: SeedTheme[];
  tagThemes: SeedTagTheme[];
  companyThemes: SeedCompanyTheme[];
  themeWeeklyStats: SeedThemeWeek[];
  weeklyTotals: SeedWeeklyTotal[];
  locations: SeedLocation[];
  registry: SeedRegistry;
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
    ukCompanyNumber: "09000001",
  },
  {
    name: "Cotswold Carbon",
    country: "GB",
    city: "Bristol",
    tags: ["climate"],
    ukCompanyNumber: "09000002",
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

// Phase 2 seed: themes, trend history, acquisitions, grants and locations.
// Everything here is invented. Company, investor and theme names are fictional.

interface P2Company {
  name: string;
  country: string | null;
  city: string | null;
  foundedYear: number | null;
  tags: string[];
  status: CompanyStatus;
}

interface P2Theme {
  slug: string;
  name: string;
  nameSource: ThemeNameSource;
  sector: Sector;
  reviewed: boolean;
  /** Further tags that belong to the theme, besides its seed tag (the slug). */
  tags: string[];
}

const P2_THEMES: P2Theme[] = [
  {
    slug: "accounting-agents",
    name: "Agentic accounting",
    nameSource: "llm",
    sector: "financial-services",
    reviewed: false,
    tags: ["bookkeeping-automation", "ai-accountants"],
  },
  {
    slug: "climate-fintech",
    name: "Climate fintech",
    nameSource: "manual",
    sector: "financial-services",
    reviewed: true,
    tags: ["carbon-accounting", "green-lending"],
  },
  {
    slug: "grid-batteries",
    name: "Grid batteries",
    nameSource: "llm",
    sector: "climate-energy",
    reviewed: false,
    tags: ["energy-storage"],
  },
  {
    slug: "heat-pumps",
    name: "Heat pumps",
    nameSource: "tag",
    sector: "climate-energy",
    reviewed: false,
    tags: ["home-heating"],
  },
  {
    slug: "clinical-ai",
    name: "Clinical AI",
    nameSource: "llm",
    sector: "health-life-sciences",
    reviewed: true,
    tags: ["medical-imaging", "triage-software"],
  },
  {
    slug: "developer-agents",
    name: "Developer agents",
    nameSource: "llm",
    sector: "software-ai",
    reviewed: false,
    tags: ["code-review-ai"],
  },
];

/** A theme that was merged into `grid-batteries`; its slug redirects. */
const P2_MERGED_THEME = {
  slug: "home-batteries",
  name: "Home batteries",
  intoSlug: "grid-batteries",
} as const;

const P2_INVESTORS: Array<InvestorSpec & { key: string }> = [
  { key: "fenland", name: "Fenland Seed Partners", kind: "vc", country: "GB" },
  { key: "tidewater", name: "Tidewater Ventures", kind: "vc", country: "GB" },
  {
    key: "larkfield",
    name: "Larkfield Climate Fund",
    kind: "vc",
    country: "GB",
  },
  {
    key: "marlow",
    name: "Marlow Angel Network",
    kind: "angel_network",
    country: "GB",
  },
  { key: "quarry", name: "Quarry Hill Capital", kind: "vc", country: "GB" },
  { key: "corvid", name: "Corvid Health Ventures", kind: "vc", country: "DE" },
  {
    key: "council",
    name: "Example Research Council",
    kind: "government",
    country: "GB",
  },
];

function co(
  name: string,
  city: string | null,
  foundedYear: number | null,
  tags: string[],
  status: CompanyStatus = "active",
  country: string | null = "GB",
): P2Company {
  return { name, country, city, foundedYear, tags, status };
}

const P2_COMPANIES: Record<string, P2Company> = {
  a1: co("Ledgerwing", "Leeds", 2022, [
    "accounting-agents",
    "bookkeeping-automation",
  ]),
  a2: co("Tallyfox", "Manchester", 2023, [
    "accounting-agents",
    "ai-accountants",
  ]),
  a3: co("Reckonbird", "London", 2021, [
    "accounting-agents",
    "carbon-accounting",
  ]),
  a4: co("Abacus Moth", null, null, ["bookkeeping-automation"]),
  a5: co("Booksprite", null, 2023, ["ai-accountants", "accounting-agents"]),
  a6: co("Ratiofern", null, 2022, ["accounting-agents"]),
  t1: co("Ledgerlark", null, 2020, ["accounting-agents"], "acquired"),
  t7: co("Pennyscribe", null, null, ["bookkeeping-automation"], "acquired"),
  b1: co("Greenpenny", "Oxford", 2022, ["climate-fintech", "green-lending"]),
  b2: co("Carbonledger Labs", null, 2021, [
    "climate-fintech",
    "carbon-accounting",
  ]),
  b3: co("Tideoffset", null, 2019, ["green-lending"]),
  c1: co("Voltmoss", "Bristol", 2020, ["grid-batteries", "energy-storage"]),
  c2: co("Cellharbour", "Sheffield", 2021, ["grid-batteries"]),
  c3: co("Ampstone Storage", null, 2017, ["energy-storage", "home-batteries"]),
  c4: co("Gridfinch", null, 2022, ["grid-batteries"]),
  c5: co("Packrat Power", "Newcastle upon Tyne", 2020, ["energy-storage"]),
  c6: co("Wattle Storage", null, null, ["grid-batteries", "energy-storage"]),
  t2: co("Cellmesh Storage", null, 2018, ["grid-batteries"], "acquired"),
  t3: co("Voltpost", null, 2021, ["energy-storage"], "acquired"),
  t4: co("Gridwren", null, null, ["grid-batteries"], "acquired"),
  t5: co("Packwell Energy", null, 2016, ["energy-storage"], "acquired"),
  d1: co("Kilnheat", null, 2019, ["heat-pumps", "home-heating"]),
  d2: co("Warmthorn", "Berlin", 2020, ["heat-pumps"], "active", "DE"),
  e1: co("Clinicquill", "Cambridge", 2018, ["clinical-ai", "medical-imaging"]),
  e2: co("Scanbloom", "Edinburgh", 2020, ["medical-imaging"]),
  e3: co("Triagebay", null, 2021, ["triage-software"]),
  e4: co("Pathfern", null, 2016, ["clinical-ai"]),
  e5: co("Ward Lantern", null, 2023, ["triage-software", "clinical-ai"]),
  t6: co("Clinicbrook Systems", null, 2017, ["clinical-ai"], "acquired"),
  f1: co("Agentwell", null, 2023, ["developer-agents"]),
  f2: co(
    "Patchwren",
    "Austin",
    2022,
    ["developer-agents", "code-review-ai"],
    "active",
    "US",
  ),
  f3: co("Compilemoth", null, 2021, ["code-review-ai"]),
  f4: co("Reviewkite", null, null, ["developer-agents"]),
};

type P2Role = Extract<InvestorRole, "participant" | "unknown">;

/** One round: company, weeks before the last complete week, type, amount in £ thousands, lead, others. */
type P2Round = [
  company: string,
  weeksAgo: number,
  roundType: RoundType,
  thousands: number | null,
  lead: string | null,
  others?: Array<[investor: string, role: P2Role]>,
];

// 31 rounds over 30 weeks. Week 0 is the last complete week. Weeks 0 to 7 are
// the recent window and weeks 8 to 33 the baseline. Recent and baseline rounds:
// accounting-agents 5 and 2 (4 recent early rounds; 1 of 6 companies at Series A)
// climate-fintech 3 and 2 (one recent round is shared with accounting-agents)
// grid-batteries 7 and 3 (rising)
// heat-pumps 0 and 2 (two companies only, so left out of the trend views)
// clinical-ai 2 and 3 (late share 0.8)
// developer-agents 3 and 0
const P2_ROUNDS: P2Round[] = [
  ["a1", 14, "seed", 1000, "tidewater"],
  ["a1", 0, "series_a", 6000, "fenland"],
  ["a2", 2, "pre_seed", 1200, "fenland", [["tidewater", "participant"]]],
  ["a3", 3, "seed", 2000, "fenland", [["tidewater", "participant"]]],
  ["a4", 5, "seed", null, "fenland", [["marlow", "participant"]]],
  ["a5", 6, "pre_seed", 600, "tidewater", [["marlow", "unknown"]]],
  ["a6", 22, "seed", 1500, "marlow"],
  ["b1", 1, "seed", 1800, "larkfield"],
  ["b2", 4, "series_a", 6500, "quarry"],
  ["b3", 12, "series_a", 9000, "quarry"],
  ["b2", 15, "seed", 1400, "larkfield", [["tidewater", "participant"]]],
  ["c1", 0, "seed", 3500, "fenland"],
  ["c2", 1, "seed", 2200, "tidewater"],
  ["c3", 2, "series_a", 7000, "tidewater"],
  ["c4", 3, "seed", 2400, "tidewater", [["marlow", "participant"]]],
  ["c5", 4, "pre_seed", 900, "larkfield"],
  ["c6", 6, "seed", 1900, "tidewater"],
  ["c3", 7, "debt", 1500, null],
  ["c1", 12, "pre_seed", 800, "larkfield"],
  ["c2", 15, "pre_seed", 700, "larkfield"],
  ["c3", 19, "seed", 1600, "tidewater", [["larkfield", "participant"]]],
  ["d1", 11, "seed", 900, "marlow"],
  ["d2", 18, "seed", 800, "marlow"],
  ["e1", 2, "series_a", 8000, "quarry"],
  ["e2", 5, "series_b", 18000, "corvid"],
  ["e3", 13, "series_a", 9500, "corvid"],
  ["e4", 20, "growth", 40000, "corvid"],
  ["e5", 26, "seed", 1100, "corvid"],
  ["f1", 1, "seed", 1300, "quarry"],
  ["f2", 4, "seed", 1000, "marlow"],
  ["f3", 6, "series_a", 5000, "quarry"],
];

/** Five grants, confirmed by an official record. They never count as rounds. */
const P2_GRANTS: Array<[company: string, weeksAgo: number, thousands: number]> =
  [
    ["c2", 10, 250],
    ["c5", 3, 180],
    ["e1", 20, 400],
    ["e4", 6, 120],
    ["f4", 2, 90],
  ];

/** Acquisitions: target, weeks ago, acquirer (a company slug or a raw name), price in £ thousands. */
const P2_ACQUISITIONS: Array<
  [
    target: string,
    weeksAgo: number,
    acquirer: { slug: string | null; name: string },
    thousands: number | null,
  ]
> = [
  ["t1", 10, { slug: null, name: "Brightwater Group" }, 4_500],
  ["t2", 5, { slug: "thames-grid", name: "Thames Grid" }, 12_000],
  ["t3", 14, { slug: null, name: "Brightwater Group" }, null],
  ["t4", 20, { slug: "thames-grid", name: "Thames Grid" }, null],
  ["t5", 26, { slug: null, name: "Harrow Utilities Holdings" }, 8_000],
  ["t6", 9, { slug: null, name: "Brightwater Group" }, 20_000],
  ["t7", 29, { slug: null, name: "Brightwater Group" }, null],
];

type P2Location = Omit<SeedLocation, "companySlug">;

function town(
  placeSlug: string,
  itl1Code: string,
  latitude: number,
  longitude: number,
): P2Location {
  return {
    countryCode: "GB",
    itl1Code,
    placeSlug,
    outcode: null,
    latitude,
    longitude,
    precision: "town",
    source: "news_city",
  };
}

function outcode(
  code: string,
  itl1Code: string,
  latitude: number,
  longitude: number,
): P2Location {
  return {
    countryCode: "GB",
    itl1Code,
    placeSlug: null,
    outcode: code,
    latitude,
    longitude,
    precision: "outcode",
    source: "grant_postcode",
  };
}

/** Ten located companies: UK towns, two postcode districts, one region only, one non-UK city. */
const P2_LOCATIONS: Array<[company: string, location: P2Location]> = [
  ["a1", town("leeds", "TLE", 53.8016, -1.5472)],
  ["a2", town("manchester", "TLD", 53.4798, -2.2424)],
  ["b1", town("oxford", "TLJ", 51.7524, -1.2547)],
  ["c1", outcode("BS1", "TLK", 51.4537, -2.5912)],
  ["c2", town("sheffield", "TLE", 53.3833, -1.4655)],
  ["c5", outcode("NE1", "TLC", 54.9736, -1.6084)],
  ["e1", town("cambridge", "TLH", 52.2054, 0.123)],
  ["e2", town("edinburgh", "TLM", 55.9548, -3.1863)],
  [
    "f1",
    {
      countryCode: "GB",
      itl1Code: "TLF",
      placeSlug: null,
      outcode: null,
      latitude: null,
      longitude: null,
      precision: "region",
      source: "news_region",
    },
  ],
  [
    "d2",
    {
      countryCode: "DE",
      itl1Code: null,
      placeSlug: null,
      outcode: null,
      latitude: null,
      longitude: null,
      precision: "town",
      source: "news_city",
    },
  ],
];

const EARLY_TYPES: readonly RoundType[] = ["pre_seed", "seed"];
const LATER_TYPES: readonly RoundType[] = [
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "growth",
];

/** A weekday inside the week that is `weeksAgo` before the last complete week. */
function p2Date(now: Date, weeksAgo: number, index: number): string {
  const monday = addWeeks(lastCompleteWeek(now), -weeksAgo);
  const day = toUtcDay(monday);
  day.setUTCDate(day.getUTCDate() + (index % 5));
  return day.toISOString().slice(0, 10);
}

interface Phase2Seed {
  companies: SeedCompany[];
  investors: SeedInvestor[];
  tags: SeedTag[];
  companyTags: SeedCompanyTag[];
  events: SeedEvent[];
  themes: SeedTheme[];
  tagThemes: SeedTagTheme[];
  companyThemes: SeedCompanyTheme[];
  locations: SeedLocation[];
}

function buildPhase2(
  now: Date,
  article: (title: string, announcedOn: string) => SeedArticle,
): Phase2Seed {
  const slugOf = (key: string): string => {
    const company = P2_COMPANIES[key];
    if (!company) throw new Error(`Unknown Phase 2 company ${key}`);
    return slugify(company.name);
  };
  const investorSlugOf = (key: string): string => {
    const investor = P2_INVESTORS.find((spec) => spec.key === key);
    if (!investor) throw new Error(`Unknown Phase 2 investor ${key}`);
    return slugify(investor.name);
  };

  const companies: SeedCompany[] = Object.values(P2_COMPANIES).map((spec) => ({
    slug: slugify(spec.name),
    name: spec.name,
    countryCode: spec.country,
    city: spec.city,
    description: `${spec.name} is a fictional company in the local seed dataset.`,
    websiteDomain: `${slugify(spec.name)}.example`,
    foundedYear: spec.foundedYear,
    foundedYearSource: spec.foundedYear == null ? null : "news",
    status: spec.status,
    ukCompanyNumber: null,
    ycBatch: null,
    githubOrg: null,
    mergedIntoSlug: null,
    tags: spec.tags,
  }));

  const investors: SeedInvestor[] = P2_INVESTORS.map((spec) => ({
    slug: slugify(spec.name),
    name: spec.name,
    kind: spec.kind,
    countryCode: spec.country,
    websiteDomain: `${slugify(spec.name)}.example`,
    mergedIntoSlug: null,
  }));

  const events: SeedEvent[] = [];
  P2_ROUNDS.forEach(
    ([key, weeksAgo, roundType, thousands, lead, others], index) => {
      const announcedOn = p2Date(now, weeksAgo, index);
      const gbp = thousands == null ? null : thousands * 100_000;
      const roundInvestors: SeedFundingEvent["investors"] = [];
      if (lead) {
        roundInvestors.push({ slug: investorSlugOf(lead), role: "lead" });
      }
      for (const [investor, role] of others ?? []) {
        roundInvestors.push({ slug: investorSlugOf(investor), role });
      }
      const name = P2_COMPANIES[key]?.name ?? key;
      events.push({
        type: "funding_round",
        companySlug: slugOf(key),
        announcedOn,
        roundType,
        roundLabel: null,
        amountMinor: gbp,
        currency: gbp == null ? null : "GBP",
        amountGbpMinor: gbp,
        amountUsdMinor: gbp == null ? null : Math.round(gbp * 1.27),
        fxRateDate: gbp == null ? null : announcedOn,
        includesIndividualAngels: false,
        investors: roundInvestors,
        articles: [article(`${name} announces funding`, announcedOn)],
      });
    },
  );
  P2_GRANTS.forEach(([key, weeksAgo, thousands], index) => {
    const announcedOn = p2Date(now, weeksAgo, index + 2);
    const gbp = thousands * 100_000;
    events.push({
      type: "funding_round",
      companySlug: slugOf(key),
      announcedOn,
      evidence: "confirmed",
      roundType: "grant",
      roundLabel: "Collaborative R&D grant",
      amountMinor: gbp,
      currency: "GBP",
      amountGbpMinor: gbp,
      amountUsdMinor: Math.round(gbp * 1.27),
      fxRateDate: announcedOn,
      includesIndividualAngels: false,
      investors: [{ slug: investorSlugOf("council"), role: "lead" }],
      articles: [],
    });
  });
  P2_ACQUISITIONS.forEach(([key, weeksAgo, acquirer, thousands], index) => {
    const announcedOn = p2Date(now, weeksAgo, index + 1);
    const gbp = thousands == null ? null : thousands * 100_000;
    const name = P2_COMPANIES[key]?.name ?? key;
    events.push({
      type: "acquisition",
      companySlug: slugOf(key),
      announcedOn,
      acquirerSlug: acquirer.slug,
      acquirerName: acquirer.name,
      priceMinor: gbp,
      currency: gbp == null ? null : "GBP",
      priceGbpMinor: gbp,
      priceUsdMinor: gbp == null ? null : Math.round(gbp * 1.27),
      fxRateDate: gbp == null ? null : announcedOn,
      articles: [article(`${name} is acquired`, announcedOn)],
    });
  });
  const listed = events.filter((event) => event.type === "funding_round");
  if (listed.length !== PHASE2_EVENT_COUNT) {
    throw new Error(
      `Expected ${PHASE2_EVENT_COUNT} Phase 2 funding events, built ${listed.length}`,
    );
  }

  const themes: SeedTheme[] = P2_THEMES.map((theme) => ({
    slug: theme.slug,
    name: theme.name,
    nameSource: theme.nameSource,
    sector: theme.sector,
    seedTagSlug: theme.slug,
    mergedIntoSlug: null,
    reviewed: theme.reviewed,
  }));
  themes.push({
    slug: P2_MERGED_THEME.slug,
    name: P2_MERGED_THEME.name,
    nameSource: "tag",
    sector: "climate-energy",
    seedTagSlug: P2_MERGED_THEME.slug,
    mergedIntoSlug: P2_MERGED_THEME.intoSlug,
    reviewed: false,
  });

  const tagThemes: SeedTagTheme[] = [];
  const themeOfTag = new Map<string, string>();
  for (const theme of P2_THEMES) {
    for (const tagSlug of [theme.slug, ...theme.tags]) {
      themeOfTag.set(tagSlug, theme.slug);
      tagThemes.push({
        tagSlug,
        themeSlug: theme.slug,
        similarity: tagSlug === theme.slug ? 1 : 0.72,
        assignedBy: "auto",
      });
    }
  }
  // The merged theme's seed tag now points at the surviving theme.
  themeOfTag.set(P2_MERGED_THEME.slug, P2_MERGED_THEME.intoSlug);
  tagThemes.push({
    tagSlug: P2_MERGED_THEME.slug,
    themeSlug: P2_MERGED_THEME.intoSlug,
    similarity: 0.81,
    assignedBy: "auto",
  });

  const companyThemes: SeedCompanyTheme[] = [];
  for (const company of companies) {
    const counts = new Map<string, number>();
    for (const tagSlug of company.tags) {
      const themeSlug = themeOfTag.get(tagSlug);
      if (themeSlug) counts.set(themeSlug, (counts.get(themeSlug) ?? 0) + 1);
    }
    for (const [themeSlug, tagCount] of [...counts].sort()) {
      companyThemes.push({ companySlug: company.slug, themeSlug, tagCount });
    }
  }

  const tags: SeedTag[] = [...themeOfTag.keys()].sort().map((slug) => ({
    slug,
    label: tagLabel(slug.replace(/-/g, " ")),
  }));
  const companyTags: SeedCompanyTag[] = companies.flatMap((company) =>
    company.tags.map((tagSlug) => ({ companySlug: company.slug, tagSlug })),
  );

  const locations: SeedLocation[] = P2_LOCATIONS.map(([key, location]) => ({
    companySlug: slugOf(key),
    ...location,
  }));

  return {
    companies,
    investors,
    tags,
    companyTags,
    events,
    themes,
    tagThemes,
    companyThemes,
    locations,
  };
}

/**
 * Weekly counts worked out from the seeded events by the rules in
 * docs/spec-phase2.md section 8. Task 043 can later switch the seed to the
 * real stats rebuild. Until then the same rules are written out here, so the
 * seed does not import the pipeline.
 */
function deriveWeeklyStats(
  allEvents: readonly SeedEvent[],
  skipCompanies: ReadonlySet<string>,
  themesOfCompany: ReadonlyMap<string, readonly string[]>,
): { themeWeeks: SeedThemeWeek[]; totals: SeedWeeklyTotal[] } {
  const totals = new Map<string, SeedWeeklyTotal>();
  const themeWeeks = new Map<string, SeedThemeWeek & { seen: Set<string> }>();

  for (const event of allEvents) {
    if (skipCompanies.has(event.companySlug)) continue;
    const week = weekStart(event.announcedOn);
    const total = totals.get(week) ?? {
      weekStart: week,
      rounds: 0,
      earlyRounds: 0,
      grants: 0,
      acquisitions: 0,
      launches: 0,
    };
    totals.set(week, total);

    const rows = (themesOfCompany.get(event.companySlug) ?? []).map(
      (themeSlug) => {
        const key = `${themeSlug}|${week}`;
        const row = themeWeeks.get(key) ?? {
          themeSlug,
          weekStart: week,
          rounds: 0,
          roundsWithAmount: 0,
          totalGbpMinor: 0,
          earlyRounds: 0,
          laterRounds: 0,
          unknownStageRounds: 0,
          grants: 0,
          grantGbpMinor: 0,
          acquisitions: 0,
          launches: 0,
          companies: 0,
          seen: new Set<string>(),
        };
        themeWeeks.set(key, row);
        if (!row.seen.has(event.companySlug)) {
          row.seen.add(event.companySlug);
          row.companies += 1;
        }
        return row;
      },
    );

    if (event.type === "acquisition") {
      total.acquisitions += 1;
      for (const row of rows) row.acquisitions += 1;
    } else if (event.type === "launch") {
      total.launches += 1;
      for (const row of rows) row.launches += 1;
    } else if (event.roundType === "grant") {
      total.grants += 1;
      for (const row of rows) {
        row.grants += 1;
        row.grantGbpMinor += event.amountGbpMinor ?? 0;
      }
    } else {
      total.rounds += 1;
      const early = EARLY_TYPES.includes(event.roundType);
      if (early) total.earlyRounds += 1;
      for (const row of rows) {
        row.rounds += 1;
        if (event.amountGbpMinor != null) {
          row.roundsWithAmount += 1;
          row.totalGbpMinor += event.amountGbpMinor;
        }
        if (early) row.earlyRounds += 1;
        else if (LATER_TYPES.includes(event.roundType)) row.laterRounds += 1;
        else if (event.roundType === "unknown") row.unknownStageRounds += 1;
      }
    }
  }

  return {
    themeWeeks: [...themeWeeks.values()]
      .map((entry) => {
        const { seen, ...row } = entry;
        seen.clear();
        return row;
      })
      .sort(
        (a, b) =>
          a.weekStart.localeCompare(b.weekStart) ||
          a.themeSlug.localeCompare(b.themeSlug),
      ),
    totals: [...totals.values()].sort((a, b) =>
      a.weekStart.localeCompare(b.weekStart),
    ),
  };
}

function isoDaysBefore(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - days),
  );
  return date.toISOString().slice(0, 10);
}

/**
 * Registry rows for three states the pages show: a linked UK company with an
 * SH01 confirmation, a dormant UK company, and a US company with a Form D
 * confirmation. The two confirmed events are marked `confirmed` here, as the
 * confirm step would. Returns the events with that change.
 */
function buildRegistry(events: SeedEvent[]): {
  registry: SeedRegistry;
  events: SeedEvent[];
} {
  const firstEquity = (companyName: string): number => {
    const slug = slugify(companyName);
    return events.findIndex(
      (event) =>
        event.companySlug === slug &&
        event.type === "funding_round" &&
        event.roundType !== "grant" &&
        event.roundType !== "debt",
    );
  };
  const ukIndex = firstEquity("Harbour Ledger");
  // The first US seed company that has an equity round.
  const usName =
    ["Hudson Yarn", "Cascadia Drift", "Mesa Foundry"].find(
      (name) => firstEquity(name) >= 0,
    ) ?? "";
  const usIndex = firstEquity(usName);
  if (ukIndex < 0 || usIndex < 0) throw new Error("No equity round to confirm");
  const ukEvent = events[ukIndex];
  const usEvent = events[usIndex];
  if (!ukEvent || !usEvent) throw new Error("Missing registry seed events");

  const allotted = isoDaysBefore(ukEvent.announcedOn, 36);
  const firstSale = isoDaysBefore(usEvent.announcedOn, 40);

  const registry: SeedRegistry = {
    chCompanies: [
      {
        companyNumber: "09000001",
        name: "HARBOUR LEDGER LIMITED",
        status: "active",
        statusDetail: null,
        companyType: "ltd",
        incorporatedOn: "2021-03-15",
        ceasedOn: null,
        sicCodes: ["62012", "64999"],
        officePostcode: "M1 0AA",
        officeOutcode: "M1",
        officeLocality: "Manchester",
        accountsType: "micro-entity",
        accountsMadeUpTo: "2025-03-31",
      },
      {
        companyNumber: "09000002",
        name: "COTSWOLD CARBON LIMITED",
        status: "active",
        statusDetail: null,
        companyType: "ltd",
        incorporatedOn: "2019-07-01",
        ceasedOn: null,
        sicCodes: ["99999"],
        officePostcode: "BS1 0AA",
        officeOutcode: "BS1",
        officeLocality: "Bristol",
        accountsType: "dormant",
        accountsMadeUpTo: "2025-07-31",
      },
    ],
    links: [
      {
        companySlug: slugify("Harbour Ledger"),
        registry: "companies_house",
        registryId: "09000001",
        registryName: "HARBOUR LEDGER LIMITED",
        method: "name_location",
        reason: "Seed data: exact name and a matching town",
      },
      {
        companySlug: slugify("Cotswold Carbon"),
        registry: "companies_house",
        registryId: "09000002",
        registryName: "COTSWOLD CARBON LIMITED",
        method: "name_location",
        reason: "Seed data: exact name and a matching town",
      },
      {
        companySlug: slugify(usName),
        registry: "sec_edgar",
        registryId: "9000001",
        registryName: `${usName} Inc.`,
        method: "form_d_round",
        reason: "Seed data: exact name and a Form D close to the round",
      },
    ],
    chFilings: [
      {
        companyNumber: "09000001",
        transactionId: "SEED-SH01-0001",
        type: "SH01",
        category: "capital",
        filedOn: isoDaysBefore(ukEvent.announcedOn, 30),
        actionDate: allotted,
        capital: [{ currency: "GBP", figure: "1,250.00" }],
      },
    ],
    formDFilings: [
      {
        accessionNumber: "0009000001-26-000001",
        cik: "9000001",
        issuerName: `${usName} Inc.`,
        entityType: "Corporation",
        jurisdiction: "DE",
        issuerState: "NY",
        issuerCity: "New York",
        industryGroup: "Other",
        dateOfFirstSale: firstSale,
        totalOfferingUsdMinor: 500_000_000,
        totalSoldUsdMinor: 440_000_000,
        investorCount: 7,
        filedOn: isoDaysBefore(usEvent.announcedOn, 25),
        companySlug: slugify(usName),
      },
    ],
    confirmations: [
      {
        eventIndex: ukIndex,
        recordKind: "ch_allotment",
        recordKey: "SEED-SH01-0001",
        rule: "ch_allotment_window",
        recordDate: allotted,
        confirmsAmount: false,
      },
      {
        eventIndex: usIndex,
        recordKind: "sec_form_d",
        recordKey: "0009000001-26-000001",
        rule: "form_d_window",
        recordDate: firstSale,
        confirmsAmount: false,
      },
    ],
    edgarSource: {
      slug: "sec-edgar",
      name: "SEC EDGAR",
      kind: "sec_edgar",
      url: "https://www.sec.gov/edgar",
      priority: 5,
    },
  };

  const confirmed = events.map((event, index) =>
    index === ukIndex || index === usIndex
      ? { ...event, evidence: "confirmed" as const }
      : event,
  );
  return { registry, events: confirmed };
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
  for (let index = 0; index < PHASE1_ROUND_COUNT; index += 1) {
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
  if (liveFunding.length !== PHASE1_ROUND_COUNT) {
    throw new Error(
      `Expected ${PHASE1_ROUND_COUNT} live funding rounds, built ${liveFunding.length}`,
    );
  }
  const grantCount = liveFunding.filter(
    (event) => event.roundType === "grant",
  ).length;
  if (grantCount + 5 !== SEEDED_GRANT_COUNT) {
    throw new Error(`Expected Phase 1 grants to total 6, built ${grantCount}`);
  }
  if (acquisitions.length !== 5 || launches.length !== 5) {
    throw new Error("Expected 5 acquisitions and 5 launches");
  }

  const phase2 = buildPhase2(now, article);
  assertUnique("company", [
    ...companies.map((company) => company.slug),
    ...phase2.companies.map((company) => company.slug),
  ]);
  assertUnique("investor", [
    ...investors.map((investor) => investor.slug),
    ...phase2.investors.map((investor) => investor.slug),
  ]);
  const allCompanies = [...companies, ...phase2.companies];
  const unconfirmedEvents = [
    ...funding,
    ...acquisitions,
    ...launches,
    ...phase2.events,
  ];
  const { registry, events: allEvents } = buildRegistry(unconfirmedEvents);
  const themesOfCompany = new Map<string, string[]>();
  for (const link of phase2.companyThemes) {
    const list = themesOfCompany.get(link.companySlug) ?? [];
    list.push(link.themeSlug);
    themesOfCompany.set(link.companySlug, list);
  }
  const stats = deriveWeeklyStats(
    allEvents,
    new Set([SEED_REFERENCE.mergedCompanySlug]),
    themesOfCompany,
  );

  return {
    companies: allCompanies,
    aliases: [
      {
        companySlug: SEED_REFERENCE.liveCompanySlug,
        alias: "Northwind Bots",
        source: "manual",
      },
    ],
    tags: [...tags, ...phase2.tags],
    companyTags: [...companyTags, ...phase2.companyTags],
    investors: [...investors, ...phase2.investors],
    events: allEvents,
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
    themes: phase2.themes,
    tagThemes: phase2.tagThemes,
    companyThemes: phase2.companyThemes,
    themeWeeklyStats: stats.themeWeeks,
    weeklyTotals: stats.totals,
    locations: phase2.locations,
    registry,
  };
}
