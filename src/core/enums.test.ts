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
} from "./enums";

type EnumCase = [string, readonly string[], readonly string[]];

// Postgres enums are built from these arrays, so values may only be appended.
// These lists are copied, not imported: each one is the enum as it stood
// before Phase 3, and must stay first and in this order.
const BEFORE_PHASE_3: EnumCase[] = [
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
      "ukri_gtr",
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
  [
    "LLM_PURPOSES",
    LLM_PURPOSES,
    ["extraction", "embedding", "eval", "theme_naming", "tagging"],
  ],
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
  ["ALIAS_SOURCES", ALIAS_SOURCES, ["extraction", "manual", "merge", "grant"]],
  ["THEME_STATUSES", THEME_STATUSES, ["active", "merged"]],
  ["THEME_NAME_SOURCES", THEME_NAME_SOURCES, ["tag", "llm", "manual"]],
  ["THEME_ASSIGNED_BY", THEME_ASSIGNED_BY, ["auto", "manual"]],
  ["LOCATION_PRECISIONS", LOCATION_PRECISIONS, ["outcode", "town", "region"]],
  [
    "LOCATION_SOURCES",
    LOCATION_SOURCES,
    ["grant_postcode", "news_city", "news_region"],
  ],
  ["GRANT_ROLES", GRANT_ROLES, ["lead", "participant"]],
  ["RECORD_KINDS", RECORD_KINDS, ["ukri_grant"]],
];

// Phase 3 appends exactly these values (docs/spec-phase3.md section 5.1).
const PHASE_3_APPENDED: EnumCase[] = [
  ["RECORD_KINDS", RECORD_KINDS, ["ch_allotment", "sec_form_d"]],
  ["LOCATION_SOURCES", LOCATION_SOURCES, ["registered_office"]],
  ["ALIAS_SOURCES", ALIAS_SOURCES, ["registry"]],
  ["FOUNDED_YEAR_SOURCES", FOUNDED_YEAR_SOURCES, ["sec_form_d"]],
  ["LLM_PURPOSES", LLM_PURPOSES, ["document_reading"]],
];

const PHASE_3_NEW: EnumCase[] = [
  ["REGISTRY_KINDS", REGISTRY_KINDS, ["companies_house", "sec_edgar"]],
  [
    "REGISTRY_LINK_STATUSES",
    REGISTRY_LINK_STATUSES,
    ["linked", "candidate", "rejected"],
  ],
  [
    "REGISTRY_LINK_METHODS",
    REGISTRY_LINK_METHODS,
    [
      "grant_number",
      "name_grant_postcode",
      "name_filing",
      "name_location",
      "prefix_filing_location",
      "form_d_round",
      "manual",
    ],
  ],
  ["LINK_DECIDED_BY", LINK_DECIDED_BY, ["auto", "manual"]],
  [
    "REGISTRY_SEARCH_OUTCOMES",
    REGISTRY_SEARCH_OUTCOMES,
    ["linked", "candidates", "none", "skipped"],
  ],
  ["SECTOR_SOURCES", SECTOR_SOURCES, ["theme", "sic"]],
];

describe("enums", () => {
  it.each(BEFORE_PHASE_3)(
    "%s keeps its Phase 1 and Phase 2 values first, in order",
    (_name, actual, before) => {
      expect(actual.slice(0, before.length)).toEqual(before);
    },
  );

  it.each(PHASE_3_APPENDED)(
    "%s appends the Phase 3 values after the earlier ones",
    (name, actual, appended) => {
      const before = BEFORE_PHASE_3.find(([n]) => n === name)?.[2];
      expect(before, name).toBeDefined();
      expect(actual.slice(before?.length)).toEqual(appended);
    },
  );

  it("changes no other existing enum in Phase 3", () => {
    const appended = new Set(PHASE_3_APPENDED.map(([name]) => name));
    for (const [name, actual, before] of BEFORE_PHASE_3) {
      if (!appended.has(name)) expect(actual, name).toEqual(before);
    }
  });

  it.each(PHASE_3_NEW)("adds %s", (_name, actual, expected) => {
    expect(actual).toEqual(expected);
  });

  it("has no duplicate values in any enum", () => {
    for (const [name, values] of [...BEFORE_PHASE_3, ...PHASE_3_NEW]) {
      expect(new Set(values).size, name).toBe(values.length);
    }
  });
});
