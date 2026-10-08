import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { HttpFetcher } from "@/core/ports";
import {
  createFrankfurterProvider,
  DEFAULT_FRANKFURTER_ECB_BASE_URL,
} from "./frankfurter";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(repoRoot, "fixtures/fx", name), "utf8");
}

function stubFetcher(
  body: string,
  status = 200,
): {
  fetcher: HttpFetcher;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(() =>
    Promise.resolve({
      status,
      body,
      etag: null,
      lastModified: null,
    }),
  );
  return { fetcher: { get }, get };
}

describe("createFrankfurterProvider", () => {
  it("returns ECB rates for a normal weekday", async () => {
    const { fetcher, get } = stubFetcher(loadFixture("2024-05-15.json"));
    const provider = createFrankfurterProvider({ fetcher });

    const rates = await provider.getRates("2024-05-15");

    expect(get).toHaveBeenCalledWith(
      `${DEFAULT_FRANKFURTER_ECB_BASE_URL}/rates?from=2024-05-15&to=2024-05-15`,
    );
    expect(rates).toEqual({
      date: "2024-05-15",
      perEur: {
        EUR: 1,
        GBP: 0.8584,
        USD: 1.0832,
        CHF: 0.98,
      },
    });
  });

  it("keeps the previous business day when the requested date is a weekend", async () => {
    const { fetcher } = stubFetcher(loadFixture("2024-05-18-weekend.json"));
    const provider = createFrankfurterProvider({ fetcher });

    const rates = await provider.getRates("2024-05-18");

    expect(rates.date).toBe("2024-05-17");
    expect(rates.perEur.EUR).toBe(1);
    expect(rates.perEur.GBP).toBe(0.85685);
  });

  it("always includes EUR at 1 in perEur", async () => {
    const { fetcher } = stubFetcher(loadFixture("2024-05-15.json"));
    const provider = createFrankfurterProvider({ fetcher });

    const rates = await provider.getRates("2024-05-15");

    expect(rates.perEur.EUR).toBe(1);
  });

  it("throws on a malformed response body", async () => {
    const { fetcher } = stubFetcher(loadFixture("malformed.json"));
    const provider = createFrankfurterProvider({ fetcher });

    await expect(provider.getRates("2024-05-15")).rejects.toThrow(
      /did not match the expected shape/,
    );
  });

  it("throws on a non-2xx HTTP response", async () => {
    const { fetcher } = stubFetcher("{}", 503);
    const provider = createFrankfurterProvider({ fetcher });

    await expect(provider.getRates("2024-05-15")).rejects.toThrow(/HTTP 503/);
  });

  it("rejects a future date without calling the fetcher", async () => {
    const { fetcher, get } = stubFetcher(loadFixture("2024-05-15.json"));
    const provider = createFrankfurterProvider({
      fetcher,
      todayUtc: () => "2024-05-15",
    });

    await expect(provider.getRates("2024-05-16")).rejects.toThrow(
      /in the future/,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects dates before ECB data begins", async () => {
    const { fetcher, get } = stubFetcher(loadFixture("2024-05-15.json"));
    const provider = createFrankfurterProvider({
      fetcher,
      todayUtc: () => "2024-05-15",
    });

    await expect(provider.getRates("1999-01-03")).rejects.toThrow(
      /before ECB data begins/,
    );
    expect(get).not.toHaveBeenCalled();
  });
});
