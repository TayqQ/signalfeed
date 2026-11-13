import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { IngestStats } from "@/core/domain";
import {
  ALIAS_SOURCES,
  COMPANY_STATUSES,
  DATE_PRECISIONS,
  EVENT_TYPES,
  EVIDENCE_LEVELS,
  FOUNDED_YEAR_SOURCES,
  GRANT_ROLES,
  INGEST_STATUSES,
  INGEST_TRIGGERS,
  INVESTOR_KINDS,
  INVESTOR_ROLES,
  LAUNCH_KINDS,
  LINK_DECIDED_BY,
  LLM_PURPOSES,
  LOCATION_PRECISIONS,
  LOCATION_SOURCES,
  MERGE_CANDIDATE_STATUSES,
  MERGE_ENTITIES,
  RECORD_KINDS,
  REGISTRY_KINDS,
  REGISTRY_LINK_METHODS,
  REGISTRY_LINK_STATUSES,
  REGISTRY_SEARCH_OUTCOMES,
  ROUND_TYPES,
  SECTOR_SOURCES,
  SOURCE_ITEM_STATUSES,
  SOURCE_KINDS,
  THEME_ASSIGNED_BY,
  THEME_NAME_SOURCES,
  THEME_STATUSES,
} from "@/core/enums";
import type { ExtractionV1, ExtractionV2 } from "@/core/extraction-schema";
import type { CapitalAmount } from "@/core/registry";

export const EMBEDDING_DIMENSIONS = 512;

// Column helpers keep the spec's storage rules in one place: identity integer
// ids, UTC timestamps, integer minor-unit money and YYYY-MM-DD dates.
const id = () => integer("id").primaryKey().generatedAlwaysAsIdentity();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdNow = (name: string) => timestamptz(name).notNull().defaultNow();
const moneyMinor = (name: string) => bigint(name, { mode: "number" });
const currencyCode = (name: string) => char(name, { length: 3 });
const countryCode = (name: string) => char(name, { length: 2 });
const isoDate = (name: string) => date(name, { mode: "string" });
const embedding = (name = "embedding") =>
  vector(name, { dimensions: EMBEDDING_DIMENSIONS });

// Enums

export const sourceKind = pgEnum("source_kind", SOURCE_KINDS);
export const sourceItemStatus = pgEnum(
  "source_item_status",
  SOURCE_ITEM_STATUSES,
);
export const eventType = pgEnum("event_type", EVENT_TYPES);
export const roundType = pgEnum("round_type", ROUND_TYPES);
export const investorKind = pgEnum("investor_kind", INVESTOR_KINDS);
export const investorRole = pgEnum("investor_role", INVESTOR_ROLES);
export const launchKind = pgEnum("launch_kind", LAUNCH_KINDS);
export const evidenceLevel = pgEnum("evidence_level", EVIDENCE_LEVELS);
export const datePrecision = pgEnum("date_precision", DATE_PRECISIONS);
export const companyStatus = pgEnum("company_status", COMPANY_STATUSES);
export const foundedYearSource = pgEnum(
  "founded_year_source",
  FOUNDED_YEAR_SOURCES,
);
export const llmPurpose = pgEnum("llm_purpose", LLM_PURPOSES);
export const ingestTrigger = pgEnum("ingest_trigger", INGEST_TRIGGERS);
export const ingestStatus = pgEnum("ingest_status", INGEST_STATUSES);
export const mergeEntity = pgEnum("merge_entity", MERGE_ENTITIES);
export const mergeCandidateStatus = pgEnum(
  "merge_candidate_status",
  MERGE_CANDIDATE_STATUSES,
);
export const aliasSource = pgEnum("alias_source", ALIAS_SOURCES);

// Phase 2 enums (docs/spec-phase2.md section 5.1)

export const themeStatus = pgEnum("theme_status", THEME_STATUSES);
export const themeNameSource = pgEnum("theme_name_source", THEME_NAME_SOURCES);
export const themeAssignedBy = pgEnum("theme_assigned_by", THEME_ASSIGNED_BY);
export const locationPrecision = pgEnum(
  "location_precision",
  LOCATION_PRECISIONS,
);
export const locationSource = pgEnum("location_source", LOCATION_SOURCES);
export const grantRole = pgEnum("grant_role", GRANT_ROLES);
export const recordKind = pgEnum("record_kind", RECORD_KINDS);

// Phase 3 enums (docs/spec-phase3.md section 5.1)

export const registryKind = pgEnum("registry_kind", REGISTRY_KINDS);
export const registryLinkStatus = pgEnum(
  "registry_link_status",
  REGISTRY_LINK_STATUSES,
);
export const registryLinkMethod = pgEnum(
  "registry_link_method",
  REGISTRY_LINK_METHODS,
);
export const linkDecidedBy = pgEnum("link_decided_by", LINK_DECIDED_BY);
export const registrySearchOutcome = pgEnum(
  "registry_search_outcome",
  REGISTRY_SEARCH_OUTCOMES,
);
export const sectorSource = pgEnum("sector_source", SECTOR_SOURCES);

// Collection and processing

export const sources = pgTable("sources", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: sourceKind("kind").notNull(),
  url: text("url").notNull(),
  /** Higher wins ties when canonical event fields are recomputed. */
  priority: smallint("priority").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  etag: text("etag"),
  /** Raw `Last-Modified` header value, echoed back as `If-Modified-Since`. */
  lastModified: text("last_modified"),
  lastFetchedAt: timestamptz("last_fetched_at"),
  createdAt: createdNow("created_at"),
});

