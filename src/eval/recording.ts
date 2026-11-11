import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EVAL_CASES_SCHEMA, type EvalCase } from "@/core/eval-fixture";
import {
  EXTRACTION_SCHEMA_V1,
  EXTRACTION_SCHEMA_V2,
  upgradeExtraction,
} from "@/core/extraction-schema";

export const CASES_PATH = "fixtures/extraction/cases.json";
export const RECORDINGS_DIR = "fixtures/extraction/recorded";

/** Prompt v1 recordings hold V1 results. Both are read as V2. */
const recordedResultSchema = z
  .union([EXTRACTION_SCHEMA_V2, EXTRACTION_SCHEMA_V1])
  .transform(upgradeExtraction);

const recordedCaseSchema = z.object({
  id: z.string(),
  result: recordedResultSchema.nullable(),
  error: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsdMicros: z.number(),
});

export const recordingSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  recordedOn: z.string(),
  cases: z.array(recordedCaseSchema),
});
export type Recording = z.infer<typeof recordingSchema>;

export function loadCases(path = CASES_PATH): EvalCase[] {
  return EVAL_CASES_SCHEMA.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Every committed recording, ordered by model name. Malformed files throw. */
export function loadRecordings(dir = RECORDINGS_DIR): Recording[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      recordingSchema.parse(
        JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown,
      ),
    );
}
