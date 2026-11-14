import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoundType } from "@/core/enums";
import type { CapitalFiling, RegistryCompanyFacts } from "@/core/registry";
import type { Db } from "@/db/client";
import {
  chAddressCounts,
  chCompanies,
  chFilings,
  companies,
  companyLocations,
  eventSources,
  events,
  extractions,
  fundingRounds,
  grantParticipants,
  grantProjects,
  mergeCandidates,
  registryLinks,
  registrySearches,
  sourceItems,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { RateLimitedError, type ChClient, type ChSearchHit } from "./ch-client";
import { eligibleCompanies, linkCompanies } from "./link-companies";
import { recordLink } from "./link-store";
import { fakeChClient, type FakeChClientOptions } from "./testing";

const NOW = new Date("2026-11-12T09:00:00Z");
const LEEDS = { placeSlug: "leeds", latitude: 53.8016, longitude: -1.5472 };
const LONDON = { placeSlug: "london", latitude: 51.5078, longitude: -0.1245 };

let testDb: TestDb;
let db: Db;
let slugCounter = 0;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function insertCompany(
  name: string,
  values: Partial<typeof companies.$inferInsert> = {},
) {
  slugCounter += 1;
  const [row] = await db
    .insert(companies)
    .values({
      slug: `company-${slugCounter}`,
      name,
      normalisedName: name.toLowerCase(),
      countryCode: "GB",
      ...values,
    })
    .returning();
  return row!;
}

async function addRound(
  companyId: number,
  announcedOn: string,
  roundType: RoundType = "seed",
  datePrecision: "day" | "month" = "day",
) {
  const [event] = await db
    .insert(events)
    .values({ type: "funding_round", companyId, announcedOn, datePrecision })
    .returning();
  await db.insert(fundingRounds).values({ eventId: event!.id, roundType });
  return event!;
}

async function setLocation(
  companyId: number,
  place: { placeSlug: string; latitude: number; longitude: number },
) {
  await db.insert(companyLocations).values({
    companyId,
    countryCode: "GB",
    precision: "town",
    source: "news_city",
    ...place,
  });
}

async function addGrantParticipant(
  companyId: number,
  values: { postcode?: string; regNumber?: string; name: string },
) {
  const [source] = await db
    .insert(sources)
    .values({
      slug: `gtr-${companyId}`,
      name: "GtR",
      kind: "ukri_gtr",
      url: `https://gtr.test/${companyId}`,
      priority: 5,
    })
    .returning();
  const [project] = await db
    .insert(grantProjects)
    .values({
      sourceId: source!.id,
      gtrProjectId: `project-${companyId}`,
      title: "Invented project",
      grantCategory: "Feasibility Studies",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: "2025-06-01",
      endOn: null,
      gtrUrl: `https://gtr.test/project-${companyId}`,
    })
    .returning();
  await db.insert(grantParticipants).values({
    projectId: project!.id,
    gtrOrgId: `org-${companyId}`,
    organisationName: values.name,
    regNumber: values.regNumber ?? null,
    postcode: values.postcode ?? null,
    outcode: values.postcode?.split(" ")[0] ?? null,
    role: "lead",
    companyId,
  });
}

function profile(
  overrides: Partial<RegistryCompanyFacts> = {},
): RegistryCompanyFacts {
  return {
    companyNumber: "13579246",
    name: "BRIGHTWELL ROBOTICS LTD",
    previousNames: [],
    status: "active",
    companyType: "ltd",
    incorporatedOn: "2022-06-01",
    ceasedOn: null,
    sicCodes: ["62012"],
    officePostcode: "LS1 4AP",
    officeOutcode: "LS1",
    accountsType: null,
    accountsMadeUpTo: null,
    etag: `etag-${overrides.companyNumber ?? "13579246"}`,
    ...overrides,
  };
}

function hit(p: RegistryCompanyFacts): ChSearchHit {
  return {
    companyNumber: p.companyNumber,
    name: p.name,
    status: p.status,
    companyType: p.companyType,
    incorporatedOn: p.incorporatedOn,
    ceasedOn: p.ceasedOn,
    postcode: p.officePostcode,
    locality: null,
  };
}

function sh01(actionDate: string): CapitalFiling {
  return {
    transactionId: `t-${actionDate}`,
    type: "SH01",
    filedOn: actionDate,
    actionDate,
    capital: null,
  };
}

/** A fake client that also records which methods were called. */
function recordingClient(options: FakeChClientOptions) {
  const inner = fakeChClient(options);
  const calls: string[] = [];
  const client: ChClient = {
    searchCompanies: (name) => {
      calls.push(`search:${name}`);
      return inner.searchCompanies(name);
    },
    getCompany: (number) => {
      calls.push(`profile:${number}`);
      return inner.getCompany(number);
    },
    getCapitalFilings: (number, opts) => {
      calls.push(`filings:${number}`);
      return inner.getCapitalFilings(number, opts);
    },
    countActiveAtPostcode: (postcode) => {
      calls.push(`count:${postcode}`);
      return inner.countActiveAtPostcode(postcode);
    },
    requestsMade: () => inner.requestsMade(),
  };
  return { client, calls };
}

function run(client: ChClient, maxRequests = 100, now = NOW) {
  return linkCompanies({ db, client, now, maxRequests });
}

async function linksOf(companyId: number) {
  return db
    .select()
    .from(registryLinks)
    .where(eq(registryLinks.companyId, companyId))
    .orderBy(asc(registryLinks.id));
}

async function searchOf(companyId: number) {
  const [row] = await db
    .select()
    .from(registrySearches)
    .where(eq(registrySearches.companyId, companyId));
  return row;
}

async function companyRow(id: number) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  return row!;
}

