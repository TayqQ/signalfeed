import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExtractionValidationError } from "@/core/errors";
import type {
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmTokenUsage,
} from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companyTags,
  grantParticipants,
  grantProjects,
  grantProjectTexts,
  grantTaggings,
  llmUsage,
  tags,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { createBudgetGuard } from "../budget/budget-guard";
import { buildSystemPrompt } from "../extract/prompt";
import {
  GRANT_TAGS_PROMPT_VERSION,
  GRANT_TAG_RULE,
  buildGrantTagsSystemPrompt,
  buildGrantTagsUserPrompt,
} from "./grant-tag-prompt";
import { resolveGrantsStep } from "./resolve-grants";
import { ensureGtrSource } from "./store-grants";
import { acceptedTaggings, splitEvenly, tagGrantsStep } from "./tag-grants";

const model = "gpt-5.6-luna";
const usage: LlmTokenUsage = { inputTokens: 1001, outputTokens: 302 };
const fixedClock = { now: () => new Date("2026-11-11T12:00:00Z") };
const now = () => fixedClock.now();

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
  sentIds: number[][];
} {
  const requests: LlmCompleteRequest<unknown>[] = [];
  const sentIds: number[][] = [];
  return {
    requests,
    sentIds,
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      requests.push(request);
      const sent = JSON.parse(request.user) as { projects: { id: number }[] };
      const ids = sent.projects.map((p) => p.id);
      sentIds.push(ids);
      const parsed = request.schema.safeParse(respond(ids));
      if (!parsed.success) {
        return Promise.reject(
          new FakeValidationError(parsed.error.message, usage),
        );
      }
      return Promise.resolve({ data: parsed.data, usage, model });
    },
  };
}

const tagAll: Responder = (ids) => ({
  projects: ids.map((id) => ({ id, tags: ["Heat Pumps", "home energy"] })),
});

let testDb: TestDb;
let db: Db;
let sourceId: number;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  sourceId = await ensureGtrSource(db);
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

function budget(capGbp = 5) {
  return createBudgetGuard({ db, clock: fixedClock, capGbp });
}

/** A project with one kept participant; returns the project id. */
async function project(
  n: number,
  options: { abstract?: string; participants?: number } = {},
): Promise<number> {
  const [row] = await db
    .insert(grantProjects)
    .values({
      sourceId,
      gtrProjectId: `project-${n}`,
      title: `Invented project ${n}`,
      grantCategory: "Collaborative R&D",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: "2026-06-01",
      gtrUrl: `https://gtr.test/project-${n}`,
    })
    .returning({ id: grantProjects.id });
  const projectId = row!.id;
  await db.insert(grantProjectTexts).values({
    projectId,
    abstract: options.abstract ?? `Invented abstract ${n}.`,
  });
  for (let i = 0; i < (options.participants ?? 1); i += 1) {
    await db.insert(grantParticipants).values({
      projectId,
      gtrOrgId: `org-${n}-${i}`,
      organisationName: `Invented ${n}-${i} Ltd`,
      role: "lead",
      grantOfferMinor: 1_000_000,
      orgFetchedAt: now(),
    });
  }
  return projectId;
}

async function taggingRows() {
  return db.select().from(grantTaggings).orderBy(asc(grantTaggings.id));
}

describe("grant tag prompt", () => {
  it("uses the extraction v2 tag rule word for word", () => {
    expect(GRANT_TAGS_PROMPT_VERSION).toBe("grant-tags-v1");
    expect(buildSystemPrompt()).toContain(GRANT_TAG_RULE);
    expect(buildGrantTagsSystemPrompt()).toContain(GRANT_TAG_RULE);
  });

  it("sends id, title and the abstract cut to 800 characters", () => {
    const user = buildGrantTagsUserPrompt([
      { id: 7, title: " A title ", abstract: "x".repeat(1_500) },
    ]);
    const parsed = JSON.parse(user) as {
      projects: { id: number; title: string; abstract: string }[];
    };
    expect(parsed.projects).toEqual([
      { id: 7, title: "A title", abstract: "x".repeat(800) },
    ]);
  });
});