export const sourceItems = pgTable(
  "source_items",
  {
    id: id(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull().unique(),
    title: text("title").notNull(),
    publishedAt: timestamptz("published_at"),
    fetchedAt: createdNow("fetched_at"),
    status: sourceItemStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    unique("source_items_source_id_external_id_unique").on(
      t.sourceId,
      t.externalId,
    ),
    index("source_items_status_fetched_at_idx").on(t.status, t.fetchedAt),
  ],
);

/** Feed summaries, used only as LLM input. Never displayed; the web role cannot read it. */
export const sourceItemTexts = pgTable("source_item_texts", {
  sourceItemId: integer("source_item_id")
    .primaryKey()
    .references(() => sourceItems.id, { onDelete: "cascade" }),
  summary: text("summary"),
});

export const extractions = pgTable(
  "extractions",
  {
    id: id(),
    sourceItemId: integer("source_item_id")
      .notNull()
      .references(() => sourceItems.id),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    /** Stored as written: rows from prompt v1 have no `regionText`. */
    result: jsonb("result").$type<ExtractionV1 | ExtractionV2>().notNull(),
    isRelevant: boolean("is_relevant").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull(),
    createdAt: createdNow("created_at"),
    resolvedAt: timestamptz("resolved_at"),
  },
  (t) => [
    unique("extractions_item_prompt_model_unique").on(
      t.sourceItemId,
      t.promptVersion,
      t.model,
    ),
    uniqueIndex("extractions_one_current_per_item_idx")
      .on(t.sourceItemId)
      .where(sql`${t.isCurrent}`),
  ],
);

export const ingestRuns = pgTable("ingest_runs", {
  id: id(),
  startedAt: createdNow("started_at"),
  finishedAt: timestamptz("finished_at"),
  trigger: ingestTrigger("trigger").notNull(),
  status: ingestStatus("status").notNull().default("running"),
  stats: jsonb("stats").$type<IngestStats>(),
  error: text("error"),
});

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: id(),
    occurredAt: createdNow("occurred_at"),
    purpose: llmPurpose("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull(),
    sourceItemId: integer("source_item_id").references(() => sourceItems.id),
    ingestRunId: integer("ingest_run_id").references(() => ingestRuns.id),
  },
  (t) => [index("llm_usage_occurred_at_idx").on(t.occurredAt)],
);

/** ECB reference rates: units of `currency` per 1 EUR. Cross rates are computed in code. */
export const fxRates = pgTable(
  "fx_rates",
  {
    rateDate: isoDate("rate_date").notNull(),
    currency: currencyCode("currency").notNull(),
    perEur: numeric("per_eur", {
      precision: 18,
      scale: 8,
      mode: "number",
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.rateDate, t.currency] })],
);

// Entities

export const companies = pgTable(
  "companies",
  {
    id: id(),
    /** Never changes once assigned; merged companies redirect by slug. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    normalisedName: text("normalised_name").notNull(),
    websiteDomain: text("website_domain").unique(),
    description: text("description"),
    countryCode: countryCode("country_code"),
    city: text("city"),
    foundedYear: smallint("founded_year"),
    foundedYearSource: foundedYearSource("founded_year_source"),
    status: companyStatus("status").notNull().default("active"),
    ukCompanyNumber: text("uk_company_number").unique(),
    secCik: text("sec_cik").unique(),
    ycBatch: text("yc_batch"),
    githubOrg: text("github_org"),
    embedding: embedding(),
    embeddingModel: text("embedding_model"),
    mergedIntoId: integer("merged_into_id").references(
      (): AnyPgColumn => companies.id,
    ),
    firstSeenAt: createdNow("first_seen_at"),
    updatedAt: createdNow("updated_at"),
  },
  (t) => [
    index("companies_normalised_name_trgm_idx").using(
      "gin",
      t.normalisedName.op("gin_trgm_ops"),
    ),
    index("companies_normalised_name_idx").on(t.normalisedName),
    check(
      "companies_description_length",
      sql`char_length(${t.description}) <= 200`,
    ),
    check("companies_not_merged_into_self", sql`${t.mergedIntoId} <> ${t.id}`),
  ],
);

export const companyAliases = pgTable(
  "company_aliases",
  {
    id: id(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    alias: text("alias").notNull(),
    normalisedAlias: text("normalised_alias").notNull(),
    source: aliasSource("source").notNull(),
  },
  (t) => [
    unique("company_aliases_company_id_normalised_alias_unique").on(
      t.companyId,
      t.normalisedAlias,
    ),
    index("company_aliases_normalised_alias_trgm_idx").using(
      "gin",
      t.normalisedAlias.op("gin_trgm_ops"),
    ),
    index("company_aliases_normalised_alias_idx").on(t.normalisedAlias),
  ],
);

export const tags = pgTable("tags", {
  id: id(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  embedding: embedding(),
  embeddingModel: text("embedding_model"),
  firstSeenAt: createdNow("first_seen_at"),
});

export const companyTags = pgTable(
  "company_tags",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id),
    /** Where the tag came from, e.g. `extraction` or `manual`. */
    source: text("source").notNull().default("extraction"),
    mentionCount: integer("mention_count").notNull().default(1),
    firstSeenAt: createdNow("first_seen_at"),
    lastSeenAt: createdNow("last_seen_at"),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.tagId] }),
    index("company_tags_tag_id_idx").on(t.tagId),
  ],
);

/** Organisations only; individual angels are never stored (D19). */
export const investors = pgTable(
  "investors",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    normalisedName: text("normalised_name").notNull(),
    kind: investorKind("kind").notNull().default("unknown"),
    countryCode: countryCode("country_code"),
    websiteDomain: text("website_domain"),
    mergedIntoId: integer("merged_into_id").references(
      (): AnyPgColumn => investors.id,
    ),
    firstSeenAt: createdNow("first_seen_at"),
  },
  (t) => [
    index("investors_normalised_name_trgm_idx").using(
      "gin",
      t.normalisedName.op("gin_trgm_ops"),
    ),
    index("investors_normalised_name_idx").on(t.normalisedName),
    index("investors_website_domain_idx").on(t.websiteDomain),
    check("investors_not_merged_into_self", sql`${t.mergedIntoId} <> ${t.id}`),
  ],
);

export const investorAliases = pgTable(
  "investor_aliases",
  {
    id: id(),
    investorId: integer("investor_id")
      .notNull()
      .references(() => investors.id),
    alias: text("alias").notNull(),
    normalisedAlias: text("normalised_alias").notNull(),
    source: aliasSource("source").notNull(),
  },
  (t) => [
    unique("investor_aliases_investor_id_normalised_alias_unique").on(
      t.investorId,
      t.normalisedAlias,
    ),
    index("investor_aliases_normalised_alias_trgm_idx").using(
      "gin",
      t.normalisedAlias.op("gin_trgm_ops"),
    ),
    index("investor_aliases_normalised_alias_idx").on(t.normalisedAlias),
  ],
);

