import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EVENT_TYPES, ROUND_TYPES, SOURCE_ITEM_STATUSES } from "@/core/enums";
import type { FundingFilters } from "@/core/read-models";
import { normaliseCompanyName, slugify } from "@/lib/normalise";
import { regionForCountry } from "@/lib/regions";
import type { Db } from "../client";
import {
  companies,
  companyAliases,
  events,
  fundingRounds,
  llmUsage,
  sourceItems,
  sourceItemTexts,
} from "../schema";
import { isLocalSeedTarget, seedDatabase } from "../seed";
import { SEED_REFERENCE } from "../seed-data";
import { createTestDb, type TestDb } from "../testing";
import { getCompanyDetail } from "./companies";
import { listFundingRounds } from "./funding";
import { getInvestorDetail } from "./investors";
import { getStatusSummary } from "./status";

function filters(overrides: Partial<FundingFilters> = {}): FundingFilters {
  return { page: 1, pageSize: 100, ...overrides };
}

async function insertRound(
  database: Db,
  name: string,
  announcedOn: string,
  alias?: string,
): Promise<string> {
  const slug = slugify(name);
  const [company] = await database
    .insert(companies)
    .values({
      slug,
      name,
      normalisedName: normaliseCompanyName(name),
      countryCode: "GB",
    })
    .returning({ id: companies.id });
  if (!company) throw new Error("Company insert failed");
  if (alias) {
    await database.insert(companyAliases).values({
      companyId: company.id,
      alias,
      normalisedAlias: normaliseCompanyName(alias),
      source: "manual",
    });
  }
  const [event] = await database
    .insert(events)
    .values({
      type: "funding_round",
      companyId: company.id,
      announcedOn,
      sourceCount: 0,
    })
    .returning({ id: events.id });
  if (!event) throw new Error("Event insert failed");
  await database.insert(fundingRounds).values({
    eventId: event.id,
    roundType: "seed",
    amountMinor: 10_000_000,
    currency: "GBP",
    amountGbpMinor: 10_000_000,
    amountUsdMinor: 12_500_000,
  });
  return slug;
}

describe("isLocalSeedTarget", () => {
  it("allows localhost and --force, and refuses other hosts", () => {
    expect(isLocalSeedTarget("postgres://localhost/signalfeed", false)).toBe(
      true,
    );
    expect(isLocalSeedTarget("postgres://db.example/signalfeed", false)).toBe(
      false,
    );
    expect(isLocalSeedTarget("postgres://db.example/signalfeed", true)).toBe(
      true,
    );
    expect(isLocalSeedTarget("", false)).toBe(false);
  });
});

