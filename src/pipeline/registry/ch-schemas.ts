import { z } from "zod";

// Zod schemas for the Companies House responses SignalFeed reads (A34, A35,
// A37, A38). Unknown keys are ignored. Officer, PSC and charges data is never
// described here, so it can never be parsed or stored (D58).

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const chAddressSchema = z.object({
  postal_code: z.string().nullish(),
  locality: z.string().nullish(),
});

export const chSearchItemSchema = z.object({
  title: z.string(),
  company_number: z.string(),
  company_status: z.string().nullish(),
  company_type: z.string().nullish(),
  date_of_creation: date.nullish(),
  date_of_cessation: date.nullish(),
  address: chAddressSchema.nullish(),
});

export const chSearchResponseSchema = z.object({
  total_results: z.number().int().nonnegative().optional(),
  items: z.array(chSearchItemSchema).default([]),
});

export const chProfileSchema = z.object({
  company_name: z.string(),
  company_number: z.string(),
  company_status: z.string(),
  company_status_detail: z.string().nullish(),
  type: z.string(),
  date_of_creation: date,
  date_of_cessation: date.nullish(),
  sic_codes: z.array(z.string()).default([]),
  registered_office_address: chAddressSchema.nullish(),
  accounts: z
    .object({
      last_accounts: z
        .object({
          type: z.string().nullish(),
          period_end_on: date.nullish(),
          made_up_to: date.nullish(),
        })
        .nullish(),
    })
    .nullish(),
  previous_company_names: z.array(z.object({ name: z.string() })).default([]),
  has_insolvency_history: z.boolean().nullish(),
  links: z.object({ insolvency: z.string().optional() }).nullish(),
  etag: z.string().nullish(),
});

export const chFilingItemSchema = z.object({
  transaction_id: z.string(),
  type: z.string(),
  date,
  action_date: date.nullish(),
  description_values: z
    .object({
      capital: z
        .array(z.object({ currency: z.string(), figure: z.string() }))
        .nullish(),
    })
    .nullish(),
  links: z.object({ document_metadata: z.string().optional() }).nullish(),
});

export const chFilingHistorySchema = z.object({
  total_count: z.number().int().nonnegative().optional(),
  items: z.array(chFilingItemSchema).default([]),
});

export const chAdvancedSearchSchema = z.object({
  hits: z.number().int().nonnegative(),
});

export type ChSearchItem = z.infer<typeof chSearchItemSchema>;
export type ChProfile = z.infer<typeof chProfileSchema>;
export type ChFilingItem = z.infer<typeof chFilingItemSchema>;