// Events: class-table inheritance (D13). Detail and link rows cascade with the event.

export const events = pgTable(
  "events",
  {
    id: id(),
    type: eventType("type").notNull(),
    /** The funded company, the acquisition target, or the launching company. */
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    announcedOn: isoDate("announced_on").notNull(),
    datePrecision: datePrecision("date_precision").notNull().default("day"),
    evidence: evidenceLevel("evidence").notNull().default("reported"),
    sourceCount: integer("source_count").notNull().default(0),
    firstSeenAt: createdNow("first_seen_at"),
    updatedAt: createdNow("updated_at"),
  },
  (t) => [
    index("events_type_announced_on_idx").on(t.type, t.announcedOn),
    index("events_company_id_idx").on(t.companyId),
  ],
);

export const fundingRounds = pgTable(
  "funding_rounds",
  {
    eventId: integer("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    roundType: roundType("round_type").notNull().default("unknown"),
    /** Raw wording, e.g. "seed extension". */
    roundLabel: text("round_label"),
    amountMinor: moneyMinor("amount_minor"),
    currency: currencyCode("currency"),
    amountUsdMinor: moneyMinor("amount_usd_minor"),
    amountGbpMinor: moneyMinor("amount_gbp_minor"),
    fxRateDate: isoDate("fx_rate_date"),
    includesIndividualAngels: boolean("includes_individual_angels")
      .notNull()
      .default(false),
  },
  (t) => [
    index("funding_rounds_round_type_idx").on(t.roundType),
    index("funding_rounds_amount_gbp_minor_idx").on(t.amountGbpMinor),
    check(
      "funding_rounds_amount_has_currency",
      sql`(${t.amountMinor} IS NULL) = (${t.currency} IS NULL)`,
    ),
    check(
      "funding_rounds_amounts_non_negative",
      sql`${t.amountMinor} >= 0 AND ${t.amountUsdMinor} >= 0 AND ${t.amountGbpMinor} >= 0`,
    ),
  ],
);

export const acquisitions = pgTable(
  "acquisitions",
  {
    eventId: integer("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    acquirerCompanyId: integer("acquirer_company_id").references(
      () => companies.id,
    ),
    /** The acquirer as the source names it, kept even when resolved. */
    acquirerName: text("acquirer_name").notNull(),
    priceMinor: moneyMinor("price_minor"),
    currency: currencyCode("currency"),
    priceUsdMinor: moneyMinor("price_usd_minor"),
    priceGbpMinor: moneyMinor("price_gbp_minor"),
    fxRateDate: isoDate("fx_rate_date"),
  },
  (t) => [
    index("acquisitions_acquirer_company_id_idx").on(t.acquirerCompanyId),
    check(
      "acquisitions_price_has_currency",
      sql`(${t.priceMinor} IS NULL) = (${t.currency} IS NULL)`,
    ),
    check(
      "acquisitions_prices_non_negative",
      sql`${t.priceMinor} >= 0 AND ${t.priceUsdMinor} >= 0 AND ${t.priceGbpMinor} >= 0`,
    ),
  ],
);

export const launches = pgTable("launches", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  kind: launchKind("kind").notNull(),
  productName: text("product_name"),
  url: text("url"),
  /** For example an HN item id or a GitHub `owner/repo`. */
  externalRef: text("external_ref"),
});

/** Filled in Phase 2. `metric` is one of `points`, `comments`, `stars`, `forks`. */
export const launchMetricSnapshots = pgTable(
  "launch_metric_snapshots",
  {
    id: id(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    observedAt: createdNow("observed_at"),
  },
  (t) => [
    index("launch_metric_snapshots_event_metric_observed_idx").on(
      t.eventId,
      t.metric,
      t.observedAt,
    ),
  ],
);

export const eventInvestors = pgTable(
  "event_investors",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    investorId: integer("investor_id")
      .notNull()
      .references(() => investors.id),
    role: investorRole("role").notNull().default("unknown"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.investorId] }),
    index("event_investors_investor_id_idx").on(t.investorId),
  ],
);

export const eventSources = pgTable(
  "event_sources",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    extractionId: integer("extraction_id")
      .notNull()
      .references(() => extractions.id),
    sourceItemId: integer("source_item_id")
      .notNull()
      .references(() => sourceItems.id),
    /** Position in `extractions.result.events`. */
    eventIndex: smallint("event_index").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.extractionId, t.eventIndex] }),
    index("event_sources_extraction_id_idx").on(t.extractionId),
    index("event_sources_source_item_id_idx").on(t.sourceItemId),
  ],
);

// Data quality

export const mergeCandidates = pgTable(
  "merge_candidates",
  {
    id: id(),
    entityType: mergeEntity("entity_type").notNull(),
    leftId: integer("left_id").notNull(),
    rightId: integer("right_id").notNull(),
    score: real("score").notNull(),
    reason: text("reason").notNull(),
    status: mergeCandidateStatus("status").notNull().default("open"),
    createdAt: createdNow("created_at"),
    resolvedAt: timestamptz("resolved_at"),
  },
  (t) => [
    unique("merge_candidates_entity_left_right_unique").on(
      t.entityType,
      t.leftId,
      t.rightId,
    ),
    index("merge_candidates_status_idx").on(t.status),
    check("merge_candidates_distinct_ids", sql`${t.leftId} <> ${t.rightId}`),
  ],
);

/** Audit log of manual merges. */
export const entityMerges = pgTable("entity_merges", {
  id: id(),
  entityType: mergeEntity("entity_type").notNull(),
  keptId: integer("kept_id").notNull(),
  mergedId: integer("merged_id").notNull(),
  mergedAt: createdNow("merged_at"),
  note: text("note"),
});

// Themes (Phase 2, spec-phase2 section 5.2). Raw tags and `company_tags` are untouched.

