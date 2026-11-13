import { describe, expect, it } from "vitest";
import { GENERIC_TAG_SLUGS, isGenericTag } from "./stoplist";

describe("isGenericTag", () => {
  it("matches every listed generic word", () => {
    for (const slug of GENERIC_TAG_SLUGS) expect(isGenericTag(slug)).toBe(true);
    expect(isGenericTag("startup")).toBe(true);
    expect(isGenericTag("technology")).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(isGenericTag(" Startup ")).toBe(true);
  });

  it("keeps specific tags", () => {
    for (const slug of [
      "fintech",
      "ai",
      "climate-tech",
      "edtech",
      "payments",
    ]) {
      expect(isGenericTag(slug)).toBe(false);
    }
  });

  it("is a short list of plain lowercase slugs", () => {
    expect(GENERIC_TAG_SLUGS.size).toBeLessThanOrEqual(20);
    for (const slug of GENERIC_TAG_SLUGS) expect(slug).toMatch(/^[a-z-]+$/);
  });
});
