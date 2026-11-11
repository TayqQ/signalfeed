import { z } from "zod";
import {
  EVENT_TYPES,
  INVESTOR_KINDS,
  LAUNCH_KINDS,
  ROUND_TYPES,
} from "./enums";
import { strictJsonSchema } from "./json-schema";

// OpenAI strict structured outputs: every property is required, unknown values
// are null rather than omitted, and objects allow no extra keys. Values are kept
// as the text states them; code parses and validates them afterwards.
//
// V1 stays as it was so stored results and old recordings still parse. V2 adds
// `company.regionText`. New calls use V2.

export const EXTRACTION_SCHEMA_NAME = "extraction_v1";
export const CURRENT_EXTRACTION_SCHEMA_NAME = "extraction_v2";

const companyFieldsBeforeRegion = {
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
};

const companyFieldsAfterRegion = {
  foundedYear: z.number().int().nullable(),
  tags: z
    .array(z.string())
    .max(5)
    .describe(
      'Up to 5 short lowercase theme phrases, e.g. "ai agents", "climate fintech"',
    ),
};

const companySchema = z.strictObject({
  ...companyFieldsBeforeRegion,
  ...companyFieldsAfterRegion,
});

const companySchemaV2 = z.strictObject({
  ...companyFieldsBeforeRegion,
  regionText: z
    .string()
    .nullable()
    .describe(
      'Region, nation or county the text states, copied as written, e.g. "Scotland", "Yorkshire", "Bavaria". Never derived from the city',
    ),
  ...companyFieldsAfterRegion,
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

function eventSchemaFor<Company extends z.ZodType>(company: Company) {
  return z.strictObject({
    type: z.enum(EVENT_TYPES),
    company,
    announcedOn: z.string().nullable().describe("YYYY-MM-DD if stated"),
    funding: fundingSchema.nullable(),
    acquisition: acquisitionSchema.nullable(),
    launch: launchSchema.nullable(),
  });
}

function extractionSchemaFor<Company extends z.ZodType>(company: Company) {
  return z.strictObject({
    isRelevant: z
      .boolean()
      .describe(
        "True if the item reports a completed funding round, acquisition or launch by a startup or scale-up",
      ),
    events: z.array(eventSchemaFor(company)).max(10),
  });
}

export const EXTRACTION_SCHEMA_V1 = extractionSchemaFor(companySchema);

export type ExtractionV1 = z.infer<typeof EXTRACTION_SCHEMA_V1>;
export type ExtractedEventV1 = ExtractionV1["events"][number];

export const EXTRACTION_SCHEMA_V2 = extractionSchemaFor(companySchemaV2);

export type ExtractionV2 = z.infer<typeof EXTRACTION_SCHEMA_V2>;
export type ExtractedEventV2 = ExtractionV2["events"][number];

/** The schema new extraction calls use. */
export const CURRENT_EXTRACTION_SCHEMA = EXTRACTION_SCHEMA_V2;

/** Reads a stored V1 or V2 result as V2. V1 had no region, so it is null. */
export function upgradeExtraction(
  value: ExtractionV1 | ExtractionV2,
): ExtractionV2 {
  return {
    ...value,
    events: value.events.map((event) => ({
      ...event,
      company: {
        ...event.company,
        regionText:
          "regionText" in event.company ? event.company.regionText : null,
      },
    })),
  };
}

/** JSON Schema for `CURRENT_EXTRACTION_SCHEMA`, shaped for OpenAI strict mode. */
export function extractionJsonSchema(): Record<string, unknown> {
  return strictJsonSchema(CURRENT_EXTRACTION_SCHEMA);
}
