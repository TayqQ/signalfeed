import { describe, expect, it } from "vitest";
import {
  EXTRACTION_SCHEMA_V1,
  extractionJsonSchema,
  type ExtractionV1,
} from "./extraction-schema";

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
