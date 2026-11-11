import { and, asc, eq, exists, isNull, notExists } from "drizzle-orm";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient, LlmTokenUsage } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  grantParticipants,
  grantProjects,
  grantProjectTexts,
  grantTaggings,
} from "@/db/schema";
import { normaliseTag } from "@/lib/normalise";
import { costUsdMicros, estimateCost } from "../extract/pricing";
import {
  GRANT_MAX_TAGS,
  GRANT_TAGGING_BATCH_SIZE,
  GRANT_TAGS_PROMPT_VERSION,
  GRANT_TAGS_SCHEMA_NAME,
  buildGrantTagsSystemPrompt,
  buildGrantTagsUserPrompt,
  grantProjectTagsSchema,
  grantTagsMaxOutputTokens,
  grantTagsSchema,
  type GrantProjectTags,
  type GrantProjectToTag,
} from "./grant-tag-prompt";

export interface TagGrantsArgs {
  db: Db;
  llm: LlmClient;
  budget: BudgetGuard;
  model: string;
  /** Most projects to tag in this run. */
  maxProjects: number;
  runId?: number;
}

export interface TagGrantsResult {
  projectsTagged: number;
  /** LLM calls made, including ones that failed validation. */
  batches: number;
  /** Projects left untagged by invalid or missing output. They are retried on the next run. */
  projectsInvalid: number;
  budgetPaused?: boolean;
}

/**
 * Projects with at least one kept participant and no tagging yet for this
 * prompt version and model, oldest first.
 */
export async function listProjectsToTag(
  db: Db,
  model: string,
  maxProjects: number,
): Promise<GrantProjectToTag[]> {
  if (maxProjects <= 0) return [];
  const rows = await db
    .select({
      id: grantProjects.id,
      title: grantProjects.title,
      abstract: grantProjectTexts.abstract,
    })
    .from(grantProjects)
    .leftJoin(
      grantProjectTexts,
      eq(grantProjectTexts.projectId, grantProjects.id),
    )
    .where(
      and(
        exists(
          db
            .select({ id: grantParticipants.id })
            .from(grantParticipants)
            .where(
              and(
                eq(grantParticipants.projectId, grantProjects.id),
                isNull(grantParticipants.skippedReason),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: grantTaggings.id })
            .from(grantTaggings)
            .where(
              and(
                eq(grantTaggings.projectId, grantProjects.id),
                eq(grantTaggings.promptVersion, GRANT_TAGS_PROMPT_VERSION),
                eq(grantTaggings.model, model),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(grantProjects.id))
    .limit(maxProjects);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    abstract: row.abstract ?? "",
  }));
}

/**
 * Keeps output items that pass the schema on their own, were asked for and
 * are not repeated. Tags are normalised, deduplicated and cut to five.
 */
export function acceptedTaggings(
  data: unknown,
  sentIds: ReadonlySet<number>,
): GrantProjectTags[] {
  const items =
    typeof data === "object" && data !== null
      ? (data as { projects?: unknown }).projects
      : undefined;
  if (!Array.isArray(items)) return [];
  const seen = new Set<number>();
  const accepted: GrantProjectTags[] = [];
  for (const item of items) {
    const parsed = grantProjectTagsSchema.safeParse(item);
    if (!parsed.success) continue;
    const { id } = parsed.data;
    if (!sentIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const tags = [...new Set(parsed.data.tags.map(normaliseTag))]
      .filter((tag) => tag.length > 0)
      .slice(0, GRANT_MAX_TAGS);
    accepted.push({ id, tags });
  }
  return accepted;
}

/** Splits `total` into `parts` whole shares; the remainder goes on the first. */
export function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const share = Math.floor(total / parts);
  const shares = new Array<number>(parts).fill(share);
  shares[0] = total - share * (parts - 1);
  return shares;
}

function isTokenUsage(value: unknown): value is LlmTokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.inputTokens === "number" &&
    Number.isFinite(usage.inputTokens) &&
    typeof usage.outputTokens === "number" &&
    Number.isFinite(usage.outputTokens)
  );
}

/** Tokens already billed when the adapter rejects the model JSON. */
function usageOf(error: ExtractionValidationError): LlmTokenUsage | undefined {
  const usage = (error as { usage?: unknown }).usage;
  return isTokenUsage(usage) ? usage : undefined;
}

/**
 * Part of pipeline step 8 (spec-phase2 section 10.4): tags grant projects in
 * batches of up to 20, through the budget guard with purpose `tagging`. Each
 * project is paid for once per prompt version and model. Tags reach companies
 * through the grant resolution step, whichever of the two runs first.
 */
export async function tagGrantsStep({
  db,
  llm,
  budget,
  model,
  maxProjects,
  runId,
}: TagGrantsArgs): Promise<TagGrantsResult> {
  const result: TagGrantsResult = {
    projectsTagged: 0,
    batches: 0,
    projectsInvalid: 0,
  };
  const pending = await listProjectsToTag(db, model, maxProjects);
  const system = buildGrantTagsSystemPrompt();

  for (
    let start = 0;
    start < pending.length;
    start += GRANT_TAGGING_BATCH_SIZE
  ) {
    const batch = pending.slice(start, start + GRANT_TAGGING_BATCH_SIZE);
    const user = buildGrantTagsUserPrompt(batch);
    const maxOutputTokens = grantTagsMaxOutputTokens(batch.length);

    try {
      await budget.assertCanSpend(
        estimateCost({ model, system, user, maxOutputTokens }),
      );
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        result.budgetPaused = true;
        break;
      }
      throw error;
    }

    const record = async (usage: LlmTokenUsage): Promise<number> => {
      const cost = costUsdMicros(model, usage);
      await budget.record({
        purpose: "tagging",
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsdMicros: cost,
        ingestRunId: runId,
      });
      return cost;
    };

    result.batches += 1;
    let data: unknown;
    let usage: LlmTokenUsage;
    let cost: number;
    try {
      const completion = await llm.complete({
        system,
        user,
        schema: grantTagsSchema,
        schemaName: GRANT_TAGS_SCHEMA_NAME,
        maxOutputTokens,
      });
      usage = completion.usage;
      cost = await record(usage);
      data = completion.data;
    } catch (error) {
      if (error instanceof ExtractionValidationError) {
        const spent = usageOf(error);
        if (spent) await record(spent);
        result.projectsInvalid += batch.length;
        continue;
      }
      throw error;
    }

    const accepted = acceptedTaggings(
      data,
      new Set(batch.map((project) => project.id)),
    );
    result.projectsInvalid += batch.length - accepted.length;
    if (accepted.length === 0) continue;

    const inputShares = splitEvenly(usage.inputTokens, accepted.length);
    const outputShares = splitEvenly(usage.outputTokens, accepted.length);
    const costShares = splitEvenly(cost, accepted.length);
    const stored = await db
      .insert(grantTaggings)
      .values(
        accepted.map((item, index) => ({
          projectId: item.id,
          promptVersion: GRANT_TAGS_PROMPT_VERSION,
          model,
          tags: item.tags,
          inputTokens: inputShares[index] ?? 0,
          outputTokens: outputShares[index] ?? 0,
          costUsdMicros: costShares[index] ?? 0,
        })),
      )
      .onConflictDoNothing({
        target: [
          grantTaggings.projectId,
          grantTaggings.promptVersion,
          grantTaggings.model,
        ],
      })
      .returning({ id: grantTaggings.id });
    result.projectsTagged += stored.length;
  }

  return result;
}
