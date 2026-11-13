-- Phase 3 (docs/spec-phase3.md section 5): new tables and appended enum values only.
-- Enum values are appended with ALTER TYPE ... ADD VALUE, never by recreating a type.
-- ADD VALUE cannot run inside a transaction block before Postgres 12, and a value
-- added in a transaction cannot be used until it commits. The Drizzle migrator runs
-- in one transaction, so this migration never uses the values it appends. The CI
-- migrations job runs Postgres 17; PGlite applies it in the tests.
CREATE TYPE "public"."link_decided_by" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."registry_kind" AS ENUM('companies_house', 'sec_edgar');--> statement-breakpoint
CREATE TYPE "public"."registry_link_method" AS ENUM('grant_number', 'name_grant_postcode', 'name_filing', 'name_location', 'prefix_filing_location', 'form_d_round', 'manual');--> statement-breakpoint
CREATE TYPE "public"."registry_link_status" AS ENUM('linked', 'candidate', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."registry_search_outcome" AS ENUM('linked', 'candidates', 'none', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sector_source" AS ENUM('theme', 'sic');--> statement-breakpoint
ALTER TYPE "public"."alias_source" ADD VALUE 'registry';--> statement-breakpoint
ALTER TYPE "public"."founded_year_source" ADD VALUE 'sec_form_d';--> statement-breakpoint
ALTER TYPE "public"."llm_purpose" ADD VALUE 'document_reading';--> statement-breakpoint
ALTER TYPE "public"."location_source" ADD VALUE 'registered_office';--> statement-breakpoint
ALTER TYPE "public"."record_kind" ADD VALUE 'ch_allotment';--> statement-breakpoint
ALTER TYPE "public"."record_kind" ADD VALUE 'sec_form_d';--> statement-breakpoint
CREATE TABLE "ch_address_counts" (
	"postcode" text PRIMARY KEY NOT NULL,
	"active_companies" integer NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ch_address_counts_non_negative" CHECK ("ch_address_counts"."active_companies" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ch_companies" (
	"company_number" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"status_detail" text,
	"company_type" text NOT NULL,
	"incorporated_on" date NOT NULL,
	"ceased_on" date,
	"sic_codes" text[] DEFAULT '{}' NOT NULL,
	"office_postcode" text,
	"office_outcode" text,
	"office_locality" text,
	"previous_names" text[] DEFAULT '{}' NOT NULL,
	"accounts_type" text,
	"accounts_made_up_to" date,
	"has_insolvency_history" boolean DEFAULT false NOT NULL,
	"etag" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ch_filings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ch_filings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_number" text NOT NULL,
	"transaction_id" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"filed_on" date NOT NULL,
	"action_date" date,
	"capital" jsonb,
	"document_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ch_filings_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "company_sectors" (
	"company_id" integer NOT NULL,
	"sector" text NOT NULL,
	"source" "sector_source" NOT NULL,
	CONSTRAINT "company_sectors_company_id_sector_pk" PRIMARY KEY("company_id","sector")
);
--> statement-breakpoint
CREATE TABLE "edgar_index_days" (
	"day" date PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"form_d_found" integer DEFAULT 0 NOT NULL,
	"form_d_stored" integer DEFAULT 0 NOT NULL,
	"fund_skipped" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edgar_index_days_status" CHECK ("edgar_index_days"."status" IN ('done', 'missing')),
	CONSTRAINT "edgar_index_days_non_negative" CHECK ("edgar_index_days"."form_d_found" >= 0 AND "edgar_index_days"."form_d_stored" >= 0 AND "edgar_index_days"."fund_skipped" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_confirmations" (
	"event_id" integer NOT NULL,
	"record_kind" "record_kind" NOT NULL,
	"record_id" integer NOT NULL,
	"rule" text NOT NULL,
	"record_date" date NOT NULL,
	"confirms_amount" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_confirmations_event_id_record_kind_record_id_pk" PRIMARY KEY("event_id","record_kind","record_id")
);
--> statement-breakpoint
CREATE TABLE "form_d_filings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_d_filings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"accession_number" text NOT NULL,
	"cik" text NOT NULL,
	"issuer_name" text NOT NULL,
	"entity_type" text,
	"jurisdiction" text,
	"issuer_state" text,
	"issuer_city" text,
	"year_of_inc" smallint,
	"inc_over_five_years" boolean DEFAULT false NOT NULL,
	"industry_group" text,
	"is_amendment" boolean NOT NULL,
	"previous_accession_number" text,
	"date_of_first_sale" date,
	"first_sale_yet_to_occur" boolean DEFAULT false NOT NULL,
	"total_offering_usd_minor" bigint,
	"total_sold_usd_minor" bigint,
	"investor_count" integer,
	"securities" text[] DEFAULT '{}' NOT NULL,
	"exemptions" text[] DEFAULT '{}' NOT NULL,
	"filed_on" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" integer,
	"linked_at" timestamp with time zone,
	CONSTRAINT "form_d_filings_accession_number_unique" UNIQUE("accession_number"),
	CONSTRAINT "form_d_filings_amounts_non_negative" CHECK ("form_d_filings"."total_offering_usd_minor" >= 0 AND "form_d_filings"."total_sold_usd_minor" >= 0 AND "form_d_filings"."investor_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "registry_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registry_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"registry" "registry_kind" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_name" text NOT NULL,
	"status" "registry_link_status" NOT NULL,
	"method" "registry_link_method",
	"reason" text NOT NULL,
	"decided_by" "link_decided_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_links_company_registry_id_unique" UNIQUE("company_id","registry","registry_id"),
	CONSTRAINT "registry_links_linked_has_method" CHECK ("registry_links"."status" <> 'linked' OR "registry_links"."method" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "registry_searches" (
	"company_id" integer NOT NULL,
	"registry" "registry_kind" NOT NULL,
	"searched_at" timestamp with time zone NOT NULL,
	"outcome" "registry_search_outcome" NOT NULL,
	"input_fingerprint" text NOT NULL,
	CONSTRAINT "registry_searches_company_id_registry_pk" PRIMARY KEY("company_id","registry")
);
--> statement-breakpoint
ALTER TABLE "company_sectors" ADD CONSTRAINT "company_sectors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_confirmations" ADD CONSTRAINT "event_confirmations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_d_filings" ADD CONSTRAINT "form_d_filings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_d_filings" ADD CONSTRAINT "form_d_filings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_links" ADD CONSTRAINT "registry_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_searches" ADD CONSTRAINT "registry_searches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ch_companies_office_outcode_idx" ON "ch_companies" USING btree ("office_outcode");--> statement-breakpoint
CREATE INDEX "ch_filings_company_number_action_date_idx" ON "ch_filings" USING btree ("company_number","action_date");--> statement-breakpoint
CREATE INDEX "company_sectors_sector_idx" ON "company_sectors" USING btree ("sector");--> statement-breakpoint
CREATE INDEX "event_confirmations_record_kind_record_id_idx" ON "event_confirmations" USING btree ("record_kind","record_id");--> statement-breakpoint
CREATE INDEX "form_d_filings_cik_idx" ON "form_d_filings" USING btree ("cik");--> statement-breakpoint
CREATE INDEX "form_d_filings_filed_on_idx" ON "form_d_filings" USING btree ("filed_on");--> statement-breakpoint
CREATE INDEX "form_d_filings_company_id_idx" ON "form_d_filings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_links_one_linked_per_company_idx" ON "registry_links" USING btree ("company_id","registry") WHERE "registry_links"."status" = 'linked';--> statement-breakpoint
CREATE UNIQUE INDEX "registry_links_one_linked_per_number_idx" ON "registry_links" USING btree ("registry","registry_id") WHERE "registry_links"."status" = 'linked';--> statement-breakpoint
CREATE INDEX "registry_links_registry_status_idx" ON "registry_links" USING btree ("registry","status");