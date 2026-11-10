import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EVAL_CASES_SCHEMA, type EvalCase } from "@/core/eval-fixture";
import { EXTRACTION_SCHEMA_V1 } from "@/core/extraction-schema";

export const CASES_PATH = "fixtures/extraction/cases.json";
export const RECORDINGS_DIR = "fixtures/extraction/recorded";

const recordedCaseSchema = z.object({
  id: z.string(),
  result: EXTRACTION_SCHEMA_V1.nullable(),
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
