import { z } from "zod";
import { EVENT_TYPES, ROUND_TYPES } from "./enums";

// Schema for `fixtures/extraction/cases.json`. Summaries are paraphrased in our
// own words, never copied publisher text.

export const EVAL_EXPECTED_EVENT_SCHEMA = z.strictObject({
  type: z.enum(EVENT_TYPES),
  companyName: z.string().min(1),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, "Expected an upper-case ISO 3166-1 alpha-2 code")
    .nullable(),
  roundType: z.enum(ROUND_TYPES).nullable(),
  /** Verbatim amount as it appears in the headline or summary. */
  amountText: z.string().nullable(),
  leadInvestors: z.array(z.string().min(1)),
  investors: z.array(z.string().min(1)),
  acquirerName: z.string().nullable(),
});
export type EvalExpectedEvent = z.infer<typeof EVAL_EXPECTED_EVENT_SCHEMA>;

export const EVAL_CASE_SCHEMA = z.strictObject({
  id: z.string().min(1),
  sourceSlug: z.string().min(1),
  url: z.url(),
  headline: z.string().min(1),
  summary: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  expected: z.strictObject({
    isRelevant: z.boolean(),
    events: z.array(EVAL_EXPECTED_EVENT_SCHEMA),
  }),
});
export type EvalCase = z.infer<typeof EVAL_CASE_SCHEMA>;

export const EVAL_CASES_SCHEMA = z
  .array(EVAL_CASE_SCHEMA)
  .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, {
    message: "Case ids must be unique",
  });
