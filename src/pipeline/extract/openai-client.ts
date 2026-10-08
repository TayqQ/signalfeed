import OpenAI from "openai";
import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmTokenUsage,
} from "@/core/ports";
import { extractionJsonSchema } from "@/core/extraction-schema";
import { ExtractionValidationError, type ValidationIssue } from "@/core/errors";

/** Chat Completions surface the adapter needs. Tests inject a fake. */
export interface OpenAiCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      refusal?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  } | null;
}

export interface OpenAiChatClient {
  chat: {
    completions: {
      create: (
        body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      ) => Promise<OpenAiCompletionResponse>;
    };
  };
}

export interface OpenAiClientOptions {
  apiKey: string;
  model: string;
  client?: OpenAiChatClient;
}

/**
 * Raised when the model spent tokens but the body was not a valid extraction.
 * `usage` is the consumed token count so the caller can still record the cost.
 */
export class OpenAiExtractionValidationError extends ExtractionValidationError {
  readonly usage: LlmTokenUsage;

  constructor(
    issues: readonly ValidationIssue[],
    usage: LlmTokenUsage,
    options?: ErrorOptions,
  ) {
    super(issues, options);
    this.usage = usage;
  }
}

function sdkClient(sdk: OpenAI): OpenAiChatClient {
  return {
    chat: {
      completions: {
        create: (body) => sdk.chat.completions.create(body),
      },
    },
  };
}

/** o-series and gpt-5 reasoning models reject `temperature`. */
function modelSupportsTemperature(model: string): boolean {
  return !/^(o\d|gpt-5)/i.test(model);
}

function issuesFromZod(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [...issue.path],
    message: issue.message,
  }));
}

export function createOpenAiClient({
  apiKey,
  model,
  client,
}: OpenAiClientOptions): LlmClient {
  const sdk = client ?? sdkClient(new OpenAI({ apiKey }));

  return {
    async complete<T>(
      request: LlmCompleteRequest<T>,
    ): Promise<LlmCompleteResult<T>> {
      const response = await sdk.chat.completions.create({
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        max_completion_tokens: request.maxOutputTokens,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: extractionJsonSchema(),
          },
        },
        ...(modelSupportsTemperature(model) ? { temperature: 0 } : {}),
      });

      if (!response.usage) {
        throw new Error("OpenAI response did not include token usage");
      }
      const usage: LlmTokenUsage = {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      };

      const content = response.choices[0]?.message.content;
      if (!content) {
        const refusal = response.choices[0]?.message.refusal;
        throw new OpenAiExtractionValidationError(
          [
            {
              path: [],
              message: refusal?.trim()
                ? `Model refused: ${refusal.trim()}`
                : "Model returned no JSON content",
            },
          ],
          usage,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(content) as unknown;
      } catch (error) {
        throw new OpenAiExtractionValidationError(
          [{ path: [], message: "Model output is not valid JSON" }],
          usage,
          { cause: error },
        );
      }

      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        throw new OpenAiExtractionValidationError(
          issuesFromZod(parsed.error),
          usage,
        );
      }

      return { data: parsed.data, usage, model };
    },
  };
}