describe("acceptedTaggings", () => {
  it("ignores ids not sent and repeats, and normalises tags to at most 5", () => {
    const accepted = acceptedTaggings(
      {
        projects: [
          { id: 1, tags: [" AI Agents ", "ai agents", "Heat & Pumps", ""] },
          { id: 1, tags: ["repeat"] },
          { id: 99, tags: ["not sent"] },
          { id: 2, tags: ["a", "b", "c", "d", "e", "f", "g"] },
          { id: "3", tags: [] },
        ],
      },
      new Set([1, 2, 3]),
    );
    expect(accepted).toEqual([
      { id: 1, tags: ["ai agents", "heat and pumps"] },
      { id: 2, tags: ["a", "b", "c", "d", "e"] },
    ]);
  });

  it("splits a total evenly with the remainder on the first", () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(2, 3)).toEqual([2, 0, 0]);
    expect(splitEvenly(5, 0)).toEqual([]);
  });
});

describe("tagGrantsStep", () => {
  it("tags in batches of 20", async () => {
    const ids: number[] = [];
    for (let n = 1; n <= 45; n += 1) ids.push(await project(n));
    const llm = fakeLlm(tagAll);

    const result = await tagGrantsStep({
      db,
      llm,
      budget: budget(),
      model,
      maxProjects: 100,
      runId: undefined,
    });

    expect(llm.sentIds.map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(llm.sentIds.flat()).toEqual(ids);
    expect(result).toEqual({
      projectsTagged: 45,
      batches: 3,
      projectsInvalid: 0,
    });
    const usageRows = await db.select().from(llmUsage);
    expect(usageRows).toHaveLength(3);
    expect(usageRows.every((row) => row.purpose === "tagging")).toBe(true);
    const [first] = await taggingRows();
    expect(first?.tags).toEqual(["heat pumps", "home energy"]);
  });

  it("stops at maxProjects and skips projects with no kept participant", async () => {
    await project(1, { participants: 0 });
    const skipped = await project(2);
    await db
      .update(grantParticipants)
      .set({ skippedReason: "no grant offer", resolvedAt: now() })
      .where(eq(grantParticipants.projectId, skipped));
    const a = await project(3);
    await project(4);
    const llm = fakeLlm(tagAll);

    await tagGrantsStep({ db, llm, budget: budget(), model, maxProjects: 1 });

    expect(llm.sentIds).toEqual([[a]]);
  });

  it("ignores ids that were not sent and retries missing ones", async () => {
    const a = await project(1);
    const b = await project(2);
    const llm = fakeLlm(() => ({
      projects: [
        { id: a, tags: ["fintech"] },
        { id: 9_999, tags: ["stray"] },
      ],
    }));

    const result = await tagGrantsStep({
      db,
      llm,
      budget: budget(),
      model,
      maxProjects: 10,
    });

    expect(result.projectsTagged).toBe(1);
    expect(result.projectsInvalid).toBe(1);
    const rows = await taggingRows();
    expect(rows.map((row) => row.projectId)).toEqual([a]);
    expect(rows[0]?.tags).toEqual(["fintech"]);

    const retry = fakeLlm(tagAll);
    await tagGrantsStep({
      db,
      llm: retry,
      budget: budget(),
      model,
      maxProjects: 10,
    });
    expect(retry.sentIds).toEqual([[b]]);
  });

  it("splits tokens and cost evenly, with the remainder on the first", async () => {
    for (let n = 1; n <= 3; n += 1) await project(n);
    await tagGrantsStep({
      db,
      llm: fakeLlm(tagAll),
      budget: budget(),
      model,
      maxProjects: 10,
    });
    const rows = await taggingRows();
    const [usageRow] = await db.select().from(llmUsage);
    expect(rows.map((row) => row.inputTokens)).toEqual([335, 333, 333]);
    expect(rows.map((row) => row.outputTokens)).toEqual([102, 100, 100]);
    const totalCost = rows.reduce((sum, row) => sum + row.costUsdMicros, 0);
    expect(totalCost).toBe(usageRow?.costUsdMicros);
    expect(rows[0]!.costUsdMicros).toBeGreaterThanOrEqual(
      rows[1]!.costUsdMicros,
    );
  });

  it("stops cleanly on a budget refusal", async () => {
    await project(1);
    const llm = fakeLlm(tagAll);

    const result = await tagGrantsStep({
      db,
      llm,
      budget: budget(0),
      model,
      maxProjects: 10,
    });

    expect(result).toEqual({
      projectsTagged: 0,
      batches: 0,
      projectsInvalid: 0,
      budgetPaused: true,
    });
    expect(llm.requests).toHaveLength(0);
    expect(await taggingRows()).toHaveLength(0);
    expect(await db.select().from(llmUsage)).toHaveLength(0);
  });

  it("records usage for invalid output and stores nothing", async () => {
    await project(1);
    const result = await tagGrantsStep({
      db,
      llm: fakeLlm(() => ({ wrong: true })),
      budget: budget(),
      model,
      maxProjects: 10,
    });
    expect(result.projectsInvalid).toBe(1);
    expect(await taggingRows()).toHaveLength(0);
    expect(await db.select().from(llmUsage)).toHaveLength(1);
  });

  it("tags each project once per prompt version and model", async () => {
    await project(1);
    const first = fakeLlm(tagAll);
    await tagGrantsStep({
      db,
      llm: first,
      budget: budget(),
      model,
      maxProjects: 10,
    });
    const again = fakeLlm(tagAll);
    const result = await tagGrantsStep({
      db,
      llm: again,
      budget: budget(),
      model,
      maxProjects: 10,
    });
    expect(again.requests).toHaveLength(0);
    expect(result.batches).toBe(0);

    const otherModel = fakeLlm(tagAll);
    await tagGrantsStep({
      db,
      llm: otherModel,
      budget: budget(),
      model: "gpt-5.4-mini",
      maxProjects: 10,
    });
    expect(otherModel.requests).toHaveLength(1);
    const rows = await taggingRows();
    expect(rows.map((row) => [row.promptVersion, row.model])).toEqual([
      [GRANT_TAGS_PROMPT_VERSION, model],
      [GRANT_TAGS_PROMPT_VERSION, "gpt-5.4-mini"],
    ]);
  });
});

describe("grant tags on companies", () => {
  async function grantTagLinks() {
    return db
      .select({
        slug: tags.slug,
        source: companyTags.source,
        mentions: companyTags.mentionCount,
      })
      .from(companyTags)
      .innerJoin(tags, eq(tags.id, companyTags.tagId))
      .orderBy(asc(tags.slug));
  }

  const expected = [
    { slug: "heat pumps", source: "grant", mentions: 1 },
    { slug: "home energy", source: "grant", mentions: 1 },
  ];

  it("reach company_tags with source grant when tagging runs first", async () => {
    await project(1);
    await tagGrantsStep({
      db,
      llm: fakeLlm(tagAll),
      budget: budget(),
      model,
      maxProjects: 10,
    });
    const result = await resolveGrantsStep({ db, now });
    expect(result.tagsApplied).toBe(2);
    expect(await grantTagLinks()).toEqual(expected);
  });

  it("reach companies resolved before the project was tagged", async () => {
    await project(1, { participants: 2 });
    await resolveGrantsStep({ db, now });
    expect(await grantTagLinks()).toEqual([]);

    await tagGrantsStep({
      db,
      llm: fakeLlm(tagAll),
      budget: budget(),
      model,
      maxProjects: 10,
    });
    const late = await resolveGrantsStep({ db, now });
    expect(late.participantsResolved).toBe(0);
    expect(late.tagsApplied).toBe(4);

    const repeat = await resolveGrantsStep({ db, now });
    expect(repeat.tagsApplied).toBe(0);
    const links = await grantTagLinks();
    expect(links).toHaveLength(4);
    expect(links.every((link) => link.source === "grant")).toBe(true);
    expect(links.every((link) => link.mentions === 1)).toBe(true);
  });
});
