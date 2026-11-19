import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "@/core/enums";
import { stageBucket } from "./stage";

describe("stageBucket", () => {
  it.each([
    ["pre_seed", "early"],
    ["seed", "seed"],
    ["series_a", "venture"],
    ["series_b", "venture"],
    ["series_c", "late"],
    ["series_d_plus", "late"],
    ["growth", "late"],
    ["debt", "other"],
    ["grant", "other"],
    ["unknown", "other"],
  ] as const)("%s is %s", (roundType, bucket) => {
    expect(stageBucket(roundType)).toBe(bucket);
  });

  it("covers every round type", () => {
    for (const t of ROUND_TYPES) expect(stageBucket(t)).toBeDefined();
  });
});
