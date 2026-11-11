import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CURRENT_EXTRACTION_SCHEMA,
  CURRENT_EXTRACTION_SCHEMA_NAME,
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
  schema: CURRENT_EXTRACTION_SCHEMA,
  schemaName: CURRENT_EXTRACTION_SCHEMA_NAME,
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
  // Before Task 024 the adapter always sent `extractionJsonSchema()` under the
  // request's name. The body below is that body; only the schema and its name
  // moved from V1 to V2.
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
          name: "extraction_v2",
          strict: true,
          schema: extractionJsonSchema(),
        },
      },
    });
  });

  it("sends the JSON schema of whatever schema it is given", async () => {
    let body:
      Parameters<OpenAiChatClient["chat"]["completions"]["create"]>[0] | null =
      null;
    const themeNames = z.strictObject({
      names: z.array(z.strictObject({ id: z.number(), name: z.string() })),
    });
    const client = createOpenAiClient({
      apiKey: "sk-test",
      model: "gpt-4.1-nano",
      client: fakeClient(
        completion(JSON.stringify({ names: [{ id: 1, name: "Heat pumps" }] })),
        (sent) => {
          body = sent;
        },
      ),
    });

    const result = await client.complete({
      system: "name the themes",
      user: "tags",
      schema: themeNames,
      schemaName: "theme_names_v1",
      maxOutputTokens: 300,
    });

    expect(result.data).toEqual({ names: [{ id: 1, name: "Heat pumps" }] });
    expect(body).toMatchObject({ max_completion_tokens: 300 });
    expect(
      (body as unknown as { response_format: unknown }).response_format,
    ).toEqual({
      type: "json_schema",
      json_schema: {
        name: "theme_names_v1",
        strict: true,
        schema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "number" },
                  name: { type: "string" },
                },
                required: ["id", "name"],
                additionalProperties: false,
              },
            },
          },
          required: ["names"],
          additionalProperties: false,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("isRelevant");
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
