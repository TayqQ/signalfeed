import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { HttpFetcher, HttpGetOptions, HttpResponse } from "@/core/ports";
import {
  normaliseCompanyNumber,
  type CapitalFiling,
  type RegistryCompanyFacts,
} from "@/core/registry";
import {
  CH_API_BASE,
  profileToFacts,
  type ChClient,
  type ChSearchHit,
} from "./ch-client";
import { chProfileSchema } from "./ch-schemas";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function loadChFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "fixtures/companies-house", name), "utf8"),
  ) as Record<string, unknown>;
}

export function jsonResponse(body: unknown, status = 200): HttpResponse {
  return {
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
    etag: null,
    lastModified: null,
  };
}

export interface FakeChFetcher {
  fetcher: HttpFetcher;
  /** Paths after the base URL, in request order. */
  paths: string[];
  headers: (Record<string, string> | undefined)[];
}

/** A fake `HttpFetcher` whose answers come from `respond(path, call)`. */
export function fakeChFetcher(
  respond: (path: string, call: number) => HttpResponse,
): FakeChFetcher {
  const fake: FakeChFetcher = {
    paths: [],
    headers: [],
    fetcher: {
      get: vi.fn((url: string, options?: HttpGetOptions) => {
        const requestPath = url.startsWith(CH_API_BASE)
          ? url.slice(CH_API_BASE.length)
          : url;
        fake.paths.push(requestPath);
        fake.headers.push(options?.headers);
        return Promise.resolve(respond(requestPath, fake.paths.length));
      }),
    },
  };
  return fake;
}

export interface FakeChClientOptions {
  /** Defaults to the three profile fixtures. */
  companies?: RegistryCompanyFacts[];
  /** Search hits by exact name. Missing names give no hits. */
  search?: Record<string, ChSearchHit[]>;
  /** SH01 filings by company number. */
  filings?: Record<string, CapitalFiling[]>;
  /** Active company counts by postcode. A missing postcode gives null. */
  postcodeCounts?: Record<string, number>;
}

/** The three profile fixtures as core facts. */
export function fixtureCompanies(): RegistryCompanyFacts[] {
  return [
    "profile-active.json",
    "profile-dormant.json",
    "profile-dissolved.json",
  ].map((name) => profileToFacts(chProfileSchema.parse(loadChFixture(name))));
}

/** A fake `ChClient` with no network, for the registry step and eval tests. */
export function fakeChClient(options: FakeChClientOptions = {}): ChClient {
  const companies = new Map(
    (options.companies ?? fixtureCompanies()).map((c) => [c.companyNumber, c]),
  );
  let made = 0;
  return {
    searchCompanies(name) {
      made += 1;
      return Promise.resolve(options.search?.[name] ?? []);
    },
    getCompany(companyNumber) {
      made += 1;
      const number = normaliseCompanyNumber(companyNumber);
      return Promise.resolve(number ? (companies.get(number) ?? null) : null);
    },
    getCapitalFilings(companyNumber, opts = {}) {
      made += 1;
      const number = normaliseCompanyNumber(companyNumber) ?? companyNumber;
      const since = opts.since;
      return Promise.resolve(
        (options.filings?.[number] ?? [])
          .filter((f) => since === undefined || f.filedOn >= since)
          .sort((a, b) => b.filedOn.localeCompare(a.filedOn)),
      );
    },
    countActiveAtPostcode(postcode) {
      made += 1;
      return Promise.resolve(options.postcodeCounts?.[postcode] ?? null);
    },
    requestsMade: () => made,
  };
}
