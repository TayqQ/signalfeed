// Enums from spec section 5. Task 004 builds the Postgres enums from these arrays,
// so values must only ever be appended, never renamed or removed.

export const SOURCE_KINDS = [
  "rss",
  "hn_algolia",
  "yc_directory",
  "github",
  "companies_house",
  "sec_edgar",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_ITEM_STATUSES = [
  "pending",
  "filtered_out",
  "extracted",
  "failed",
] as const;
export type SourceItemStatus = (typeof SOURCE_ITEM_STATUSES)[number];

export const EVENT_TYPES = ["funding_round", "acquisition", "launch"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ROUND_TYPES = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "growth",
  "debt",
  "grant",
  "unknown",
] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

export const INVESTOR_KINDS = [
  "vc",
  "corporate",
  "accelerator",
  "angel_network",
  "government",
  "private_equity",
  "family_office",
  "other",
  "unknown",
] as const;
export type InvestorKind = (typeof INVESTOR_KINDS)[number];

export const INVESTOR_ROLES = ["lead", "participant", "unknown"] as const;
export type InvestorRole = (typeof INVESTOR_ROLES)[number];

export const LAUNCH_KINDS = [
  "product",
  "show_hn",
  "launch_hn",
  "open_source",
  "other",
] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

/** `reported` comes from news; `confirmed` from an official filing (Phase 3). */
export const EVIDENCE_LEVELS = ["reported", "confirmed"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const DATE_PRECISIONS = ["day", "month", "year"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const COMPANY_STATUSES = [
  "active",
  "acquired",
  "closed",
  "unknown",
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const FOUNDED_YEAR_SOURCES = [
  "news",
  "companies_house",
  "yc",
  "manual",
] as const;
export type FoundedYearSource = (typeof FOUNDED_YEAR_SOURCES)[number];

export const LLM_PURPOSES = ["extraction", "embedding", "eval"] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export const INGEST_TRIGGERS = ["schedule", "manual"] as const;
export type IngestTrigger = (typeof INGEST_TRIGGERS)[number];

export const INGEST_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "budget_paused",
] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

export const MERGE_ENTITIES = ["company", "investor"] as const;
export type MergeEntity = (typeof MERGE_ENTITIES)[number];

export const MERGE_CANDIDATE_STATUSES = [
  "open",
  "merged",
  "dismissed",
] as const;
export type MergeCandidateStatus = (typeof MERGE_CANDIDATE_STATUSES)[number];

export const ALIAS_SOURCES = ["extraction", "manual", "merge"] as const;
export type AliasSource = (typeof ALIAS_SOURCES)[number];
