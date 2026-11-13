import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EXTRACTION_SCHEMA_V1 } from "./extraction-schema";
import { strictJsonSchema } from "./json-schema";

// `extractionJsonSchema()` output for V1, captured before Task 024 moved the
// strict-mode conversion here. Key order matters: the test compares strings.
const V1_JSON_SCHEMA_BEFORE_MOVE = {
  type: "object",
  properties: {
    isRelevant: {
      type: "boolean",
      description:
        "True if the item reports a completed funding round, acquisition or launch by a startup or scale-up",
    },
    events: {
      maxItems: 10,
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["funding_round", "acquisition", "launch"],
          },
          company: {
            type: "object",
            properties: {
              name: { type: "string" },
              websiteDomain: {
                description: "Only if the domain appears in the text",
                type: ["string", "null"],
              },
              description: {
                description: "At most 200 characters, facts only",
                type: ["string", "null"],
              },
              countryCode: {
                description: "ISO 3166-1 alpha-2 country code",
                type: ["string", "null"],
              },
              city: { type: ["string", "null"] },
              foundedYear: {
                anyOf: [
                  {
                    type: "integer",
                    minimum: -9007199254740991,
                    maximum: 9007199254740991,
                  },
                  { type: "null" },
                ],
              },
              tags: {
                maxItems: 5,
                type: "array",
                items: { type: "string" },
                description:
                  'Up to 5 short lowercase theme phrases, e.g. "ai agents", "climate fintech"',
              },
            },
            required: [
              "name",
              "websiteDomain",
              "description",
              "countryCode",
              "city",
              "foundedYear",
              "tags",
            ],
            additionalProperties: false,
          },
          announcedOn: {
            description: "YYYY-MM-DD if stated",
            type: ["string", "null"],
          },
          funding: {
            anyOf: [
              {
                type: "object",
                properties: {
                  roundType: {
                    type: "string",
                    enum: [
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
                  },
                  roundLabel: {
                    description: 'Raw round wording, e.g. "seed extension"',
                    type: ["string", "null"],
                  },
                  amountText: {
                    description:
                      'Verbatim amount, e.g. "$12.5M", "€3 million", "£750k"',
                    type: ["string", "null"],
                  },
                  currencyHint: {
                    description:
                      "ISO 4217 code if the text makes the currency clear",
                    type: ["string", "null"],
                  },
                  investors: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: {
                          type: "string",
                          description:
                            "Organisation name. Never an individual person",
                        },
                        kind: {
                          type: "string",
                          enum: [
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
                        },
                        isLead: { type: "boolean" },
                      },
                      required: ["name", "kind", "isLead"],
                      additionalProperties: false,
                    },
                    description: "Organisations only",
                  },
                  includesIndividualAngels: { type: "boolean" },
                },
                required: [
                  "roundType",
                  "roundLabel",
                  "amountText",
                  "currencyHint",
                  "investors",
                  "includesIndividualAngels",
                ],
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
          acquisition: {
            anyOf: [
              {
                type: "object",
                properties: {
                  acquirerName: { type: "string" },
                  acquirerDomain: { type: ["string", "null"] },
                  acquirerCountryCode: { type: ["string", "null"] },
                  priceText: {
                    description: "Verbatim price, if stated",
                    type: ["string", "null"],
                  },
                  currencyHint: { type: ["string", "null"] },
                },
                required: [
                  "acquirerName",
                  "acquirerDomain",
                  "acquirerCountryCode",
                  "priceText",
                  "currencyHint",
                ],
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
          launch: {
            anyOf: [
              {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: [
                      "product",
                      "show_hn",
                      "launch_hn",
                      "open_source",
                      "other",
                    ],
                  },
                  productName: { type: ["string", "null"] },
                  url: { type: ["string", "null"] },
                },
                required: ["kind", "productName", "url"],
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
        },
        required: [
          "type",
          "company",
          "announcedOn",
          "funding",
          "acquisition",
          "launch",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["isRelevant", "events"],
  additionalProperties: false,
};

describe("strictJsonSchema", () => {
  it("gives the V1 extraction schema byte for byte as before the move", () => {
    expect(JSON.stringify(strictJsonSchema(EXTRACTION_SCHEMA_V1))).toBe(
      JSON.stringify(V1_JSON_SCHEMA_BEFORE_MOVE),
    );
  });

  it("makes every property required and forbids extra keys at every level", () => {
    const schema = z.object({
      label: z.string(),
      note: z.string().optional(),
      parts: z.array(z.object({ id: z.number(), hint: z.string().nullable() })),
    });

    expect(strictJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        label: { type: "string" },
        note: { type: "string" },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              hint: { type: ["string", "null"] },
            },
            required: ["id", "hint"],
            additionalProperties: false,
          },
        },
      },
      required: ["label", "note", "parts"],
      additionalProperties: false,
    });
  });

  it("drops the $schema keyword and leaves non-object roots alone", () => {
    expect(strictJsonSchema(z.array(z.string()))).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("does not treat a property called type as a schema keyword", () => {
    const schema = z.strictObject({ type: z.literal("object") });
    const json = strictJsonSchema(schema);
    expect(json.required).toEqual(["type"]);
    expect(json.properties).toEqual({
      type: { type: "string", const: "object" },
    });
  });
});
