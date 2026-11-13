// Enums from spec section 5. Task 004 builds the Postgres enums from these arrays,
// so values must only ever be appended, never renamed or removed.

export const SOURCE_KINDS = [
  "rss",
  "hn_algolia",
  "yc_directory",
  "github",
  "companies_house",
  "sec_edgar",
  // Phase 2
  "ukri_gtr",
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
  // Phase 3
  "sec_form_d",
] as const;
export type FoundedYearSource = (typeof FOUNDED_YEAR_SOURCES)[number];

export const LLM_PURPOSES = [
  "extraction",
  "embedding",
  "eval",
  // Phase 2
  "theme_naming",
  "tagging",
  // Phase 3 (used only by the cuttable SH01 reader, Task 067)
  "document_reading",
] as const;
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

export const ALIAS_SOURCES = [
  "extraction",
  "manual",
  "merge",
  // Phase 2
  "grant",
  // Phase 3
  "registry",
] as const;
export type AliasSource = (typeof ALIAS_SOURCES)[number];

// Phase 2 enums (docs/spec-phase2.md section 5.1). Append only, as above.

export const THEME_STATUSES = ["active", "merged"] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];

/** `manual` names are never overwritten by the naming step. */
export const THEME_NAME_SOURCES = ["tag", "llm", "manual"] as const;
export type ThemeNameSource = (typeof THEME_NAME_SOURCES)[number];

/** `manual` links are never changed by automatic assignment. */
export const THEME_ASSIGNED_BY = ["auto", "manual"] as const;
export type ThemeAssignedBy = (typeof THEME_ASSIGNED_BY)[number];

export const LOCATION_PRECISIONS = ["outcode", "town", "region"] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export const LOCATION_SOURCES = [
  "grant_postcode",
  "news_city",
  "news_region",
  // Phase 3
  "registered_office",
] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const GRANT_ROLES = ["lead", "participant"] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

/** Official records an event can be linked to through `event_record_sources`. */
export const RECORD_KINDS = [
  "ukri_grant",
  // Phase 3
  "ch_allotment",
  "sec_form_d",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

// Phase 3 enums (docs/spec-phase3.md section 5.1). Append only, as above.

export const REGISTRY_KINDS = ["companies_house", "sec_edgar"] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

/** `candidate` rows wait for review and are never shown on pages. */
export const REGISTRY_LINK_STATUSES = [
  "linked",
  "candidate",
  "rejected",
] as const;
export type RegistryLinkStatus = (typeof REGISTRY_LINK_STATUSES)[number];

/** Which rule made a link (spec-phase3 section 7.2 and 8.3). */
export const REGISTRY_LINK_METHODS = [
  "grant_number",
  "name_grant_postcode",
  "name_filing",
  "name_location",
  "prefix_filing_location",
  "form_d_round",
  "manual",
] as const;
export type RegistryLinkMethod = (typeof REGISTRY_LINK_METHODS)[number];

/** `manual` decisions are final: automatic linking never changes them. */
export const LINK_DECIDED_BY = ["auto", "manual"] as const;
export type LinkDecidedBy = (typeof LINK_DECIDED_BY)[number];

export const REGISTRY_SEARCH_OUTCOMES = [
  "linked",
  "candidates",
  "none",
  "skipped",
] as const;
export type RegistrySearchOutcome = (typeof REGISTRY_SEARCH_OUTCOMES)[number];

/** Where a row of `company_sectors` came from. */
export const SECTOR_SOURCES = ["theme", "sic"] as const;
export type SectorSource = (typeof SECTOR_SOURCES)[number];
