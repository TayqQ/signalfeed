import { parseNoLlmPipelineEnv, type EnvSource } from "@/core/env";
import { createPipelineDb } from "@/db/client";
import { buildUserAgent, createHttpFetcher } from "@/lib/http";
import { createBudgetGuard } from "./budget/budget-guard";
import { createRssCollector } from "./collect/rss";
import { createOpenAiEmbeddingClient } from "./embed/openai-embeddings";
import { createOpenAiClient } from "./extract/openai-client";
import { createFrankfurterProvider } from "./fx/frankfurter";
import { createGtrClient } from "./grants/gtr-client";
import { dedicatedConnectionLock, type IngestLock } from "./lock";
import type { PipelineDeps } from "./run";

export interface Wired {
  deps: PipelineDeps;
  lock: IngestLock;
  close: () => Promise<void>;
}

/**
 * Builds the real implementations. A missing LLM key leaves `llm` and
 * `embedder` null rather than failing, so paid steps skip and the rest runs.
 */
export function createPipelineDeps(env: EnvSource): Wired {
  const parsed = parseNoLlmPipelineEnv(env);
  const { db, close } = createPipelineDb(parsed.DATABASE_URL);
  const fetcher = createHttpFetcher({
    userAgent: buildUserAgent(parsed.HTTP_CONTACT),
  });
  const clock = { now: () => new Date() };
  const apiKey = parsed.OPENAI_API_KEY;

  return {
    deps: {
      db,
      collector: createRssCollector(fetcher),
      llm: apiKey
        ? createOpenAiClient({ apiKey, model: parsed.EXTRACTION_MODEL })
        : null,
      embedder: apiKey
        ? createOpenAiEmbeddingClient({
            apiKey,
            model: parsed.EMBEDDING_MODEL,
          })
        : null,
      gtr: createGtrClient({ http: fetcher }),
      budget: createBudgetGuard({
        db,
        clock,
        capGbp: parsed.LLM_MONTHLY_CAP_GBP,
      }),
      fx: createFrankfurterProvider({ fetcher }),
      clock,
      config: {
        model: parsed.EXTRACTION_MODEL,
        maxExtractionsPerRun: parsed.MAX_EXTRACTIONS_PER_RUN,
        capGbp: parsed.LLM_MONTHLY_CAP_GBP,
        embeddingModel: parsed.EMBEDDING_MODEL,
        maxEmbeddingsPerRun: parsed.MAX_EMBEDDINGS_PER_RUN,
        maxThemeNamesPerRun: parsed.MAX_THEME_NAMES_PER_RUN,
        maxGrantTaggingsPerRun: parsed.MAX_GRANT_TAGGINGS_PER_RUN,
      },
      log: (message) => console.error(message),
    },
    lock: dedicatedConnectionLock(parsed.DATABASE_URL),
    close,
  };
}
