import { z } from "zod";
import type { FxRates } from "@/core/domain";
import type { FxProvider, HttpFetcher } from "@/core/ports";

export const DEFAULT_FRANKFURTER_ECB_BASE_URL =
  "https://api.frankfurter.dev/v2/providers/ecb";

const ECB_EARLIEST_DATE = "1999-01-04";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const frankfurterRateRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.literal("EUR"),
  quote: z.string().min(1),
  rate: z.number().finite().positive(),
});

const frankfurterRatesResponseSchema = z
  .array(frankfurterRateRowSchema)
  .min(1);

export interface FrankfurterProviderOptions {
  fetcher: HttpFetcher;
  baseUrl?: string;
  /** UTC calendar date (YYYY-MM-DD) used to reject future requests. Defaults to today. */
  todayUtc?: () => string;
}

function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertValidRateDate(date: string, todayUtc: () => string): void {
  if (!ISO_DATE.test(date)) {
    throw new Error(`Invalid FX rate date: expected YYYY-MM-DD, got ${date}`);
  }
  if (date < ECB_EARLIEST_DATE) {
    throw new Error(
      `FX rate date ${date} is before ECB data begins (${ECB_EARLIEST_DATE})`,
    );
  }
  if (date > todayUtc()) {
    throw new Error(`FX rate date ${date} is in the future`);
  }
}

function rowsToFxRates(rows: z.infer<typeof frankfurterRatesResponseSchema>): FxRates {
  const date = rows[0]!.date;
  for (const row of rows) {
    if (row.date !== date) {
      throw new Error(
        `Frankfurter returned multiple dates in one range: ${date} and ${row.date}`,
      );
    }
  }

  const perEur: Record<string, number> = { EUR: 1 };
  for (const row of rows) {
    if (row.quote === "EUR") {
      continue;
    }
    perEur[row.quote] = row.rate;
  }

  return { date, perEur };
}

export function createFrankfurterProvider(
  options: FrankfurterProviderOptions,
): FxProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_FRANKFURTER_ECB_BASE_URL).replace(
    /\/$/,
    "",
  );
  const todayUtc = options.todayUtc ?? utcTodayYmd;

  return {
    async getRates(date: string): Promise<FxRates> {
      assertValidRateDate(date, todayUtc);

      const url = `${baseUrl}/rates?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`;
      const response = await options.fetcher.get(url);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Frankfurter ECB rates request failed with HTTP ${response.status} for ${date}`,
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(response.body) as unknown;
      } catch {
        throw new Error(
          `Frankfurter ECB rates response for ${date} was not valid JSON`,
        );
      }

      const validated = frankfurterRatesResponseSchema.safeParse(parsedJson);
      if (!validated.success) {
        throw new Error(
          `Frankfurter ECB rates response for ${date} did not match the expected shape: ${validated.error.message}`,
        );
      }

      return rowsToFxRates(validated.data);
    },
  };
}
