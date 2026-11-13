import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyLocations,
  events,
  fundingRounds,
  registryLinks,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { RateLimitedError, createChClient, type ChClient } from "./ch-client";
import { createWindowLimiter } from "./rate-limit";
import { registryStep } from "./registry-step";
import { fakeChFetcher, jsonResponse, loadChFixture } from "./testing";

const NOW = new Date("2026-11-12T09:00:00Z");
const KEY = "test-key-abc123";
const clock = { now: () => NOW };

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

/** A real client over a fake fetcher that serves the fixtures. */
function fixtureClient(respond = route) {
  const fake = fakeChFetcher(respond);
  const sleep = vi.fn(() => Promise.resolve());
  const client = createChClient({
    http: fake.fetcher,
    apiKey: KEY,
    limiter: createWindowLimiter({
      max: 500,
      windowMs: 300_000,
      clock: { now: () => new Date(0) },
      sleep,
    }),
    sleep,
  });
  return { client, fake };
}

function route(path: string) {
  if (path.startsWith("/search/"))
    return jsonResponse(loadChFixture("search.json"));
  if (path.includes("/filing-history"))
    return jsonResponse(loadChFixture("filing-history-capital.json"));
  if (path.startsWith("/advanced-search/"))
    return jsonResponse(loadChFixture("advanced-search-location.json"));
  if (path === "/company/09100417")
    return jsonResponse(loadChFixture("profile-active.json"));
  if (path === "/company/09100558")
    return jsonResponse(loadChFixture("profile-dissolved.json"));
  if (path === "/company/09100632")
    return jsonResponse(loadChFixture("profile-dormant.json"));
  return jsonResponse("not found", 404);
}

/** A UK company named like the active fixture, with a round and a town. */
async function kestrelLantern() {
  const [company] = await db
    .insert(companies)
    .values({
      slug: "kestrel-lantern-labs",
      name: "Kestrel Lantern Labs",
      normalisedName: "kestrel lantern labs",
      countryCode: "GB",
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId: company!.id,
      announcedOn: "2026-04-01",
    })
    .returning();
  await db
    .insert(fundingRounds)
    .values({ eventId: event!.id, roundType: "seed" });
  await db.insert(companyLocations).values({
    companyId: company!.id,
    countryCode: "GB",
    placeSlug: "exeter",
    latitude: 50.7236,
    longitude: -3.5275,
    precision: "town",
    source: "news_city",
  });
  return company!;
}

describe("registryStep", () => {
  it("is skipped without a client", async () => {
    const log = vi.fn();
    const stats = await registryStep({
      db,
      client: null,
      clock,
      maxRequests: 100,
      log,
    });
    expect(stats.skipped).toBe(true);
    expect(stats.requests).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "registry: skipped, no Companies House key",
    );
  });

  it("never calls officers, PSC or charges paths, and logs no key or postcode", async () => {
    await kestrelLantern();
    const { client, fake } = fixtureClient();
    const lines: string[] = [];
    const stats = await registryStep({
      db,
      client,
      clock,
      maxRequests: 100,
      log: (line) => lines.push(line),
    });
    expect(fake.paths.length).toBeGreaterThan(0);
    expect(fake.paths.some((p) => p.startsWith("/search/"))).toBe(true);
    expect(fake.paths.some((p) => p.startsWith("/company/09100417"))).toBe(
      true,
    );
    for (const path of fake.paths) {
      expect(path).not.toMatch(
        /officers|persons-with-significant-control|psc|charges|appointments/,
      );
    }
    expect(stats.requests).toBe(fake.paths.length);
    const text = lines.join("\n");
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/);
  });

  it("never exceeds maxRequests across linking and refreshing", async () => {
    await kestrelLantern();
    for (const max of [0, 1, 2, 3, 5, 8]) {
      const { client, fake } = fixtureClient();
      const stats = await registryStep({
        db,
        client,
        clock,
        maxRequests: max,
        log: () => undefined,
      });
      expect(fake.paths.length).toBeLessThanOrEqual(max);
      expect(stats.requests).toBe(fake.paths.length);
    }
  });

  it("refreshes a linked profile in the same run when requests remain", async () => {
    const [company] = await db
      .insert(companies)
      .values({
        slug: "kestrel-lantern",
        name: "Kestrel Lantern Labs",
        normalisedName: "kestrel lantern labs",
        countryCode: "US",
      })
      .returning();
    await db.insert(registryLinks).values({
      companyId: company!.id,
      registry: "companies_house",
      registryId: "09100417",
      registryName: "KESTREL LANTERN LABS LIMITED",
      status: "linked",
      method: "manual",
      reason: "test",
      decidedBy: "manual",
    });
    const { client, fake } = fixtureClient();
    const stats = await registryStep({
      db,
      client,
      clock,
      maxRequests: 100,
      log: () => undefined,
    });
    expect(stats.profilesRefreshed).toBe(1);
    expect(fake.paths).toEqual(["/company/09100417"]);
  });

  it("ends with rateLimited and a normal result on RateLimitedError", async () => {
    await kestrelLantern();
    const { client } = fixtureClient();
    const limited: ChClient = {
      ...client,
      searchCompanies: () => Promise.reject(new RateLimitedError()),
    };
    const stats = await registryStep({
      db,
      client: limited,
      clock,
      maxRequests: 100,
      log: () => undefined,
    });
    expect(stats.rateLimited).toBe(true);
    expect(stats.skipped).toBeUndefined();
  });

  it("ends with rateLimited when Companies House answers 429 twice", async () => {
    await kestrelLantern();
    const { client } = fixtureClient(() => jsonResponse("slow down", 429));
    const stats = await registryStep({
      db,
      client,
      clock,
      maxRequests: 100,
      log: () => undefined,
    });
    expect(stats.rateLimited).toBe(true);
    expect(stats.requests).toBe(2);
  });
});
