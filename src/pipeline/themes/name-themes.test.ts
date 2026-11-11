import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExtractionValidationError } from "@/core/errors";
import { strictJsonSchema } from "@/core/json-schema";
import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmTokenUsage,
} from "@/core/ports";
import type { Db } from "@/db/client";
import { companies, llmUsage, themes } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { createBudgetGuard } from "../budget/budget-guard";
import {
  THEME_NAMES_PROMPT_VERSION,
  acceptedNames,
  buildThemeNamesSystemPrompt,
  buildThemeNamesUserPrompt,
  listThemesToName,
  nameThemesStep,
  themeNamesSchema,
} from "./name-themes";
import {
  insertCompany,
  insertNamedSeedTheme,
  insertTag,
  linkTag,
} from "./testing";

const model = "gpt-5.6-luna";
const usage: LlmTokenUsage = { inputTokens: 500, outputTokens: 100 };

class FakeValidationError extends ExtractionValidationError {
  constructor(
    message: string,
    readonly usage: LlmTokenUsage,
  ) {
    super([{ path: [], message }]);
  }
}

type Responder = (ids: number[]) => unknown;

/** Answers from `respond`, then validates like the OpenAI adapter does. */
function fakeLlm(respond: Responder): LlmClient & {
  requests: LlmCompleteRequest<unknown>[];
} {
  const requests: LlmCompleteRequest<unknown>[] = [];
  return {
    requests,
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      requests.push(request);
      const sent = JSON.parse(request.user) as { themes: { id: number }[] };
      const parsed = request.schema.safeParse(
        respond(sent.themes.map((t) => t.id)),
      );
      if (!parsed.success) {
        return Promise.reject(
          new FakeValidationError(parsed.error.message, usage),
        );
      }
      return Promise.resolve({ data: parsed.data, usage, model });
    },
  };
}

const nameAll: Responder = (ids) => ({
  themes: ids.map((id) => ({ id, name: `Theme ${id}`, sector: "software-ai" })),
});

const fixedClock = { now: () => new Date("2026-11-11T12:00:00Z") };

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.close();
});

function budget(capGbp = 5) {
  return createBudgetGuard({ db, clock: fixedClock, capGbp });
}

async function theme(id: number) {
  const [row] = await db.select().from(themes).where(eq(themes.id, id));
  return row!;
}

describe("theme naming output schema", () => {
  it("sends OpenAI strict mode no string length keywords", () => {
    const json = JSON.stringify(strictJsonSchema(themeNamesSchema));
    expect(json).not.toContain("maxLength");
    expect(json).not.toContain("minLength");
    expect(json).toContain('"additionalProperties":false');
    expect(json).toContain("space-deep-tech");
  });

  it("leaves the length rule to the item check", () => {
    const long = { themes: [{ id: 1, name: "x".repeat(41), sector: "other" }] };
    expect(themeNamesSchema.safeParse(long).success).toBe(true);
    expect(acceptedNames(long, new Set([1]))).toEqual([]);
  });
});

describe("theme naming prompt", () => {
  it("states the rules and lists every sector", () => {
    const system = buildThemeNamesSystemPrompt();
    expect(THEME_NAMES_PROMPT_VERSION).toBe("theme-names-v1");
    expect(system).toContain("sentence case");
    expect(system).toContain("British English");
    expect(system).toContain("2 to 4 words");
    expect(system).toContain("Never use company");
    expect(system).toContain("space-deep-tech");
    expect(system).toContain("public-social");
  });

  it("sends ids and tags as JSON", () => {
    expect(
      buildThemeNamesUserPrompt([{ id: 3, tags: ["fintech", "payments"] }]),
    ).toBe('{"themes":[{"id":3,"tags":["fintech","payments"]}]}');
  });
});

