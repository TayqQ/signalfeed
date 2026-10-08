import { describe, expect, it } from "vitest";
import type { CostEstimate, UsageRecord } from "@/core/domain";
import { EXTRACTION_SCHEMA_NAME } from "@/core/extraction-schema";
import {
  BudgetExceededError,
  ExtractionValidationError,
  UnknownModelPriceError,
} from "@/core/errors";
import type {
  BudgetGuard,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
} from "@/core/ports";
import { extractItem } from "./extract-item";
import { createOpenAiClient } from "./openai-client";
import { costUsdMicros } from "./pricing";
import {
  EXTRACTION_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt";

const item = {
  title: "ExampleCo raises $4M seed",
  summary: "Example Ventures led the round.",
  url: "https://example.com/stories/exampleco",
  sourceName: "Example Wire",
  publishedAt: new Date("2026-10-01T00:00:00.000Z"),
};

const validExtraction = { isRelevant: false, events: [] };

function trackingBudget(order: string[]): {
  budget: BudgetGuard;
  estimates: CostEstimate[];
  records: UsageRecord[];
} {
  const estimates: CostEstimate[] = [];
  const records: UsageRecord[] = [];
  const budget: BudgetGuard = {
    assertCanSpend(estimate) {
      order.push("budget");
      estimates.push(estimate);
      return Promise.resolve();
    },
    record(usage) {
      order.push("record");
      records.push(usage);
      return Promise.resolve();
    },
    monthToDate() {
      return Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 0 });
    },
  };
  return { budget, estimates, records };
}

describe("extraction prompt", () => {
  it("is version v1, states the contract, and stays under about 900 tokens", () => {
    const system = buildSystemPrompt();
    expect(EXTRACTION_PROMPT_VERSION).toBe("v1");
    expect(system.length / 4).toBeLessThan(900);
    expect(system).toContain("verbatim");
    expect(system).toContain("includesIndividualAngels");
    expect(system).toContain("websiteDomain");
    expect(system).toContain("null");
    expect(system).toContain("lowercase");
    expect(system).toContain("ExampleCo");
    expect(system).toContain("Example Ventures");
    expect(system).not.toMatch(/\b(Acme|Stripe|Sequoia)\b/);
  });

  it("puts the item fields in the user prompt", () => {
    expect(buildUserPrompt(item)).toBe(
      [
        "Source: Example Wire",
        "Published: 2026-10-01T00:00:00.000Z",
        "URL: https://example.com/stories/exampleco",
        "Title: ExampleCo raises $4M seed",
        "Summary: Example Ventures led the round.",
      ].join("\n"),
    );
    expect(
      buildUserPrompt({ ...item, summary: "  ", publishedAt: null }),
    ).toContain("Summary: (none)");
  });
});

