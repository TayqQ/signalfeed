import { describe, expect, it } from "vitest";
import {
  EXTRACTION_SCHEMA_NAME,
  EXTRACTION_SCHEMA_V1,
  extractionJsonSchema,
} from "@/core/extraction-schema";
import { ExtractionValidationError } from "@/core/errors";
import type { LlmCompleteRequest } from "@/core/ports";
import {
  OpenAiExtractionValidationError,
  createOpenAiClient,
  type OpenAiChatClient,
  type OpenAiCompletionResponse,
} from "./openai-client";

const request: LlmCompleteRequest<unknown> = {
  system: "system rules",
  user: "headline",
  schema: EXTRACTION_SCHEMA_V1,
  schemaName: EXTRACTION_SCHEMA_NAME,
  maxOutputTokens: 1200,
};

function fakeClient(
  response: OpenAiCompletionResponse,
  onCreate?: (
    body: Parameters<OpenAiChatClient["chat"]["completions"]["create"]>[0],
  ) => void,
): OpenAiChatClient {
  return {
    chat: {
      completions: {
        create(body) {
          onCreate?.(body);
          return Promise.resolve(response);
        },
      },
    },
  };
}

function completion(
  content: string | null,
  usage: { prompt_tokens: number; completion_tokens: number } | null = {
    prompt_tokens: 11,
    completion_tokens: 7,
  },
): OpenAiCompletionResponse {
  return {
    choices: [{ message: { content, refusal: null } }],
    usage,
  };
}

describe("createOpenAiClient", () => {
  it("requests strict extraction JSON at temperature 0 and returns usage", async () => {
    let body:
      Parameters<OpenAiChatClient["chat"]["completions"]["create"]>[0] | null =
      null;
    const client = createOpenAiClient({
      apiKey: "sk-test",
      model: "gpt-4.1-nano",
      client: fakeClient(
        completion(JSON.stringify({ isRelevant: false, events: [] })),
        (sent) => {
          body = sent;
        },
      ),
    });

    const result = await client.complete(request);

    expect(result).toEqual({
      data: { isRelevant: false, events: [] },
      usage: { inputTokens: 11, outputTokens: 7 },
      model: "gpt-4.1-nano",
    });
    expect(body).toEqual({
      model: "gpt-4.1-nano",
      messages: [
        { role: "system", content: "system rules" },
        { role: "user", content: "headline" },
      ],
      max_completion_tokens: 1200,
      stream: false,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: EXTRACTION_SCHEMA_NAME,
          strict: true,
          schema: extractionJsonSchema(),
        },
      },
    });
  });

  it("omits temperature for reasoning models that reject it", async () => {
    let body:
      Parameters<OpenAiChatClient["chat"]["completions"]["create"]>[0] | null =
      null;
    const client = createOpenAiClient({
      apiKey: "sk-test",
      model: "o4-mini",
      client: fakeClient(
        completion(JSON.stringify({ isRelevant: false, events: [] })),
        (sent) => {
          body = sent;
        },
      ),
    });

    await client.complete(request);
    expect(body).not.toHaveProperty("temperature");
  });

  it("throws ExtractionValidationError for invalid JSON and keeps the usage", async () => {
    const client = createOpenAiClient({
      apiKey: "sk-test",
      model: "gpt-4.1-nano",
      client: fakeClient(completion("not-json")),
    });

    const error = await client.complete(request).then(
      () => {
        throw new Error("Expected validation to fail");
      },
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ExtractionValidationError);
    expect(error).toBeInstanceOf(OpenAiExtractionValidationError);
    expect((error as OpenAiExtractionValidationError).usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
    });
  });

  it("throws ExtractionValidationError when JSON does not match the schema", async () => {
    const client = createOpenAiClient({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      client: fakeClient(completion(JSON.stringify({ isRelevant: false }))),
    });

    await expect(client.complete(request)).rejects.toBeInstanceOf(
      ExtractionValidationError,
    );
  });

  it("does not call the network when a fake client is injected", async () => {
    const client = createOpenAiClient({
      apiKey: "sk-test",
      model: "gpt-4.1-nano",
      client: fakeClient(
        completion(JSON.stringify({ isRelevant: false, events: [] })),
      ),
    });

    await expect(client.complete(request)).resolves.toMatchObject({
      data: { isRelevant: false, events: [] },
    });
    expect(() => fetch("https://api.openai.com/v1/chat/completions")).toThrow(
      /Network access is disabled/,
    );
  });
});
