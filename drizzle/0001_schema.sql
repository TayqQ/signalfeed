CREATE TYPE "public"."alias_source" AS ENUM('extraction', 'manual', 'merge');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'acquired', 'closed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."date_precision" AS ENUM('day', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('funding_round', 'acquisition', 'launch');--> statement-breakpoint
CREATE TYPE "public"."evidence_level" AS ENUM('reported', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."founded_year_source" AS ENUM('news', 'companies_house', 'yc', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'succeeded', 'failed', 'budget_paused');--> statement-breakpoint
CREATE TYPE "public"."ingest_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TYPE "public"."investor_kind" AS ENUM('vc', 'corporate', 'accelerator', 'angel_network', 'government', 'private_equity', 'family_office', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."investor_role" AS ENUM('lead', 'participant', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."launch_kind" AS ENUM('product', 'show_hn', 'launch_hn', 'open_source', 'other');--> statement-breakpoint
CREATE TYPE "public"."llm_purpose" AS ENUM('extraction', 'embedding', 'eval');--> statement-breakpoint
CREATE TYPE "public"."merge_candidate_status" AS ENUM('open', 'merged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."merge_entity" AS ENUM('company', 'investor');--> statement-breakpoint
CREATE TYPE "public"."round_type" AS ENUM('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'growth', 'debt', 'grant', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."source_item_status" AS ENUM('pending', 'filtered_out', 'extracted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'hn_algolia', 'yc_directory', 'github', 'companies_house', 'sec_edgar');--> statement-breakpoint
CREATE TABLE "acquisitions" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"acquirer_company_id" integer,
	"acquirer_name" text NOT NULL,
	"price_minor" bigint,
	"currency" char(3),
	"price_usd_minor" bigint,
	"price_gbp_minor" bigint,
	"fx_rate_date" date,
	CONSTRAINT "acquisitions_price_has_currency" CHECK (("acquisitions"."price_minor" IS NULL) = ("acquisitions"."currency" IS NULL)),
	CONSTRAINT "acquisitions_prices_non_negative" CHECK ("acquisitions"."price_minor" >= 0 AND "acquisitions"."price_usd_minor" >= 0 AND "acquisitions"."price_gbp_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"website_domain" text,
	"description" text,
	"country_code" char(2),
	"city" text,
	"founded_year" smallint,
	"founded_year_source" "founded_year_source",
	"status" "company_status" DEFAULT 'active' NOT NULL,
	"uk_company_number" text,
	"sec_cik" text,
	"yc_batch" text,
	"github_org" text,
	"embedding" vector(512),
	"embedding_model" text,
	"merged_into_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "companies_website_domain_unique" UNIQUE("website_domain"),
	CONSTRAINT "companies_uk_company_number_unique" UNIQUE("uk_company_number"),
	CONSTRAINT "companies_sec_cik_unique" UNIQUE("sec_cik"),
	CONSTRAINT "companies_description_length" CHECK (char_length("companies"."description") <= 200),
	CONSTRAINT "companies_not_merged_into_self" CHECK ("companies"."merged_into_id" <> "companies"."id")
);
--> statement-breakpoint
CREATE TABLE "company_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"alias" text NOT NULL,
	"normalised_alias" text NOT NULL,
	"source" "alias_source" NOT NULL,
	CONSTRAINT "company_aliases_company_id_normalised_alias_unique" UNIQUE("company_id","normalised_alias")
);
--> statement-breakpoint
CREATE TABLE "company_tags" (
	"company_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"source" text DEFAULT 'extraction' NOT NULL,
	"mention_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_tags_company_id_tag_id_pk" PRIMARY KEY("company_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "entity_merges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entity_merges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entity_type" "merge_entity" NOT NULL,
	"kept_id" integer NOT NULL,
	"merged_id" integer NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "event_investors" (
	"event_id" integer NOT NULL,
	"investor_id" integer NOT NULL,
	"role" "investor_role" DEFAULT 'unknown' NOT NULL,
	CONSTRAINT "event_investors_event_id_investor_id_pk" PRIMARY KEY("event_id","investor_id")
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"event_id" integer NOT NULL,
	"extraction_id" integer NOT NULL,
	"source_item_id" integer NOT NULL,
	"event_index" smallint NOT NULL,
	CONSTRAINT "event_sources_event_id_extraction_id_event_index_pk" PRIMARY KEY("event_id","extraction_id","event_index")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "event_type" NOT NULL,
	"company_id" integer NOT NULL,
	"announced_on" date NOT NULL,
	"date_precision" date_precision DEFAULT 'day' NOT NULL,
	"evidence" "evidence_level" DEFAULT 'reported' NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extractions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_item_id" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"result" jsonb NOT NULL,
	"is_relevant" boolean NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "extractions_item_prompt_model_unique" UNIQUE("source_item_id","prompt_version","model")
);
--> statement-breakpoint
CREATE TABLE "funding_rounds" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"round_type" "round_type" DEFAULT 'unknown' NOT NULL,
	"round_label" text,
	"amount_minor" bigint,
	"currency" char(3),
	"amount_usd_minor" bigint,
	"amount_gbp_minor" bigint,
	"fx_rate_date" date,
	"includes_individual_angels" boolean DEFAULT false NOT NULL,
	CONSTRAINT "funding_rounds_amount_has_currency" CHECK (("funding_rounds"."amount_minor" IS NULL) = ("funding_rounds"."currency" IS NULL)),
	CONSTRAINT "funding_rounds_amounts_non_negative" CHECK ("funding_rounds"."amount_minor" >= 0 AND "funding_rounds"."amount_usd_minor" >= 0 AND "funding_rounds"."amount_gbp_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"rate_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"per_eur" numeric(18, 8) NOT NULL,
	CONSTRAINT "fx_rates_rate_date_currency_pk" PRIMARY KEY("rate_date","currency")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" "ingest_trigger" NOT NULL,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "investor_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "investor_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"investor_id" integer NOT NULL,
	"alias" text NOT NULL,
	"normalised_alias" text NOT NULL,
	"source" "alias_source" NOT NULL,
	CONSTRAINT "investor_aliases_investor_id_normalised_alias_unique" UNIQUE("investor_id","normalised_alias")
);
--> statement-breakpoint
CREATE TABLE "investors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "investors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"kind" "investor_kind" DEFAULT 'unknown' NOT NULL,
	"country_code" char(2),
	"website_domain" text,
	"merged_into_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "investors_not_merged_into_self" CHECK ("investors"."merged_into_id" <> "investors"."id")
);
--> statement-breakpoint
CREATE TABLE "launch_metric_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "launch_metric_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"metric" text NOT NULL,
	"value" bigint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"kind" "launch_kind" NOT NULL,
	"product_name" text,
	"url" text,
	"external_ref" text
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "llm_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd_micros" bigint NOT NULL,
	"source_item_id" integer,
	"ingest_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "merge_candidates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "merge_candidates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entity_type" "merge_entity" NOT NULL,
	"left_id" integer NOT NULL,
	"right_id" integer NOT NULL,
	"score" real NOT NULL,
	"reason" text NOT NULL,
	"status" "merge_candidate_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "merge_candidates_entity_left_right_unique" UNIQUE("entity_type","left_id","right_id"),
	CONSTRAINT "merge_candidates_distinct_ids" CHECK ("merge_candidates"."left_id" <> "merge_candidates"."right_id")
);
--> statement-breakpoint
CREATE TABLE "source_item_texts" (
	"source_item_id" integer PRIMARY KEY NOT NULL,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "source_item_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "source_items_canonical_url_unique" UNIQUE("canonical_url"),
	CONSTRAINT "source_items_source_id_external_id_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"embedding" vector(512),
	"embedding_model" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_acquirer_company_id_companies_id_fk" FOREIGN KEY ("acquirer_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_merged_into_id_companies_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tags" ADD CONSTRAINT "company_tags_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tags" ADD CONSTRAINT "company_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_investors" ADD CONSTRAINT "event_investors_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_investors" ADD CONSTRAINT "event_investors_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_rounds" ADD CONSTRAINT "funding_rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_aliases" ADD CONSTRAINT "investor_aliases_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_merged_into_id_investors_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_metric_snapshots" ADD CONSTRAINT "launch_metric_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_texts" ADD CONSTRAINT "source_item_texts_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisitions_acquirer_company_id_idx" ON "acquisitions" USING btree ("acquirer_company_id");--> statement-breakpoint
CREATE INDEX "companies_normalised_name_trgm_idx" ON "companies" USING gin ("normalised_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "companies_normalised_name_idx" ON "companies" USING btree ("normalised_name");--> statement-breakpoint
CREATE INDEX "company_aliases_normalised_alias_trgm_idx" ON "company_aliases" USING gin ("normalised_alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "company_aliases_normalised_alias_idx" ON "company_aliases" USING btree ("normalised_alias");--> statement-breakpoint
CREATE INDEX "company_tags_tag_id_idx" ON "company_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "event_investors_investor_id_idx" ON "event_investors" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "event_sources_extraction_id_idx" ON "event_sources" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX "event_sources_source_item_id_idx" ON "event_sources" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "events_type_announced_on_idx" ON "events" USING btree ("type","announced_on");--> statement-breakpoint
CREATE INDEX "events_company_id_idx" ON "events" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_one_current_per_item_idx" ON "extractions" USING btree ("source_item_id") WHERE "extractions"."is_current";--> statement-breakpoint
CREATE INDEX "funding_rounds_round_type_idx" ON "funding_rounds" USING btree ("round_type");--> statement-breakpoint
CREATE INDEX "funding_rounds_amount_gbp_minor_idx" ON "funding_rounds" USING btree ("amount_gbp_minor");--> statement-breakpoint
CREATE INDEX "investor_aliases_normalised_alias_trgm_idx" ON "investor_aliases" USING gin ("normalised_alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "investor_aliases_normalised_alias_idx" ON "investor_aliases" USING btree ("normalised_alias");--> statement-breakpoint
CREATE INDEX "investors_normalised_name_trgm_idx" ON "investors" USING gin ("normalised_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "investors_normalised_name_idx" ON "investors" USING btree ("normalised_name");--> statement-breakpoint
CREATE INDEX "investors_website_domain_idx" ON "investors" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "launch_metric_snapshots_event_metric_observed_idx" ON "launch_metric_snapshots" USING btree ("event_id","metric","observed_at");--> statement-breakpoint
CREATE INDEX "llm_usage_occurred_at_idx" ON "llm_usage" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "merge_candidates_status_idx" ON "merge_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "source_items_status_fetched_at_idx" ON "source_items" USING btree ("status","fetched_at");