export const themes = pgTable(
  "themes",
  {
    id: id(),
    /** Never changes once assigned; merged themes redirect by slug. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    nameSource: themeNameSource("name_source").notNull().default("tag"),
    /** One of the slugs in `src/core/sectors.ts`, checked in code (the list is append-only). */
    sector: text("sector"),
    status: themeStatus("status").notNull().default("active"),
    mergedIntoId: integer("merged_into_id").references(
      (): AnyPgColumn => themes.id,
    ),
    seedTagId: integer("seed_tag_id")
      .notNull()
      .references(() => tags.id),
    centroid: embedding("centroid").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: createdNow("created_at"),
    namedAt: timestamptz("named_at"),
    reviewedAt: timestamptz("reviewed_at"),
  },
  (t) => [
    index("themes_status_idx").on(t.status),
    check("themes_not_merged_into_self", sql`${t.mergedIntoId} <> ${t.id}`),
    check(
      "themes_merged_has_target",
      sql`(${t.status} = 'merged') = (${t.mergedIntoId} IS NOT NULL)`,
    ),
  ],
);

/** One row per assigned tag. A null `theme_id` means a person decided the tag belongs to no theme. */
export const tagThemes = pgTable(
  "tag_themes",
  {
    tagId: integer("tag_id")
      .primaryKey()
      .references(() => tags.id),
    themeId: integer("theme_id").references(() => themes.id),
    /** Cosine similarity to the theme centroid; null for manual links. */
    similarity: real("similarity"),
    assignedBy: themeAssignedBy("assigned_by").notNull(),
    embeddingModel: text("embedding_model"),
    assignedAt: createdNow("assigned_at"),
  },
  (t) => [index("tag_themes_theme_id_idx").on(t.themeId)],
);

// Derived tables (spec-phase2 section 5.3, D37). Rebuilt from source tables,
// so the rebuild may replace their rows.

const nonNegativeCount = (name: string) => integer(name).notNull().default(0);

export const companyThemes = pgTable(
  "company_themes",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    themeId: integer("theme_id")
      .notNull()
      .references(() => themes.id),
    tagCount: integer("tag_count").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.themeId] }),
    index("company_themes_theme_id_idx").on(t.themeId),
    check("company_themes_tag_count_non_negative", sql`${t.tagCount} >= 0`),
  ],
);

/** Only weeks with at least one event get a row. Rounds exclude grants. */
export const themeWeeklyStats = pgTable(
  "theme_weekly_stats",
  {
    themeId: integer("theme_id")
      .notNull()
      .references(() => themes.id),
    /** A Monday. */
    weekStart: isoDate("week_start").notNull(),
    rounds: nonNegativeCount("rounds"),
    roundsWithAmount: nonNegativeCount("rounds_with_amount"),
    totalGbpMinor: moneyMinor("total_gbp_minor").notNull().default(0),
    /** `pre_seed` and `seed`. */
    earlyRounds: nonNegativeCount("early_rounds"),
    /** `series_a` to `series_d_plus`, and `growth`. */
    laterRounds: nonNegativeCount("later_rounds"),
    unknownStageRounds: nonNegativeCount("unknown_stage_rounds"),
    grants: nonNegativeCount("grants"),
    grantGbpMinor: moneyMinor("grant_gbp_minor").notNull().default(0),
    acquisitions: nonNegativeCount("acquisitions"),
    launches: nonNegativeCount("launches"),
    /** Distinct companies with any event that week. */
    companies: nonNegativeCount("companies"),
  },
  (t) => [
    primaryKey({ columns: [t.themeId, t.weekStart] }),
    index("theme_weekly_stats_week_start_idx").on(t.weekStart),
    check(
      "theme_weekly_stats_week_start_monday",
      sql`extract(isodow from ${t.weekStart}) = 1`,
    ),
    check(
      "theme_weekly_stats_non_negative",
      sql`${t.rounds} >= 0 AND ${t.roundsWithAmount} >= 0 AND ${t.totalGbpMinor} >= 0 AND ${t.earlyRounds} >= 0 AND ${t.laterRounds} >= 0 AND ${t.unknownStageRounds} >= 0 AND ${t.grants} >= 0 AND ${t.grantGbpMinor} >= 0 AND ${t.acquisitions} >= 0 AND ${t.launches} >= 0 AND ${t.companies} >= 0`,
    ),
  ],
);

/** Distinct events across all companies, so an event in two themes counts once. */
export const weeklyTotals = pgTable(
  "weekly_totals",
  {
    /** A Monday. */
    weekStart: isoDate("week_start").primaryKey(),
    rounds: nonNegativeCount("rounds"),
    earlyRounds: nonNegativeCount("early_rounds"),
    grants: nonNegativeCount("grants"),
    acquisitions: nonNegativeCount("acquisitions"),
    launches: nonNegativeCount("launches"),
  },
  (t) => [
    check(
      "weekly_totals_week_start_monday",
      sql`extract(isodow from ${t.weekStart}) = 1`,
    ),
    check(
      "weekly_totals_non_negative",
      sql`${t.rounds} >= 0 AND ${t.earlyRounds} >= 0 AND ${t.grants} >= 0 AND ${t.acquisitions} >= 0 AND ${t.launches} >= 0`,
    ),
  ],
);

/**
 * Equity rounds only (funding rounds other than `debt` and `grant`, D43).
 * Rows referring to a deleted event go with it; the next rebuild recomputes them.
 */
