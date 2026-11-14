import { describe, expect, it } from "vitest";
import {
  isSiteIndexingEnabled,
  parseNoLlmPipelineEnv,
  parsePipelineEnv,
  parseWebEnv,
  webEnvSchema,
} from "./env";
import { ConfigError } from "./errors";

const secrets = {
  DATABASE_URL: "postgres://user:db-secret-123@host/db",
  OPENAI_API_KEY: "sk-test-secret-456",
  HTTP_CONTACT: "https://example.com/contact",
};

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw");
}

describe("parsePipelineEnv", () => {
  it("applies defaults", () => {
    expect(parsePipelineEnv(secrets)).toEqual({
      ...secrets,
      EXTRACTION_MODEL: "gpt-5.6-luna",
      LLM_MONTHLY_CAP_GBP: 3,
      MAX_EXTRACTIONS_PER_RUN: 150,
      EMBEDDING_MODEL: "text-embedding-3-small",
      MAX_EMBEDDINGS_PER_RUN: 2000,
      MAX_THEME_NAMES_PER_RUN: 20,
      MAX_GRANT_TAGGINGS_PER_RUN: 200,
      THEME_CHECK_MODEL: "gpt-5.6-luna",
      GTR_REQUESTS_PER_SECOND: 3,
      MAX_GRANT_ORG_FETCHES_PER_RUN: 1500,
      MAX_CH_REQUESTS_PER_RUN: 2000,
      MAX_EDGAR_DAYS_PER_RUN: 10,
      MAX_EDGAR_REQUESTS_PER_RUN: 3000,
    });
  });

  it("treats empty strings as unset so defaults still apply", () => {
    const env = parsePipelineEnv({
      ...secrets,
      LLM_MONTHLY_CAP_GBP: "",
      EXTRACTION_MODEL: "",
    });
    expect(env.LLM_MONTHLY_CAP_GBP).toBe(3);
    expect(env.EXTRACTION_MODEL).toBe("gpt-5.6-luna");
  });

  it("coerces numeric values", () => {
    const env = parsePipelineEnv({
      ...secrets,
      LLM_MONTHLY_CAP_GBP: "2.5",
      MAX_EXTRACTIONS_PER_RUN: "20",
    });
    expect(env.LLM_MONTHLY_CAP_GBP).toBe(2.5);
    expect(env.MAX_EXTRACTIONS_PER_RUN).toBe(20);
  });

  it("throws ConfigError naming a missing OPENAI_API_KEY without echoing values", () => {
    const withoutKey = { ...secrets, OPENAI_API_KEY: undefined };
    const error = captureError(() => parsePipelineEnv(withoutKey));

    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.code).toBe("CONFIG");
    expect(configError.missingKeys).toEqual(["OPENAI_API_KEY"]);
    expect(configError.message).toContain("OPENAI_API_KEY");
    expect(configError.message).not.toContain(secrets.DATABASE_URL);
    expect(configError.message).not.toContain("db-secret-123");
  });

  it("lists every missing key", () => {
    const error = captureError(() => parsePipelineEnv({})) as ConfigError;
    expect(error.missingKeys).toEqual([
      "DATABASE_URL",
      "HTTP_CONTACT",
      "OPENAI_API_KEY",
    ]);
  });

  it("rejects a non-positive cap without printing the value", () => {
    const error = captureError(() =>
      parsePipelineEnv({ ...secrets, LLM_MONTHLY_CAP_GBP: "-7.25" }),
    ) as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.invalidKeys).toEqual(["LLM_MONTHLY_CAP_GBP"]);
    expect(error.message).not.toContain("-7.25");
    expect(error.message).not.toContain(secrets.OPENAI_API_KEY);
  });
});

