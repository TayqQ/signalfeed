import { describe, expect, it } from "vitest";
import type { HttpFetcher, HttpResponse } from "@/core/ports";
import {
  EdgarThrottledError,
  createEdgarClient,
  formDUrl,
  formIndexUrl,
} from "./edgar-client";
import { createFakeEdgarClient, readEdgarFixture } from "./testing";

function reply(status: number, body = ""): HttpResponse {
  return { status, body, etag: null, lastModified: null };
}

function setup(respond: (url: string, call: number) => HttpResponse) {
  let now = Date.parse("2026-11-12T10:00:00Z");
  const log: { url: string; at: number; headers: Record<string, string> }[] =
    [];
  const sleeps: number[] = [];
  const http: HttpFetcher = {
    get(url, options) {
      log.push({ url, at: now, headers: options?.headers ?? {} });
      return Promise.resolve(respond(url, log.length));
    },
  };
  const client = createEdgarClient({
    http,
    contact: "signalfeed@example.com",
    clock: { now: () => new Date(now) },
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
  });
  return { client, log, sleeps };
}

describe("urls", () => {
  it("builds the index url from the quarter", () => {
    expect(formIndexUrl("2026-11-10")).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/form.20261110.idx",
    );
    expect(formIndexUrl("2026-03-31")).toContain("/QTR1/form.20260331.idx");
  });
  it("builds the Form D url without leading zeros or dashes", () => {
    expect(formDUrl("0001999001", "0001999001-26-000001")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1999001/000199900126000001/primary_doc.xml",
    );
  });
});

describe("createEdgarClient", () => {
  it("refuses a contact without an email address", () => {
    const http: HttpFetcher = { get: () => Promise.resolve(reply(200)) };
    for (const contact of ["", "SignalFeed", "name at example dot com"]) {
      expect(() =>
        createEdgarClient({
          http,
          contact,
          sleep: () => Promise.resolve(),
          clock: { now: () => new Date() },
        }),
      ).toThrow(/email/);
    }
  });

  it("sends the User-Agent from config and accepts gzip", async () => {
    const { client, log } = setup(() => reply(200, "body"));
    await client.getFormIndex("2026-11-10");
    expect(log[0]?.headers["user-agent"]).toMatch(
      /^SignalFeed\/\S+ \(\+signalfeed@example\.com\)$/,
    );
    expect(log[0]?.headers["accept-encoding"]).toBe("gzip, deflate");
  });

  it("returns text, and missing for a 404", async () => {
    const { client } = setup((url) =>
      url.includes("20261110") ? reply(200, "idx") : reply(404),
    );
    expect(await client.getFormIndex("2026-11-10")).toEqual({
      status: "ok",
      text: "idx",
    });
    expect(await client.getFormIndex("2026-11-11")).toEqual({
      status: "missing",
    });
    expect(await client.getFormD("1", "0000000001-26-000001")).toEqual({
      status: "missing",
    });
  });

  it("never sends more than 5 requests in any second", async () => {
    const { client, log, sleeps } = setup(() => reply(200, "x"));
    for (let i = 0; i < 23; i += 1) await client.getFormIndex("2026-11-10");
    expect(client.requestCount()).toBe(23);
    expect(sleeps.length).toBeGreaterThan(0);
    const times = log.map((entry) => entry.at);
    times.forEach((time, i) => {
      const fifthBefore = times[i - 5];
      if (fifthBefore !== undefined) {
        expect(time - fifthBefore).toBeGreaterThan(1000);
      }
    });
  });

  it("waits 10 minutes once on a 429, then carries on", async () => {
    const { client, sleeps } = setup((_url, call) =>
      call === 1 ? reply(429) : reply(200, "ok"),
    );
    expect(await client.getFormIndex("2026-11-10")).toEqual({
      status: "ok",
      text: "ok",
    });
    expect(sleeps).toContain(600_000);
    expect(client.requestCount()).toBe(2);
  });

  it("throws after a second 403", async () => {
    const { client, sleeps } = setup(() => reply(403));
    await expect(client.getFormD("1", "0000000001-26-000001")).rejects.toThrow(
      EdgarThrottledError,
    );
    expect(sleeps.filter((ms) => ms === 600_000)).toHaveLength(1);
    expect(client.requestCount()).toBe(2);
  });

  it("throws on other errors", async () => {
    const { client } = setup(() => reply(500));
    await expect(client.getFormIndex("2026-11-10")).rejects.toThrow(/500/);
  });
});

describe("createFakeEdgarClient", () => {
  it("serves the fixtures and counts requests", async () => {
    const fake = createFakeEdgarClient();
    const index = await fake.getFormIndex("2026-11-10");
    expect(index).toEqual({
      status: "ok",
      text: readEdgarFixture("form-index.idx"),
    });
    expect(await fake.getFormIndex("2026-11-09")).toEqual({
      status: "missing",
    });
    expect(fake.requestCount()).toBe(2);
  });
});