export const fundingRoundMomentum = pgTable(
  "funding_round_momentum",
  {
    eventId: integer("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /** 1 means the first round SignalFeed has recorded. */
    equityRoundNumber: smallint("equity_round_number").notNull(),
    previousEventId: integer("previous_event_id").references(
      (): AnyPgColumn => events.id,
      { onDelete: "cascade" },
    ),
    monthsSincePrevious: smallint("months_since_previous"),
    stepUpBasisEventId: integer("step_up_basis_event_id").references(
      (): AnyPgColumn => events.id,
      { onDelete: "cascade" },
    ),
    stepUpRatio: real("step_up_ratio"),
    roundsIn24mToDate: smallint("rounds_in_24m_to_date").notNull(),
  },
  (t) => [
    index("funding_round_momentum_company_id_idx").on(t.companyId),
    check(
      "funding_round_momentum_non_negative",
      sql`${t.equityRoundNumber} >= 1 AND ${t.monthsSincePrevious} >= 0 AND ${t.stepUpRatio} >= 0 AND ${t.roundsIn24mToDate} >= 1`,
    ),
  ],
);

/** One row per company with at least a UK region or a non-UK city (spec-phase2 section 9.1). */
export const companyLocations = pgTable(
  "company_locations",
  {
    companyId: integer("company_id")
      .primaryKey()
      .references(() => companies.id),
    countryCode: countryCode("country_code").notNull(),
    /** ITL1 code, for example `TLE`. */
    itl1Code: char("itl1_code", { length: 3 }),
    placeSlug: text("place_slug"),
    /** Postcode district, for example `L35`. */
    outcode: text("outcode"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    precision: locationPrecision("precision").notNull(),
    source: locationSource("source").notNull(),
    computedAt: createdNow("computed_at"),
  },
  (t) => [
    index("company_locations_itl1_code_idx").on(t.itl1Code),
    index("company_locations_place_slug_idx").on(t.placeSlug),
    index("company_locations_latitude_longitude_idx").on(
      t.latitude,
      t.longitude,
    ),
    check(
      "company_locations_coordinates_paired",
      sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)`,
    ),
  ],
);

/** A rebuild is skipped when its input fingerprint has not changed. */
export const derivedRebuilds = pgTable("derived_rebuilds", {
  /** For example `stats` or `locations`. */
  name: text("name").primaryKey(),
  inputFingerprint: text("input_fingerprint").notNull(),
  rebuiltAt: createdNow("rebuilt_at"),
});

// Grants: UKRI Gateway to Research (spec-phase2 section 5.4, D40)

export const grantProjects = pgTable("grant_projects", {
  id: id(),
  sourceId: integer("source_id")
    .notNull()
    .references(() => sources.id),
  gtrProjectId: text("gtr_project_id").notNull().unique(),
  title: text("title").notNull(),
  /** For example "Collaborative R&D". */
  grantCategory: text("grant_category").notNull(),
  leadFunder: text("lead_funder").notNull(),
  status: text("status").notNull(),
  startOn: isoDate("start_on"),
  endOn: isoDate("end_on"),
  gtrUrl: text("gtr_url").notNull(),
  firstSeenAt: createdNow("first_seen_at"),
  updatedAt: createdNow("updated_at"),
});

/** Project abstracts, used only as LLM input. Never displayed; the web role cannot read it. */
export const grantProjectTexts = pgTable(
  "grant_project_texts",
  {
    projectId: integer("project_id")
      .primaryKey()
      .references(() => grantProjects.id, { onDelete: "cascade" }),
    abstract: text("abstract").notNull(),
  },
  (t) => [
    check(
      "grant_project_texts_abstract_length",
      sql`char_length(${t.abstract}) <= 1500`,
    ),
  ],
);

/** Organisations only; participants that may be individual people are never stored. */
export const grantParticipants = pgTable(
  "grant_participants",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => grantProjects.id),
    gtrOrgId: text("gtr_org_id").notNull(),
    organisationName: text("organisation_name").notNull(),
    /** Companies House number, when GtR has one. */
    regNumber: text("reg_number"),
    postcode: text("postcode"),
    outcode: text("outcode"),
    regionText: text("region_text"),
    role: grantRole("role").notNull(),
    /** GBP pence. */
    grantOfferMinor: moneyMinor("grant_offer_minor"),
    projectCostMinor: moneyMinor("project_cost_minor"),
    orgFetchedAt: timestamptz("org_fetched_at"),
    companyId: integer("company_id").references(() => companies.id),
    eventId: integer("event_id").references(() => events.id),
    resolvedAt: timestamptz("resolved_at"),
    skippedReason: text("skipped_reason"),
  },
  (t) => [
    unique("grant_participants_project_id_gtr_org_id_unique").on(
      t.projectId,
      t.gtrOrgId,
    ),
    index("grant_participants_resolved_at_idx").on(t.resolvedAt),
    check(
      "grant_participants_amounts_non_negative",
      sql`${t.grantOfferMinor} >= 0 AND ${t.projectCostMinor} >= 0`,
    ),
  ],
);

/** Tagging is paid for once per project, prompt version and model. */
export const grantTaggings = pgTable(
  "grant_taggings",
  {
    id: id(),
    projectId: integer("project_id")
      .notNull()
      .references(() => grantProjects.id),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    tags: text("tags").array().notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull(),
    createdAt: createdNow("created_at"),
  },
  (t) => [
    unique("grant_taggings_project_prompt_model_unique").on(
      t.projectId,
      t.promptVersion,
      t.model,
    ),
    check(
      "grant_taggings_usage_non_negative",
      sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.costUsdMicros} >= 0`,
    ),
  ],
);

/** Links an event to an official record instead of an extraction. */
export const eventRecordSources = pgTable(
  "event_record_sources",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    recordKind: recordKind("record_kind").notNull(),
    /** For `ukri_grant`, a `grant_participants.id`. */
    recordId: integer("record_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.recordKind, t.recordId] })],
);

// Registry links (spec-phase3 section 5.2). Only `src/pipeline/registry/link-store.ts`
// writes `registry_links`.

export const registryLinks = pgTable(
  "registry_links",
  {
    id: id(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    registry: registryKind("registry").notNull(),
    /** A normalised Companies House number, or a CIK without leading zeros. */
    registryId: text("registry_id").notNull(),
    /** The organisation name the registry gives. */
    registryName: text("registry_name").notNull(),
    status: registryLinkStatus("status").notNull(),
    /** Null for candidates and rejections. */
    method: registryLinkMethod("method"),
    /** Which rule and signals decided the row. */
    reason: text("reason").notNull(),
    decidedBy: linkDecidedBy("decided_by").notNull(),
    createdAt: createdNow("created_at"),
    decidedAt: createdNow("decided_at"),
  },
  (t) => [
    unique("registry_links_company_registry_id_unique").on(
      t.companyId,
      t.registry,
      t.registryId,
    ),
    uniqueIndex("registry_links_one_linked_per_company_idx")
      .on(t.companyId, t.registry)
      .where(sql`${t.status} = 'linked'`),
    uniqueIndex("registry_links_one_linked_per_number_idx")
      .on(t.registry, t.registryId)
      .where(sql`${t.status} = 'linked'`),
    index("registry_links_registry_status_idx").on(t.registry, t.status),
    check(
      "registry_links_linked_has_method",
      sql`${t.status} <> 'linked' OR ${t.method} IS NOT NULL`,
    ),
  ],
);

/** A company is searched again only when its fingerprint changes or after 90 days. */
export const registrySearches = pgTable(
  "registry_searches",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    registry: registryKind("registry").notNull(),
    searchedAt: timestamptz("searched_at").notNull(),
    outcome: registrySearchOutcome("outcome").notNull(),
    /** Hash of the names and events the search used. */
    inputFingerprint: text("input_fingerprint").notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.registry] })],
);