// Worked example 1.
const BRIGHTWELL = profile();
const BRIGHTWELL_SERVICES = profile({
  companyNumber: "14002211",
  name: "BRIGHTWELL ROBOTICS SERVICES LTD",
  officePostcode: "LS11 5DR",
  officeOutcode: "LS11",
});

async function brightwellSetup(
  values: Partial<typeof companies.$inferInsert> = {},
) {
  const company = await insertCompany("Brightwell Robotics", values);
  await addRound(company.id, "2026-03-10");
  await setLocation(company.id, LEEDS);
  const options: FakeChClientOptions = {
    companies: [BRIGHTWELL, BRIGHTWELL_SERVICES],
    search: {
      "Brightwell Robotics": [hit(BRIGHTWELL), hit(BRIGHTWELL_SERVICES)],
    },
    filings: { "13579246": [sh01("2026-02-02")] },
  };
  return { company, options };
}

describe("linkCompanies: worked examples (spec-phase3 section 7.2)", () => {
  it("1. Brightwell Robotics is linked by filing, and the facts are stored", async () => {
    const { company, options } = await brightwellSetup();
    const { client, calls } = recordingClient(options);
    const stats = await run(client);

    const links = await linksOf(company.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      registryId: "13579246",
      status: "linked",
      method: "name_filing",
      decidedBy: "auto",
    });
    const row = await companyRow(company.id);
    expect(row.ukCompanyNumber).toBe("13579246");
    expect(row.foundedYear).toBe(2022);
    expect(row.foundedYearSource).toBe("companies_house");
    expect(await db.select().from(chCompanies)).toHaveLength(2);
    expect(await db.select().from(chFilings)).toHaveLength(1);
    expect((await searchOf(company.id))?.outcome).toBe("linked");
    expect(stats.linkedByMethod).toEqual({ name_filing: 1 });
    expect(stats.companiesSearched).toBe(1);
    expect(stats.requests).toBe(client.requestsMade());
    // Filings are fetched only for the candidate the rules asked about.
    expect(calls.filter((c) => c.startsWith("filings:"))).toEqual([
      "filings:13579246",
    ]);
  });

  it("2. Nova: a short name with no support becomes a candidate", async () => {
    const company = await insertCompany("Nova");
    await addRound(company.id, "2026-05-01");
    const nova = profile({
      companyNumber: "06812345",
      name: "NOVA LTD",
      incorporatedOn: "2009-02-11",
      officePostcode: "BS1 4DJ",
      officeOutcode: "BS1",
      accountsType: "dormant",
      accountsMadeUpTo: "2026-03-31",
    });
    const client = fakeChClient({
      companies: [nova],
      search: { Nova: [hit(nova)] },
    });
    const stats = await run(client);

    const links = await linksOf(company.id);
    expect(links).toEqual([
      expect.objectContaining({ registryId: "06812345", status: "candidate" }),
    ]);
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
    expect((await searchOf(company.id))?.outcome).toBe("candidates");
    expect(stats.candidates).toBe(1);
  });

  it("3. Kestrel AI: incorporated after the first event, so none", async () => {
    const company = await insertCompany("Kestrel AI", {
      foundedYear: 2023,
      foundedYearSource: "news",
    });
    await addRound(company.id, "2024-11-12");
    const kestrel = profile({
      companyNumber: "15550001",
      name: "KESTREL AI LTD",
      incorporatedOn: "2025-08-01",
    });
    const client = fakeChClient({
      companies: [kestrel],
      search: { "Kestrel AI": [hit(kestrel)] },
    });
    const stats = await run(client);
    expect(await linksOf(company.id)).toEqual([]);
    expect((await searchOf(company.id))?.outcome).toBe("none");
    expect(stats.none).toBe(1);
    expect((await companyRow(company.id)).foundedYear).toBe(2023);
  });

  it("4. Fenwick Thermal is linked by grant postcode", async () => {
    const company = await insertCompany("Fenwick Thermal Ltd");
    await addRound(company.id, "2025-06-01", "grant", "month");
    await addGrantParticipant(company.id, {
      name: "Fenwick Thermal Ltd",
      postcode: "NE1 5DL",
    });
    const fenwick = profile({
      companyNumber: "11223344",
      name: "FENWICK THERMAL LTD",
      officePostcode: "NE1 5DL",
      officeOutcode: "NE1",
    });
    const client = fakeChClient({
      companies: [fenwick],
      search: { "Fenwick Thermal Ltd": [hit(fenwick)] },
    });
    await run(client);
    expect(await linksOf(company.id)).toEqual([
      expect.objectContaining({
        registryId: "11223344",
        status: "linked",
        method: "name_grant_postcode",
      }),
    ]);
  });

  it("5. Tidewell: prefix matches go to review (D61), never linked", async () => {
    const company = await insertCompany("Tidewell");
    await addRound(company.id, "2026-01-20");
    await setLocation(company.id, LONDON);
    const platform = profile({
      companyNumber: "12456780",
      name: "TIDEWELL PLATFORM LTD",
      officePostcode: "EC2A 4NE",
      officeOutcode: "EC2A",
    });
    const holdings = profile({
      companyNumber: "12456781",
      name: "TIDEWELL HOLDINGS LTD",
      officePostcode: "EC2A 4NE",
      officeOutcode: "EC2A",
    });
    const client = fakeChClient({
      companies: [platform, holdings],
      search: { Tidewell: [hit(platform), hit(holdings)] },
      filings: { "12456780": [sh01("2025-12-15")] },
    });
    await run(client);
    const links = await linksOf(company.id);
    expect(links.map((l) => [l.registryId, l.status])).toEqual([
      ["12456780", "candidate"],
      ["12456781", "candidate"],
    ]);
    expect((await companyRow(company.id)).ukCompanyNumber).toBeNull();
    expect((await searchOf(company.id))?.outcome).toBe("candidates");
  });

  it("6. AcmeBio: a number linked to Acme Bio makes a merge candidate, not a link", async () => {
    const acme = await insertCompany("Acme Bio");
    await recordLink(db, {
      companyId: acme.id,
      registry: "companies_house",
      registryId: "09876543",
      registryName: "ACME BIO LTD",
      method: "name_location",
      reason: "test",
      decidedBy: "auto",
      now: NOW,
    });
    const acmeBio = await insertCompany("AcmeBio");
    const p = profile({
      companyNumber: "09876543",
      name: "ACME BIO LTD",
      incorporatedOn: "2020-01-01",
    });
    const client = fakeChClient({
      companies: [p],
      search: { AcmeBio: [hit(p)] },
    });
    await run(client);
    expect(await linksOf(acmeBio.id)).toEqual([]);
    const merges = await db.select().from(mergeCandidates);
    expect(merges).toEqual([
      expect.objectContaining({
        entityType: "company",
        leftId: acme.id,
        rightId: acmeBio.id,
        reason: "same Companies House number",
      }),
    ]);
    expect((await searchOf(acmeBio.id))?.outcome).toBe("none");
  });
});

