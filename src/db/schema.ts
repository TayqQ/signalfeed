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
  INGEST_STATUSES,
  INGEST_TRIGGERS,
  INVESTOR_KINDS,
  INVESTOR_ROLES,
  LAUNCH_KINDS,
  LLM_PURPOSES,
  MERGE_CANDIDATE_STATUSES,
  MERGE_ENTITIES,
  ROUND_TYPES,
  SOURCE_ITEM_STATUSES,
  SOURCE_KINDS,
} from "@/core/enums";
import type { ExtractionV1 } from "@/core/extraction-schema";

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
const embedding = () =>
  vector("embedding", { dimensions: EMBEDDING_DIMENSIONS });

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
    result: jsonb("result").$type<ExtractionV1>().notNull(),
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

// Relations

export const sourcesRelations = relations(sources, ({ many }) => ({
  items: many(sourceItems),
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

export const tagsRelations = relations(tags, ({ many }) => ({
  companies: many(companyTags),
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
  metricSnapshots: many(launchMetricSnapshots),
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
