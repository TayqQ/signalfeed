import { describe, expect, it } from "vitest";
import { pageRobots, robotsFile } from "./indexing";

describe("indexing is off until launch", () => {
  it.each([
    {},
    { SITE_INDEXING: "" },
    { SITE_INDEXING: "false" },
    { SITE_INDEXING: "yes" },
  ])("blocks indexing for %j", (env) => {
    expect(pageRobots(env)).toEqual({ index: false, follow: false });
    expect(robotsFile(env)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("allows indexing only when SITE_INDEXING is true", () => {
    const env = { SITE_INDEXING: "true" };
    expect(pageRobots(env)).toEqual({ index: true, follow: true });
    expect(robotsFile(env)).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });
});
