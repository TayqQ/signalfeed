CREATE TYPE "public"."grant_role" AS ENUM('lead', 'participant');--> statement-breakpoint
CREATE TYPE "public"."location_precision" AS ENUM('outcode', 'town', 'region');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('grant_postcode', 'news_city', 'news_region');--> statement-breakpoint
CREATE TYPE "public"."record_kind" AS ENUM('ukri_grant');--> statement-breakpoint
CREATE TYPE "public"."theme_assigned_by" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."theme_name_source" AS ENUM('tag', 'llm', 'manual');--> statement-breakpoint
CREATE TYPE "public"."theme_status" AS ENUM('active', 'merged');--> statement-breakpoint
ALTER TYPE "public"."alias_source" ADD VALUE 'grant';--> statement-breakpoint
ALTER TYPE "public"."llm_purpose" ADD VALUE 'theme_naming';--> statement-breakpoint
ALTER TYPE "public"."llm_purpose" ADD VALUE 'tagging';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'ukri_gtr';--> statement-breakpoint
CREATE TABLE "company_locations" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"country_code" char(2) NOT NULL,
	"itl1_code" char(3),
	"place_slug" text,
	"outcode" text,
	"latitude" real,
	"longitude" real,
	"precision" "location_precision" NOT NULL,
	"source" "location_source" NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_locations_coordinates_paired" CHECK (("company_locations"."latitude" IS NULL) = ("company_locations"."longitude" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "company_themes" (
	"company_id" integer NOT NULL,
	"theme_id" integer NOT NULL,
	"tag_count" integer NOT NULL,
	CONSTRAINT "company_themes_company_id_theme_id_pk" PRIMARY KEY("company_id","theme_id"),
	CONSTRAINT "company_themes_tag_count_non_negative" CHECK ("company_themes"."tag_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "derived_rebuilds" (
	"name" text PRIMARY KEY NOT NULL,
	"input_fingerprint" text NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_record_sources" (
	"event_id" integer NOT NULL,
	"record_kind" "record_kind" NOT NULL,
	"record_id" integer NOT NULL,
	CONSTRAINT "event_record_sources_event_id_record_kind_record_id_pk" PRIMARY KEY("event_id","record_kind","record_id")
);
--> statement-breakpoint
CREATE TABLE "funding_round_momentum" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"equity_round_number" smallint NOT NULL,
	"previous_event_id" integer,
	"months_since_previous" smallint,
	"step_up_basis_event_id" integer,
	"step_up_ratio" real,
	"rounds_in_24m_to_date" smallint NOT NULL,
	CONSTRAINT "funding_round_momentum_non_negative" CHECK ("funding_round_momentum"."equity_round_number" >= 1 AND "funding_round_momentum"."months_since_previous" >= 0 AND "funding_round_momentum"."step_up_ratio" >= 0 AND "funding_round_momentum"."rounds_in_24m_to_date" >= 1)
);
--> statement-breakpoint
CREATE TABLE "grant_participants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "grant_participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"gtr_org_id" text NOT NULL,
	"organisation_name" text NOT NULL,
	"reg_number" text,
	"postcode" text,
	"outcode" text,
	"region_text" text,
	"role" "grant_role" NOT NULL,
	"grant_offer_minor" bigint,
	"project_cost_minor" bigint,
	"org_fetched_at" timestamp with time zone,
	"company_id" integer,
	"event_id" integer,
	"resolved_at" timestamp with time zone,
	"skipped_reason" text,
	CONSTRAINT "grant_participants_project_id_gtr_org_id_unique" UNIQUE("project_id","gtr_org_id"),
	CONSTRAINT "grant_participants_amounts_non_negative" CHECK ("grant_participants"."grant_offer_minor" >= 0 AND "grant_participants"."project_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "grant_project_texts" (
	"project_id" integer PRIMARY KEY NOT NULL,
	"abstract" text NOT NULL,
	CONSTRAINT "grant_project_texts_abstract_length" CHECK (char_length("grant_project_texts"."abstract") <= 1500)
);
--> statement-breakpoint
CREATE TABLE "grant_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "grant_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"gtr_project_id" text NOT NULL,
	"title" text NOT NULL,
	"grant_category" text NOT NULL,
	"lead_funder" text NOT NULL,
	"status" text NOT NULL,
	"start_on" date,
	"end_on" date,
	"gtr_url" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grant_projects_gtr_project_id_unique" UNIQUE("gtr_project_id")
);
--> statement-breakpoint
CREATE TABLE "grant_taggings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "grant_taggings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"tags" text[] NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grant_taggings_project_prompt_model_unique" UNIQUE("project_id","prompt_version","model"),
	CONSTRAINT "grant_taggings_usage_non_negative" CHECK ("grant_taggings"."input_tokens" >= 0 AND "grant_taggings"."output_tokens" >= 0 AND "grant_taggings"."cost_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tag_themes" (
	"tag_id" integer PRIMARY KEY NOT NULL,
	"theme_id" integer,
	"similarity" real,
	"assigned_by" "theme_assigned_by" NOT NULL,
	"embedding_model" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theme_weekly_stats" (
	"theme_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"rounds_with_amount" integer DEFAULT 0 NOT NULL,
	"total_gbp_minor" bigint DEFAULT 0 NOT NULL,
	"early_rounds" integer DEFAULT 0 NOT NULL,
	"later_rounds" integer DEFAULT 0 NOT NULL,
	"unknown_stage_rounds" integer DEFAULT 0 NOT NULL,
	"grants" integer DEFAULT 0 NOT NULL,
	"grant_gbp_minor" bigint DEFAULT 0 NOT NULL,
	"acquisitions" integer DEFAULT 0 NOT NULL,
	"launches" integer DEFAULT 0 NOT NULL,
	"companies" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "theme_weekly_stats_theme_id_week_start_pk" PRIMARY KEY("theme_id","week_start"),
	CONSTRAINT "theme_weekly_stats_week_start_monday" CHECK (extract(isodow from "theme_weekly_stats"."week_start") = 1),
	CONSTRAINT "theme_weekly_stats_non_negative" CHECK ("theme_weekly_stats"."rounds" >= 0 AND "theme_weekly_stats"."rounds_with_amount" >= 0 AND "theme_weekly_stats"."total_gbp_minor" >= 0 AND "theme_weekly_stats"."early_rounds" >= 0 AND "theme_weekly_stats"."later_rounds" >= 0 AND "theme_weekly_stats"."unknown_stage_rounds" >= 0 AND "theme_weekly_stats"."grants" >= 0 AND "theme_weekly_stats"."grant_gbp_minor" >= 0 AND "theme_weekly_stats"."acquisitions" >= 0 AND "theme_weekly_stats"."launches" >= 0 AND "theme_weekly_stats"."companies" >= 0)
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "themes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_source" "theme_name_source" DEFAULT 'tag' NOT NULL,
	"sector" text,
	"status" "theme_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" integer,
	"seed_tag_id" integer NOT NULL,
	"centroid" vector(512) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"named_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "themes_slug_unique" UNIQUE("slug"),
	CONSTRAINT "themes_not_merged_into_self" CHECK ("themes"."merged_into_id" <> "themes"."id"),
	CONSTRAINT "themes_merged_has_target" CHECK (("themes"."status" = 'merged') = ("themes"."merged_into_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "weekly_totals" (
	"week_start" date PRIMARY KEY NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"early_rounds" integer DEFAULT 0 NOT NULL,
	"grants" integer DEFAULT 0 NOT NULL,
	"acquisitions" integer DEFAULT 0 NOT NULL,
	"launches" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "weekly_totals_week_start_monday" CHECK (extract(isodow from "weekly_totals"."week_start") = 1),
	CONSTRAINT "weekly_totals_non_negative" CHECK ("weekly_totals"."rounds" >= 0 AND "weekly_totals"."early_rounds" >= 0 AND "weekly_totals"."grants" >= 0 AND "weekly_totals"."acquisitions" >= 0 AND "weekly_totals"."launches" >= 0)
);
--> statement-breakpoint
ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_themes" ADD CONSTRAINT "company_themes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_themes" ADD CONSTRAINT "company_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_record_sources" ADD CONSTRAINT "event_record_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_round_momentum" ADD CONSTRAINT "funding_round_momentum_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_round_momentum" ADD CONSTRAINT "funding_round_momentum_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_round_momentum" ADD CONSTRAINT "funding_round_momentum_previous_event_id_events_id_fk" FOREIGN KEY ("previous_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_round_momentum" ADD CONSTRAINT "funding_round_momentum_step_up_basis_event_id_events_id_fk" FOREIGN KEY ("step_up_basis_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_participants" ADD CONSTRAINT "grant_participants_project_id_grant_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."grant_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_participants" ADD CONSTRAINT "grant_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_participants" ADD CONSTRAINT "grant_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_project_texts" ADD CONSTRAINT "grant_project_texts_project_id_grant_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."grant_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_projects" ADD CONSTRAINT "grant_projects_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_taggings" ADD CONSTRAINT "grant_taggings_project_id_grant_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."grant_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_themes" ADD CONSTRAINT "tag_themes_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_themes" ADD CONSTRAINT "tag_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_weekly_stats" ADD CONSTRAINT "theme_weekly_stats_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_merged_into_id_themes_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_seed_tag_id_tags_id_fk" FOREIGN KEY ("seed_tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_locations_itl1_code_idx" ON "company_locations" USING btree ("itl1_code");--> statement-breakpoint
CREATE INDEX "company_locations_place_slug_idx" ON "company_locations" USING btree ("place_slug");--> statement-breakpoint
CREATE INDEX "company_locations_latitude_longitude_idx" ON "company_locations" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "company_themes_theme_id_idx" ON "company_themes" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "funding_round_momentum_company_id_idx" ON "funding_round_momentum" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "grant_participants_resolved_at_idx" ON "grant_participants" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "tag_themes_theme_id_idx" ON "tag_themes" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "theme_weekly_stats_week_start_idx" ON "theme_weekly_stats" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "themes_status_idx" ON "themes" USING btree ("status");