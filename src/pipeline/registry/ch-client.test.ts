import { describe, expect, it, vi } from "vitest";
import { RateLimitedError, createChClient } from "./ch-client";
import { createWindowLimiter } from "./rate-limit";
import {
  fakeChClient,
  fakeChFetcher,
  jsonResponse,
  loadChFixture,
} from "./testing";

const KEY = "test-key-abc123";

function setup(
  respond: (path: string, call: number) => ReturnType<typeof jsonResponse>,
) {
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
  return { fake, client, sleep };
}

function route(path: string) {
  if (path.startsWith("/search/"))
    return jsonResponse(loadChFixture("search.json"));
  if (path.includes("filing-history"))
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

describe("createChClient", () => {
  it("maps search items and keeps dates as YYYY-MM-DD", async () => {
    const { client, fake } = setup(route);
    const hits = await client.searchCompanies("Kestrel Lantern");
    expect(hits).toHaveLength(5);
    expect(hits[0]).toMatchObject({
      companyNumber: "09100417",
      status: "active",
      incorporatedOn: "2019-08-30",
      postcode: "EX2 4AB",
    });
    expect(hits[1]?.ceasedOn).toBe("2026-07-21");
    expect(fake.paths[0]).toBe(
      "/search/companies?q=Kestrel%20Lantern&items_per_page=50",
    );
  });

  it("maps active, dormant and dissolved profiles and ignores unknown fields", async () => {
    const { client } = setup(route);
    const active = await client.getCompany("9100417");
    expect(active).toMatchObject({
      companyNumber: "09100417",
      status: "active",
      companyType: "ltd",
      incorporatedOn: "2010-09-23",
      ceasedOn: null,
      sicCodes: ["72190"],
      officePostcode: "EX2 4AB",
      officeOutcode: "EX2",
      accountsType: "full",
      accountsMadeUpTo: "2025-12-31",
      previousNames: ["WILLOW PEAK 2022 LIMITED"],
      hasInsolvencyHistory: false,
    });
    const dormant = await client.getCompany("09100632");
    expect(dormant?.accountsType).toBe("dormant");
    const dissolved = await client.getCompany("09100558");
    expect(dissolved?.ceasedOn).toBe("2023-06-06");
  });

  it("returns null for a 404 profile", async () => {
    const { client } = setup(route);
    expect(await client.getCompany("09999999")).toBeNull();
  });

  it("returns SH01 filings only, newest first", async () => {
    const { client, fake } = setup(route);
    const filings = await client.getCapitalFilings("09100417");
    expect(filings.map((f) => f.type)).toEqual(["SH01", "SH01", "SH01"]);
    expect(filings.map((f) => f.filedOn)).toEqual([
      "2019-10-24",
      "2014-02-05",
      "2013-12-06",
    ]);
    expect(filings[1]).toMatchObject({
      actionDate: "2014-01-24",
      capital: [{ currency: "GBP", figure: "1,640.64" }],
    });
    expect(fake.paths).toHaveLength(1);
    expect(fake.paths[0]).toContain("category=capital&items_per_page=100");
  });

  it("stops at since", async () => {
    const { client } = setup(route);
    const filings = await client.getCapitalFilings("09100417", {
      since: "2019-01-01",
    });
    expect(filings.map((f) => f.filedOn)).toEqual(["2019-10-24"]);
  });

  it("counts active companies at a postcode", async () => {
    const { client, fake } = setup(route);
    expect(await client.countActiveAtPostcode("ex24ab")).toBe(331);
    expect(fake.paths[0]).toBe(
      "/advanced-search/companies?location=EX2%204AB&company_status=active&size=1",
    );
    expect(await client.countActiveAtPostcode("not a postcode")).toBeNull();
  });

  it("sends Basic auth and JSON accept, and counts requests", async () => {
    const { client, fake } = setup(route);
    await client.getCompany("09100417");
    await client.searchCompanies("x");
    expect(fake.headers[0]).toEqual({
      Authorization: `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`,
      Accept: "application/json",
    });
    expect(client.requestsMade()).toBe(2);
  });

  it("never requests officers, PSC or charges", async () => {
    const { client, fake } = setup(route);
    await client.searchCompanies("a");
    await client.getCompany("09100417");
    await client.getCapitalFilings("09100417");
    await client.countActiveAtPostcode("EX2 4AB");
    for (const p of fake.paths) {
      expect(p).not.toMatch(
        /officers|persons-with-significant-control|charges/,
      );
    }
  });

  it("waits for the window on 429 and retries once", async () => {
    const { client, sleep, fake } = setup((p, call) =>
      call === 1 ? jsonResponse("slow down", 429) : route(p),
    );
    expect(await client.getCompany("09100417")).not.toBeNull();
    expect(sleep).toHaveBeenCalledWith(300_000);
    expect(fake.paths).toHaveLength(2);
    expect(client.requestsMade()).toBe(2);
  });

  it("throws RateLimitedError on two 429s in a row", async () => {
    const { client } = setup(() => jsonResponse("slow down", 429));
    await expect(client.getCompany("09100417")).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("keeps the key out of thrown messages", async () => {
    const failing = createChClient({
      http: {
        get: () => Promise.reject(new Error(`boom for ${KEY} and Basic xyz`)),
      },
      apiKey: KEY,
      limiter: createWindowLimiter({
        max: 5,
        windowMs: 1000,
        clock: { now: () => new Date(0) },
      }),
    });
    const error = await failing.getCompany("09100417").catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(KEY);

    const { client } = setup(() => jsonResponse("no", 403));
    const forbidden = await client
      .getCompany("09100417")
      .catch((e: unknown) => e);
    expect((forbidden as Error).message).not.toContain(KEY);
    expect((forbidden as Error).message).toContain("403");
  });
});

describe("fakeChClient", () => {
  it("serves the fixture companies", async () => {
    const fake = fakeChClient({ postcodeCounts: { "EX2 4AB": 3 } });
    expect((await fake.getCompany("09100417"))?.name).toContain("KESTREL");
    expect(await fake.getCompany("00000001")).toBeNull();
    expect(await fake.countActiveAtPostcode("EX2 4AB")).toBe(3);
    expect(fake.requestsMade()).toBe(3);
  });
});
