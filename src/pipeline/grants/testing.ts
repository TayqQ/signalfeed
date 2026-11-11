import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { HttpFetcher, HttpGetOptions, HttpResponse } from "@/core/ports";
import { GTR_API_BASE } from "./gtr-client";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function loadGtrFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "fixtures/gtr", name), "utf8"),
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

export interface FakeGtr {
  fetcher: HttpFetcher;
  urls: string[];
  pageRequests: number[];
  orgRequests: string[];
  headers: (Record<string, string> | undefined)[];
}

/**
 * A fake `HttpFetcher` for the GtR API. `pages` maps a page number to a
 * response body; `failOrgs` lists organisation ids that answer HTTP 500.
 */
export function fakeGtr(
  pages: (page: number) => unknown,
  options: { failOrgs?: string[]; postCode?: string } = {},
): FakeGtr {
  const organisationTemplate = loadGtrFixture("organisation.json");
  const fake: FakeGtr = {
    urls: [],
    pageRequests: [],
    orgRequests: [],
    headers: [],
    fetcher: {
      get: vi.fn((url: string, getOptions?: HttpGetOptions) => {
        fake.urls.push(url);
        fake.headers.push(getOptions?.headers);
        const orgMatch = /\/organisations\/([^/?]+)$/.exec(url);
        if (orgMatch?.[1]) {
          const id = orgMatch[1];
          fake.orgRequests.push(id);
          if (options.failOrgs?.includes(id)) {
            return Promise.resolve(jsonResponse("error", 500));
          }
          const organisation: Record<string, unknown> = {
            ...organisationTemplate,
            id,
            name: `Org ${id}`,
          };
          if (options.postCode !== undefined) {
            organisation.addresses = {
              address: [
                {
                  postCode: options.postCode,
                  region: null,
                  type: "MAIN_ADDRESS",
                },
              ],
            };
          }
          return Promise.resolve(jsonResponse(organisation));
        }
        const pageMatch = /[?&]p=(\d+)/.exec(url);
        if (url.includes("/projects.json?") && pageMatch?.[1]) {
          const page = Number(pageMatch[1]);
          fake.pageRequests.push(page);
          return Promise.resolve(jsonResponse(pages(page)));
        }
        return Promise.resolve(jsonResponse("not found", 404));
      }),
    },
  };
  return fake;
}

type Json = Record<string, unknown>;

/** A page of invented projects, each led by its own invented company. */
export function syntheticPage(
  page: number,
  count: number,
  startMs = 1782860400000,
): Json {
  const template = (
    loadGtrFixture("projects-page.json").project as Json[]
  )[0] as Json;
  const project = Array.from({ length: count }, (_, index) => {
    const n = `${page}-${index}`;
    const orgId = `org-${n}`;
    return {
      ...template,
      id: `project-${n}`,
      title: `Invented project ${n}`,
      links: {
        link: [
          {
            rel: "FUND",
            href: null,
            start: startMs - page * 86_400_000,
            end: startMs + 365 * 86_400_000,
          },
        ],
      },
      participantValues: {
        participant: [
          {
            organisationId: orgId,
            organisationName: `Invented ${n} Ltd`,
            role: "LEAD_PARTICIPANT",
            projectCost: 1000,
            grantOffer: 500,
          },
        ],
      },
    };
  });
  return { page, size: count, totalPages: 50, totalSize: 50 * count, project };
}

export { GTR_API_BASE };
