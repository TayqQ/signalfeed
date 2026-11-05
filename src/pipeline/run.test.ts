import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceConfig } from "@/core/domain";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import type {
  Collector,
  CollectResult,
  FxProvider,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
} from "@/core/ports";
import { ExtractionValidationError } from "@/core/errors";
import {
  events,
  fundingRounds,
  ingestRuns,
  llmUsage,
  sourceItems,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { createBudgetGuard } from "./budget/budget-guard";
import { singleConnectionLock, withIngestLock } from "./lock";
import { reextractStep, runAll, type PipelineDeps } from "./run";
import { EXTRACTION_PROMPT_VERSION } from "./extract/prompt";

const NOW = new Date("2026-06-10T12:00:00Z");

function headline(id: string, title: string): CollectResult["items"][number] {
  return {
    sourceSlug: "x",
    externalId: id,
    url: `https://news.test/${id}`,
    title,
    summary: "A short feed summary.",
    publishedAt: new Date("2026-06-09T12:00:00Z"),
  };
}

function fakeCollector(
  bySlug: Record<string, CollectResult["items"] | Error>,
): Collector {
  return {
    collect(source: SourceConfig): Promise<CollectResult> {
      const entry = bySlug[source.slug];
      if (entry instanceof Error) return Promise.reject(entry);
      return Promise.resolve({
        items: entry ?? [],
        etag: null,
        lastModified: null,
        notModified: false,
      });
    },
  };
}

function fundingEvent(name: string): ExtractedEventV1 {
  return {
    type: "funding_round",
    company: {
      name,
      websiteDomain: null,
      description: null,
      countryCode: null,
      city: null,
      foundedYear: null,
      tags: ["ai agents"],
    },
    announcedOn: null,
    funding: {
      roundType: "seed",
      roundLabel: null,
      amountText: "€4M",
      currencyHint: null,
      investors: [{ name: "Example Ventures", kind: "vc", isLead: true }],
      includesIndividualAngels: false,
    },
    acquisition: null,
    launch: null,
  };
}

/** Answers from the title's first word, and counts calls. */
function fakeLlm(options: { fail?: (user: string) => Error | null } = {}) {
  const state = { calls: 0 };
  const llm: LlmClient = {
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      state.calls += 1;
      const failure = options.fail?.(request.user);
      if (failure) return Promise.reject(failure);
      const name = /Title: (\S+)/.exec(request.user)?.[1] ?? "Unknown";
      const data: ExtractionV1 = {
        isRelevant: true,
        events: [fundingEvent(name)],
      };
      return Promise.resolve({
        data: data as T,
        usage: { inputTokens: 1000, outputTokens: 200 },
        model: "gpt-4.1-nano",
      });
    },
  };
  return { llm, state };
}

const fakeFx: FxProvider = {
  getRates: (date) =>
    Promise.resolve({
      date,
      perEur: { EUR: 1, USD: 1.25, GBP: 0.8 },
    }),
};

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

function deps(
  llm: LlmClient | null,
  collector: Collector,
  overrides: { capGbp?: number; max?: number } = {},
): PipelineDeps {
  const clock = { now: () => NOW };
  return {
    db: testDb.db,
    collector,
    llm,
    budget: createBudgetGuard({
      db: testDb.db,
      clock,
      capGbp: overrides.capGbp ?? 3,
    }),
    fx: fakeFx,
    clock,
    config: {
      model: "gpt-4.1-nano",
      maxExtractionsPerRun: overrides.max ?? 150,
      capGbp: overrides.capGbp ?? 3,
    },
    log: () => undefined,
  };
}

const lock = () => singleConnectionLock(testDb.db);

const twoRaises = {
  "techcrunch-venture": [
    headline("1", "Alpha raises €4M seed"),
    headline("2", "Beta raises €4M seed"),
    headline("3", "Five things about conferences"),
  ],
};