describe("extractItem", () => {
  it("asks the budget guard before the LLM and records usage after success", async () => {
    const order: string[] = [];
    const { budget, estimates, records } = trackingBudget(order);
    const seen: {
      request: {
        schemaName: string;
        maxOutputTokens: number;
        system: string;
        user: string;
      } | null;
    } = { request: null };
    const llm: LlmClient = {
      complete<T>(
        request: LlmCompleteRequest<T>,
      ): Promise<LlmCompleteResult<T>> {
        order.push("llm");
        seen.request = {
          schemaName: request.schemaName,
          maxOutputTokens: request.maxOutputTokens,
          system: request.system,
          user: request.user,
        };
        return Promise.resolve({
          data: validExtraction as T,
          usage: { inputTokens: 30, outputTokens: 8 },
          model: "gpt-4.1-nano",
        });
      },
    };

    const result = await extractItem({
      item,
      llm,
      budget,
      model: "gpt-4.1-nano",
    });

    expect(order).toEqual(["budget", "llm", "record"]);
    expect(estimates[0]?.maxOutputTokens).toBe(1200);
    expect(seen.request?.schemaName).toBe(EXTRACTION_SCHEMA_NAME);
    expect(seen.request?.maxOutputTokens).toBe(1200);
    expect(seen.request?.system).toBe(buildSystemPrompt());
    expect(seen.request?.user).toBe(buildUserPrompt(item));
    const expectedCost = costUsdMicros("gpt-4.1-nano", {
      inputTokens: 30,
      outputTokens: 8,
    });
    expect(records).toEqual([
      {
        purpose: "extraction",
        model: "gpt-4.1-nano",
        inputTokens: 30,
        outputTokens: 8,
        costUsdMicros: expectedCost,
      },
    ]);
    expect(result).toEqual({
      result: validExtraction,
      usage: { inputTokens: 30, outputTokens: 8 },
      costUsdMicros: expectedCost,
      promptVersion: "v1",
      model: "gpt-4.1-nano",
    });
  });

  it("does not call the LLM when the budget guard refuses", async () => {
    const order: string[] = [];
    const refusal = new BudgetExceededError({
      model: "gpt-4.1-nano",
      estimateUsdMicros: 50,
      spentUsdMicros: 100,
      capUsdMicros: 120,
    });
    const budget: BudgetGuard = {
      assertCanSpend() {
        order.push("budget");
        return Promise.reject(refusal);
      },
      record() {
        order.push("record");
        return Promise.resolve();
      },
      monthToDate() {
        return Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 0 });
      },
    };
    const llm: LlmClient = {
      complete() {
        order.push("llm");
        return Promise.reject(new Error("LLM should not be called"));
      },
    };

    await expect(
      extractItem({ item, llm, budget, model: "gpt-4.1-nano" }),
    ).rejects.toBe(refusal);
    expect(order).toEqual(["budget"]);
  });

  it("records usage when model JSON fails validation", async () => {
    const order: string[] = [];
    const { budget, records } = trackingBudget(order);
    const llm = createOpenAiClient({
      apiKey: "sk-test",
      model: "gpt-4.1-nano",
      client: {
        chat: {
          completions: {
            create() {
              order.push("llm");
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ isRelevant: false }),
                      refusal: null,
                    },
                  },
                ],
                usage: { prompt_tokens: 18, completion_tokens: 6 },
              });
            },
          },
        },
      },
    });

    await expect(
      extractItem({ item, llm, budget, model: "gpt-4.1-nano" }),
    ).rejects.toBeInstanceOf(ExtractionValidationError);
    expect(order).toEqual(["budget", "llm", "record"]);
    expect(records).toEqual([
      {
        purpose: "extraction",
        model: "gpt-4.1-nano",
        inputTokens: 18,
        outputTokens: 6,
        costUsdMicros: costUsdMicros("gpt-4.1-nano", {
          inputTokens: 18,
          outputTokens: 6,
        }),
      },
    ]);
  });

  it("throws an unknown model price before the budget guard or the LLM", async () => {
    const order: string[] = [];
    const { budget } = trackingBudget(order);
    const llm: LlmClient = {
      complete() {
        order.push("llm");
        return Promise.reject(new Error("LLM should not be called"));
      },
    };

    await expect(
      extractItem({ item, llm, budget, model: "not-a-priced-model" }),
    ).rejects.toBeInstanceOf(UnknownModelPriceError);
    expect(order).toEqual([]);
  });

  it("forwards a custom max output token cap", async () => {
    const order: string[] = [];
    const { budget, estimates } = trackingBudget(order);
    let maxOutputTokens = 0;
    const llm: LlmClient = {
      complete<T>(
        request: LlmCompleteRequest<T>,
      ): Promise<LlmCompleteResult<T>> {
        maxOutputTokens = request.maxOutputTokens;
        return Promise.resolve({
          data: validExtraction as T,
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "gpt-4o-mini",
        });
      },
    };

    await extractItem({
      item,
      llm,
      budget,
      model: "gpt-4o-mini",
      maxOutputTokens: 400,
    });
    expect(estimates[0]?.maxOutputTokens).toBe(400);
    expect(maxOutputTokens).toBe(400);
  });
});
