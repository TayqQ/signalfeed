import { describe, expect, it } from "vitest";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import { strictJsonSchema } from "@/core/json-schema";
import type {
  BudgetGuard,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmTokenUsage,
} from "@/core/ports";
import type { UsageRecord } from "@/core/domain";
import { assignGreedy, type GreedyTag } from "./cluster";
import {
  THEME_CHECK_SCHEMA_NAME,
  acceptedVerdicts,
  askThemeChecks,
  assignWithThemeCheck,
  buildThemeCheckSystemPrompt,
  buildThemeCheckUserPrompt,
  themeCheckSchema,
} from "./theme-check";
import { axis, vectorAt } from "./testing";

const DIMS = 16;
const model = "gpt-5.6-luna";
const usage: LlmTokenUsage = { inputTokens: 300, outputTokens: 50 };
const bands = { low: 0.6, high: 0.9 };

interface PromptItem {
  id: number;
  tag: string;
  candidates: { n: number; tags: string[] }[];
}

/** Answers each prompt item with `pick(item)`: a candidate number or 0. */
function fakeLlm(
  pick: (item: PromptItem) => number,
  fail?: () => Error | null,
): LlmClient & { requests: LlmCompleteRequest<unknown>[] } {
  const requests: LlmCompleteRequest<unknown>[] = [];
  return {
    requests,
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      requests.push(request);
      const error = fail?.();
      if (error) return Promise.reject(error);
      const { tags } = JSON.parse(request.user) as { tags: PromptItem[] };
      const data = request.schema.parse({
        verdicts: tags.map((item) => ({ id: item.id, match: pick(item) })),
      });
      return Promise.resolve({ data, usage, model });
    },
  };
}

function budgetGuard(refuse = false): BudgetGuard & { records: UsageRecord[] } {
  const records: UsageRecord[] = [];
  return {
    records,
    assertCanSpend(estimate) {
      return refuse
        ? Promise.reject(
            new BudgetExceededError({
              model: estimate.model,
              estimateUsdMicros: estimate.usdMicros,
              spentUsdMicros: 0,
              capUsdMicros: 0,
            }),
          )
        : Promise.resolve();
    },
    record(row) {
      records.push(row);
      return Promise.resolve();
    },
    monthToDate: () => Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 1 }),
  };
}

function tag(id: number, slug: string, embedding: number[], mentions: number) {
  return { id, slug, mentions, embedding } satisfies GreedyTag;
}

// "seed" starts a theme. "close" is above τ_high, "middle" in the band and
// "far" below τ_low.
const seed = tag(1, "seed", axis(0, DIMS), 10);
const close = tag(2, "close", vectorAt(0.95, 0, 1, DIMS), 9);
const middle = tag(3, "middle", vectorAt(0.75, 0, 2, DIMS), 8);
const far = tag(4, "far", vectorAt(0.3, 0, 3, DIMS), 7);
const tags = [seed, close, middle, far];

describe("theme check prompt and schema", () => {
  it("has no string length keywords and lists every property as required", () => {
    const schema = JSON.stringify(strictJsonSchema(themeCheckSchema));
    expect(schema).not.toMatch(/minLength|maxLength/);
    expect(schema).toContain('"additionalProperties":false');
  });

  it("numbers tags and candidates from 1 and states the market rules", () => {
    const user = JSON.parse(
      buildThemeCheckUserPrompt([
        {
          key: "k",
          tag: "baas",
          candidates: [{ tags: ["embedded finance"] }, { tags: ["neobank"] }],
        },
      ]),
    ) as { tags: PromptItem[] };
    expect(user.tags[0]).toEqual({
      id: 1,
      tag: "baas",
      candidates: [
        { n: 1, tags: ["embedded finance"] },
        { n: 2, tags: ["neobank"] },
      ],
    });
    const system = buildThemeCheckSystemPrompt();
    expect(system).toMatch(/sector word/);
    expect(system).toMatch(/answer 0/);
  });

  it("keeps only verdicts that were asked, once, and in range", () => {
    const batch = [
      { key: "a", tag: "a", candidates: [{ tags: ["x"] }] },
      { key: "b", tag: "b", candidates: [{ tags: ["x"] }, { tags: ["y"] }] },
      { key: "c", tag: "c", candidates: [{ tags: ["x"] }] },
    ];
    const verdicts = acceptedVerdicts(
      {
        verdicts: [
          { id: 1, match: 0 },
          { id: 1, match: 1 },
          { id: 2, match: 2 },
          { id: 3, match: 2 },
          { id: 9, match: 1 },
        ],
      },
      batch,
    );
    expect([...verdicts]).toEqual([
      ["a", null],
      ["b", 1],
    ]);
    expect(acceptedVerdicts({ nonsense: true }, batch).size).toBe(0);
  });
});