describe("runAll", () => {
  it("creates events and records stats", async () => {
    const { llm, state } = fakeLlm();
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises)),
      lock(),
      "manual",
    );
    expect(summary.status).toBe("succeeded");
    expect(state.calls).toBe(2);
    expect(summary.stats?.collect.itemsInserted).toBe(3);
    expect(summary.stats?.prefilter.itemsFilteredOut).toBe(1);
    expect(summary.stats?.extract.itemsExtracted).toBe(2);
    expect(summary.stats?.resolve.eventsCreated).toBe(2);
    expect(summary.stats?.resolve.investorsCreated).toBe(1);
    expect(summary.stats?.spendUsdMicros).toBeGreaterThan(0);

    const [round] = await testDb.db.select().from(fundingRounds);
    expect(round?.amountUsdMinor).toBe(500_000_000);
    expect(round?.amountGbpMinor).toBe(320_000_000);

    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();

    const usage = await testDb.db.select().from(llmUsage);
    expect(usage).toHaveLength(2);
    expect(usage[0]?.sourceItemId).not.toBeNull();
    expect(usage[0]?.ingestRunId).toBe(run?.id);
  });

  it("makes zero LLM calls on a second run with the same feed", async () => {
    const { llm, state } = fakeLlm();
    const collector = fakeCollector(twoRaises);
    await runAll(deps(llm, collector), lock(), "manual");
    const callsAfterFirst = state.calls;
    const second = await runAll(deps(llm, collector), lock(), "manual");
    expect(state.calls).toBe(callsAfterFirst);
    expect(second.stats?.collect.itemsInserted).toBe(0);
    expect(await testDb.db.select().from(events)).toHaveLength(2);
  });

  it("does no work when the lock is already held", async () => {
    const { llm, state } = fakeLlm();
    const held = {
      tryAcquire: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises)),
      held,
      "manual",
    );
    expect(summary).toEqual({ ran: false });
    expect(state.calls).toBe(0);
    expect(await testDb.db.select().from(ingestRuns)).toHaveLength(0);
  });

  it("pauses at the budget, leaves items pending and resolves what it has", async () => {
    const { llm } = fakeLlm();
    // A cap that fits one worst-case call and not two (1.0 USD per GBP with no rates).
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises), { capGbp: 0.0007 }),
      lock(),
      "schedule",
    );
    expect(summary.status).toBe("budget_paused");
    expect(summary.stats?.budgetPaused).toBe(true);
    expect(summary.stats?.extract.itemsExtracted).toBe(1);
    expect(summary.stats?.resolve.extractionsResolved).toBe(1);
    const pending = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.status, "pending"));
    expect(pending).toHaveLength(1);
  });

  it("keeps going when one feed fails", async () => {
    const { llm } = fakeLlm();
    const summary = await runAll(
      deps(
        llm,
        fakeCollector({
          "techcrunch-venture": new Error("HTTP 500"),
          "tech-eu": [headline("1", "Alpha raises €4M seed")],
        }),
      ),
      lock(),
      "manual",
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.stats?.collect.sourcesFailed).toBe(1);
    expect(summary.stats?.extract.itemsExtracted).toBe(1);
  });

  it("keeps collecting with no key and leaves items pending", async () => {
    const summary = await runAll(
      deps(null, fakeCollector(twoRaises)),
      lock(),
      "schedule",
    );
    expect(summary.status).toBe("succeeded");
    expect(summary.stats?.collect.itemsInserted).toBe(3);
    expect(summary.stats?.extract.skipped).toBe(true);
    const pending = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.status, "pending"));
    expect(pending).toHaveLength(2);
  });

  it("does not use up attempts when the provider refuses", async () => {
    const quota = Object.assign(new Error("insufficient_quota"), {
      status: 429,
    });
    const { llm } = fakeLlm({ fail: () => quota });
    const summary = await runAll(
      deps(llm, fakeCollector(twoRaises)),
      lock(),
      "manual",
    );
    expect(summary.status).toBe("failed");
    expect(summary.stats?.extract.providerError).toBe("insufficient_quota");
    const items = await testDb.db
      .select()
      .from(sourceItems)
      .orderBy(asc(sourceItems.id));
    expect(items.every((item) => item.attempts === 0)).toBe(true);
  });

  it("fails an item after three bad responses and carries on", async () => {
    const invalid = new ExtractionValidationError([
      { path: ["events"], message: "bad" },
    ]);
    const { llm } = fakeLlm({
      fail: (user) => (user.includes("Alpha") ? invalid : null),
    });
    const collector = fakeCollector(twoRaises);
    for (let run = 0; run < 3; run += 1) {
      await runAll(deps(llm, collector), lock(), "manual");
    }
    const [alpha] = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.externalId, "1"));
    expect(alpha?.status).toBe("failed");
    expect(alpha?.attempts).toBe(3);
    const [beta] = await testDb.db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.externalId, "2"));
    expect(beta?.status).toBe("extracted");
  });

  it("marks a run failed and rethrows on an unexpected error", async () => {
    const { llm } = fakeLlm();
    const unpriced = deps(llm, fakeCollector(twoRaises));
    unpriced.config.model = "not-a-real-model";
    await expect(runAll(unpriced, lock(), "manual")).rejects.toThrow(
      /No price/,
    );
    const [run] = await testDb.db.select().from(ingestRuns);
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/No price/);
  });
});

describe("reextractStep", () => {
  it("makes zero LLM calls on a dry run", async () => {
    const { llm, state } = fakeLlm();
    const run = deps(llm, fakeCollector(twoRaises));
    await runAll(run, lock(), "manual");
    const before = state.calls;
    await testDb.db.execute("update extractions set prompt_version = 'v0'");
    const summary = await reextractStep(run, {
      promptVersion: EXTRACTION_PROMPT_VERSION,
      limit: 10,
      dryRun: true,
      yes: false,
    });
    expect(state.calls).toBe(before);
    expect(summary.items).toBe(2);
    expect(summary.estimatedUsdMicros).toBeGreaterThan(0);
  });

  it("refuses a real run without --yes", async () => {
    const { llm } = fakeLlm();
    await expect(
      reextractStep(deps(llm, fakeCollector({})), {
        promptVersion: EXTRACTION_PROMPT_VERSION,
        limit: 10,
        dryRun: false,
        yes: false,
      }),
    ).rejects.toThrow(/--yes/);
  });
});

describe("singleConnectionLock", () => {
  it("excludes a second holder until released", async () => {
    const first = singleConnectionLock(testDb.db);
    const inner = await withIngestLock(first, () => Promise.resolve("work"));
    expect(inner).toEqual({ ran: true, result: "work" });
  });
});