describe("read queries", () => {
  let testDb: TestDb;
  let db: Db;

  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    await seedDatabase(db);
  }, 60_000);

  afterEach(async () => {
    await testDb.close();
  });

  it("narrows results for each filter", async () => {
    const all = await listFundingRounds(db, filters());
    expect(all.total).toBe(SEED_REFERENCE.listedFundingRounds);
    expect(all.items).toHaveLength(all.total);
    expect(
      all.items.some(
        (row) => row.companySlug === SEED_REFERENCE.mergedCompanySlug,
      ),
    ).toBe(false);

    const uk = await listFundingRounds(db, filters({ regions: ["UK"] }));
    expect(uk.total).toBeGreaterThan(0);
    expect(uk.total).toBeLessThan(all.total);
    expect(uk.total).toBe(
      all.items.filter((row) => row.countryCode === "GB").length,
    );
    expect(uk.items.every((row) => row.countryCode === "GB")).toBe(true);

    const europe = await listFundingRounds(
      db,
      filters({ regions: ["Europe"] }),
    );
    expect(europe.total).toBeGreaterThan(0);
    expect(europe.total).toBeLessThan(all.total);
    expect(europe.total).toBe(
      all.items.filter((row) => regionForCountry(row.countryCode) === "Europe")
        .length,
    );
    expect(
      europe.items.every(
        (row) => regionForCountry(row.countryCode) === "Europe",
      ),
    ).toBe(true);

    const unitedStates = await listFundingRounds(
      db,
      filters({ countryCodes: ["US"] }),
    );
    expect(unitedStates.total).toBeGreaterThan(0);
    expect(unitedStates.total).toBeLessThan(all.total);
    expect(unitedStates.items.every((row) => row.countryCode === "US")).toBe(
      true,
    );

    const seriesA = await listFundingRounds(
      db,
      filters({ roundTypes: ["series_a"] }),
    );
    expect(seriesA.total).toBeGreaterThan(0);
    expect(seriesA.total).toBeLessThan(all.total);
    expect(seriesA.items.every((row) => row.roundType === "series_a")).toBe(
      true,
    );

    const tagged = await listFundingRounds(
      db,
      filters({ tag: SEED_REFERENCE.tagSlug }),
    );
    expect(tagged.total).toBeGreaterThan(0);
    expect(tagged.total).toBeLessThan(all.total);
    expect(
      tagged.items.every((row) =>
        row.tags.some((tag) => tag.slug === SEED_REFERENCE.tagSlug),
      ),
    ).toBe(true);

    const invested = await listFundingRounds(
      db,
      filters({ investorSlug: SEED_REFERENCE.investorSlug }),
    );
    const led = all.items.filter((row) =>
      row.leadInvestors.some(
        (investor) => investor.slug === SEED_REFERENCE.investorSlug,
      ),
    );
    expect(invested.total).toBeGreaterThan(0);
    expect(invested.total).toBeLessThan(all.total);
    expect(invested.total).toBe(led.length);
    expect(
      invested.items.every((row) =>
        row.leadInvestors.some(
          (investor) => investor.slug === SEED_REFERENCE.investorSlug,
        ),
      ),
    ).toBe(true);

    const dates = all.items.map((row) => row.announcedOn).sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    expect(earliest).toBeDefined();
    expect(latest).toBeDefined();
    expect(earliest).not.toBe(latest);
    const fromLatest = await listFundingRounds(db, filters({ from: latest }));
    expect(fromLatest.total).toBeGreaterThan(0);
    expect(fromLatest.total).toBeLessThan(all.total);
    expect(fromLatest.items.every((row) => row.announcedOn >= latest!)).toBe(
      true,
    );
    const inclusive = await listFundingRounds(
      db,
      filters({ from: earliest, to: earliest }),
    );
    expect(inclusive.total).toBeGreaterThan(0);
    expect(inclusive.items.every((row) => row.announcedOn === earliest)).toBe(
      true,
    );

    const priced = all.items
      .map((row) => row.amountGbpMinor)
      .filter((amount): amount is number => amount != null);
    const low = Math.min(...priced);
    const high = Math.max(...priced);
    expect(high).toBeGreaterThan(low);
    const mid = low + Math.floor((high - low) / 2);
    const minFiltered = await listFundingRounds(
      db,
      filters({ minGbpMinor: mid }),
    );
    expect(minFiltered.total).toBeGreaterThan(0);
    expect(minFiltered.total).toBeLessThan(all.total);
    expect(
      minFiltered.items.every(
        (row) => row.amountGbpMinor != null && row.amountGbpMinor >= mid,
      ),
    ).toBe(true);
    const maxFiltered = await listFundingRounds(
      db,
      filters({ maxGbpMinor: mid }),
    );
    expect(maxFiltered.total).toBeGreaterThan(0);
    expect(maxFiltered.total).toBeLessThan(all.total);
    expect(
      maxFiltered.items.every(
        (row) => row.amountGbpMinor != null && row.amountGbpMinor <= mid,
      ),
    ).toBe(true);

    const searched = await listFundingRounds(
      db,
      filters({ q: "Northwind Robotics" }),
    );
    expect(searched.total).toBeGreaterThan(0);
    expect(searched.total).toBeLessThan(all.total);
    expect(
      searched.items.every((row) =>
        row.companyName.toLowerCase().includes("northwind"),
      ),
    ).toBe(true);
    expect(
      searched.items.some(
        (row) => row.companySlug === SEED_REFERENCE.liveCompanySlug,
      ),
    ).toBe(true);

    const intersection = await listFundingRounds(
      db,
      filters({ regions: ["UK"], countryCodes: ["US"] }),
    );
    expect(intersection.total).toBe(0);
  }, 60_000);

  it("ranks the closest company name first even when that round is the oldest", async () => {
    const exact = await insertRound(db, "Zzylophone", "2015-01-15");
    const newer = await insertRound(db, "Zzylophone Logistics", "2026-09-01");

    const ranked = await listFundingRounds(db, {
      q: "Zzylophone",
      page: 1,
      pageSize: 25,
    });

    expect(ranked.items.map((item) => item.companySlug)).toEqual([
      exact,
      newer,
    ]);
    expect(ranked.items[0]?.announcedOn).toBe("2015-01-15");
    expect(ranked.items[1]?.announcedOn).toBe("2026-09-01");
    expect(ranked.items[0]!.announcedOn < ranked.items[1]!.announcedOn).toBe(
      true,
    );
  });

  it("lets an explicit announced sort ignore relevance", async () => {
    const exact = await insertRound(db, "Zzylophone", "2015-01-15");
    const newer = await insertRound(db, "Zzylophone Logistics", "2026-09-01");

    const byDate = await listFundingRounds(db, {
      q: "Zzylophone",
      sort: "announced",
      page: 1,
      pageSize: 25,
    });

    expect(byDate.items.map((item) => item.companySlug)).toEqual([
      newer,
      exact,
    ]);
  });

  it("ranks an exact alias ahead of a weaker newer name", async () => {
    const aliasMatch = await insertRound(
      db,
      "Quill Oak Press",
      "2014-02-02",
      "Qxvzephyr",
    );
    const newer = await insertRound(db, "Qxvzephyr Holdings", "2026-07-07");

    const ranked = await listFundingRounds(db, {
      q: "Qxvzephyr",
      page: 1,
      pageSize: 25,
    });

    expect(ranked.items.map((item) => item.companySlug)).toEqual([
      aliasMatch,
      newer,
    ]);
    expect(ranked.items[0]!.announcedOn < ranked.items[1]!.announcedOn).toBe(
      true,
    );
  });

  it("puts null amounts last when sorting by amount", async () => {
    const listed = await listFundingRounds(
      db,
      filters({ sort: "amount", direction: "desc" }),
    );
    const amounts = listed.items.map((row) => row.amountGbpMinor);
    const firstNull = amounts.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(amounts.slice(firstNull).every((amount) => amount == null)).toBe(
      true,
    );
    const numbers = amounts.filter(
      (amount): amount is number => amount != null,
    );
    expect(numbers).toEqual([...numbers].sort((left, right) => right - left));

    const ascending = await listFundingRounds(
      db,
      filters({ sort: "amount", direction: "asc" }),
    );
    const ascendingAmounts = ascending.items.map((row) => row.amountGbpMinor);
    const ascendingNull = ascendingAmounts.indexOf(null);
    expect(ascendingNull).toBeGreaterThan(0);
    expect(
      ascendingAmounts.slice(ascendingNull).every((amount) => amount == null),
    ).toBe(true);
    const ascendingNumbers = ascendingAmounts.filter(
      (amount): amount is number => amount != null,
    );
    expect(ascendingNumbers).toEqual(
      [...ascendingNumbers].sort((left, right) => left - right),
    );
  });

  it("reports pagination totals", async () => {
    const pageSize = 25;
    const first = await listFundingRounds(db, { page: 1, pageSize });
    expect(first.total).toBe(SEED_REFERENCE.listedFundingRounds);
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(pageSize);
    expect(first.items).toHaveLength(pageSize);

    const pageCount = Math.ceil(first.total / pageSize);
    const seen = new Set<number>();
    let count = 0;
    for (let page = 1; page <= pageCount; page += 1) {
      const result = await listFundingRounds(db, { page, pageSize });
      expect(result.total).toBe(first.total);
      for (const item of result.items) {
        expect(seen.has(item.eventId)).toBe(false);
        seen.add(item.eventId);
      }
      count += result.items.length;
    }
    expect(count).toBe(first.total);

    const capped = await listFundingRounds(db, { page: 1, pageSize: 500 });
    expect(capped.pageSize).toBe(100);
    expect(capped.total).toBe(first.total);
    expect(capped.items).toHaveLength(Math.min(100, capped.total));
    const dates = capped.items.map((row) => row.announcedOn);
    expect(dates).toEqual(
      [...dates].sort((left, right) =>
        left < right ? 1 : left > right ? -1 : 0,
      ),
    );

    const invalid = await listFundingRounds(db, { page: 0, pageSize: 0 });
    expect(invalid.page).toBe(1);
    expect(invalid.pageSize).toBe(25);
  });

  it("excludes merged companies and redirects their detail", async () => {
    const merged = await getCompanyDetail(db, SEED_REFERENCE.mergedCompanySlug);
    expect(merged).not.toBeNull();
    expect(merged?.redirectToSlug).toBe(SEED_REFERENCE.liveCompanySlug);
    const mergedEventIds = new Set(merged?.events.map((event) => event.id));
    expect(mergedEventIds.size).toBeGreaterThan(0);

    const listed = await listFundingRounds(db, filters());
    expect(listed.items.every((row) => !mergedEventIds.has(row.eventId))).toBe(
      true,
    );
    expect(
      listed.items.some(
        (row) => row.companySlug === SEED_REFERENCE.mergedCompanySlug,
      ),
    ).toBe(false);
  });

  it("returns company events with sources and never article text", async () => {
    const detail = await getCompanyDetail(db, SEED_REFERENCE.liveCompanySlug);
    expect(detail?.redirectToSlug).toBeNull();
    expect(detail?.city).toBe("London");
    expect(detail?.countryCode).toBe("GB");
    expect(detail?.tags.some((tag) => tag.slug === "robotics")).toBe(true);
    const timeline = detail?.events ?? [];
    expect(timeline.length).toBeGreaterThan(1);
    for (let index = 1; index < timeline.length; index += 1) {
      const previous = timeline[index - 1];
      const current = timeline[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (!previous || !current) continue;
      expect(
        previous.announcedOn > current.announcedOn ||
          (previous.announcedOn === current.announcedOn &&
            previous.id >= current.id),
      ).toBe(true);
    }
    expect(timeline.every((event) => event.sources.length > 0)).toBe(true);
    expect(timeline.some((event) => event.sources.length >= 2)).toBe(true);
    expect(timeline.some((event) => event.type === "funding_round")).toBe(true);
    expect(timeline.some((event) => event.type === "launch")).toBe(true);
    const source = timeline[0]?.sources[0];
    expect(source?.title.length).toBeGreaterThan(0);
    expect(source?.url).toContain("https://example.com/");
    expect(source?.sourceName).toBe(SEED_REFERENCE.sourceName);
    expect(source?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const acquired = await getCompanyDetail(
      db,
      SEED_REFERENCE.acquiredCompanySlug,
    );
    const acquisition = acquired?.events.find(
      (event) => event.type === "acquisition",
    );
    expect(acquisition?.type).toBe("acquisition");
    if (acquisition?.type === "acquisition") {
      expect(acquisition.acquirer?.slug).toBe(SEED_REFERENCE.liveCompanySlug);
      expect(acquisition.acquirerName).toBe("Northwind Robotics");
      expect(acquisition.sources[0]?.url).toContain("https://example.com/");
    }

    const items = await db.select({ id: sourceItems.id }).from(sourceItems);
    await db.insert(sourceItemTexts).values(
      items.map((item) => ({
        sourceItemId: item.id,
        summary: "SECRET_ARTICLE_BODY",
      })),
    );
    const again = await getCompanyDetail(db, SEED_REFERENCE.liveCompanySlug);
    expect(JSON.stringify(again)).not.toContain("SECRET_ARTICLE_BODY");
    expect(await getCompanyDetail(db, "missing-company")).toBeNull();
  });

  it("returns investor rounds and a count for every round type", async () => {
    const detail = await getInvestorDetail(db, SEED_REFERENCE.investorSlug);
    expect(detail?.redirectToSlug).toBeNull();
    expect(detail?.rounds.length).toBeGreaterThan(0);
    expect(detail?.rounds.every((round) => round.role === "lead")).toBe(true);
    expect(Object.keys(detail?.roundTypeCounts ?? {}).sort()).toEqual(
      [...ROUND_TYPES].sort(),
    );
    const sum = Object.values(detail?.roundTypeCounts ?? {}).reduce(
      (total, count) => total + count,
      0,
    );
    expect(sum).toBe(detail?.rounds.length);

    const merged = await getInvestorDetail(
      db,
      SEED_REFERENCE.mergedInvestorSlug,
    );
    expect(merged?.redirectToSlug).toBe(SEED_REFERENCE.survivingInvestorSlug);
    expect(await getInvestorDetail(db, "missing-investor")).toBeNull();
  });

  it("sums the current month's spend and reads the latest cap", async () => {
    const summary = await getStatusSummary(db);
    expect(summary.monthToDateUsdMicros).toBe(
      SEED_REFERENCE.currentMonthUsdMicros,
    );
    expect(summary.monthToDateUsdMicros).not.toBe(
      SEED_REFERENCE.currentMonthUsdMicros +
        SEED_REFERENCE.previousMonthUsdMicros,
    );
    expect(summary.capGbp).toBe(SEED_REFERENCE.latestCapGbp);
    expect(summary.recentRuns[0]?.stats?.capGbp).toBe(
      SEED_REFERENCE.latestCapGbp,
    );
    expect(
      summary.recentRuns.some(
        (run) => run.stats?.capGbp === SEED_REFERENCE.olderCapGbp,
      ),
    ).toBe(true);
    const started = summary.recentRuns.map((run) => run.startedAt);
    expect(started).toEqual(
      [...started].sort((left, right) =>
        left < right ? 1 : left > right ? -1 : 0,
      ),
    );
    expect(summary.recentRuns).toHaveLength(3);
    for (const status of SOURCE_ITEM_STATUSES) {
      expect(summary.itemCountsByStatus[status]).toBeGreaterThan(0);
    }
    for (const type of EVENT_TYPES) {
      expect(summary.eventCountsByType[type]).toBeGreaterThan(0);
    }

    await db.insert(llmUsage).values({
      occurredAt: new Date(Date.UTC(2020, 0, 15)),
      purpose: "extraction",
      model: "gpt-4.1-nano",
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 111,
    });
    await db.insert(llmUsage).values({
      occurredAt: new Date(),
      purpose: "extraction",
      model: "gpt-4.1-nano",
      inputTokens: 1,
      outputTokens: 1,
      costUsdMicros: 222,
    });
    const after = await getStatusSummary(db);
    expect(after.monthToDateUsdMicros).toBe(summary.monthToDateUsdMicros + 222);
  });
});