describe("linkCompanies: step 0, repeats and founded years", () => {
  it("links a grant company number with a matching name by grant_number, with no search", async () => {
    const company = await insertCompany("Glowtern Energy", {
      ukCompanyNumber: "09876501",
    });
    await addGrantParticipant(company.id, {
      name: "Glowtern Energy Ltd",
      regNumber: "9876501",
    });
    const glowtern = profile({
      companyNumber: "09876501",
      name: "GLOWTERN ENERGY LTD",
    });
    const { client, calls } = recordingClient({ companies: [glowtern] });
    await run(client);
    expect(await linksOf(company.id)).toEqual([
      expect.objectContaining({
        registryId: "09876501",
        status: "linked",
        method: "grant_number",
      }),
    ]);
    expect(calls).toEqual(["profile:09876501"]);
  });

  it("puts grant companies with a number first", async () => {
    const news = await insertCompany("Nova");
    await addRound(news.id, "2026-10-01");
    const grant = await insertCompany("Glowtern Energy", {
      ukCompanyNumber: "09876501",
    });
    await addGrantParticipant(grant.id, {
      name: "Glowtern Energy Ltd",
      regNumber: "09876501",
    });
    const { client, calls } = recordingClient({
      companies: [
        profile({ companyNumber: "09876501", name: "GLOWTERN ENERGY LTD" }),
      ],
    });
    await run(client);
    expect(calls[0]).toBe("profile:09876501");
    expect(calls[1]).toBe("search:Nova");
  });

  it("makes no request on a second run when the fingerprint is unchanged", async () => {
    const company = await insertCompany("Nova");
    await addRound(company.id, "2026-05-01");
    const nova = profile({ companyNumber: "06812345", name: "NOVA LTD" });
    const client = fakeChClient({
      companies: [nova],
      search: { Nova: [hit(nova)] },
    });
    await run(client);
    const first = client.requestsMade();
    expect(first).toBeGreaterThan(0);
    const again = await run(client);
    expect(client.requestsMade()).toBe(first);
    expect(again.companiesSearched).toBe(0);

    // A new event changes the fingerprint, so the company is searched again.
    await addRound(company.id, "2026-09-01");
    await run(client);
    expect(client.requestsMade()).toBeGreaterThan(first);
  });

  it("keeps a news founded year when linking", async () => {
    const { company, options } = await brightwellSetup({
      foundedYear: 2021,
      foundedYearSource: "news",
    });
    await run(fakeChClient(options));
    const row = await companyRow(company.id);
    expect(row.ukCompanyNumber).toBe("13579246");
    expect(row.foundedYear).toBe(2021);
    expect(row.foundedYearSource).toBe("news");
  });

  it("skips a company with no name of 3 characters, with no request", async () => {
    const company = await insertCompany("Q2");
    const client = fakeChClient();
    const stats = await run(client);
    expect(client.requestsMade()).toBe(0);
    expect((await searchOf(company.id))?.outcome).toBe("skipped");
    expect(stats.companiesSkipped).toBe(1);
  });

  it("does not search companies that are not UK", async () => {
    await insertCompany("Orbital Forge", { countryCode: "US" });
    const client = fakeChClient();
    await run(client);
    expect(client.requestsMade()).toBe(0);
  });
});

