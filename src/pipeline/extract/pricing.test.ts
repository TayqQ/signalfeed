import { describe, expect, it } from "vitest";
import { UnknownModelPriceError } from "@/core/errors";
import {
  MODEL_PRICES,
  costUsdMicros,
  estimateCost,
  estimateInputTokens,
} from "./pricing";

describe("MODEL_PRICES", () => {
  it("uses the OpenAI extraction prices from docs/sources.md A10", () => {
    expect(MODEL_PRICES).toEqual([
      {
        model: "gpt-4.1-nano",
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
      },
      {
        model: "gpt-4.1-mini",
        inputUsdPerMillion: 0.4,
        outputUsdPerMillion: 1.6,
      },
      {
        model: "gpt-4o-mini",
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.6,
      },
      {
        model: "o4-mini",
        inputUsdPerMillion: 1.1,
        outputUsdPerMillion: 4.4,
      },
    ]);
  });
});

describe("estimateCost", () => {
  it("pads input tokens by characters/4 × 1.2 and prices the max output", () => {
    const system = "a".repeat(40);
    const user = "";
    const estimate = estimateCost({
      model: "gpt-4.1-nano",
      system,
      user,
      maxOutputTokens: 100,
    });

    expect(estimateInputTokens(system, user)).toBe(12);
    expect(estimate).toEqual({
      model: "gpt-4.1-nano",
      estimatedInputTokens: 12,
      maxOutputTokens: 100,
      usdMicros: costUsdMicros("gpt-4.1-nano", {
        inputTokens: 12,
        outputTokens: 100,
      }),
    });
    expect(estimate.usdMicros).toBe(42);
  });

  it("rounds a fractional token estimate up", () => {
    expect(estimateInputTokens("abcde", "")).toBe(2);
    expect(estimateInputTokens("", "")).toBe(0);
  });

  it("throws before a price can be invented for an unknown model", () => {
    expect(() =>
      estimateCost({
        model: "gpt-unknown",
        system: "system",
        user: "user",
        maxOutputTokens: 10,
      }),
    ).toThrow(UnknownModelPriceError);
  });
});

describe("costUsdMicros", () => {
  it("converts published per-million prices into integer USD micros", () => {
    expect(
      costUsdMicros("gpt-4.1-nano", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(100_000);
    expect(
      costUsdMicros("gpt-4.1-mini", {
        inputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(1_600_000);
    expect(
      costUsdMicros("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(150_000);
    expect(
      costUsdMicros("o4-mini", { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(1_100_000);
  });

  it("rounds fractional micros up", () => {
    expect(
      costUsdMicros("gpt-4.1-nano", { inputTokens: 18, outputTokens: 6 }),
    ).toBe(5);
    expect(
      costUsdMicros("gpt-4o-mini", { inputTokens: 1, outputTokens: 0 }),
    ).toBe(1);
  });

  it("throws UnknownModelPriceError for a model with no price", () => {
    let caught: unknown;
    try {
      costUsdMicros("not-a-model", { inputTokens: 1, outputTokens: 1 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownModelPriceError);
    expect((caught as UnknownModelPriceError).model).toBe("not-a-model");
  });
});
