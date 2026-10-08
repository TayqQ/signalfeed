import { describe, expect, it } from "vitest";
import { parsePipelineEnv, parseWebEnv, webEnvSchema } from "./env";
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
      EXTRACTION_MODEL: "gpt-4.1-nano",
      LLM_MONTHLY_CAP_GBP: 3,
      MAX_EXTRACTIONS_PER_RUN: 150,
    });
  });

  it("treats empty strings as unset so defaults still apply", () => {
    const env = parsePipelineEnv({
      ...secrets,
      LLM_MONTHLY_CAP_GBP: "",
      EXTRACTION_MODEL: "",
    });
    expect(env.LLM_MONTHLY_CAP_GBP).toBe(3);
    expect(env.EXTRACTION_MODEL).toBe("gpt-4.1-nano");
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

describe("web env", () => {
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
