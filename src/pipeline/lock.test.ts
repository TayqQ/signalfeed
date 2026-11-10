import { describe, expect, it } from "vitest";
import {
  assertDirectConnection,
  withIngestLock,
  type IngestLock,
} from "./lock";

function fakeLock(available: boolean) {
  const calls: string[] = [];
  const lock: IngestLock = {
    tryAcquire() {
      calls.push("acquire");
      return Promise.resolve(available);
    },
    release() {
      calls.push("release");
      return Promise.resolve();
    },
  };
  return { lock, calls };
}

describe("withIngestLock", () => {
  it("does no work when the lock is held", async () => {
    const { lock, calls } = fakeLock(false);
    let ran = false;
    const result = await withIngestLock(lock, () => {
      ran = true;
      return Promise.resolve(1);
    });
    expect(result).toEqual({ ran: false });
    expect(ran).toBe(false);
    expect(calls).toEqual(["acquire"]);
  });

  it("releases even when the work throws", async () => {
    const { lock, calls } = fakeLock(true);
    await expect(
      withIngestLock(lock, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["acquire", "release"]);
  });
});

describe("assertDirectConnection", () => {
  it("rejects Neon's pooled host, whose pooler breaks session locks", () => {
    expect(() =>
      assertDirectConnection(
        "postgres://u:p@ep-cool-1-pooler.eu-west-2.aws.neon.tech/db",
      ),
    ).toThrow(/pooler/);
  });

  it("accepts a direct host", () => {
    expect(() =>
      assertDirectConnection(
        "postgres://u:p@ep-cool-1.eu-west-2.aws.neon.tech/db",
      ),
    ).not.toThrow();
  });
});
