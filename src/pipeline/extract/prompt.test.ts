import { describe, expect, it } from "vitest";
import { CURRENT_EXTRACTION_SCHEMA_NAME } from "@/core/extraction-schema";
import { EXTRACTION_PROMPT_VERSION, buildSystemPrompt } from "./prompt";

describe("extraction prompt v2", () => {
  const system = buildSystemPrompt();

  it("is version v2 and names the current schema", () => {
    expect(EXTRACTION_PROMPT_VERSION).toBe("v2");
    expect(system).toContain(CURRENT_EXTRACTION_SCHEMA_NAME);
    expect(system).not.toContain("extraction_v1");
  });

  it("asks for regionText as written, and never derived from the city", () => {
    expect(system).toContain("regionText");
    expect(system).toContain("copied as written");
    expect(system).toContain("Do not derive it from the city");
    for (const example of ["Scotland", "Wales", "Yorkshire", "Bavaria"]) {
      expect(system).toContain(`"${example}"`);
    }
  });

  it("asks for a bare city name only when the text states one", () => {
    expect(system).toContain('"Leeds-based" gives "Leeds"');
    expect(system).toContain("no county, region or country");
  });

  it("forbids guessing", () => {
    expect(system).toContain("Do not guess");
    expect(system).toContain("even if you believe you know the answer");
  });

  it("lists the banned generic tag words", () => {
    for (const word of ["startup", "technology", "innovation", "funding"]) {
      expect(system).toContain(`"${word}"`);
    }
    expect(system).toContain("places, round types or company names");
    expect(system).toContain("most specific first");
  });
});
