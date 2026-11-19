import type { RoundType } from "@/core/enums";

export type StageBucket = "early" | "seed" | "venture" | "late" | "other";

const BUCKETS: Readonly<Record<RoundType, StageBucket>> = {
  pre_seed: "early",
  seed: "seed",
  series_a: "venture",
  series_b: "venture",
  series_c: "late",
  series_d_plus: "late",
  growth: "late",
  debt: "other",
  grant: "other",
  unknown: "other",
};

/** The colour bucket for a round type. The only copy of this mapping. */
export function stageBucket(roundType: RoundType): StageBucket {
  return BUCKETS[roundType];
}

/** Tailwind background class for a bucket (the stage ramp in globals.css). */
export const STAGE_BG: Readonly<Record<StageBucket, string>> = {
  early: "bg-stage-early",
  seed: "bg-stage-seed",
  venture: "bg-stage-venture",
  late: "bg-stage-late",
  other: "bg-stage-other",
};
