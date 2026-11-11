import { z } from "zod";
import { ConfigError } from "./errors";

export const webEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

export const pipelineEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  EXTRACTION_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  LLM_MONTHLY_CAP_GBP: z.coerce.number().positive().default(3),
  MAX_EXTRACTIONS_PER_RUN: z.coerce.number().int().positive().default(150),
  /** Contact URL or email sent in the User-Agent of outgoing requests. */
  HTTP_CONTACT: z.string().min(1),
  // Phase 2
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  MAX_EMBEDDINGS_PER_RUN: z.coerce.number().int().positive().default(2000),
  MAX_THEME_NAMES_PER_RUN: z.coerce.number().int().positive().default(20),
  MAX_GRANT_TAGGINGS_PER_RUN: z.coerce.number().int().positive().default(200),
  /** Raises the GitHub API rate limit for star snapshots. Optional. */
  GITHUB_TOKEN: z.string().min(1).optional(),
});
export type PipelineEnv = z.infer<typeof pipelineEnvSchema>;

/**
 * The same settings with no LLM key. Collecting costs nothing, and history can
 * only accumulate from the day collection starts, so a run without a key still
 * stores new items and leaves them pending for extraction later. It inherits
 * every other setting, Phase 2 limits included.
 */
export const noLlmPipelineEnvSchema = pipelineEnvSchema.extend({
  OPENAI_API_KEY: z.string().min(1).optional(),
});
export type NoLlmPipelineEnv = z.infer<typeof noLlmPipelineEnvSchema>;

export type EnvSource = Record<string, string | undefined>;

function parseEnv<T extends z.ZodObject>(
  schema: T,
  env: EnvSource,
): z.infer<T> {
  // Unset CI secrets arrive as empty strings; treat them as missing.
  const input: EnvSource = {};
  for (const key of Object.keys(schema.shape)) {
    const value = env[key];
    if (value !== undefined && value !== "") input[key] = value;
  }

  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const missing = new Set<string>();
  const invalid = new Set<string>();
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (input[key] === undefined) missing.add(key);
    else invalid.add(key);
  }
  throw new ConfigError([...missing].sort(), [...invalid].sort());
}

export function parseWebEnv(env: EnvSource): WebEnv {
  return parseEnv(webEnvSchema, env);
}

export function parsePipelineEnv(env: EnvSource): PipelineEnv {
  return parseEnv(pipelineEnvSchema, env);
}

export function parseNoLlmPipelineEnv(env: EnvSource): NoLlmPipelineEnv {
  return parseEnv(noLlmPipelineEnvSchema, env);
}
