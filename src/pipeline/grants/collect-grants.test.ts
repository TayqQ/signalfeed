import type { HttpFetcher } from "@/core/ports";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { grantParticipants, grantProjects, sources } from "@/db/schema";
import { collectGrantsStep, grantCoverage } from "./collect-grants";
import { createGtrClient, GTR_API_BASE } from "./gtr-client";
import {
  fakeGtr,
  jsonResponse,
  loadGtrFixture,
  syntheticPage,
} from "./testing";

let testDb: TestDb;
beforeEach(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  await testDb.close();
});

function setup(
  pages: (page: number) => unknown,
  options: { failOrgs?: string[]; postCode?: string } = {},
) {
  const fake = fakeGtr(pages, options);
  const gtr = createGtrClient({ http: fake.fetcher, sleep: vi.fn() });
  return { fake, gtr };
}

const fixturePage = () => loadGtrFixture("projects-page.json");

describe("collectGrantsStep", () => {
  it("inserts projects, texts and organisation participants, then fetches organisations", async () => {
    const { gtr, fake } = setup(fixturePage);
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 1 });
    expect(stats).toEqual({
      pagesFetched: 1,
      projectsFound: 3,
      projectsInserted: 3,
      participantsInserted: 3,
      participantsSkipped: 2,
      orgsFetched: 3,
      orgsFailed: 0,
    });

    const participants = await testDb.db.select().from(grantParticipants);
    expect(participants).toHaveLength(3);
    for (const row of participants) {
      expect(row).toMatchObject({
        regNumber: "01234567",
        postcode: "L35 9JJ",
        outcode: "L35",
        regionText: "North West",
      });
      expect(row.orgFetchedAt).not.toBeNull();
    }
    expect(fake.orgRequests).toHaveLength(3);
    const [source] = await testDb.db.select().from(sources);
    expect(source?.lastFetchedAt).not.toBeNull();
    expect(await grantCoverage(testDb.db)).toEqual({
      projects: 3,
      participants: 3,
      withPostcode: 3,
    });
  });

  it("inserts nothing on a second run and fetches no organisation again", async () => {
    const { gtr, fake } = setup(fixturePage);
    await collectGrantsStep({ db: testDb.db, gtr, maxPages: 1 });
    const second = await collectGrantsStep({
      db: testDb.db,
      gtr,
      maxPages: 1,
    });
    expect(second).toMatchObject({
      projectsInserted: 0,
      participantsInserted: 0,
      orgsFetched: 0,
    });
    expect(fake.orgRequests).toHaveLength(3);
    expect(await testDb.db.select().from(grantProjects)).toHaveLength(3);
  });

  it("stops after 3 pages with no unseen project", async () => {
    const first = setup((page) => syntheticPage(page, 2));
    await collectGrantsStep({
      db: testDb.db,
      gtr: first.gtr,
      maxPages: 3,
      maxOrgFetches: 0,
    });
    expect(await testDb.db.select().from(grantProjects)).toHaveLength(6);

    const second = setup((page) => syntheticPage(page, 2));
    const stats = await collectGrantsStep({
      db: testDb.db,
      gtr: second.gtr,
      maxOrgFetches: 0,
    });
    expect(second.fake.pageRequests).toEqual([1, 2, 3]);
    expect(stats).toMatchObject({ pagesFetched: 3, projectsInserted: 0 });
  });

  it("keeps walking while pages hold new projects, up to maxPages", async () => {
    const { gtr, fake } = setup((page) => syntheticPage(page, 1));
    const stats = await collectGrantsStep({
      db: testDb.db,
      gtr,
      maxPages: 5,
      maxOrgFetches: 0,
    });
    expect(fake.pageRequests).toEqual([1, 2, 3, 4, 5]);
    expect(stats.projectsInserted).toBe(5);
  });

  it("stops at the last page the API reports", async () => {
    const { gtr, fake } = setup((page) => ({
      ...syntheticPage(page, 1),
      totalPages: 2,
    }));
    await collectGrantsStep({ db: testDb.db, gtr, maxOrgFetches: 0 });
    expect(fake.pageRequests).toEqual([1, 2]);
  });

  it("stops once project start dates fall before since", async () => {
    // Each synthetic page starts one day earlier than the last.
    const start = Date.UTC(2026, 5, 10, 12);
    const { gtr, fake } = setup((page) => syntheticPage(page, 1, start));
    const stats = await collectGrantsStep({
      db: testDb.db,
      gtr,
      since: "2026-06-08",
      maxOrgFetches: 0,
    });
    // Page 1 starts 9 June, page 2 starts 8 June, page 3 starts 7 June.
    expect(fake.pageRequests).toEqual([1, 2, 3]);
    expect(stats.projectsInserted).toBe(2);
  });

  it("respects maxOrgFetches across runs", async () => {
    const { gtr, fake } = setup(fixturePage);
    const first = await collectGrantsStep({
      db: testDb.db,
      gtr,
      maxPages: 1,
      maxOrgFetches: 2,
    });
    expect(first.orgsFetched).toBe(2);
    const second = await collectGrantsStep({
      db: testDb.db,
      gtr,
      maxPages: 1,
      maxOrgFetches: 2,
    });
    expect(second.orgsFetched).toBe(1);
    expect(new Set(fake.orgRequests).size).toBe(3);
    expect(fake.orgRequests).toHaveLength(3);
  });

  it("fetches an organisation once when several projects share it", async () => {
    const { gtr, fake } = setup(() => {
      const page = syntheticPage(1, 3) as {
        project: {
          participantValues: { participant: { organisationId: string }[] };
        }[];
      };
      for (const project of page.project) {
        const [participant] = project.participantValues.participant;
        if (participant) participant.organisationId = "shared-org";
      }
      return page;
    });
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 1 });
    expect(stats.participantsInserted).toBe(3);
    expect(stats.orgsFetched).toBe(1);
    expect(fake.orgRequests).toEqual(["shared-org"]);
    const rows = await testDb.db.select().from(grantParticipants);
    expect(rows.every((row) => row.orgFetchedAt !== null)).toBe(true);
  });

  it("counts a failed organisation fetch and retries it next run", async () => {
    const failing = setup(fixturePage, {
      failOrgs: ["aaaaaaaa-0000-4000-8000-000000000002"],
    });
    const first = await collectGrantsStep({
      db: testDb.db,
      gtr: failing.gtr,
      maxPages: 1,
    });
    expect(first).toMatchObject({ orgsFetched: 2, orgsFailed: 1 });

    const healthy = setup(fixturePage);
    const second = await collectGrantsStep({
      db: testDb.db,
      gtr: healthy.gtr,
      maxPages: 1,
    });
    expect(second).toMatchObject({ orgsFetched: 1, orgsFailed: 0 });
    expect(healthy.fake.orgRequests).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000002",
    ]);
  });

  it("leaves the postcode empty when GtR's postcode is not valid", async () => {
    const { gtr } = setup(fixturePage, { postCode: "NOT A POSTCODE" });
    await collectGrantsStep({ db: testDb.db, gtr, maxPages: 1 });
    const rows = await testDb.db.select().from(grantParticipants);
    expect(rows.every((row) => row.postcode === null)).toBe(true);
    expect(rows.every((row) => row.orgFetchedAt !== null)).toBe(true);
  });

  it("only ever requests project pages and organisations, never people", async () => {
    const { gtr, fake } = setup(fixturePage);
    await collectGrantsStep({ db: testDb.db, gtr, maxPages: 2 });
    expect(fake.urls.length).toBeGreaterThan(0);
    for (const url of fake.urls) {
      expect(url.startsWith(GTR_API_BASE)).toBe(true);
      expect(url).not.toMatch(/person/i);
      expect(url).toMatch(/\/(projects\.json\?|organisations\/[0-9A-Za-z-]+$)/);
    }
  });
});