describe("Phase 2 pipeline settings", () => {
  const phase2Defaults = {
    EMBEDDING_MODEL: "text-embedding-3-small",
    MAX_EMBEDDINGS_PER_RUN: 2000,
    MAX_THEME_NAMES_PER_RUN: 20,
    MAX_GRANT_TAGGINGS_PER_RUN: 200,
  };

  it("leaves GITHUB_TOKEN unset by default", () => {
    expect(parsePipelineEnv(secrets)).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("reads overrides and treats empty strings as unset", () => {
    const env = parsePipelineEnv({
      ...secrets,
      EMBEDDING_MODEL: "text-embedding-3-large",
      MAX_EMBEDDINGS_PER_RUN: "500",
      MAX_THEME_NAMES_PER_RUN: "",
      MAX_GRANT_TAGGINGS_PER_RUN: "50",
      GITHUB_TOKEN: "ghp-test-token",
    });
    expect(env.EMBEDDING_MODEL).toBe("text-embedding-3-large");
    expect(env.MAX_EMBEDDINGS_PER_RUN).toBe(500);
    expect(env.MAX_THEME_NAMES_PER_RUN).toBe(20);
    expect(env.MAX_GRANT_TAGGINGS_PER_RUN).toBe(50);
    expect(env.GITHUB_TOKEN).toBe("ghp-test-token");
  });

  it.each([
    ["MAX_EMBEDDINGS_PER_RUN", "0"],
    ["MAX_EMBEDDINGS_PER_RUN", "12.5"],
    ["MAX_THEME_NAMES_PER_RUN", "-1"],
    ["MAX_THEME_NAMES_PER_RUN", "many"],
    ["MAX_GRANT_TAGGINGS_PER_RUN", "0"],
  ])("rejects %s=%s without printing the value", (key, value) => {
    const error = captureError(() =>
      parsePipelineEnv({ ...secrets, [key]: value }),
    ) as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.invalidKeys).toEqual([key]);
    expect(error.missingKeys).toEqual([]);
    expect(error.message).not.toContain(secrets.OPENAI_API_KEY);
  });

  it("applies the same defaults without an LLM key", () => {
    const withoutKey = { ...secrets, OPENAI_API_KEY: undefined };
    const env = parseNoLlmPipelineEnv(withoutKey);
    expect(env).toMatchObject(phase2Defaults);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("validates the same settings without an LLM key", () => {
    const error = captureError(() =>
      parseNoLlmPipelineEnv({
        DATABASE_URL: secrets.DATABASE_URL,
        HTTP_CONTACT: secrets.HTTP_CONTACT,
        MAX_EMBEDDINGS_PER_RUN: "-5",
        GITHUB_TOKEN: "ghp-test-token",
      }),
    ) as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.invalidKeys).toEqual(["MAX_EMBEDDINGS_PER_RUN"]);
    expect(error.missingKeys).toEqual([]);
    expect(error.message).not.toContain("ghp-test-token");
  });
});

describe("Phase 3 pipeline settings", () => {
  const phase3Defaults = {
    MAX_CH_REQUESTS_PER_RUN: 2000,
    MAX_EDGAR_DAYS_PER_RUN: 10,
    MAX_EDGAR_REQUESTS_PER_RUN: 3000,
  };
  const phase3Overrides = {
    COMPANIES_HOUSE_API_KEY: "ch-test-key-789",
    MAX_CH_REQUESTS_PER_RUN: "500",
    MAX_EDGAR_DAYS_PER_RUN: "180",
    MAX_EDGAR_REQUESTS_PER_RUN: "40000",
  };

  it("applies defaults and leaves COMPANIES_HOUSE_API_KEY unset", () => {
    const env = parsePipelineEnv(secrets);
    expect(env).toMatchObject(phase3Defaults);
    expect(env).not.toHaveProperty("COMPANIES_HOUSE_API_KEY");
  });

  it("treats an empty COMPANIES_HOUSE_API_KEY as missing", () => {
    const env = parsePipelineEnv({ ...secrets, COMPANIES_HOUSE_API_KEY: "" });
    expect(env).not.toHaveProperty("COMPANIES_HOUSE_API_KEY");
    expect(
      parseNoLlmPipelineEnv({ ...secrets, COMPANIES_HOUSE_API_KEY: "" }),
    ).not.toHaveProperty("COMPANIES_HOUSE_API_KEY");
  });

  it("treats empty limits as unset so defaults still apply", () => {
    const env = parsePipelineEnv({
      ...secrets,
      MAX_CH_REQUESTS_PER_RUN: "",
      MAX_EDGAR_DAYS_PER_RUN: "",
      MAX_EDGAR_REQUESTS_PER_RUN: "",
    });
    expect(env).toMatchObject(phase3Defaults);
  });

  it("reads overrides in both pipeline schemas", () => {
    const expected = {
      COMPANIES_HOUSE_API_KEY: "ch-test-key-789",
      MAX_CH_REQUESTS_PER_RUN: 500,
      MAX_EDGAR_DAYS_PER_RUN: 180,
      MAX_EDGAR_REQUESTS_PER_RUN: 40000,
    };
    expect(parsePipelineEnv({ ...secrets, ...phase3Overrides })).toMatchObject(
      expected,
    );
    expect(
      parseNoLlmPipelineEnv({
        ...secrets,
        OPENAI_API_KEY: undefined,
        ...phase3Overrides,
      }),
    ).toMatchObject(expected);
  });

  it("applies the same defaults without an LLM key", () => {
    const env = parseNoLlmPipelineEnv({
      ...secrets,
      OPENAI_API_KEY: undefined,
    });
    expect(env).toMatchObject(phase3Defaults);
    expect(env).not.toHaveProperty("COMPANIES_HOUSE_API_KEY");
  });

  it.each([
    ["MAX_CH_REQUESTS_PER_RUN", "0"],
    ["MAX_CH_REQUESTS_PER_RUN", "2.5"],
    ["MAX_EDGAR_DAYS_PER_RUN", "-1"],
    ["MAX_EDGAR_REQUESTS_PER_RUN", "lots"],
  ])("rejects %s=%s without printing the key", (key, value) => {
    const error = captureError(() =>
      parsePipelineEnv({
        ...secrets,
        COMPANIES_HOUSE_API_KEY: "ch-test-key-789",
        [key]: value,
      }),
    ) as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.invalidKeys).toEqual([key]);
    expect(error.missingKeys).toEqual([]);
    expect(error.message).not.toContain("ch-test-key-789");
  });
});

describe("web env", () => {
  it("gains no Phase 3 setting and rejects none", () => {
    const env = parseWebEnv({
      DATABASE_URL: secrets.DATABASE_URL,
      COMPANIES_HOUSE_API_KEY: "ch-test-key-789",
      MAX_CH_REQUESTS_PER_RUN: "not a number",
      MAX_EDGAR_DAYS_PER_RUN: "-1",
      MAX_EDGAR_REQUESTS_PER_RUN: "",
    });
    expect(env).toEqual({ DATABASE_URL: secrets.DATABASE_URL });
    expect(Object.keys(webEnvSchema.shape)).toEqual([
      "DATABASE_URL",
      "SITE_INDEXING",
    ]);
  });

  it("ignores OPENAI_API_KEY", () => {
    const env = parseWebEnv(secrets);
    expect(env).toEqual({ DATABASE_URL: secrets.DATABASE_URL });
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(webEnvSchema.parse(secrets)).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("throws ConfigError when DATABASE_URL is missing", () => {
    const error = captureError(() =>
      parseWebEnv({ OPENAI_API_KEY: "sk-test" }),
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).missingKeys).toEqual(["DATABASE_URL"]);
    expect((error as ConfigError).message).not.toContain("sk-test");
  });
});

describe("grants speed settings and site indexing", () => {
  it("reads the GtR rate and the organisation cap", () => {
    const env = parsePipelineEnv({
      ...secrets,
      GTR_REQUESTS_PER_SECOND: "5",
      MAX_GRANT_ORG_FETCHES_PER_RUN: "800",
    });
    expect(env.GTR_REQUESTS_PER_SECOND).toBe(5);
    expect(env.MAX_GRANT_ORG_FETCHES_PER_RUN).toBe(800);
  });

  it.each(["0", "-1", "11", "fast"])(
    "rejects GTR_REQUESTS_PER_SECOND %s",
    (v) => {
      expect(() =>
        parsePipelineEnv({ ...secrets, GTR_REQUESTS_PER_SECOND: v }),
      ).toThrow(ConfigError);
    },
  );

  it("treats SITE_INDEXING as optional in the web schema", () => {
    expect(parseWebEnv({ DATABASE_URL: "postgres://x" })).toEqual({
      DATABASE_URL: "postgres://x",
    });
    expect(
      parseWebEnv({ DATABASE_URL: "postgres://x", SITE_INDEXING: "true" })
        .SITE_INDEXING,
    ).toBe("true");
  });

  it("enables indexing only for the exact value true", () => {
    expect(isSiteIndexingEnabled({})).toBe(false);
    expect(isSiteIndexingEnabled({ SITE_INDEXING: "TRUE" })).toBe(false);
    expect(isSiteIndexingEnabled({ SITE_INDEXING: "true" })).toBe(true);
  });
});
