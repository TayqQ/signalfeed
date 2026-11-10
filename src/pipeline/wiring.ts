import { parseNoLlmPipelineEnv, type EnvSource } from "@/core/env";
import { createPipelineDb } from "@/db/client";
import { buildUserAgent, createHttpFetcher } from "@/lib/http";
import { createBudgetGuard } from "./budget/budget-guard";
import { createRssCollector } from "./collect/rss";
import { createOpenAiClient } from "./extract/openai-client";
import { createFrankfurterProvider } from "./fx/frankfurter";
import { dedicatedConnectionLock, type IngestLock } from "./lock";
import type { PipelineDeps } from "./run";

export interface Wired {
  deps: PipelineDeps;
  lock: IngestLock;
  close: () => Promise<void>;
}

/** Builds the real implementations. A missing LLM key leaves `llm` null rather than failing. */
export function createPipelineDeps(env: EnvSource): Wired {
  const parsed = parseNoLlmPipelineEnv(env);
  const { db, close } = createPipelineDb(parsed.DATABASE_URL);
  const fetcher = createHttpFetcher({
    userAgent: buildUserAgent(parsed.HTTP_CONTACT),
  });
  const clock = { now: () => new Date() };

  return {
    deps: {
      db,
      collector: createRssCollector(fetcher),
      llm: parsed.OPENAI_API_KEY
        ? createOpenAiClient({
            apiKey: parsed.OPENAI_API_KEY,
            model: parsed.EXTRACTION_MODEL,
          })
        : null,
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
      },
      log: (message) => console.error(message),
    },
    lock: dedicatedConnectionLock(parsed.DATABASE_URL),
    close,
  };
}
