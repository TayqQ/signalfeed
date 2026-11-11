import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENT_EXTRACTION_SCHEMA,
  CURRENT_EXTRACTION_SCHEMA_NAME,
  EXTRACTION_SCHEMA_V1,
  EXTRACTION_SCHEMA_V2,
  extractionJsonSchema,
  upgradeExtraction,
  type ExtractionV1,
  type ExtractionV2,
} from "./extraction-schema";
import { strictJsonSchema } from "./json-schema";

const company = {
  name: "Acme Robotics",
  websiteDomain: "acme.ai",
  description: "Builds warehouse picking robots",
  countryCode: "GB",
  city: "London",
  foundedYear: 2021,
  tags: ["robotics", "logistics"],
};

const fundingExample: ExtractionV1 = {
  isRelevant: true,
  events: [
    {
      type: "funding_round",
      company,
      announcedOn: "2026-10-01",
      funding: {
        roundType: "seed",
        roundLabel: "seed",
        amountText: "£4.5M",
        currencyHint: "GBP",
        investors: [
          { name: "Example Ventures", kind: "vc", isLead: true },
          { name: "Sample Capital", kind: "vc", isLead: false },
        ],
        includesIndividualAngels: true,
      },
      acquisition: null,
      launch: null,
    },
  ],
};

const acquisitionExample: ExtractionV1 = {
  isRelevant: true,
  events: [
    {
      type: "acquisition",
      company: { ...company, websiteDomain: null, foundedYear: null, tags: [] },
      announcedOn: null,
      funding: null,
      acquisition: {
        acquirerName: "Bigco",
        acquirerDomain: null,
        acquirerCountryCode: "US",
        priceText: null,
        currencyHint: null,
      },
      launch: null,
    },
  ],
};

const irrelevantExample: ExtractionV1 = { isRelevant: false, events: [] };

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectObjectSchemas(
  node: unknown,
  found: JsonObject[] = [],
): JsonObject[] {
  if (Array.isArray(node)) {
    for (const child of node) collectObjectSchemas(child, found);
  } else if (isJsonObject(node)) {
    if (node.type === "object") found.push(node);
    for (const child of Object.values(node)) collectObjectSchemas(child, found);
  }
  return found;
}

describe("EXTRACTION_SCHEMA_V1", () => {
  it.each([
    ["funding", fundingExample],
    ["acquisition", acquisitionExample],
    ["irrelevant", irrelevantExample],
  ])("parses a valid %s example", (_name, example) => {
    expect(EXTRACTION_SCHEMA_V1.parse(example)).toEqual(example);
  });

  it("rejects a missing top-level property", () => {
    expect(EXTRACTION_SCHEMA_V1.safeParse({ isRelevant: false }).success).toBe(
      false,
    );
  });

  it("rejects a missing nested property instead of treating it as null", () => {
    const companyWithoutCity: Record<string, unknown> = { ...company };
    delete companyWithoutCity.city;
    const input = {
      ...fundingExample,
      events: [{ ...fundingExample.events[0], company: companyWithoutCity }],
    };
    expect(EXTRACTION_SCHEMA_V1.safeParse(input).success).toBe(false);
  });

  it("rejects an extra top-level property", () => {
    const input = { ...irrelevantExample, confidence: 0.9 };
    expect(EXTRACTION_SCHEMA_V1.safeParse(input).success).toBe(false);
  });

  it("rejects an extra nested property", () => {
    const input = {
      ...fundingExample,
      events: [
        {
          ...fundingExample.events[0],
          company: { ...company, founderName: "x" },
        },
      ],
    };
    expect(EXTRACTION_SCHEMA_V1.safeParse(input).success).toBe(false);
  });

  it("allows at most 10 events and 5 tags", () => {
    const event = fundingExample.events[0]!;
    expect(
      EXTRACTION_SCHEMA_V1.safeParse({
        isRelevant: true,
        events: Array(10).fill(event),
      }).success,
    ).toBe(true);
    expect(
      EXTRACTION_SCHEMA_V1.safeParse({
        isRelevant: true,
        events: Array(11).fill(event),
      }).success,
    ).toBe(false);

    const sixTags = {
      ...event,
      company: { ...company, tags: ["a", "b", "c", "d", "e", "f"] },
    };
    expect(
      EXTRACTION_SCHEMA_V1.safeParse({ isRelevant: true, events: [sixTags] })
        .success,
    ).toBe(false);
  });

  it("rejects values outside the enums", () => {
    const event = fundingExample.events[0]!;
    const input = {
      isRelevant: true,
      events: [
        { ...event, funding: { ...event.funding!, roundType: "series_z" } },
      ],
    };
    expect(EXTRACTION_SCHEMA_V1.safeParse(input).success).toBe(false);
  });
});

describe("extractionJsonSchema", () => {
  const schema = extractionJsonSchema();
  const objects = collectObjectSchemas(schema);

  it("has a root object schema without a $schema keyword", () => {
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("$schema");
  });

  it("covers every nested object", () => {
    // root, event, company, funding, investor, acquisition, launch
    expect(objects).toHaveLength(7);
  });

  it("sets additionalProperties: false on every object", () => {
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
    }
  });

  it("lists every property in required", () => {
    for (const object of objects) {
      const properties = object.properties as JsonObject;
      expect(Object.keys(properties).length).toBeGreaterThan(0);
      expect([...(object.required as string[])].sort()).toEqual(
        Object.keys(properties).sort(),
      );
    }
  });

  it("keeps the array limits", () => {
    const events = (schema.properties as JsonObject).events as JsonObject;
    expect(events.maxItems).toBe(10);
    const company = (((events.items as JsonObject).properties as JsonObject)
      .company ?? {}) as JsonObject;
    expect(
      ((company.properties as JsonObject).tags as JsonObject).maxItems,
    ).toBe(5);
  });
});

