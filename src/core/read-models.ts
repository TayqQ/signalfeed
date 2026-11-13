import type { SizeBand } from "@/lib/size-bands";
import type { IngestStats, Money } from "./domain";
import type {
  CompanyStatus,
  DatePrecision,
  EventType,
  EvidenceLevel,
  FoundedYearSource,
  IngestStatus,
  IngestTrigger,
  InvestorKind,
  InvestorRole,
  LaunchKind,
  LocationPrecision,
  RecordKind,
  RegistryKind,
  RegistryLinkMethod,
  RegistryLinkStatus,
  RoundType,
  SourceItemStatus,
} from "./enums";
import type { CompanySizeBand } from "./registry";
import type { Sector } from "./sectors";

// Read models are plain JSON-serialisable data so they survive the page cache:
// timestamps are ISO 8601 UTC strings and calendar dates are YYYY-MM-DD strings.

export const FUNDING_SORTS = ["announced", "amount", "relevance"] as const;
export type FundingSort = (typeof FUNDING_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Radii, in km, allowed for the `near` filter. */
export const NEAR_RADII_KM = [10, 25, 50, 100] as const;
export type NearRadiusKm = (typeof NEAR_RADII_KM)[number];
export const DEFAULT_NEAR_KM: NearRadiusKm = 25;

/**
 * `first`: the round is the company's first recorded equity round.
 * `repeat`: the company had an earlier recorded equity round within 24 months.
 */
export const MOMENTUM_FILTERS = ["first", "repeat"] as const;
export type MomentumFilter = (typeof MOMENTUM_FILTERS)[number];

/** What to match (docs/spec-phase2.md section 9.3). Phase 4 saves this. */
export interface FundingCriteria {
  /** Company name search. */
  q?: string;
  /** When unset, every round type except `grant` (D44). */
  roundTypes?: RoundType[];
  /** Region slugs as defined in `src/lib/regions.ts`. */
  regions?: string[];
  /** ISO 3166-1 alpha-2 codes. */
  countryCodes?: string[];
  /** Tag slug. */
  tag?: string;
  investorSlug?: string;
  /** Inclusive, YYYY-MM-DD. */
  from?: string;
  /** Inclusive, YYYY-MM-DD. */
  to?: string;
  minGbpMinor?: number;
  maxGbpMinor?: number;
  /** Deal size bands from `src/lib/size-bands.ts`; a round matches any of them. */
  sizeBands?: SizeBand[];
  /** Theme slugs. Merged slugs follow `merged_into_id`. */
  themes?: string[];
  /** The company is in any theme with any of these sectors. */
  sectors?: Sector[];
  /** ITL1 region slugs. */
  ukRegions?: string[];
  /** UK place slugs, or other city names matched against `companies.city`. */
  cities?: string[];
  /** Located companies within `km` of a UK place. */
  near?: { placeSlug: string; km: NearRadiusKm };
  momentum?: MomentumFilter;
  /** Phase 3 (D60): only events confirmed by an official record. */
  evidence?: "confirmed";
  /**
   * Phase 3 (D60): the company's size band from its last accounts; a round
   * matches any of them. Companies with no Companies House link never match.
   */
  companySizes?: CompanySizeBand[];
}

/** How to show the matches. Not part of a saved search. */
export interface FundingView {
  /** When unset: `relevance` if `q` is present, otherwise `announced`. */
  sort?: FundingSort;
  direction?: SortDirection;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export type FundingFilters = FundingCriteria & FundingView;

export interface CompanyRef {
  slug: string;
  name: string;
}

export interface InvestorRef {
  slug: string;
  name: string;
}

export interface TagRef {
  slug: string;
  label: string;
}

/** Momentum of one equity round (spec section 8.3, D43). */
export interface RoundMomentum {
  /** 1 means the first round SignalFeed has recorded, not the company's first ever. */
  equityRoundNumber: number;
  /** Null for the first recorded round, or when either date has year precision. */
  monthsSincePrevious: number | null;
  /** This round's GBP amount over the basis round's. Null when not known. */
  stepUpRatio: number | null;
  /** YYYY-MM-DD of the basis round for `stepUpRatio`, or null. */
  stepUpBasisOn: string | null;
}

/** An official record that confirms an event (spec-phase3 section 9). */
export interface EventConfirmation {
  kind: RecordKind;
  /** YYYY-MM-DD: the allotment date, the Form D first sale, or the grant start. */
  recordDate: string;
  /** True only when the record's amount agrees with the reported one. */
  confirmsAmount: boolean;
  /** The marker wording, such as "Confirmed: shares allotted on 2 February 2026 (Companies House SH01)". */
  text: string;
}

export interface FundingRow {
  eventId: number;
  companySlug: string;
  companyName: string;
  countryCode: string | null;
  city: string | null;
  roundType: RoundType;
  roundLabel: string | null;
  /** Original amount and currency as reported. */
  amount: Money | null;
  amountGbpMinor: number | null;
  amountUsdMinor: number | null;
  announcedOn: string;
  leadInvestors: InvestorRef[];
  investorCount: number;
  sourceCount: number;
  tags: TagRef[];
  /** Equity rounds only; null for debt and grant rounds. */
  momentum?: RoundMomentum | null;
  /** `confirmed` for grants and for news rounds confirmed by a filing. */
  evidence?: EvidenceLevel;
  /** The closest confirming record. Null or unset when not confirmed. */
  confirmation?: EventConfirmation | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface EventSourceLink {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
}

interface CompanyEventBase {
  id: number;
  announcedOn: string;
  datePrecision: DatePrecision;
  evidence: EvidenceLevel;
  sourceCount: number;
  sources: EventSourceLink[];
  /** Closest record first. Empty or unset when not confirmed. */
  confirmations?: EventConfirmation[];
}

export interface EventInvestor extends InvestorRef {
  role: InvestorRole;
}

export interface FundingRoundEvent extends CompanyEventBase {
  type: "funding_round";
  roundType: RoundType;
  roundLabel: string | null;
  amount: Money | null;
  amountUsdMinor: number | null;
  amountGbpMinor: number | null;
  fxRateDate: string | null;
  includesIndividualAngels: boolean;
  investors: EventInvestor[];
  /** Equity rounds only; null for debt and grant rounds. */
  momentum?: RoundMomentum | null;
}

export interface AcquisitionEvent extends CompanyEventBase {
  type: "acquisition";
  /** Set when the acquirer resolved to a company record. */
  acquirer: CompanyRef | null;
  acquirerName: string;
  price: Money | null;
  priceUsdMinor: number | null;
  priceGbpMinor: number | null;
  fxRateDate: string | null;
}

export interface LaunchEvent extends CompanyEventBase {
  type: "launch";
  kind: LaunchKind;
  productName: string | null;
  url: string | null;
  externalRef: string | null;
}

export type CompanyEvent = FundingRoundEvent | AcquisitionEvent | LaunchEvent;

/** Where a company is, from `company_locations` (spec section 9.1). */
export interface CompanyLocationView {
  precision: LocationPrecision;
  /** ITL1 region slug, null outside the UK. */
  ukRegion: string | null;
  /** Town or city name, null when only the region is known. */
  placeName: string | null;
  /** Postcode district, such as "LS1", from a grant record. */
  outcode: string | null;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
}

/** A SIC code with its description; `label` is null for an unknown code. */
export interface SicCodeView {
  code: string;
  label: string | null;
}

/**
 * The company's Companies House record (spec-phase3 section 11). Never holds
 * the full registered office postcode.
 */
export interface CompaniesHouseView {
  companyNumber: string;
  url: string;
  /** The name Companies House gives. */
  name: string;
  /** Companies House's own wording, such as "Active" or "In Administration". */
  statusLabel: string;
  /** Such as "Private limited company". */
  typeLabel: string;
  /** YYYY-MM-DD. Shown as the incorporation date, beside any news founded year (D61). */
  incorporatedOn: string;
  ceasedOn: string | null;
  sicCodes: SicCodeView[];
  sizeBand: CompanySizeBand;
  /** YYYY-MM-DD of the last accounts, or null when none are filed. */
  accountsMadeUpTo: string | null;
  /** Postcode district, such as "LS1". */
  officeOutcode: string | null;
}

export interface SecFilerView {
  cik: string;
  url: string;
}

/** Linked registry records only. Candidates and rejected links are never shown. */
export interface CompanyRegistryView {
  companiesHouse: CompaniesHouseView | null;
  sec: SecFilerView | null;
}

export interface CompanyDetail {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  websiteDomain: string | null;
  countryCode: string | null;
  city: string | null;
  foundedYear: number | null;
  foundedYearSource: FoundedYearSource | null;
  status: CompanyStatus;
  ukCompanyNumber: string | null;
  secCik: string | null;
  ycBatch: string | null;
  githubOrg: string | null;
  firstSeenAt: string;
  updatedAt: string;
  tags: TagRef[];
  /** Slug of the surviving company when this one was merged; the page redirects. */
  redirectToSlug: string | null;
  /** Newest first. */
  events: CompanyEvent[];
  themes?: ThemeRef[];
  /** The sectors of the company's themes, without repeats. */
  sectors?: Sector[];
  /** Null when only the country is known. */
  location?: CompanyLocationView | null;
  /** Equity rounds in the 24 months to today, counted at read time. */
  roundsInLast24Months?: number;
  /** Null when the company has no linked registry record. */
  registry?: CompanyRegistryView | null;
}

export interface InvestorRoundRow extends FundingRow {
  role: InvestorRole;
}

export interface InvestorDetail {
  id: number;
  slug: string;
  name: string;
  kind: InvestorKind;
  countryCode: string | null;
  websiteDomain: string | null;
  firstSeenAt: string;
  /** Slug of the surviving investor when this one was merged; the page redirects. */
  redirectToSlug: string | null;
  rounds: InvestorRoundRow[];
  /** Every round type is present; zero when the investor has none. */
  roundTypeCounts: Record<RoundType, number>;
}

export interface IngestRunSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: IngestTrigger;
  status: IngestStatus;
  stats: IngestStats | null;
  error: string | null;
}

export interface StatusSummary {
  /** Newest first. */
  recentRuns: IngestRunSummary[];
  /** Every status is present; zero when there are none. */
  itemCountsByStatus: Record<SourceItemStatus, number>;
  /** Every type is present; zero when there are none. */
  eventCountsByType: Record<EventType, number>;
  monthToDateUsdMicros: number;
  /** From the latest run's stats; null before the first run. */
  capGbp: number | null;
  /** Latest stored rate. Null falls back to 1.0, as the budget guard does. */
  usdPerGbp: number | null;
  registry?: RegistryStatus;
  formD?: FormDStatus;
  confirmations?: ConfirmationStatus;
}

// Phase 3 status counts (spec-phase3 section 11).

export interface RegistryLinkCounts {
  /** Every status is present; zero when there are none. `candidate` is the open review queue. */
  byStatus: Record<RegistryLinkStatus, number>;
  /** `linked` rows only. Every method is present; zero when there are none. */
  linkedByMethod: Record<RegistryLinkMethod, number>;
}

export interface RegistryStatus {
  /** Every registry is present. */
  links: Record<RegistryKind, RegistryLinkCounts>;
  /** Companies whose latest Companies House search found nothing. */
  searchedNoMatch: number;
  /** Linked profiles not fetched for more than 90 days. */
  profilesOlderThan90Days: number;
  /** From the latest run with registry stats; null before the first. */
  lastRun: {
    requests: number;
    profilesRefreshed: number;
    stoppedAtLimit: boolean;
    rateLimited: boolean;
    /** True when the run had no Companies House key. */
    skipped: boolean;
  } | null;
}

export interface FormDStatus {
  /** YYYY-MM-DD of the latest index day marked `done`; null before the first. */
  lastDoneDay: string | null;
  filingsStored: number;
  fundsSkipped: number;
  /** Stored filings linked to a company. */
  filingsLinked: number;
}

export interface ConfirmationStatus {
  /** Rows of `event_confirmations`. Every kind is present. */
  byRecordKind: Record<RecordKind, number>;
  /** News events (no record source) with `evidence = confirmed`. */
  newsEventsConfirmed: number;
}

// Themes and trends (docs/spec-phase2.md sections 7, 8 and 12).

export interface ThemeRef {
  slug: string;
  name: string;
  sector: Sector | null;
}

export interface ThemeSummary extends ThemeRef {
  /** False while the name is the seed tag's label or an LLM suggestion. */
  nameIsReviewed: boolean;
  companyCount: number;
  tagCount: number;
}

/** One ISO week (Monday, UTC) of a theme's funding rounds, grants excluded. */
export interface WeeklyPoint {
  /** YYYY-MM-DD, a Monday. */
  weekStart: string;
  rounds: number;
  /** `pre_seed` and `seed`. */
  earlyRounds: number;
  /** `series_a` to `series_d_plus`, and `growth`. */
  laterRounds: number;
  unknownStageRounds: number;
  /** Sum of rounds with a known GBP amount. */
  totalGbpMinor: number;
}

export interface RisingThemeRow {
  theme: ThemeRef;
  /** Rounds in the 8 recent weeks. */
  recentRounds: number;
  /** Rounds in the baseline weeks before them. */
  baselineRounds: number;
  /** Rounds expected in the recent weeks from the theme's baseline share. */
  expected: number;
  /** ln((r + 3) / (e + 3)). Null when there is not enough history. */
  score: number | null;
  recentGbpMinor: number;
  /** Rounds per week, oldest first, 26 weeks. */
  sparkline: number[];
}

export interface EarlyMomentumRow {
  theme: ThemeRef;
  recentEarlyRounds: number;
  score: number;
  /** Share of companies with a known round type that reached Series A or later. Null below 5 companies. */
  lateShare: number | null;
}

export interface ThemeDetail {
  summary: ThemeSummary;
  /** Top tags by mentions. */
  tags: TagRef[];
  /** 52 weeks, oldest first, with empty weeks filled with zeros. */
  weekly: WeeklyPoint[];
  /** Funding rounds by type over all recorded history. Every type is present. */
  stageMix: Record<RoundType, number>;
  /** Slug of the surviving theme when this one was merged; the page redirects. */
  redirectToSlug: string | null;
}

// Acquisitions and investors (spec sections 8.4 and 8.5).

export interface AcquisitionRow {
  eventId: number;
  target: CompanyRef;
  /** Set when the acquirer resolved to a company record. */
  acquirer: CompanyRef | null;
  acquirerName: string;
  price: Money | null;
  priceGbpMinor: number | null;
  announcedOn: string;
  datePrecision: DatePrecision;
  /** Announcement year minus founded year. Null when the founded year is unknown. */
  targetAgeYears: number | null;
  /** The target company's themes. */
  themes: ThemeRef[];
}

export interface AcquirerCount {
  /** Set when the acquirer resolved to a company record. */
  acquirer: CompanyRef | null;
  acquirerName: string;
  acquisitions: number;
}

/** Acquisitions of companies in one theme. */
export interface AcquirerSummary {
  theme: ThemeRef;
  acquisitions: number;
  /** Most acquisitions first. */
  topAcquirers: AcquirerCount[];
  /** Null unless at least 3 target ages are known. */
  medianTargetAgeYears: number | null;
  /** How many of `acquisitions` have a known target age. */
  targetAgesKnown: number;
}

/** One investor's early rounds in a window (spec section 8.5). */
export interface InvestorActivityRow {
  investor: InvestorRef;
  /** Rounds as `lead`. */
  led: number;
  /** Rounds as `participant` or `unknown`. */
  joined: number;
  /** Median over rounds with a known GBP amount. Null when none has one. */
  medianRoundGbpMinor: number | null;
  roundsWithAmount: number;
  rounds: number;
}