/** Wraps the fake so that chosen project pages answer with a failing status. */
function flaky(failures: Record<number, number[]>) {
  const fake = fakeGtr((page) => syntheticPage(page, 2));
  const left = new Map(
    Object.entries(failures).map(([k, v]) => [Number(k), [...v]]),
  );
  const attempts = new Map<number, number>();
  const sleep = vi.fn().mockResolvedValue(undefined);
  const http: HttpFetcher = {
    get: (url, options) => {
      const match = /projects\.json\?.*[?&]?p=(\d+)/.exec(url);
      const page = match?.[1] ? Number(match[1]) : null;
      if (page !== null) {
        attempts.set(page, (attempts.get(page) ?? 0) + 1);
        const status = left.get(page)?.shift();
        if (status !== undefined) {
          return Promise.resolve(jsonResponse("error", status));
        }
      }
      return fake.fetcher.get(url, options);
    },
  };
  const gtr = createGtrClient({ http, sleep, random: () => 0.5 });
  return { gtr, attempts, sleep };
}

describe("collectGrantsStep retries and partial progress", () => {
  it("carries on after a 503 that clears on retry", async () => {
    const { gtr, attempts } = flaky({ 2: [503] });
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 3 });
    expect(attempts.get(2)).toBe(2);
    expect(stats).toMatchObject({ pagesFetched: 3, projectsInserted: 6 });
    expect(stats.errorCount).toBeUndefined();
    expect(stats.lastError).toBeUndefined();
  });

  it("retries a 429", async () => {
    const { gtr, attempts } = flaky({ 1: [429] });
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 1 });
    expect(attempts.get(1)).toBe(2);
    expect(stats.projectsInserted).toBe(2);
  });

  it("keeps stored pages and records the error when a 503 persists", async () => {
    const { gtr, attempts } = flaky({ 2: [503, 503, 503, 503, 503, 503] });
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 5 });
    expect(attempts.get(2)).toBe(5);
    expect(attempts.get(3)).toBeUndefined();
    expect(stats).toMatchObject({
      pagesFetched: 1,
      projectsInserted: 2,
      errorCount: 1,
      lastError: "GtR projects page 2 failed: HTTP 503",
    });
    expect(await testDb.db.select().from(grantProjects)).toHaveLength(2);
    // Organisations wait for the next run while the API is unwell.
    expect(stats.orgsFetched).toBe(0);

    // The next run finds the missing data and fetches the organisations.
    const next = flaky({});
    const again = await collectGrantsStep({
      db: testDb.db,
      gtr: next.gtr,
      maxPages: 3,
    });
    expect(again.errorCount).toBeUndefined();
    expect(again.projectsInserted).toBe(4);
    expect(again.orgsFetched).toBe(6);
  });

  it("does not retry a 404, and stops the walk", async () => {
    const { gtr, attempts, sleep } = flaky({ 2: [404] });
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 5 });
    expect(attempts.get(2)).toBe(1);
    expect(sleep).not.toHaveBeenCalledWith(2000);
    expect(stats).toMatchObject({
      projectsInserted: 2,
      errorCount: 1,
      lastError: "GtR projects page 2 failed: HTTP 404",
    });
  });

  it("throws when the first page fails, as nothing was fetched", async () => {
    const { gtr } = flaky({ 1: [503, 503, 503, 503, 503] });
    await expect(
      collectGrantsStep({ db: testDb.db, gtr, maxPages: 3 }),
    ).rejects.toThrow("HTTP 503");
  });

  it("stops fetching organisations after 3 failures in a row", async () => {
    const fake = fakeGtr((page) => syntheticPage(page, 5), {
      failOrgs: Array.from({ length: 5 }, (_, i) => `org-1-${i}`),
    });
    const gtr = createGtrClient({ http: fake.fetcher, sleep: vi.fn() });
    const stats = await collectGrantsStep({ db: testDb.db, gtr, maxPages: 1 });
    expect(stats.orgsFailed).toBe(3);
    expect(stats.errorCount).toBe(1);
    expect(stats.lastError).toContain("HTTP 500");
  });
});