// Companies House (spec-phase3 section 5.3). Organisation facts only (D58).

export const chCompanies = pgTable(
  "ch_companies",
  {
    companyNumber: text("company_number").primaryKey(),
    name: text("name").notNull(),
    /** Companies House's own status value, such as `active`. */
    status: text("status").notNull(),
    statusDetail: text("status_detail"),
    companyType: text("company_type").notNull(),
    incorporatedOn: isoDate("incorporated_on").notNull(),
    ceasedOn: isoDate("ceased_on"),
    sicCodes: text("sic_codes").array().notNull().default([]),
    /** Full registered office postcode, for the shared-address check. Never displayed. */
    officePostcode: text("office_postcode"),
    /** Postcode district, for example `LS1`. */
    officeOutcode: text("office_outcode"),
    officeLocality: text("office_locality"),
    /** Organisation names only. */
    previousNames: text("previous_names").array().notNull().default([]),
    /** `accounts.last_accounts.type`. */
    accountsType: text("accounts_type"),
    accountsMadeUpTo: isoDate("accounts_made_up_to"),
    hasInsolvencyHistory: boolean("has_insolvency_history")
      .notNull()
      .default(false),
    etag: text("etag"),
    fetchedAt: createdNow("fetched_at"),
    firstSeenAt: createdNow("first_seen_at"),
  },
  (t) => [index("ch_companies_office_outcode_idx").on(t.officeOutcode)],
);

/** Capital-category SH01 filings only. */
export const chFilings = pgTable(
  "ch_filings",
  {
    id: id(),
    companyNumber: text("company_number").notNull(),
    transactionId: text("transaction_id").notNull().unique(),
    /** For example `SH01`. */
    type: text("type").notNull(),
    /** For example `capital`. */
    category: text("category").notNull(),
    filedOn: isoDate("filed_on").notNull(),
    /** For an SH01, the allotment date. */
    actionDate: isoDate("action_date"),
    /** Statement of capital after the allotment. */
    capital: jsonb("capital").$type<CapitalAmount[]>(),
    /** For the deferred SH01 reader (Task 067). */
    documentId: text("document_id"),
    fetchedAt: createdNow("fetched_at"),
  },
  (t) => [
    index("ch_filings_company_number_action_date_idx").on(
      t.companyNumber,
      t.actionDate,
    ),
  ],
);

/** Cache for the shared-address check (spec-phase3 section 7.3). */
export const chAddressCounts = pgTable(
  "ch_address_counts",
  {
    postcode: text("postcode").primaryKey(),
    activeCompanies: integer("active_companies").notNull(),
    checkedAt: timestamptz("checked_at").notNull(),
  },
  (t) => [
    check("ch_address_counts_non_negative", sql`${t.activeCompanies} >= 0`),
  ],
);

// SEC Form D (spec-phase3 section 5.4). Issuer and offering fields only (D58);
// pooled investment funds are never stored.

export const formDFilings = pgTable(
  "form_d_filings",
  {
    id: id(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    accessionNumber: text("accession_number").notNull().unique(),
    /** Without leading zeros. */
    cik: text("cik").notNull(),
    issuerName: text("issuer_name").notNull(),
    entityType: text("entity_type"),
    /** State or country of incorporation. */
    jurisdiction: text("jurisdiction"),
    issuerState: text("issuer_state"),
    issuerCity: text("issuer_city"),
    /** Given only when the issuer was incorporated within five years. */
    yearOfInc: smallint("year_of_inc"),
    incOverFiveYears: boolean("inc_over_five_years").notNull().default(false),
    industryGroup: text("industry_group"),
    isAmendment: boolean("is_amendment").notNull(),
    previousAccessionNumber: text("previous_accession_number"),
    dateOfFirstSale: isoDate("date_of_first_sale"),
    firstSaleYetToOccur: boolean("first_sale_yet_to_occur")
      .notNull()
      .default(false),
    /** Null when the offering is "Indefinite". */
    totalOfferingUsdMinor: moneyMinor("total_offering_usd_minor"),
    totalSoldUsdMinor: moneyMinor("total_sold_usd_minor"),
    investorCount: integer("investor_count"),
    /** For example `equity`, `debt`, `option`. */
    securities: text("securities").array().notNull().default([]),
    /** For example `06b`. */
    exemptions: text("exemptions").array().notNull().default([]),
    filedOn: isoDate("filed_on").notNull(),
    fetchedAt: createdNow("fetched_at"),
    companyId: integer("company_id").references(() => companies.id),
    linkedAt: timestamptz("linked_at"),
  },
  (t) => [
    index("form_d_filings_cik_idx").on(t.cik),
    index("form_d_filings_filed_on_idx").on(t.filedOn),
    index("form_d_filings_company_id_idx").on(t.companyId),
    check(
      "form_d_filings_amounts_non_negative",
      sql`${t.totalOfferingUsdMinor} >= 0 AND ${t.totalSoldUsdMinor} >= 0 AND ${t.investorCount} >= 0`,
    ),
  ],
);

/** One row per EDGAR daily index processed, so collection resumes without repeats. */
export const edgarIndexDays = pgTable(
  "edgar_index_days",
  {
    day: isoDate("day").primaryKey(),
    /** `done` or `missing` (no index for that day). */
    status: text("status").notNull(),
    formDFound: nonNegativeCount("form_d_found"),
    formDStored: nonNegativeCount("form_d_stored"),
    fundSkipped: nonNegativeCount("fund_skipped"),
    fetchedAt: createdNow("fetched_at"),
  },
  (t) => [
    check("edgar_index_days_status", sql`${t.status} IN ('done', 'missing')`),
    check(
      "edgar_index_days_non_negative",
      sql`${t.formDFound} >= 0 AND ${t.formDStored} >= 0 AND ${t.fundSkipped} >= 0`,
    ),
  ],
);

// Phase 3 derived tables (spec-phase3 section 5.5, D37). Rebuilt from source
// tables, so the rebuild may replace their rows.

export const eventConfirmations = pgTable(
  "event_confirmations",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    recordKind: recordKind("record_kind").notNull(),
    /** A `ch_filings.id` or a `form_d_filings.id`. */
    recordId: integer("record_id").notNull(),
    /** For example `ch_allotment_window`. */
    rule: text("rule").notNull(),
    recordDate: isoDate("record_date").notNull(),
    confirmsAmount: boolean("confirms_amount").notNull().default(false),
    computedAt: createdNow("computed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.recordKind, t.recordId] }),
    index("event_confirmations_record_kind_record_id_idx").on(
      t.recordKind,
      t.recordId,
    ),
  ],
);

/** Theme sectors, plus SIC sectors for companies with no theme sector. */
export const companySectors = pgTable(
  "company_sectors",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /** One of the slugs in `src/core/sectors.ts`, checked in code (the list is append-only). */
    sector: text("sector").notNull(),
    source: sectorSource("source").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.sector] }),
    index("company_sectors_sector_idx").on(t.sector),
  ],
);

