import { z } from "zod";

// Prompt and output schema for tagging grant projects (spec-phase2 section 10.4).

export const GRANT_TAGS_PROMPT_VERSION = "grant-tags-v1";
export const GRANT_TAGS_SCHEMA_NAME = "grant_tags";
/** Projects per LLM call. */
export const GRANT_TAGGING_BATCH_SIZE = 20;
/** Abstract characters sent per project. */
export const GRANT_ABSTRACT_PROMPT_CHARS = 800;
export const GRANT_MAX_TAGS = 5;

/**
 * The tag rule from extraction v2 (spec-phase2 section 4.2), word for word, so
 * grant tags and news tags share one vocabulary.
 */
export const GRANT_TAG_RULE =
  'tags are zero to five short lowercase phrases for what the company makes or does and who it serves, most specific first. Prefer common industry terms ("insurtech", "ai agents", "heat pumps"). Do not use generic words ("startup", "technology", "innovation", "funding"), places, round types or company names.';

export const grantProjectTagsSchema = z.object({
  id: z.number().int(),
  tags: z.array(z.string()),
});
export type GrantProjectTags = z.infer<typeof grantProjectTagsSchema>;

/** Strict output of one tagging call. */
export const grantTagsSchema = z.object({
  projects: z.array(grantProjectTagsSchema),
});
export type GrantTagsOutput = z.infer<typeof grantTagsSchema>;

export interface GrantProjectToTag {
  id: number;
  title: string;
  /** The stored abstract. It is cut again for the prompt. */
  abstract: string;
}

export function buildGrantTagsSystemPrompt(): string {
  return [
    "You tag UK innovation grant projects for a UK startup news site.",
    "Each project has an id, a title and part of its public abstract.",
    "The tags describe the companies that work on the project.",
    `For every project, return its id and tags. ${GRANT_TAG_RULE}`,
    "Return an empty tags array when the text does not say what the work is.",
    "Return each project id you were given exactly once, and no other ids.",
  ].join("\n");
}

/** Whole characters, so a surrogate pair is never cut in half. */
function cut(text: string, maxChars: number): string {
  return Array.from(text.trim()).slice(0, maxChars).join("");
}

export function buildGrantTagsUserPrompt(
  batch: readonly GrantProjectToTag[],
): string {
  return JSON.stringify({
    projects: batch.map((project) => ({
      id: project.id,
      title: project.title.trim(),
      abstract: cut(project.abstract, GRANT_ABSTRACT_PROMPT_CHARS),
    })),
  });
}

/** Room for about 50 tokens a project plus model overhead. */
export function grantTagsMaxOutputTokens(batchSize: number): number {
  return 300 + 50 * batchSize;
}