describe("listThemesToName", () => {
  it("needs 2 companies, skips named and manual themes, and sends the top 8 tags", async () => {
    const big = await insertNamedSeedTheme(db, {
      slug: "fintech",
      tagSlugs: Array.from({ length: 10 }, (_, i) => `fin-${i}`),
      companyCount: 3,
    });
    await insertNamedSeedTheme(db, {
      slug: "solo",
      companyCount: 1,
      axisIndex: 1,
    });
    await insertNamedSeedTheme(db, {
      slug: "manual",
      nameSource: "manual",
      axisIndex: 2,
    });
    const small = await insertNamedSeedTheme(db, {
      slug: "edtech",
      axisIndex: 3,
    });
    const named = await insertNamedSeedTheme(db, {
      slug: "named",
      axisIndex: 4,
    });
    await db
      .update(themes)
      .set({ namedAt: new Date(), nameSource: "llm" })
      .where(eq(themes.id, named.themeId));

    const pending = await listThemesToName(db, 20);
    expect(pending.map((t) => t.id)).toEqual([big.themeId, small.themeId]);
    expect(pending[0]!.tags).toEqual(
      Array.from({ length: 8 }, (_, i) => `fin ${i}`),
    );
    expect(await listThemesToName(db, 1)).toHaveLength(1);
    expect(await listThemesToName(db, 0)).toEqual([]);
  });

  it("does not count merged companies", async () => {
    const { themeId, companyIds } = await insertNamedSeedTheme(db, {
      slug: "a",
    });
    const keeper = await insertCompany(db, "keeper");
    await db
      .update(companies)
      .set({ mergedIntoId: keeper })
      .where(eq(companies.id, companyIds[1]!));
    expect((await listThemesToName(db, 20)).map((t) => t.id)).not.toContain(
      themeId,
    );
  });
});

