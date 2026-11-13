import { parseNoLlmPipelineEnv, type EnvSource } from "@/core/env";
import type { Clock, HttpFetcher } from "@/core/ports";
import { createPipelineDb } from "@/db/client";
import { buildUserAgent, createHttpFetcher } from "@/lib/http";
import { createBudgetGuard } from "./budget/budget-guard";
import { createRssCollector } from "./collect/rss";
import { createOpenAiEmbeddingClient } from "./embed/openai-embeddings";
import { createOpenAiClient } from "./extract/openai-client";
import { createEdgarClient, type EdgarClient } from "./filings/edgar-client";
import { createFrankfurterProvider } from "./fx/frankfurter";
import { createGtrClient } from "./grants/gtr-client";
import { dedicatedConnectionLock, type IngestLock } from "./lock";
import { createChClient } from "./registry/ch-client";
import { createWindowLimiter } from "./registry/rate-limit";
import type { PipelineDeps } from "./run";

/** Companies House allows 600 requests in 5 minutes; SignalFeed stays at 500 (D52). */
const CH_REQUESTS_PER_WINDOW = 500;
const CH_WINDOW_MS = 5 * 60 * 1000;

export interface Wired {
  deps: PipelineDeps;
  lock: IngestLock;
  close: () => Promise<void>;
}

/**
 * Builds the real implementations. A missing LLM key leaves `llm` and
 * `embedder` null rather than failing, so paid steps skip and the rest runs.
 * The same holds for Companies House without `COMPANIES_HOUSE_API_KEY`, and
 * for EDGAR when `HTTP_CONTACT` has no email address. Both registry clients
 * share the one `HttpFetcher`. Only the pipeline builds them; web code
 * cannot import this file.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * EDGAR needs an email address in the User-Agent. The client refuses a
 * contact without one, so `formd` can refuse with a clear message while
 * every other command still runs.
 */
function edgarClientOrNull(
  http: HttpFetcher,
  contact: string,
  clock: Clock,
): EdgarClient | null {
  try {
    return createEdgarClient({ http, contact, sleep, clock });
  } catch {
    return null;
  }
}

export function createPipelineDeps(env: EnvSource): Wired {
  const parsed = parseNoLlmPipelineEnv(env);
  const { db, close } = createPipelineDb(parsed.DATABASE_URL);
  const fetcher = createHttpFetcher({
    userAgent: buildUserAgent(parsed.HTTP_CONTACT),
  });
  const clock = { now: () => new Date() };
  const apiKey = parsed.OPENAI_API_KEY;
  const chKey = parsed.COMPANIES_HOUSE_API_KEY;

  return {
    deps: {
      db,
      collector: createRssCollector(fetcher),
      llm: apiKey
        ? createOpenAiClient({ apiKey, model: parsed.EXTRACTION_MODEL })
        : null,
      themeCheckLlm:
        apiKey && parsed.THEME_CHECK_MODEL !== parsed.EXTRACTION_MODEL
          ? createOpenAiClient({ apiKey, model: parsed.THEME_CHECK_MODEL })
          : null,
      embedder: apiKey
        ? createOpenAiEmbeddingClient({
            apiKey,
            model: parsed.EMBEDDING_MODEL,
          })
        : null,
      gtr: createGtrClient({ http: fetcher }),
      companiesHouse: chKey
        ? createChClient({
            http: fetcher,
            apiKey: chKey,
            limiter: createWindowLimiter({
              max: CH_REQUESTS_PER_WINDOW,
              windowMs: CH_WINDOW_MS,
              clock,
            }),
          })
        : null,
      edgar: edgarClientOrNull(fetcher, parsed.HTTP_CONTACT, clock),
      budget: createBudgetGuard({
        db,
        clock,
        capGbp: parsed.LLM_MONTHLY_CAP_GBP,
      }),
      fx: createFrankfurterProvider({ fetcher }),
      clock,
      config: {
        model: parsed.EXTRACTION_MODEL,
        themeCheckModel: parsed.THEME_CHECK_MODEL,
        maxExtractionsPerRun: parsed.MAX_EXTRACTIONS_PER_RUN,
        capGbp: parsed.LLM_MONTHLY_CAP_GBP,
        embeddingModel: parsed.EMBEDDING_MODEL,
        maxEmbeddingsPerRun: parsed.MAX_EMBEDDINGS_PER_RUN,
        maxThemeNamesPerRun: parsed.MAX_THEME_NAMES_PER_RUN,
        maxGrantTaggingsPerRun: parsed.MAX_GRANT_TAGGINGS_PER_RUN,
        maxChRequestsPerRun: parsed.MAX_CH_REQUESTS_PER_RUN,
        maxEdgarDaysPerRun: parsed.MAX_EDGAR_DAYS_PER_RUN,
        maxEdgarRequestsPerRun: parsed.MAX_EDGAR_REQUESTS_PER_RUN,
      },
      log: (message) => console.error(message),
    },
    lock: dedicatedConnectionLock(parsed.DATABASE_URL),
    close,
  };
}
