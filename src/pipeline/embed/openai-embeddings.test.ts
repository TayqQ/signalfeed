import { describe, expect, it } from "vitest";
import {
  createOpenAiEmbeddingClient,
  type OpenAiEmbeddingResponse,
  type OpenAiEmbeddingSdk,
} from "./openai-embeddings";

type Body = Parameters<OpenAiEmbeddingSdk["embeddings"]["create"]>[0];

function fakeSdk(
  response: OpenAiEmbeddingResponse,
  onCreate?: (body: Body) => void,
): OpenAiEmbeddingSdk {
  return {
    embeddings: {
      create(body) {
        onCreate?.(body);
        return Promise.resolve(response);
      },
    },
  };
}

const vec = (n: number, value = 0.1) => new Array<number>(n).fill(value);

function client(
  response: OpenAiEmbeddingResponse,
  onCreate?: (b: Body) => void,
) {
  return createOpenAiEmbeddingClient({
    apiKey: "test",
    model: "text-embedding-3-small",
    client: fakeSdk(response, onCreate),
  });
}

describe("createOpenAiEmbeddingClient", () => {
  it("sends the model, inputs and dimensions, and returns usage", async () => {
    let sent: Body | undefined;
    const result = await client(
      {
        data: [
          { index: 1, embedding: vec(512, 0.2) },
          { index: 0, embedding: vec(512, 0.1) },
        ],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      },
      (body) => (sent = body),
    ).embed({ inputs: ["ai", "fintech"], dimensions: 512 });

    expect(sent).toEqual({
      model: "text-embedding-3-small",
      input: ["ai", "fintech"],
      dimensions: 512,
    });
    expect(result.usage).toEqual({ inputTokens: 7 });
    expect(result.model).toBe("text-embedding-3-small");
    expect(result.vectors[0]?.[0]).toBe(0.1);
    expect(result.vectors[1]?.[0]).toBe(0.2);
  });

  it("throws on a wrong vector length", async () => {
    await expect(
      client({
        data: [{ index: 0, embedding: vec(511) }],
        usage: { prompt_tokens: 1 },
      }).embed({ inputs: ["ai"], dimensions: 512 }),
    ).rejects.toThrow(/512/);
  });

  it("throws on a wrong vector count", async () => {
    await expect(
      client({
        data: [{ index: 0, embedding: vec(512) }],
        usage: { prompt_tokens: 1 },
      }).embed({ inputs: ["ai", "ml"], dimensions: 512 }),
    ).rejects.toThrow(/1 embeddings for 2 inputs/);
  });

  it("throws when usage is missing", async () => {
    await expect(
      client({ data: [{ index: 0, embedding: vec(512) }] }).embed({
        inputs: ["ai"],
        dimensions: 512,
      }),
    ).rejects.toThrow(/usage/);
  });
});
