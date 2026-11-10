import { describe, expect, it } from "vitest";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import { postProcess, type ProcessItem } from "./post-process";

const item: ProcessItem = {
  title: "Acme raises $4M seed led by Example Ventures",
  summary: "acme.io raised money.",
  url: "https://news.example.com/acme",
  publishedAt: new Date("2026-10-08T12:00:00Z"),
};

function company(
  overrides: Partial<ExtractedEventV1["company"]> = {},
): ExtractedEventV1["company"] {
  return {
    name: "Acme",
    websiteDomain: null,
    description: null,
    countryCode: null,
    city: null,
    foundedYear: null,
    tags: [],
    ...overrides,
  };
}

function funding(
  overrides: Partial<NonNullable<ExtractedEventV1["funding"]>> = {},
  event: Partial<ExtractedEventV1> = {},
): ExtractedEventV1 {
  return {
    type: "funding_round",
    company: company(),
    announcedOn: null,
    funding: {
      roundType: "seed",
      roundLabel: null,
      amountText: "$4M",
      currencyHint: null,
      investors: [],
      includesIndividualAngels: false,
      ...overrides,
    },
    acquisition: null,
    launch: null,
    ...event,
  };
}

function result(events: ExtractedEventV1[]): ExtractionV1 {
  return { isRelevant: true, events };
}

describe("postProcess", () => {
  it("returns nothing for an irrelevant extraction", () => {
    expect(
      postProcess({ isRelevant: false, events: [funding()] }, item),
    ).toEqual([]);
  });

  it("parses the amount in code", () => {
    const [event] = postProcess(result([funding()]), item);
    expect(event?.type === "funding_round" && event.funding.amount).toEqual({
      amountMinor: 400_000_000,
      currency: "USD",
    });
  });

  it("drops an amount too small to be a real round", () => {
    const [event] = postProcess(
      result([funding({ amountText: "$3,499" })]),
      item,
    );
    expect(event?.type === "funding_round" && event.funding.amount).toBeNull();
  });

  it("keeps a domain only when it appears in the text", () => {
    const events = postProcess(
      result([
        funding({}, { company: company({ websiteDomain: "acme.io" }) }),
        funding({}, { company: company({ websiteDomain: "invented.ai" }) }),
      ]),
      item,
    );
    expect(events[0]?.company.websiteDomain).toBe("acme.io");
    expect(events[1]?.company.websiteDomain).toBeNull();
  });

  it("uppercases country codes and drops invalid ones", () => {
    const events = postProcess(
      result([
        funding({}, { company: company({ countryCode: "gb" }) }),
        funding({}, { company: company({ countryCode: "UK-ish" }) }),
      ]),
      item,
    );
    expect(events[0]?.company.countryCode).toBe("GB");
    expect(events[1]?.company.countryCode).toBeNull();
  });

  it("normalises and de-duplicates tags", () => {
    const [event] = postProcess(
      result([
        funding(
          {},
          {
            company: company({
              tags: ["AI Agents", "ai  agents", "Climate & Tech"],
            }),
          },
        ),
      ]),
      item,
    );
    expect(event?.company.tags).toEqual(["ai agents", "climate and tech"]);
  });

  it("drops empty investor names and keeps lead if any mention says so", () => {
    const [event] = postProcess(
      result([
        funding({
          investors: [
            { name: " ", kind: "vc", isLead: false },
            { name: "Example", kind: "vc", isLead: true },
            { name: "example", kind: "vc", isLead: false },
          ],
        }),
      ]),
      item,
    );
    expect(event?.type === "funding_round" && event.funding.investors).toEqual([
      { name: "example", kind: "vc", isLead: true },
    ]);
  });

  it("drops events with no company and keeps the original index", () => {
    const events = postProcess(
      result([funding({}, { company: company({ name: "  " }) }), funding()]),
      item,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.eventIndex).toBe(1);
  });

  it("rejects malformed and future dates", () => {
    const events = postProcess(
      result([
        funding({}, { announcedOn: "2026-10-01" }),
        funding({}, { announcedOn: "2026-13-01" }),
        funding({}, { announcedOn: "2027-01-01" }),
      ]),
      item,
    );
    expect(events.map((event) => event.announcedOn)).toEqual([
      "2026-10-01",
      null,
      null,
    ]);
  });

  it("only keeps launch URLs that are http(s) and in the text", () => {
    const launch = (url: string): ExtractedEventV1 => ({
      type: "launch",
      company: company(),
      announcedOn: null,
      funding: null,
      acquisition: null,
      launch: { kind: "product", productName: "Thing", url },
    });
    const events = postProcess(
      result([
        launch("https://acme.io/thing"),
        launch("javascript:alert(1)"),
        launch("https://invented.ai/thing"),
      ]),
      item,
    );
    expect(events.map((e) => e.type === "launch" && e.launch.url)).toEqual([
      "https://acme.io/thing",
      null,
      null,
    ]);
  });
});