// Relations

export const sourcesRelations = relations(sources, ({ many }) => ({
  items: many(sourceItems),
  grantProjects: many(grantProjects),
  formDFilings: many(formDFilings),
}));

export const sourceItemsRelations = relations(sourceItems, ({ one, many }) => ({
  source: one(sources, {
    fields: [sourceItems.sourceId],
    references: [sources.id],
  }),
  text: one(sourceItemTexts),
  extractions: many(extractions),
  eventSources: many(eventSources),
}));

export const sourceItemTextsRelations = relations(
  sourceItemTexts,
  ({ one }) => ({
    sourceItem: one(sourceItems, {
      fields: [sourceItemTexts.sourceItemId],
      references: [sourceItems.id],
    }),
  }),
);

export const extractionsRelations = relations(extractions, ({ one, many }) => ({
  sourceItem: one(sourceItems, {
    fields: [extractions.sourceItemId],
    references: [sourceItems.id],
  }),
  eventSources: many(eventSources),
}));

export const ingestRunsRelations = relations(ingestRuns, ({ many }) => ({
  llmUsage: many(llmUsage),
}));

export const llmUsageRelations = relations(llmUsage, ({ one }) => ({
  sourceItem: one(sourceItems, {
    fields: [llmUsage.sourceItemId],
    references: [sourceItems.id],
  }),
  ingestRun: one(ingestRuns, {
    fields: [llmUsage.ingestRunId],
    references: [ingestRuns.id],
  }),
}));

export const companiesRelations = relations(companies, ({ one, many }) => ({
  aliases: many(companyAliases),
  tags: many(companyTags),
  events: many(events),
  acquisitionsAsAcquirer: many(acquisitions, { relationName: "acquirer" }),
  themes: many(companyThemes),
  location: one(companyLocations),
  grantParticipants: many(grantParticipants),
  registryLinks: many(registryLinks),
  registrySearches: many(registrySearches),
  formDFilings: many(formDFilings),
  sectors: many(companySectors),
  mergedInto: one(companies, {
    fields: [companies.mergedIntoId],
    references: [companies.id],
    relationName: "companyMerge",
  }),
  mergedFrom: many(companies, { relationName: "companyMerge" }),
}));

export const companyAliasesRelations = relations(companyAliases, ({ one }) => ({
  company: one(companies, {
    fields: [companyAliases.companyId],
    references: [companies.id],
  }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  companies: many(companyTags),
  themeLink: one(tagThemes),
}));

export const companyTagsRelations = relations(companyTags, ({ one }) => ({
  company: one(companies, {
    fields: [companyTags.companyId],
    references: [companies.id],
  }),
  tag: one(tags, { fields: [companyTags.tagId], references: [tags.id] }),
}));

export const investorsRelations = relations(investors, ({ one, many }) => ({
  aliases: many(investorAliases),
  events: many(eventInvestors),
  mergedInto: one(investors, {
    fields: [investors.mergedIntoId],
    references: [investors.id],
    relationName: "investorMerge",
  }),
  mergedFrom: many(investors, { relationName: "investorMerge" }),
}));

export const investorAliasesRelations = relations(
  investorAliases,
  ({ one }) => ({
    investor: one(investors, {
      fields: [investorAliases.investorId],
      references: [investors.id],
    }),
  }),
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  company: one(companies, {
    fields: [events.companyId],
    references: [companies.id],
  }),
  fundingRound: one(fundingRounds),
  acquisition: one(acquisitions),
  launch: one(launches),
  investors: many(eventInvestors),
  sources: many(eventSources),
  recordSources: many(eventRecordSources),
  metricSnapshots: many(launchMetricSnapshots),
  momentum: one(fundingRoundMomentum),
  confirmations: many(eventConfirmations),
}));

export const fundingRoundsRelations = relations(fundingRounds, ({ one }) => ({
  event: one(events, {
    fields: [fundingRounds.eventId],
    references: [events.id],
  }),
}));

