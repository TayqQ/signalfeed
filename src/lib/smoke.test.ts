import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("disables global fetch", () => {
    expect(() => fetch("https://example.com")).toThrow(
      "Network access is disabled in tests; inject a fake HttpFetcher",
    );
  });
});