describe("linkCompanies: shared addresses", () => {
  async function setup(count: number) {
    const company = await insertCompany("Larkfield Analytics");
    await setLocation(company.id, LONDON);
    const p = profile({
      companyNumber: "12999001",
      name: "LARKFIELD ANALYTICS LTD",
      officePostcode: "EC2A 4NE",
      officeOutcode: "EC2A",
    });
    const client = fakeChClient({
      companies: [p],
      search: { "Larkfield Analytics": [hit(p)] },
      postcodeCounts: { "EC2A 4NE": count },
    });
    return { company, client };
  }

  it("links by location when the office is not shared", async () => {
    const { company, client } = await setup(4);
    await run(client);
    expect(await linksOf(company.id)).toEqual([
      expect.objectContaining({ status: "linked", method: "name_location" }),
    ]);
  });

  it("a postcode with 25 active companies is cached and stops S2", async () => {
    const { company, client } = await setup(25);
    const stats = await run(client);
    expect(await linksOf(company.id)).toEqual([
      expect.objectContaining({ status: "candidate" }),
    ]);
    expect(await db.select().from(chAddressCounts)).toEqual([
      expect.objectContaining({ postcode: "EC2A 4NE", activeCompanies: 25 }),
    ]);
    expect(stats.addressChecks).toBe(1);
  });
});

