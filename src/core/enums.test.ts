import { describe, expect, it } from "vitest";
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
  LLM_PURPOSES,
  LOCATION_PRECISIONS,
  LOCATION_SOURCES,
  MERGE_CANDIDATE_STATUSES,
  MERGE_ENTITIES,
  RECORD_KINDS,
  ROUND_TYPES,
  SOURCE_ITEM_STATUSES,
  SOURCE_KINDS,
  THEME_ASSIGNED_BY,
  THEME_NAME_SOURCES,
  THEME_STATUSES,
} from "./enums";

// Postgres enums are built from these arrays, so Phase 1 values must stay
// first and in their original order. These lists are copied, not imported.
const PHASE_1: [string, readonly string[], readonly string[]][] = [
  [
    "SOURCE_KINDS",
    SOURCE_KINDS,
    [
      "rss",
      "hn_algolia",
      "yc_directory",
      "github",
      "companies_house",
      "sec_edgar",
    ],
  ],
  [
    "SOURCE_ITEM_STATUSES",
    SOURCE_ITEM_STATUSES,
    ["pending", "filtered_out", "extracted", "failed"],
  ],
  ["EVENT_TYPES", EVENT_TYPES, ["funding_round", "acquisition", "launch"]],
  [
    "ROUND_TYPES",
    ROUND_TYPES,
    [
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
    ],
  ],
  [
    "INVESTOR_KINDS",
    INVESTOR_KINDS,
    [
      "vc",
      "corporate",
      "accelerator",
      "angel_network",
      "government",
      "private_equity",
      "family_office",
      "other",
      "unknown",
    ],
  ],
  ["INVESTOR_ROLES", INVESTOR_ROLES, ["lead", "participant", "unknown"]],
  [
    "LAUNCH_KINDS",
    LAUNCH_KINDS,
    ["product", "show_hn", "launch_hn", "open_source", "other"],
  ],
  ["EVIDENCE_LEVELS", EVIDENCE_LEVELS, ["reported", "confirmed"]],
  ["DATE_PRECISIONS", DATE_PRECISIONS, ["day", "month", "year"]],
  [
    "COMPANY_STATUSES",
    COMPANY_STATUSES,
    ["active", "acquired", "closed", "unknown"],
  ],
  [
    "FOUNDED_YEAR_SOURCES",
    FOUNDED_YEAR_SOURCES,
    ["news", "companies_house", "yc", "manual"],
  ],
  ["LLM_PURPOSES", LLM_PURPOSES, ["extraction", "embedding", "eval"]],
  ["INGEST_TRIGGERS", INGEST_TRIGGERS, ["schedule", "manual"]],
  [
    "INGEST_STATUSES",
    INGEST_STATUSES,
    ["running", "succeeded", "failed", "budget_paused"],
  ],
  ["MERGE_ENTITIES", MERGE_ENTITIES, ["company", "investor"]],
  [
    "MERGE_CANDIDATE_STATUSES",
    MERGE_CANDIDATE_STATUSES,
    ["open", "merged", "dismissed"],
  ],
  ["ALIAS_SOURCES", ALIAS_SOURCES, ["extraction", "manual", "merge"]],
];

describe("enums", () => {
  it.each(PHASE_1)(
    "%s keeps its Phase 1 values first, in order",
    (_name, actual, phase1) => {
      expect(actual.slice(0, phase1.length)).toEqual(phase1);
    },
  );

  it("appends the Phase 2 values after the Phase 1 ones", () => {
    expect(SOURCE_KINDS.slice(6)).toEqual(["ukri_gtr"]);
    expect(LLM_PURPOSES.slice(3)).toEqual(["theme_naming", "tagging"]);
    expect(ALIAS_SOURCES.slice(3)).toEqual(["grant"]);
  });

  it("adds the new Phase 2 enums", () => {
    expect(THEME_STATUSES).toEqual(["active", "merged"]);
    expect(THEME_NAME_SOURCES).toEqual(["tag", "llm", "manual"]);
    expect(THEME_ASSIGNED_BY).toEqual(["auto", "manual"]);
    expect(LOCATION_PRECISIONS).toEqual(["outcode", "town", "region"]);
    expect(LOCATION_SOURCES).toEqual([
      "grant_postcode",
      "news_city",
      "news_region",
    ]);
    expect(GRANT_ROLES).toEqual(["lead", "participant"]);
    expect(RECORD_KINDS).toEqual(["ukri_grant"]);
  });

  it("has no duplicate values in any enum", () => {
    for (const [name, values] of [
      ...PHASE_1.map(([n, v]) => [n, v] as const),
      ["THEME_STATUSES", THEME_STATUSES],
      ["THEME_NAME_SOURCES", THEME_NAME_SOURCES],
      ["THEME_ASSIGNED_BY", THEME_ASSIGNED_BY],
      ["LOCATION_PRECISIONS", LOCATION_PRECISIONS],
      ["LOCATION_SOURCES", LOCATION_SOURCES],
      ["GRANT_ROLES", GRANT_ROLES],
      ["RECORD_KINDS", RECORD_KINDS],
    ] as const) {
      expect(new Set(values).size, name).toBe(values.length);
    }
  });
});
