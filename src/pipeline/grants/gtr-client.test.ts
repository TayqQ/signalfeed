import { describe, expect, it, vi } from "vitest";
import { createGtrClient, GTR_API_BASE } from "./gtr-client";
import { projectFundDates, mainAddress } from "./gtr-schemas";
import { gtrOrganisationSchema, gtrProjectsPageSchema } from "./gtr-schemas";
import { fakeGtr, jsonResponse, loadGtrFixture } from "./testing";

describe("schemas", () => {
  it("accepts the projects fixture", () => {
    const page = gtrProjectsPageSchema.parse(
      loadGtrFixture("projects-page.json"),
    );
    expect(page.project).toHaveLength(3);
    const [first, second] = page.project;
    expect(first?.participantValues?.participant[0]?.organisationName).toBe(
      "ACME ROBOTICS LTD",
    );
    expect(second?.participantValues?.participant).toHaveLength(2);
  });

  it("reads fund dates as London days", () => {
    const page = gtrProjectsPageSchema.parse(
      loadGtrFixture("projects-page.json"),
    );
    const first = page.project[0];
    if (!first) throw new Error("fixture is empty");
    // 23:00 UTC on 30 June is midnight on 1 July in London.
    expect(projectFundDates(first)).toEqual({
      startOn: "2026-07-01",
      endOn: "2027-10-31",
    });
  });

  it("rejects a page without project", () => {
    expect(
      gtrProjectsPageSchema.safeParse({ page: 1, totalSize: 0 }).success,
    ).toBe(false);
  });

  it("accepts the organisation fixture and finds the main address", () => {
    const organisation = gtrOrganisationSchema.parse(
      loadGtrFixture("organisation.json"),
    );
    expect(organisation.regNumber).toBe("01234567");
    expect(mainAddress(organisation)?.postCode).toBe("L35 9JJ");
  });

  it("ignores unknown keys, including person links", () => {
    const organisation = gtrOrganisationSchema.parse({
      id: "x",
      name: "Invented Ltd",
      links: { link: [{ rel: "EMPLOYEE", href: "persons/1" }] },
      somethingNew: 1,
    });
    expect(organisation).not.toHaveProperty("somethingNew");
    expect(organisation).not.toHaveProperty("links");
  });
});

describe("createGtrClient", () => {
  it("builds the project list request and sends Accept: application/json", async () => {
    const fake = fakeGtr(() => loadGtrFixture("projects-page.json"));
    const client = createGtrClient({ http: fake.fetcher, sleep: vi.fn() });
    const page = await client.listInnovateUkProjects(2);
    expect(page.project).toHaveLength(3);
    expect(fake.urls[0]).toBe(
      `${GTR_API_BASE}projects.json?q=Innovate%20UK&f=pro.lf&sf=pro.sd&so=D&s=100&p=2`,
    );
    expect(fake.headers[0]).toEqual({ Accept: "application/json" });
  });

  it("waits one second between requests but not before the first", async () => {
    const fake = fakeGtr(() => loadGtrFixture("projects-page.json"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createGtrClient({ http: fake.fetcher, sleep });
    await client.listInnovateUkProjects(1);
    expect(sleep).not.toHaveBeenCalled();
    await client.getOrganisation("abc-123");
    await client.listInnovateUkProjects(2);
    expect(sleep.mock.calls).toEqual([[1000], [1000]]);
  });

  const page = () => jsonResponse(loadGtrFixture("projects-page.json"));
  const noJitter = () => 0.5;

  it("retries a 503 and then succeeds", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse("down", 503))
      .mockResolvedValueOnce(page());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createGtrClient({ http: { get }, sleep, random: noJitter });
    const result = await client.listInnovateUkProjects(1);
    expect(result.project).toHaveLength(3);
    expect(get).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[2000]]);
  });

  it("retries a 429", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse("slow down", 429))
      .mockResolvedValueOnce(page());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createGtrClient({ http: { get }, sleep, random: noJitter });
    const result = await client.listInnovateUkProjects(1);
    expect(result.project).toHaveLength(3);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([500, 502, 504])("retries HTTP %i", async (status) => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse("x", status))
      .mockResolvedValueOnce(page());
    const client = createGtrClient({
      http: { get },
      sleep: vi.fn().mockResolvedValue(undefined),
    });
    await client.listInnovateUkProjects(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("retries a network error", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("The operation timed out"))
      .mockResolvedValueOnce(page());
    const client = createGtrClient({
      http: { get },
      sleep: vi.fn().mockResolvedValue(undefined),
    });
    await client.listInnovateUkProjects(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("backs off 2, 5, 15 then 30 seconds, and then throws", async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse("down", 503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createGtrClient({ http: { get }, sleep, random: noJitter });
    await expect(client.listInnovateUkProjects(1)).rejects.toThrow(
      "GtR projects page 1 failed: HTTP 503",
    );
    expect(get).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls).toEqual([[2000], [5000], [15000], [30000]]);
  });

  it("keeps jitter within 25 per cent", async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse("down", 503));
    const low = vi.fn().mockResolvedValue(undefined);
    const high = vi.fn().mockResolvedValue(undefined);
    await createGtrClient({ http: { get }, sleep: low, random: () => 0 })
      .listInnovateUkProjects(1)
      .catch(() => undefined);
    await createGtrClient({ http: { get }, sleep: high, random: () => 1 })
      .listInnovateUkProjects(1)
      .catch(() => undefined);
    expect(low.mock.calls[0]).toEqual([1500]);
    expect(high.mock.calls[0]).toEqual([2500]);
  });

  it("does not retry a 404", async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse("gone", 404));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createGtrClient({ http: { get }, sleep });
    await expect(client.listInnovateUkProjects(1)).rejects.toThrow("HTTP 404");
    expect(get).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry other errors", async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse("bad", 400));
    const client = createGtrClient({
      http: { get },
      sleep: vi.fn(),
    });
    await expect(client.listInnovateUkProjects(1)).rejects.toThrow("HTTP 400");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("throws on a response that is not the expected shape", async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse({ page: 1 }));
    const client = createGtrClient({
      http: { get },
      sleep: vi.fn(),
    });
    await expect(client.listInnovateUkProjects(1)).rejects.toThrow(
      "expected shape",
    );
  });

  it("throws on invalid JSON", async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse("<html>"));
    const client = createGtrClient({
      http: { get },
      sleep: vi.fn(),
    });
    await expect(client.getOrganisation("abc")).rejects.toThrow("invalid JSON");
  });

  it("rejects bad page numbers and organisation ids without a request", () => {
    const get = vi.fn();
    const client = createGtrClient({
      http: { get },
      sleep: vi.fn(),
    });
    expect(() => client.listInnovateUkProjects(0)).toThrow("page number");
    expect(() => client.getOrganisation("../persons/1")).toThrow(
      "organisation id",
    );
    expect(get).not.toHaveBeenCalled();
  });
});