describe("nameThemesStep", () => {
  it("names themes in batches of 20 and records theme_naming usage", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 45; i++) {
      ids.push(
        (await insertNamedSeedTheme(db, { slug: `t-${i}`, axisIndex: i }))
          .themeId,
      );
    }
    const llm = fakeLlm(nameAll);
    const result = await nameThemesStep({
      db,
      llm,
      budget: budget(),
      model,
      maxThemes: 45,
      clock: fixedClock,
    });

    expect(result).toEqual({ themesNamed: 45, batches: 3, themesInvalid: 0 });
    expect(
      llm.requests.map(
        (r) => (JSON.parse(r.user) as { themes: unknown[] }).themes.length,
      ),
    ).toEqual([20, 20, 5]);
    expect(llm.requests[0]!.schemaName).toBe("theme_names");

    const row = await theme(ids[0]!);
    expect(row).toMatchObject({
      name: `Theme ${ids[0]}`,
      sector: "software-ai",
      nameSource: "llm",
      namedAt: fixedClock.now(),
    });

    const rows = await db.select().from(llmUsage).orderBy(asc(llmUsage.id));
    expect(rows).toHaveLength(3);
    for (const usageRow of rows) {
      expect(usageRow).toMatchObject({
        purpose: "theme_naming",
        model,
        inputTokens: 500,
        outputTokens: 100,
      });
      expect(usageRow.costUsdMicros).toBeGreaterThan(0);
    }

    const again = await nameThemesStep({
      db,
      llm,
      budget: budget(),
      model,
      maxThemes: 45,
    });
    expect(again).toEqual({ themesNamed: 0, batches: 0, themesInvalid: 0 });
  });

  it("stops at maxThemes", async () => {
    for (let i = 0; i < 3; i++) {
      await insertNamedSeedTheme(db, { slug: `t-${i}`, axisIndex: i });
    }
    const result = await nameThemesStep({
      db,
      llm: fakeLlm(nameAll),
      budget: budget(),
      model,
      maxThemes: 2,
    });
    expect(result.themesNamed).toBe(2);
  });

  it("never overwrites a manual name, and keeps a sector a person set", async () => {
    const manual = await insertNamedSeedTheme(db, {
      slug: "manual",
      nameSource: "manual",
    });
    const withSector = await insertNamedSeedTheme(db, {
      slug: "sector-set",
      sector: "education",
      axisIndex: 1,
    });
    const llm = fakeLlm(() => ({
      themes: [
        { id: manual.themeId, name: "Overwritten", sector: "other" },
        {
          id: withSector.themeId,
          name: "Learning tools",
          sector: "software-ai",
        },
      ],
    }));
    const result = await nameThemesStep({
      db,
      llm,
      budget: budget(),
      model,
      maxThemes: 20,
    });

    expect(result.themesNamed).toBe(1);
    expect(
      (JSON.parse(llm.requests[0]!.user) as { themes: { id: number }[] })
        .themes,
    ).toEqual([expect.objectContaining({ id: withSector.themeId })]);
    expect(await theme(manual.themeId)).toMatchObject({
      name: "manual",
      nameSource: "manual",
      namedAt: null,
    });
    expect(await theme(withSector.themeId)).toMatchObject({
      name: "Learning tools",
      sector: "education",
      nameSource: "llm",
    });
  });

  it("leaves themes unnamed when the output has an invalid sector", async () => {
    const { themeId } = await insertNamedSeedTheme(db, { slug: "a" });
    const result = await nameThemesStep({
      db,
      llm: fakeLlm((ids) => ({
        themes: ids.map((id) => ({ id, name: "Fine name", sector: "crypto" })),
      })),
      budget: budget(),
      model,
      maxThemes: 20,
    });
    expect(result).toEqual({ themesNamed: 0, batches: 1, themesInvalid: 1 });
    expect(await theme(themeId)).toMatchObject({
      namedAt: null,
      nameSource: "tag",
    });
    // The tokens were still paid for.
    expect(await db.select().from(llmUsage)).toHaveLength(1);
    expect((await listThemesToName(db, 20)).map((t) => t.id)).toEqual([
      themeId,
    ]);
  });

  it("leaves themes unnamed when a name is too long", async () => {
    const { themeId } = await insertNamedSeedTheme(db, { slug: "a" });
    const result = await nameThemesStep({
      db,
      llm: fakeLlm((ids) => ({
        themes: ids.map((id) => ({
          id,
          name: "x".repeat(41),
          sector: "other",
        })),
      })),
      budget: budget(),
      model,
      maxThemes: 20,
    });
    expect(result.themesInvalid).toBe(1);
    expect((await theme(themeId)).namedAt).toBeNull();
  });

  it("ignores ids that were not sent", async () => {
    const { themeId } = await insertNamedSeedTheme(db, { slug: "a" });
    const other = await insertNamedSeedTheme(db, {
      slug: "b",
      companyCount: 1,
      axisIndex: 1,
    });
    const result = await nameThemesStep({
      db,
      llm: fakeLlm(() => ({
        themes: [{ id: other.themeId, name: "Sneaky", sector: "other" }],
      })),
      budget: budget(),
      model,
      maxThemes: 20,
    });
    expect(result).toMatchObject({ themesNamed: 0, themesInvalid: 1 });
    expect((await theme(other.themeId)).name).toBe("b");
    expect((await theme(themeId)).namedAt).toBeNull();
  });

  it("stops cleanly when the budget refuses", async () => {
    const { themeId } = await insertNamedSeedTheme(db, { slug: "a" });
    const llm = fakeLlm(nameAll);
    const result = await nameThemesStep({
      db,
      llm,
      budget: budget(0),
      model,
      maxThemes: 20,
    });
    expect(result).toEqual({
      themesNamed: 0,
      batches: 0,
      themesInvalid: 0,
      budgetPaused: true,
    });
    expect(llm.requests).toHaveLength(0);
    expect((await theme(themeId)).namedAt).toBeNull();
    expect(await db.select().from(llmUsage)).toHaveLength(0);
  });

  it("does nothing without themes to name", async () => {
    const c = await insertCompany(db, "c");
    const tag = await insertTag(db, { slug: "lonely", companies: [{ id: c }] });
    await linkTag(db, tag, null, "manual");
    const llm = fakeLlm(nameAll);
    expect(
      await nameThemesStep({ db, llm, budget: budget(), model, maxThemes: 20 }),
    ).toEqual({ themesNamed: 0, batches: 0, themesInvalid: 0 });
    expect(llm.requests).toHaveLength(0);
  });
});

describe("acceptedNames", () => {
  const sent = new Set([1, 2, 3]);

  it("keeps valid, sent, first-seen items and tidies spaces", () => {
    expect(
      acceptedNames(
        {
          themes: [
            {
              id: 1,
              name: "  Digital   health ",
              sector: "health-life-sciences",
            },
            { id: 1, name: "Again", sector: "other" },
            { id: 2, name: "Bad", sector: "nope" },
            { id: 3, name: " ", sector: "other" },
            { id: 9, name: "Unsent", sector: "other" },
          ],
        },
        sent,
      ),
    ).toEqual([
      { id: 1, name: "Digital health", sector: "health-life-sciences" },
    ]);
  });

  it("returns nothing for malformed output", () => {
    expect(acceptedNames(null, sent)).toEqual([]);
    expect(acceptedNames({ themes: "no" }, sent)).toEqual([]);
  });
});
