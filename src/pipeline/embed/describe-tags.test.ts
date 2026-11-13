import { describe, expect, it } from "vitest";
import type { UsageRecord } from "@/core/domain";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import { strictJsonSchema } from "@/core/json-schema";
import type {
  BudgetGuard,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
} from "@/core/ports";
import {
  TAG_MEANINGS_SCHEMA_NAME,
  acceptedMeanings,
  buildTagMeaningUserPrompt,
  cleanMeaning,
  describeTags,
  tagMeaningsSchema,
} from "./describe-tags";

const model = "gpt-5.6-luna";

function fakeLlm(
  fail?: () => Error | null,
): LlmClient & { requests: LlmCompleteRequest<unknown>[] } {
  const requests: LlmCompleteRequest<unknown>[] = [];
  return {
    requests,
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      requests.push(request);
      const error = fail?.();
      if (error) return Promise.reject(error);
      const { tags } = JSON.parse(request.user) as {
        tags: { id: number; tag: string }[];
      };
      const data = request.schema.parse({
        tags: tags.map(({ id, tag }) => ({
          id,
          meaning: `products for ${tag}`,
          broad: tag.endsWith("tech"),
        })),
      });
      return Promise.resolve({
        data,
        usage: { inputTokens: 200, outputTokens: 40 },
        model,
      });
    },
  };
}

function budgetGuard(refuse = false): BudgetGuard & { records: UsageRecord[] } {
  const records: UsageRecord[] = [];
  return {
    records,
    assertCanSpend: (estimate) =>
      refuse
        ? Promise.reject(
            new BudgetExceededError({
              model: estimate.model,
              estimateUsdMicros: estimate.usdMicros,
              spentUsdMicros: 0,
              capUsdMicros: 0,
            }),
          )
        : Promise.resolve(),
    record: (row) => {
      records.push(row);
      return Promise.resolve();
    },
    monthToDate: () => Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 1 }),
  };
}

describe("tag meaning prompt and schema", () => {
  it("has no string length keywords", () => {
    const schema = JSON.stringify(strictJsonSchema(tagMeaningsSchema));
    expect(schema).not.toMatch(/minLength|maxLength/);
  });

  it("numbers tags from 1", () => {
    expect(
      JSON.parse(buildTagMeaningUserPrompt(["baas", "heat pumps"])),
    ).toEqual({
      tags: [
        { id: 1, tag: "baas" },
        { id: 2, tag: "heat pumps" },
      ],
    });
  });

  it("cleans meanings to one line and cuts long ones at a word", () => {
    expect(cleanMeaning("  Banking   infrastructure\nfor fintechs. ")).toBe(
      "Banking infrastructure for fintechs",
    );
    expect(cleanMeaning("x")).toBeNull();
    const long = cleanMeaning("word ".repeat(60))!;
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("word")).toBe(true);
  });

  it("keeps answers that were asked, once", () => {
    const meanings = acceptedMeanings(
      {
        tags: [
          { id: 1, meaning: "first", broad: false },
          { id: 1, meaning: "again", broad: true },
          { id: 2, meaning: "", broad: false },
          { id: 7, meaning: "not asked", broad: false },
        ],
      },
      ["a", "b"],
    );
    expect([...meanings]).toEqual([["a", { meaning: "first", broad: false }]]);
    expect(acceptedMeanings({ nope: 1 }, ["a"]).size).toBe(0);
  });
});

describe("describeTags", () => {
  it("batches, records spend and returns meanings with the broad flag", async () => {
    const llm = fakeLlm();
    const budget = budgetGuard();
    const result = await describeTags(["baas", "proptech", "heat pumps"], {
      llm,
      budget,
      model,
      purpose: "embedding",
      runId: 3,
      batchSize: 2,
    });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0]!.schemaName).toBe(TAG_MEANINGS_SCHEMA_NAME);
    expect(result.meanings.get("proptech")).toEqual({
      meaning: "products for proptech",
      broad: true,
    });
    expect(result).toMatchObject({ calls: 2, invalid: 0 });
    expect(budget.records).toHaveLength(2);
    expect(budget.records[0]).toMatchObject({
      purpose: "embedding",
      ingestRunId: 3,
    });
  });

  it("stops on a budget refusal without calling", async () => {
    const llm = fakeLlm();
    const result = await describeTags(["baas"], {
      llm,
      budget: budgetGuard(true),
      model,
      purpose: "embedding",
    });
    expect(result.budgetPaused).toBe(true);
    expect(llm.requests).toHaveLength(0);
  });

  it("records the cost of invalid output and leaves those tags undescribed", async () => {
    class Invalid extends ExtractionValidationError {
      readonly usage = { inputTokens: 10, outputTokens: 5 };
    }
    const budget = budgetGuard();
    const result = await describeTags(["baas"], {
      llm: fakeLlm(() => new Invalid([{ path: [], message: "bad" }])),
      budget,
      model,
      purpose: "embedding",
    });
    expect(result).toMatchObject({ invalid: 1, calls: 1 });
    expect(result.meanings.size).toBe(0);
    expect(budget.records).toHaveLength(1);
  });

  it("throws a provider error", async () => {
    const refusal = Object.assign(new Error("quota"), { status: 429 });
    await expect(
      describeTags(["baas"], {
        llm: fakeLlm(() => refusal),
        budget: budgetGuard(),
        model,
        purpose: "embedding",
      }),
    ).rejects.toBe(refusal);
  });
});