describe("linkCompanies: limits", () => {
  it("never exceeds maxRequests and leaves the company due", async () => {
    for (const max of [0, 1, 2, 3, 4, 5]) {
      const fresh = await createTestDb();
      const saved = db;
      db = fresh.db;
      try {
        const { company, options } = await brightwellSetup();
        const client = fakeChClient(options);
        const stats = await run(client, max);
        expect(client.requestsMade()).toBeLessThanOrEqual(max);
        expect(stats.requests).toBe(client.requestsMade());
        expect(stats.stoppedAtLimit).toBe(true);
        expect(await searchOf(company.id)).toBeUndefined();
        expect(await linksOf(company.id)).toEqual([]);
      } finally {
        db = saved;
        await fresh.close();
      }
    }
  }, 60_000);

  it("finishes the rest on the next run", async () => {
    const { company, options } = await brightwellSetup();
    const first = await run(fakeChClient(options), 2);
    expect(first.stoppedAtLimit).toBe(true);
    const second = await run(fakeChClient(options), 100);
    expect(second.stoppedAtLimit).toBe(false);
    expect(await linksOf(company.id)).toEqual([
      expect.objectContaining({ status: "linked" }),
    ]);
  });

  it("stops at a rate limit with rateLimited set, without throwing", async () => {
    const { company, options } = await brightwellSetup();
    const inner = fakeChClient(options);
    const client: ChClient = {
      ...inner,
      getCompany: () => Promise.reject(new RateLimitedError()),
    };
    const stats = await run(client);
    expect(stats.rateLimited).toBe(true);
    expect(await searchOf(company.id)).toBeUndefined();
  });
});

