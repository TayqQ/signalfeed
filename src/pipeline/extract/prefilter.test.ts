import { describe, expect, it } from "vitest";
import { isCandidate } from "./prefilter";

const relevant = [
  "ExampleCo raises $12.5M to expand",
  "Pre-seed funding for ExampleCo",
  "ExampleCo announces a Series B",
  "Example Ventures invests in ExampleCo",
  "ExampleCo secures a new round of capital",
  "ExampleCorp acquires ExampleCo",
  "ExampleCo is bought by ExampleCorp",
  "ExampleCo launches a billing product",
  "Show HN: ExampleCo for clinics",
  "ExampleCo reports a £2.5 million contract",
];

const irrelevant = [
  "Opinion: ExampleCo should slow its hiring plan",
  "ExampleCo lays off 80 people after a weak quarter",
  "Recap of the ExampleConf developer conference",
  "ExampleCo earnings beat analyst forecasts",
  "New podcast episode with the ExampleCo team",
];

describe("isCandidate", () => {
  it.each(relevant)("passes relevant headline: %s", (title) => {
    expect(isCandidate({ title, summary: null })).toBe(true);
  });

  it.each(irrelevant)("rejects irrelevant headline: %s", (title) => {
    expect(isCandidate({ title, summary: null })).toBe(false);
  });

  it("passes the remaining funding, deal, and launch wordings", () => {
    const titles = [
      "ExampleCo fundraising gathers pace",
      "ExampleCo backed by Example Ventures",
      "ExampleCo closes its seed",
      "Acquisition of ExampleCo is complete",
      "Merger ties ExampleCo to ExampleLabs",
      "ExampleCo unveils its API",
      "Launch HN: ExampleCo",
      "ExampleCo cites USD 4.5m of new capital",
      "ExampleCo agrees 3 million EUR",
    ];
    for (const title of titles) {
      expect(isCandidate({ title, summary: null })).toBe(true);
    }
  });

  it("reads the summary and ignores case", () => {
    expect(
      isCandidate({
        title: "Weekly notes",
        summary: "ExampleCo RAISES a seed extension",
      }),
    ).toBe(true);
  });

  it("does not treat a bare scale word or a lookalike as money or a round", () => {
    expect(
      isCandidate({
        title: "ExampleCo reaches 5 million users",
        summary: null,
      }),
    ).toBe(false);
    expect(
      isCandidate({
        title: "A background roundup of product blogs",
        summary: null,
      }),
    ).toBe(false);
  });

  it("rejects an empty item", () => {
    expect(isCandidate({ title: "", summary: null })).toBe(false);
    expect(isCandidate({ title: "Hello", summary: "" })).toBe(false);
  });
});
