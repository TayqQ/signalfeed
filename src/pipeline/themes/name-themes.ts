import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type {
  BudgetGuard,
  Clock,
  LlmClient,
  LlmTokenUsage,
} from "@/core/ports";
import { SECTORS, SECTOR_LABELS } from "@/core/sectors";
import type { Db } from "@/db/client";
import { companies, companyTags, tagThemes, tags, themes } from "@/db/schema";
import { costUsdMicros, estimateCost } from "../extract/pricing";

export const THEME_NAMES_PROMPT_VERSION = "theme-names-v1";
export const THEME_NAMES_SCHEMA_NAME = "theme_names";
/** Themes per LLM call. */
export const THEME_NAMING_BATCH_SIZE = 20;
/** Tags sent per theme, by mentions. */
export const THEME_NAMING_TOP_TAGS = 8;
/** A theme is named once it has this many companies. */
export const THEME_NAMING_MIN_COMPANIES = 2;
export const THEME_NAME_MIN_LENGTH = 2;
export const THEME_NAME_MAX_LENGTH = 40;

/**
 * The full rules for one named theme, checked item by item in code
 * (`acceptedNames`). Not sent to the model: OpenAI strict mode may reject
 * string `minLength`/`maxLength`.
 */
export const themeNameSchema = z.object({
  id: z.number().int(),
  name: z.string().min(THEME_NAME_MIN_LENGTH).max(THEME_NAME_MAX_LENGTH),
  sector: z.enum(SECTORS),
});
export type ThemeNameOutput = z.infer<typeof themeNameSchema>;

/**
 * Strict output of one naming call, as sent to the model. Plain strings only,
 * like `src/core/extraction-schema.ts`; the length limit is in the prompt and
 * in `themeNameSchema`.
 */
export const themeNamesSchema = z.strictObject({
  themes: z.array(
    z.strictObject({
      id: z.number().int(),
      name: z
        .string()
        .describe(
          `2 to 4 words, at most ${THEME_NAME_MAX_LENGTH} characters, sentence case`,
        ),
      sector: z.enum(SECTORS),
    }),
  ),
});
export type ThemeNamesOutput = z.infer<typeof themeNamesSchema>;

export interface ThemeToName {
  id: number;
  /** Tag labels, most mentioned first, at most `THEME_NAMING_TOP_TAGS`. */
  tags: string[];
}

export function buildThemeNamesSystemPrompt(): string {
  const sectors = SECTORS.map(
    (slug) => `- ${slug}: ${SECTOR_LABELS[slug]}`,
  ).join("\n");
  return [
    "You name groups of related startup tags for a UK startup news site.",
    "Each theme is a list of tags that companies were given, most common first.",
    "For every theme, return:",
    `- name: 2 to 4 words, sentence case, British English, at most ${THEME_NAME_MAX_LENGTH} characters. Describe what the tags share, for example "Digital health" or "Carbon removal". Never use company, product or person names.`,
    "- sector: the one slug from this list that fits best:",
    sectors,
    "Return each theme id you were given exactly once, and no other ids.",
  ].join("\n");
}

export function buildThemeNamesUserPrompt(
  batch: readonly ThemeToName[],
): string {
  return JSON.stringify({
    themes: batch.map((theme) => ({ id: theme.id, tags: theme.tags })),
  });
}

/** Room for about 40 tokens a theme plus model overhead. */
export function maxOutputTokensFor(batchSize: number): number {
  return 400 + 40 * batchSize;
}

export interface NameThemesArgs {
  db: Db;
  llm: LlmClient;
  budget: BudgetGuard;
  model: string;
  /** Most themes to name in this run. */
  maxThemes: number;
  runId?: number;
  clock?: Clock;
}

export interface NameThemesResult {
  themesNamed: number;
  /** LLM calls made, including ones that failed validation. */
  batches: number;
  /** Themes left unnamed by invalid output. They are retried on the next run. */
  themesInvalid: number;
  budgetPaused?: boolean;
}

const systemClock: Clock = { now: () => new Date() };

/** Live companies tagged with any of the theme's tags. */
function liveCompanyCount() {
  return sql<number>`count(distinct ${companies.id})`.mapWith(Number);
}

/** Active, unnamed, not manually named themes with enough companies, biggest first. */
export async function listThemesToName(
  db: Db,
  maxThemes: number,
): Promise<ThemeToName[]> {
  if (maxThemes <= 0) return [];
  const companyCount = liveCompanyCount();
  const picked = await db
    .select({ id: themes.id, companies: companyCount })
    .from(themes)
    .innerJoin(tagThemes, eq(tagThemes.themeId, themes.id))
    .innerJoin(companyTags, eq(companyTags.tagId, tagThemes.tagId))
    .innerJoin(
      companies,
      and(
        eq(companies.id, companyTags.companyId),
        isNull(companies.mergedIntoId),
      ),
    )
    .where(
      and(
        eq(themes.status, "active"),
        isNull(themes.namedAt),
        ne(themes.nameSource, "manual"),
      ),
    )
    .groupBy(themes.id)
    .having(
      sql`count(distinct ${companies.id}) >= ${THEME_NAMING_MIN_COMPANIES}`,
    )
    .orderBy(desc(companyCount), asc(themes.id))
    .limit(maxThemes);
  if (picked.length === 0) return [];

  const ids = picked.map((row) => row.id);
  const tagsByTheme = await loadThemeTags(db, ids);
  return ids.map((id) => ({
    id,
    tags: (tagsByTheme.get(id) ?? [])
      .slice(0, THEME_NAMING_TOP_TAGS)
      .map((tag) => tag.label),
  }));
}

