import OpenAI from "openai";
import type {
  EmbeddingClient,
  EmbeddingRequest,
  EmbeddingResult,
} from "@/core/ports";

/** Embeddings surface the adapter needs. Tests inject a fake. */
export interface OpenAiEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
  usage?: { prompt_tokens: number; total_tokens?: number } | null;
}

export interface OpenAiEmbeddingSdk {
  embeddings: {
    create: (body: {
      model: string;
      input: string[];
      dimensions: number;
    }) => Promise<OpenAiEmbeddingResponse>;
  };
}

export interface OpenAiEmbeddingClientOptions {
  apiKey: string;
  model: string;
  client?: OpenAiEmbeddingSdk;
}

/** One slow call must not use up the ingest job. */
const EMBEDDING_TIMEOUT_MS = 60_000;

function sdkClient(sdk: OpenAI): OpenAiEmbeddingSdk {
  return {
    embeddings: {
      create: (body) => sdk.embeddings.create(body),
    },
  };
}

export function createOpenAiEmbeddingClient({
  apiKey,
  model,
  client,
}: OpenAiEmbeddingClientOptions): EmbeddingClient {
  const sdk =
    client ??
    sdkClient(
      new OpenAI({ apiKey, timeout: EMBEDDING_TIMEOUT_MS, maxRetries: 1 }),
    );

  return {
    async embed({
      inputs,
      dimensions,
    }: EmbeddingRequest): Promise<EmbeddingResult> {
      const response = await sdk.embeddings.create({
        model,
        input: inputs,
        dimensions,
      });

      if (!response.usage) {
        throw new Error("OpenAI response did not include token usage");
      }
      if (response.data.length !== inputs.length) {
        throw new Error(
          `OpenAI returned ${response.data.length} embeddings for ${inputs.length} inputs`,
        );
      }

      const vectors = [...response.data]
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
      for (const vector of vectors) {
        if (
          vector.length !== dimensions ||
          !vector.every((value) => Number.isFinite(value))
        ) {
          throw new Error(
            `OpenAI returned a vector that is not ${dimensions} numbers long`,
          );
        }
      }

      return {
        vectors,
        usage: { inputTokens: response.usage.prompt_tokens },
        model,
      };
    },
  };
}