export const acquisitionsRelations = relations(acquisitions, ({ one }) => ({
  event: one(events, {
    fields: [acquisitions.eventId],
    references: [events.id],
  }),
  acquirer: one(companies, {
    fields: [acquisitions.acquirerCompanyId],
    references: [companies.id],
    relationName: "acquirer",
  }),
}));

export const launchesRelations = relations(launches, ({ one }) => ({
  event: one(events, { fields: [launches.eventId], references: [events.id] }),
}));

export const launchMetricSnapshotsRelations = relations(
  launchMetricSnapshots,
  ({ one }) => ({
    event: one(events, {
      fields: [launchMetricSnapshots.eventId],
      references: [events.id],
    }),
  }),
);

export const eventInvestorsRelations = relations(eventInvestors, ({ one }) => ({
  event: one(events, {
    fields: [eventInvestors.eventId],
    references: [events.id],
  }),
  investor: one(investors, {
    fields: [eventInvestors.investorId],
    references: [investors.id],
  }),
}));

export const eventSourcesRelations = relations(eventSources, ({ one }) => ({
  event: one(events, {
    fields: [eventSources.eventId],
    references: [events.id],
  }),
  extraction: one(extractions, {
    fields: [eventSources.extractionId],
    references: [extractions.id],
  }),
  sourceItem: one(sourceItems, {
    fields: [eventSources.sourceItemId],
    references: [sourceItems.id],
  }),
}));

export const themesRelations = relations(themes, ({ one, many }) => ({
  seedTag: one(tags, { fields: [themes.seedTagId], references: [tags.id] }),
  tagLinks: many(tagThemes),
  companies: many(companyThemes),
  weeklyStats: many(themeWeeklyStats),
  mergedInto: one(themes, {
    fields: [themes.mergedIntoId],
    references: [themes.id],
    relationName: "themeMerge",
  }),
  mergedFrom: many(themes, { relationName: "themeMerge" }),
}));

export const tagThemesRelations = relations(tagThemes, ({ one }) => ({
  tag: one(tags, { fields: [tagThemes.tagId], references: [tags.id] }),
  theme: one(themes, { fields: [tagThemes.themeId], references: [themes.id] }),
}));

export const companyThemesRelations = relations(companyThemes, ({ one }) => ({
  company: one(companies, {
    fields: [companyThemes.companyId],
    references: [companies.id],
  }),
  theme: one(themes, {
    fields: [companyThemes.themeId],
    references: [themes.id],
  }),
}));

export const themeWeeklyStatsRelations = relations(
  themeWeeklyStats,
  ({ one }) => ({
    theme: one(themes, {
      fields: [themeWeeklyStats.themeId],
      references: [themes.id],
    }),
  }),
);

// `previous_event_id` and `step_up_basis_event_id` have no relations: a second
// and third link to `events` would make `events.momentum` ambiguous.
export const fundingRoundMomentumRelations = relations(
  fundingRoundMomentum,
  ({ one }) => ({
    event: one(events, {
      fields: [fundingRoundMomentum.eventId],
      references: [events.id],
    }),
    company: one(companies, {
      fields: [fundingRoundMomentum.companyId],
      references: [companies.id],
    }),
  }),
);

export const companyLocationsRelations = relations(
  companyLocations,
  ({ one }) => ({
    company: one(companies, {
      fields: [companyLocations.companyId],
      references: [companies.id],
    }),
  }),
);

export const grantProjectsRelations = relations(
  grantProjects,
  ({ one, many }) => ({
    source: one(sources, {
      fields: [grantProjects.sourceId],
      references: [sources.id],
    }),
    text: one(grantProjectTexts),
    participants: many(grantParticipants),
    taggings: many(grantTaggings),
  }),
);

export const grantProjectTextsRelations = relations(
  grantProjectTexts,
  ({ one }) => ({
    project: one(grantProjects, {
      fields: [grantProjectTexts.projectId],
      references: [grantProjects.id],
    }),
  }),
);

export const grantParticipantsRelations = relations(
  grantParticipants,
  ({ one }) => ({
    project: one(grantProjects, {
      fields: [grantParticipants.projectId],
      references: [grantProjects.id],
    }),
    company: one(companies, {
      fields: [grantParticipants.companyId],
      references: [companies.id],
    }),
    event: one(events, {
      fields: [grantParticipants.eventId],
      references: [events.id],
    }),
  }),
);

export const grantTaggingsRelations = relations(grantTaggings, ({ one }) => ({
  project: one(grantProjects, {
    fields: [grantTaggings.projectId],
    references: [grantProjects.id],
  }),
}));

export const eventRecordSourcesRelations = relations(
  eventRecordSources,
  ({ one }) => ({
    event: one(events, {
      fields: [eventRecordSources.eventId],
      references: [events.id],
    }),
  }),
);

export const registryLinksRelations = relations(registryLinks, ({ one }) => ({
  company: one(companies, {
    fields: [registryLinks.companyId],
    references: [companies.id],
  }),
}));

export const registrySearchesRelations = relations(
  registrySearches,
  ({ one }) => ({
    company: one(companies, {
      fields: [registrySearches.companyId],
      references: [companies.id],
    }),
  }),
);

export const chCompaniesRelations = relations(chCompanies, ({ many }) => ({
  filings: many(chFilings),
}));

// No foreign key: a filing may be stored before its profile.
export const chFilingsRelations = relations(chFilings, ({ one }) => ({
  chCompany: one(chCompanies, {
    fields: [chFilings.companyNumber],
    references: [chCompanies.companyNumber],
  }),
}));

export const formDFilingsRelations = relations(formDFilings, ({ one }) => ({
  source: one(sources, {
    fields: [formDFilings.sourceId],
    references: [sources.id],
  }),
  company: one(companies, {
    fields: [formDFilings.companyId],
    references: [companies.id],
  }),
}));

export const eventConfirmationsRelations = relations(
  eventConfirmations,
  ({ one }) => ({
    event: one(events, {
      fields: [eventConfirmations.eventId],
      references: [events.id],
    }),
  }),
);

export const companySectorsRelations = relations(companySectors, ({ one }) => ({
  company: one(companies, {
    fields: [companySectors.companyId],
    references: [companies.id],
  }),
}));