export interface ThemeTag {
  slug: string;
  label: string;
  /** Mentions across live companies. */
  mentions: number;
}

/** Each theme's tags, most mentioned first, then by slug. */
export async function loadThemeTags(
  db: Db,
  themeIds: readonly number[],
): Promise<Map<number, ThemeTag[]>> {
  const byTheme = new Map<number, ThemeTag[]>();
  if (themeIds.length === 0) return byTheme;
  const mentions = sql<number>`coalesce(sum(${companyTags.mentionCount}) filter (where ${companies.mergedIntoId} is null), 0)`;
  const rows = await db
    .select({
      themeId: tagThemes.themeId,
      slug: tags.slug,
      label: tags.label,
      mentions: mentions.mapWith(Number),
    })
    .from(tagThemes)
    .innerJoin(tags, eq(tags.id, tagThemes.tagId))
    .leftJoin(companyTags, eq(companyTags.tagId, tags.id))
    .leftJoin(companies, eq(companies.id, companyTags.companyId))
    .where(inArray(tagThemes.themeId, [...themeIds]))
    .groupBy(tagThemes.themeId, tags.id);

  for (const { themeId, ...tag } of rows) {
    if (themeId === null) continue;
    const list = byTheme.get(themeId) ?? [];
    list.push(tag);
    byTheme.set(themeId, list);
  }
  for (const list of byTheme.values()) {
    list.sort(
      (a, b) =>
        b.mentions - a.mentions ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
  }
  return byTheme;
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
 * Keeps output items that pass the schema on their own, were asked for and
 * are not repeated. Anything else leaves its theme unnamed for the next run.
 */
export function acceptedNames(
  data: unknown,
  sentIds: ReadonlySet<number>,
): ThemeNameOutput[] {
  const items =
    typeof data === "object" && data !== null
      ? (data as { themes?: unknown }).themes
      : undefined;
  if (!Array.isArray(items)) return [];
  const seen = new Set<number>();
  const accepted: ThemeNameOutput[] = [];
  for (const item of items) {
    const parsed = themeNameSchema.safeParse(item);
    if (!parsed.success) continue;
    const name = parsed.data.name.trim().replace(/\s+/g, " ");
    if (
      name.length < THEME_NAME_MIN_LENGTH ||
      !sentIds.has(parsed.data.id) ||
      seen.has(parsed.data.id)
    ) {
      continue;
    }
    seen.add(parsed.data.id);
    accepted.push({ ...parsed.data, name });
  }
  return accepted;
}

/**
 * Pipeline step 10b (spec-phase2 section 7.2): asks the LLM for a name and a
 * sector for themes that reached 2 companies, up to 20 themes a call. Manual
 * names are never overwritten, and a sector a person already set is kept.
 */
export async function nameThemesStep({
  db,
  llm,
  budget,
  model,
  maxThemes,
  runId,
  clock = systemClock,
}: NameThemesArgs): Promise<NameThemesResult> {
  const result: NameThemesResult = {
    themesNamed: 0,
    batches: 0,
    themesInvalid: 0,
  };
  const pending = await listThemesToName(db, maxThemes);
  const system = buildThemeNamesSystemPrompt();

  for (
    let start = 0;
    start < pending.length;
    start += THEME_NAMING_BATCH_SIZE
  ) {
    const batch = pending.slice(start, start + THEME_NAMING_BATCH_SIZE);
    const user = buildThemeNamesUserPrompt(batch);
    const maxOutputTokens = maxOutputTokensFor(batch.length);

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

    const record = (usage: LlmTokenUsage) =>
      budget.record({
        purpose: "theme_naming",
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsdMicros: costUsdMicros(model, usage),
        ingestRunId: runId,
      });

    result.batches += 1;
    let data: unknown;
    try {
      const completion = await llm.complete({
        system,
        user,
        schema: themeNamesSchema,
        schemaName: THEME_NAMES_SCHEMA_NAME,
        maxOutputTokens,
      });
      await record(completion.usage);
      data = completion.data;
    } catch (error) {
      if (error instanceof ExtractionValidationError) {
        const usage = usageOf(error);
        if (usage) await record(usage);
        result.themesInvalid += batch.length;
        continue;
      }
      throw error;
    }

    const accepted = acceptedNames(data, new Set(batch.map((t) => t.id)));
    result.themesInvalid += batch.length - accepted.length;
    if (accepted.length === 0) continue;

    const namedAt = clock.now();
    await db.transaction(async (tx) => {
      for (const item of accepted) {
        const updated = await tx
          .update(themes)
          .set({
            name: item.name,
            sector: sql`coalesce(${themes.sector}, ${item.sector})`,
            nameSource: "llm",
            namedAt,
          })
          .where(
            and(
              eq(themes.id, item.id),
              eq(themes.status, "active"),
              isNull(themes.namedAt),
              ne(themes.nameSource, "manual"),
            ),
          )
          .returning({ id: themes.id });
        result.themesNamed += updated.length;
      }
    });
  }

  return result;
}