describe("assignWithThemeCheck", () => {
  it("without a client gives the embedding-only result", async () => {
    const { greedy, stats } = await assignWithThemeCheck({
      tags,
      themes: [],
      threshold: 0.7,
      bands,
    });
    expect(stats).toBeUndefined();
    expect(greedy).toEqual(assignGreedy({ tags, themes: [], threshold: 0.7 }));
  });

  it("asks only about band tags and joins on a match", async () => {
    const llm = fakeLlm(() => 1);
    const budget = budgetGuard();
    const { greedy, stats } = await assignWithThemeCheck({
      tags,
      themes: [],
      threshold: 0.99,
      bands,
      check: { llm, budget, model, purpose: "theme_naming", runId: 7 },
    });
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.schemaName).toBe(THEME_CHECK_SCHEMA_NAME);
    const asked = JSON.parse(llm.requests[0]!.user) as { tags: PromptItem[] };
    expect(asked.tags.map((item) => item.tag)).toEqual(["middle"]);
    // The candidate shows its member tags, most mentioned first.
    expect(asked.tags[0]!.candidates).toEqual([
      { n: 1, tags: ["seed", "close"] },
    ]);

    const byTag = new Map(greedy.assignments.map((a) => [a.tagId, a]));
    expect(byTag.get(close.id)).toMatchObject({ decision: "embedding" });
    expect(byTag.get(middle.id)).toMatchObject({
      decision: "llm_join",
      target: { kind: "new", index: 0 },
    });
    expect(byTag.get(far.id)).toMatchObject({
      decision: "embedding",
      target: { kind: "new", index: 1 },
    });
    expect(stats).toMatchObject({
      calls: 1,
      questions: 1,
      joined: 1,
      rejected: 0,
      fallbacks: 0,
    });
    expect(budget.records).toEqual([
      expect.objectContaining({
        purpose: "theme_naming",
        model,
        inputTokens: 300,
        outputTokens: 50,
        ingestRunId: 7,
      }),
    ]);
  });

  it("starts a new theme when the verdict is none", async () => {
    const { greedy, stats } = await assignWithThemeCheck({
      tags,
      themes: [],
      threshold: 0.5,
      bands,
      check: {
        llm: fakeLlm(() => 0),
        budget: budgetGuard(),
        model,
        purpose: "eval",
      },
    });
    const middleLink = greedy.assignments.find((a) => a.tagId === middle.id);
    expect(middleLink).toMatchObject({
      decision: "llm_new",
      target: { kind: "new", index: 1 },
    });
    expect(stats).toMatchObject({ joined: 0, rejected: 1 });
  });

  it("falls back to τ for the band on a budget refusal and makes no call", async () => {
    const llm = fakeLlm(() => 0);
    const { greedy, stats } = await assignWithThemeCheck({
      tags,
      themes: [],
      threshold: 0.7,
      bands,
      check: { llm, budget: budgetGuard(true), model, purpose: "eval" },
    });
    expect(llm.requests).toHaveLength(0);
    expect(stats).toMatchObject({ fallback: "budget", calls: 0, fallbacks: 1 });
    // 0.75 ≥ τ = 0.7: the fallback joins, as embedding-only would.
    expect(greedy.assignments.map(({ target }) => target)).toEqual(
      assignGreedy({ tags, themes: [], threshold: 0.7 }).assignments.map(
        ({ target }) => target,
      ),
    );
  });

  it("falls back on a provider error without throwing", async () => {
    const refusal = Object.assign(new Error("Rate limited"), { status: 429 });
    const { greedy, stats } = await assignWithThemeCheck({
      tags,
      themes: [],
      threshold: 0.9,
      bands,
      check: {
        llm: fakeLlm(
          () => 1,
          () => refusal,
        ),
        budget: budgetGuard(),
        model,
        purpose: "eval",
      },
    });
    expect(greedy.assignments).toHaveLength(4);
    expect(stats).toMatchObject({
      fallback: "error",
      errorMessage: "Rate limited",
      calls: 1,
      fallbacks: 1,
    });
    expect(stats?.error).toBe(refusal);
  });

  it("records the cost of invalid output and falls back for those tags", async () => {
    class Invalid extends ExtractionValidationError {
      readonly usage = usage;
    }
    const budget = budgetGuard();
    const { stats } = await assignWithThemeCheck({
      tags,
      themes: [],
      threshold: 0.9,
      bands,
      check: {
        llm: fakeLlm(
          () => 1,
          () => new Invalid([{ path: [], message: "bad" }]),
        ),
        budget,
        model,
        purpose: "eval",
      },
    });
    expect(stats).toMatchObject({ invalid: 1, fallbacks: 1, calls: 1 });
    expect(stats?.fallback).toBeUndefined();
    expect(budget.records).toHaveLength(1);
  });

  it("batches band questions and offers at most 3 candidates, best first", async () => {
    // Four seeds far apart, then many tags close to all four seeds' plane.
    const seeds = [0, 1, 2, 3].map((i) =>
      tag(100 + i, `seed-${i}`, axis(i, 64), 100),
    );
    const crowd = Array.from({ length: 7 }, (_, i) => {
      const v = new Array<number>(64).fill(0);
      v[0] = 0.62;
      v[1] = 0.6;
      v[2] = 0.3;
      v[3] = 0.2;
      v[10 + i] = 0.36;
      return tag(200 + i, `crowd-${i}`, v, 1);
    });
    const llm = fakeLlm(() => 0);
    const { stats } = await assignWithThemeCheck({
      tags: [...seeds, ...crowd],
      themes: [],
      bands: { low: 0.1, high: 0.99 },
      check: {
        llm,
        budget: budgetGuard(),
        model,
        purpose: "eval",
        batchSize: 3,
      },
    });
    const batches = llm.requests.map(
      (request) => (JSON.parse(request.user) as { tags: PromptItem[] }).tags,
    );
    expect(Math.max(...batches.map((batch) => batch.length))).toBe(3);
    for (const item of batches.flat()) {
      expect(item.candidates.length).toBeLessThanOrEqual(3);
    }
    // The crowd is close to all four seeds; the closest come first.
    const first = batches[0]![0]!;
    expect(first.candidates.map((c) => c.tags[0])).toEqual([
      "seed-0",
      "seed-1",
      "seed-2",
    ]);
    expect(stats?.calls).toBe(llm.requests.length);
    expect(stats?.questions).toBe(batches.flat().length);
  });
});

describe("askThemeChecks", () => {
  it("stops at the first refusal and reports what was sent", async () => {
    let calls = 0;
    const questions = Array.from({ length: 5 }, (_, i) => ({
      key: `k${i}`,
      tag: `t${i}`,
      candidates: [{ tags: ["x"] }],
    }));
    const result = await askThemeChecks(questions, {
      llm: fakeLlm(
        () => 1,
        () => (++calls === 2 ? new Error("down") : null),
      ),
      budget: budgetGuard(),
      model,
      purpose: "eval",
      batchSize: 2,
    });
    expect(result).toMatchObject({ calls: 2, sent: 4, fallback: "error" });
    expect([...result.verdicts.keys()]).toEqual(["k0", "k1"]);
  });
});
