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
  RoundType,
  SourceItemStatus,
} from "./enums";

// Read models are plain JSON-serialisable data so they survive the page cache:
// timestamps are ISO 8601 UTC strings and calendar dates are YYYY-MM-DD strings.

export const FUNDING_SORTS = ["announced", "amount", "relevance"] as const;
export type FundingSort = (typeof FUNDING_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface FundingFilters {
  /** Company name search. */
  q?: string;
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
  /** When unset: `relevance` if `q` is present, otherwise `announced`. */
  sort?: FundingSort;
  direction?: SortDirection;
  /** 1-based. */
  page: number;
  pageSize: number;
}

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
}