describe("linkCompanies: country hints (D62)", () => {
  let itemCounter = 0;

  async function addCurrencyRound(
    companyId: number,
    announcedOn: string,
    currency: string,
    amountMinor = 210_000_000,
  ) {
    const event = await addRound(companyId, announcedOn);
    await db
      .update(fundingRounds)
      .set({ amountMinor, currency })
      .where(eq(fundingRounds.eventId, event.id));
    return event;
  }

  /** A report of the event from the source with this slug. */
  async function addReport(
    eventId: number,
    sourceSlug: string,
    company: { name: string; city?: string | null; regionText?: string | null },
  ) {
    itemCounter += 1;
    const [existing] = await db
      .select()
      .from(sources)
      .where(eq(sources.slug, sourceSlug));
    const source =
      existing ??
      (
        await db
          .insert(sources)
          .values({
            slug: sourceSlug,
            name: sourceSlug,
            kind: "rss",
            url: `https://${sourceSlug}.test/feed`,
          })
          .returning()
      )[0]!;
    const [item] = await db
      .insert(sourceItems)
      .values({
        sourceId: source.id,
        externalId: `item-${itemCounter}`,
        url: `https://${sourceSlug}.test/${itemCounter}`,
        canonicalUrl: `https://${sourceSlug}.test/${itemCounter}`,
        title: "Invented headline",
      })
      .returning();
    const [extraction] = await db
      .insert(extractions)
      .values({
        sourceItemId: item!.id,
        promptVersion: "v2",
        model: "test",
        isRelevant: true,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
        result: {
          isRelevant: true,
          events: [
            {
              type: "funding_round",
              company: {
                name: company.name,
                websiteDomain: null,
                description: null,
                countryCode: null,
                city: company.city ?? null,
                regionText: company.regionText ?? null,
                foundedYear: null,
                tags: [],
              },
              announcedOn: null,
              funding: null,
              acquisition: null,
              launch: null,
            },
          ],
        },
      })
      .returning();
    await db.insert(eventSources).values({
      eventId,
      extractionId: extraction!.id,
      sourceItemId: item!.id,
      eventIndex: 0,
    });
  }

  function brightwellClient() {
    return recordingClient({
      companies: [BRIGHTWELL],
      search: { "Brightwell Robotics": [hit(BRIGHTWELL)] },
      filings: { "13579246": [sh01("2026-02-02")] },
    });
  }

  it("searches a company with no country and a GBP round, and records why", async () => {
    const company = await insertCompany("Brightwell Robotics", {
      countryCode: null,
    });
    await addCurrencyRound(company.id, "2026-03-10", "GBP");
    const { client, calls } = brightwellClient();
    const messages: string[] = [];
    await linkCompanies({
      db,
      client,
      now: NOW,
      maxRequests: 100,
      log: (m) => messages.push(m),
    });

    expect(calls).toContain("search:Brightwell Robotics");
    const [link] = await linksOf(company.id);
    // The link rules are unchanged: an exact name with an SH01 36 days
    // before the round links, as for a GB company.
    expect(link).toMatchObject({ status: "linked", method: "name_filing" });
    expect(link!.reason).toContain("searched on hint: gbp; country not stated");
    expect(messages).toContain(
      "registry: 1 companies searched on hints only (gbp 1)",
    );
    // A hint is never written as the company's country.
    expect((await companyRow(company.id)).countryCode).toBeNull();
  });

  it("searches a company reported only by UKTN", async () => {
    const company = await insertCompany("Brightwell Robotics", {
      countryCode: null,
    });
    const event = await addRound(company.id, "2026-03-10");
    await addReport(event.id, "uktech-news", { name: "Brightwell Robotics" });
    const { client, calls } = brightwellClient();
    await run(client);

    expect(calls).toContain("search:Brightwell Robotics");
    const [link] = await linksOf(company.id);
    expect(link!.reason).toContain("searched on hint: uk_source");
  });

  it("does not search a company reported only by a source with no country hint", async () => {
    const company = await insertCompany("Brightwell Robotics", {
      countryCode: null,
    });
    const event = await addRound(company.id, "2026-03-10");
    await addReport(event.id, "techcrunch-venture", {
      name: "Brightwell Robotics",
    });
    const { client, calls } = brightwellClient();
    await run(client);
    expect(calls).toEqual([]);
  });

  it("does not search a company whose country is FR, even with a GBP round", async () => {
    const company = await insertCompany("Brightwell Robotics", {
      countryCode: "FR",
    });
    const event = await addCurrencyRound(company.id, "2026-03-10", "GBP");
    await addReport(event.id, "uktech-news", { name: "Brightwell Robotics" });
    const { client, calls } = brightwellClient();
    await run(client);
    expect(calls).toEqual([]);
    expect(await eligibleCompanies(db)).toEqual([]);
  });

  it("takes a UK town or region from the extractions, but not a place abroad", async () => {
    const leeds = await insertCompany("Leeds Hint", { countryCode: null });
    const leedsEvent = await addRound(leeds.id, "2026-03-10");
    await addReport(leedsEvent.id, "tech-eu", {
      name: "Leeds Hint",
      city: "Leeds",
    });
    const scotland = await insertCompany("Scotland Hint", {
      countryCode: null,
    });
    const scotlandEvent = await addRound(scotland.id, "2026-03-11");
    await addReport(scotlandEvent.id, "tech-eu", {
      name: "Scotland Hint",
      regionText: "Scotland",
    });
    const town = await insertCompany("Column Hint", {
      countryCode: null,
      city: "Manchester",
    });
    const paris = await insertCompany("Paris Hint", { countryCode: null });
    const parisEvent = await addRound(paris.id, "2026-03-12");
    await addReport(parisEvent.id, "tech-eu", {
      name: "Paris Hint",
      city: "Paris",
      regionText: "Ile-de-France",
    });

    const queue = await eligibleCompanies(db);
    expect(queue.map((c) => [c.id, c.reasons])).toEqual([
      [scotland.id, ["uk_place"]],
      [leeds.id, ["uk_place"]],
      [town.id, ["uk_place"]],
    ]);
  });

  it("orders the queue by strength of hint, then newest event", async () => {
    const place = await insertCompany("Place Only", {
      countryCode: null,
      city: "Leeds",
    });
    await addRound(place.id, "2026-10-01");
    const gbp = await insertCompany("Gbp Only", { countryCode: null });
    await addCurrencyRound(gbp.id, "2026-01-01", "GBP");
    const both = await insertCompany("Gbp And Uktn", { countryCode: null });
    const bothEvent = await addCurrencyRound(both.id, "2025-06-01", "GBP");
    await addReport(bothEvent.id, "uktech-news", { name: "Gbp And Uktn" });
    const gb = await insertCompany("Stated GB");
    await addRound(gb.id, "2024-01-01");
    const newerGbp = await insertCompany("Newer Gbp", { countryCode: null });
    await addCurrencyRound(newerGbp.id, "2026-05-01", "GBP");

    const queue = await eligibleCompanies(db);
    expect(queue.map((c) => [c.id, c.tier])).toEqual([
      [gb.id, 1],
      [both.id, 2],
      [newerGbp.id, 3],
      [gbp.id, 3],
      [place.id, 4],
    ]);
  });

  it("never links a hinted company on a prefix match, even with an SH01", async () => {
    const company = await insertCompany("Tidewell", { countryCode: null });
    const event = await addCurrencyRound(company.id, "2026-01-20", "GBP");
    await addReport(event.id, "uktech-news", {
      name: "Tidewell",
      city: "London",
    });
    const platform = profile({
      companyNumber: "15550001",
      name: "TIDEWELL PLATFORM LTD",
      officePostcode: "EC2A 4NE",
      officeOutcode: "EC2A",
    });
    const client = fakeChClient({
      companies: [platform],
      search: { Tidewell: [hit(platform)] },
      filings: { "15550001": [sh01("2025-12-15")] },
    });
    await run(client);

    const links = await linksOf(company.id);
    expect(links.map((l) => l.status)).toEqual(["candidate"]);
    expect(links[0]!.reason).toContain("trading name: review");
    expect(links[0]!.reason).toContain(
      "searched on hint: gbp, uk_source, uk_place; country not stated",
    );
  });

  it("keeps the request limit with hinted companies in the queue", async () => {
    for (let i = 0; i < 5; i += 1) {
      const company = await insertCompany(`Hinted Company ${i}`, {
        countryCode: null,
      });
      await addCurrencyRound(company.id, `2026-0${i + 1}-01`, "GBP");
    }
    const client = fakeChClient();
    const stats = await run(client, 3);
    expect(client.requestsMade()).toBe(3);
    expect(stats.stoppedAtLimit).toBe(true);
    expect(stats.companiesSearched).toBe(3);
  });
});
