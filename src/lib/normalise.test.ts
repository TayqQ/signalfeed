import { describe, expect, it } from "vitest";
import {
  canonicaliseUrl,
  domainAppearsIn,
  extractDomain,
  normaliseCompanyName,
  normaliseInvestorName,
  normaliseTag,
  slugify,
} from "./normalise";

describe("normaliseCompanyName", () => {
  it.each([
    ["Acme.ai", "acme"],
    ["ACME Ltd", "acme"],
    ["Acmé GmbH", "acme"],
    ["Acme AI", "acme ai"],
    ["Acme, Inc.", "acme"],
    ["ACME LLC", "acme"],
    ["  Acme   Robotics  ", "acme robotics"],
    ["My-Startup.io", "my startup"],
    ["Acme PLC", "acme"],
    ["Östlund AB", "ostlund"],
    ["Acme Co.", "acme"],
    ["Acme Capital", "acme"],
    ["Acme Ventures Ltd", "acme"],
    ["Møller Oy", "moller"],
    ["Barnes & Noble", "barnes noble"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normaliseCompanyName(input)).toBe(expected);
  });

  it("keeps Acme AI distinct from Acme", () => {
    expect(normaliseCompanyName("Acme AI")).not.toBe(
      normaliseCompanyName("Acme"),
    );
    expect(normaliseCompanyName("Acme")).toBe("acme");
  });
});

describe("normaliseInvestorName", () => {
  it("keeps capital and ventures", () => {
    expect(normaliseInvestorName("Acme Capital")).toBe("acme capital");
    expect(normaliseInvestorName("Northzone Ventures")).toBe(
      "northzone ventures",
    );
    expect(normaliseInvestorName("Acme Capital Ltd")).toBe("acme capital");
    expect(normaliseInvestorName("Acmé Ventures GmbH")).toBe("acme ventures");
  });
});

describe("slugify", () => {
  it("builds an ASCII kebab-case slug", () => {
    expect(slugify("Acme Robotics")).toBe("acme-robotics");
    expect(slugify("Acmé GmbH")).toBe("acme-gmbh");
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Acme 東京 Labs")).toBe("acme-labs");
  });

  it("caps the slug at 60 characters without a trailing hyphen", () => {
    expect(slugify("a".repeat(80))).toBe("a".repeat(60));
    expect(slugify(`${"a".repeat(59)}---b`)).toBe("a".repeat(59));
    expect(slugify("a".repeat(80)).length).toBeLessThanOrEqual(60);
  });
});

describe("canonicaliseUrl", () => {
  it.each([
    ["https://Example.COM/Path/", "https://example.com/Path"],
    [
      "https://example.com/a?utm_source=x&utm_medium=y&b=2&a=1#frag",
      "https://example.com/a?a=1&b=2",
    ],
    [
      "https://example.com/news?ref=twitter&id=5",
      "https://example.com/news?id=5",
    ],
    [
      "https://example.com/a?fbclid=abc&gclid=def&ok=1",
      "https://example.com/a?ok=1",
    ],
    ["https://example.com/", "https://example.com"],
    ["https://example.com/a/?z=9&m=2", "https://example.com/a?m=2&z=9"],
    ["http://www.Example.com/a/#section", "http://www.example.com/a"],
  ])("canonicalises %j", (input, expected) => {
    expect(canonicaliseUrl(input)).toBe(expected);
  });

  it("drops mixed-case tracking parameters and keeps other query values sorted", () => {
    expect(canonicaliseUrl("https://example.com/a?UTM_Source=x&b=1&a=2")).toBe(
      "https://example.com/a?a=2&b=1",
    );
  });
});

describe("extractDomain", () => {
  it("returns the registrable host without www", () => {
    expect(extractDomain("https://www.blog.acme.co.uk/about")).toBe(
      "acme.co.uk",
    );
    expect(extractDomain("WWW.Acme.com")).toBe("acme.com");
    expect(extractDomain("acme.ai")).toBe("acme.ai");
    expect(extractDomain("https://user:pass@www.acme.com:8080/a")).toBe(
      "acme.com",
    );
  });
});

describe("normaliseTag", () => {
  it("lowercases, trims, collapses whitespace and rewrites ampersands", () => {
    expect(normaliseTag("  AI   Agents ")).toBe("ai agents");
    expect(normaliseTag("Climate & Fintech")).toBe("climate and fintech");
    expect(normaliseTag("R&D")).toBe("r and d");
  });

  it("caps tags at 40 characters", () => {
    expect(normaliseTag("a".repeat(50))).toBe("a".repeat(40));
    expect(normaliseTag(`  ${"b".repeat(50)}  `).length).toBe(40);
  });
});

describe("domainAppearsIn", () => {
  it("matches a host and rejects a longer host", () => {
    expect(domainAppearsIn("acme.com", ["raised by acme.com today"])).toBe(
      true,
    );
    expect(domainAppearsIn("acme.com", ["See ACME.com."])).toBe(true);
    expect(domainAppearsIn("acme.com", ["https://www.acme.com/about"])).toBe(
      true,
    );
    expect(domainAppearsIn("acme.com", ["https://blog.acme.com/news"])).toBe(
      true,
    );
    expect(domainAppearsIn("acme.com", ["notacme.com"])).toBe(false);
    expect(domainAppearsIn("acme.com", ["acme.com.evil.com"])).toBe(false);
    expect(domainAppearsIn("acme.com", ["no domain here"])).toBe(false);
    expect(domainAppearsIn("", ["acme.com"])).toBe(false);
  });
});