const companyV2 = { ...company, regionText: "Scotland" };

const fundingExampleV2: ExtractionV2 = {
  isRelevant: true,
  events: [{ ...fundingExample.events[0]!, company: companyV2 }],
};

// Code written against V1 must keep compiling when handed a V2 result.
const readAsV1: ExtractionV1 = fundingExampleV2;

describe("EXTRACTION_SCHEMA_V2", () => {
  it("is the current schema, under its own name", () => {
    expect(CURRENT_EXTRACTION_SCHEMA).toBe(EXTRACTION_SCHEMA_V2);
    expect(CURRENT_EXTRACTION_SCHEMA_NAME).toBe("extraction_v2");
  });

  it("parses a full V2 object", () => {
    expect(EXTRACTION_SCHEMA_V2.parse(fundingExampleV2)).toEqual(
      fundingExampleV2,
    );
    expect(readAsV1.events[0]?.company.city).toBe("London");
  });

  it("accepts a null regionText", () => {
    const input = {
      ...fundingExampleV2,
      events: [
        {
          ...fundingExampleV2.events[0],
          company: { ...companyV2, regionText: null },
        },
      ],
    };
    expect(EXTRACTION_SCHEMA_V2.safeParse(input).success).toBe(true);
  });

  it("rejects a missing regionText", () => {
    expect(EXTRACTION_SCHEMA_V2.safeParse(fundingExample).success).toBe(false);
  });

  it("rejects extra keys at the top level and in the company", () => {
    expect(
      EXTRACTION_SCHEMA_V2.safeParse({ ...fundingExampleV2, confidence: 1 })
        .success,
    ).toBe(false);
    const input = {
      ...fundingExampleV2,
      events: [
        {
          ...fundingExampleV2.events[0],
          company: { ...companyV2, county: "Fife" },
        },
      ],
    };
    expect(EXTRACTION_SCHEMA_V2.safeParse(input).success).toBe(false);
  });

  it("leaves V1 rejecting regionText, so stored V1 rows stay V1", () => {
    expect(EXTRACTION_SCHEMA_V1.safeParse(fundingExampleV2).success).toBe(
      false,
    );
  });

  it("has the V1 JSON schema plus regionText in the company, and nothing else", () => {
    const v1 = strictJsonSchema(EXTRACTION_SCHEMA_V1);
    const v2 = extractionJsonSchema();
    expect(v2).toEqual(strictJsonSchema(EXTRACTION_SCHEMA_V2));

    const companyOf = (schema: Record<string, unknown>): JsonObject =>
      (
        ((schema.properties as JsonObject).events as JsonObject)
          .items as JsonObject
      ).properties as JsonObject;
    const v2Company = companyOf(v2).company as JsonObject;
    const v2Properties = v2Company.properties as JsonObject;
    expect(v2Properties.regionText).toMatchObject({
      type: ["string", "null"],
    });
    expect(v2Company.required).toContain("regionText");

    const strippedV2 = structuredClone(v2);
    const strippedCompany = companyOf(strippedV2).company as JsonObject;
    strippedCompany.properties = Object.fromEntries(
      Object.entries(v2Properties).filter(([key]) => key !== "regionText"),
    );
    strippedCompany.required = (strippedCompany.required as string[]).filter(
      (key) => key !== "regionText",
    );
    expect(strippedV2).toEqual(v1);
  });
});

describe("upgradeExtraction", () => {
  it("adds a null regionText to a V1 result", () => {
    const upgraded = upgradeExtraction(fundingExample);
    expect(upgraded.events[0]?.company.regionText).toBeNull();
    expect(EXTRACTION_SCHEMA_V2.parse(upgraded)).toEqual(upgraded);
    expect(upgraded.events[0]?.funding).toEqual(
      fundingExample.events[0]?.funding,
    );
  });

  it("keeps a V2 result as it is", () => {
    expect(upgradeExtraction(fundingExampleV2)).toEqual(fundingExampleV2);
  });

  it("does not change its input", () => {
    const before = structuredClone(fundingExample);
    upgradeExtraction(fundingExample);
    expect(fundingExample).toEqual(before);
  });

  it("turns every committed V1 recording into a valid V2 object", () => {
    const dir = "fixtures/extraction/recorded";
    const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    let upgradedResults = 0;
    for (const name of files) {
      const recording = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
        cases: Array<{ result: unknown }>;
      };
      for (const entry of recording.cases) {
        if (entry.result === null) continue;
        const v1 = EXTRACTION_SCHEMA_V1.safeParse(entry.result);
        if (!v1.success) continue; // Already V2.
        const upgraded = EXTRACTION_SCHEMA_V2.parse(upgradeExtraction(v1.data));
        for (const event of upgraded.events) {
          expect(event.company.regionText).toBeNull();
        }
        upgradedResults += 1;
      }
    }
    expect(upgradedResults).toBeGreaterThan(0);
  });
});
