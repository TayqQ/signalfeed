import { z } from "zod";
import {
  EVENT_TYPES,
  INVESTOR_KINDS,
  LAUNCH_KINDS,
  ROUND_TYPES,
} from "./enums";

// OpenAI strict structured outputs: every property is required, unknown values
// are null rather than omitted, and objects allow no extra keys. Values are kept
// as the text states them; code parses and validates them afterwards.

export const EXTRACTION_SCHEMA_NAME = "extraction_v1";

const companySchema = z.strictObject({
  name: z.string(),
  websiteDomain: z
    .string()
    .nullable()
    .describe("Only if the domain appears in the text"),
  description: z
    .string()
    .nullable()
    .describe("At most 200 characters, facts only"),
  countryCode: z
    .string()
    .nullable()
    .describe("ISO 3166-1 alpha-2 country code"),
  city: z.string().nullable(),
  foundedYear: z.number().int().nullable(),
  tags: z
    .array(z.string())
    .max(5)
    .describe(
      'Up to 5 short lowercase theme phrases, e.g. "ai agents", "climate fintech"',
    ),
});

const investorSchema = z.strictObject({
  name: z.string().describe("Organisation name. Never an individual person"),
  kind: z.enum(INVESTOR_KINDS),
  isLead: z.boolean(),
});

const fundingSchema = z.strictObject({
  roundType: z.enum(ROUND_TYPES),
  roundLabel: z
    .string()
    .nullable()
    .describe('Raw round wording, e.g. "seed extension"'),
  amountText: z
    .string()
    .nullable()
    .describe('Verbatim amount, e.g. "$12.5M", "€3 million", "£750k"'),
  currencyHint: z
    .string()
    .nullable()
    .describe("ISO 4217 code if the text makes the currency clear"),
  investors: z.array(investorSchema).describe("Organisations only"),
  includesIndividualAngels: z.boolean(),
});

const acquisitionSchema = z.strictObject({
  acquirerName: z.string(),
  acquirerDomain: z.string().nullable(),
  acquirerCountryCode: z.string().nullable(),
  priceText: z.string().nullable().describe("Verbatim price, if stated"),
  currencyHint: z.string().nullable(),
});

const launchSchema = z.strictObject({
  kind: z.enum(LAUNCH_KINDS),
  productName: z.string().nullable(),
  url: z.string().nullable(),
});

const eventSchema = z.strictObject({
  type: z.enum(EVENT_TYPES),
  company: companySchema,
  announcedOn: z.string().nullable().describe("YYYY-MM-DD if stated"),
  funding: fundingSchema.nullable(),
  acquisition: acquisitionSchema.nullable(),
  launch: launchSchema.nullable(),
});

export const EXTRACTION_SCHEMA_V1 = z.strictObject({
  isRelevant: z
    .boolean()
    .describe(
      "True if the item reports a completed funding round, acquisition or launch by a startup or scale-up",
    ),
  events: z.array(eventSchema).max(10),
});

export type ExtractionV1 = z.infer<typeof EXTRACTION_SCHEMA_V1>;
export type ExtractedEventV1 = ExtractionV1["events"][number];

type JsonObject = { [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode);
  if (!isJsonObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if ((key === "properties" || key === "$defs") && isJsonObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, strictNode(child)]),
      );
    } else {
      out[key] = strictNode(value);
    }
  }

  if (out.type === "object") {
    const properties = isJsonObject(out.properties) ? out.properties : {};
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

/** JSON Schema for `EXTRACTION_SCHEMA_V1`, shaped for OpenAI strict mode. */
export function extractionJsonSchema(): Record<string, unknown> {
  return strictNode(z.toJSONSchema(EXTRACTION_SCHEMA_V1)) as Record<
    string,
    unknown
  >;
}
