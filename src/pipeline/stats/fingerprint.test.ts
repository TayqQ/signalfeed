import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { events, fundingRounds } from "@/db/schema";
import { insertCompany } from "@/pipeline/resolve/testing";
import {
  computeFingerprint,
  recordRebuild,
  shouldRebuild,
  statsFingerprint,
} from "./fingerprint";

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

describe("statsFingerprint", () => {
  it("is stable while the inputs do not change", async () => {
    const { db } = testDb;
    await insertCompany(db, { name: "Stable Ltd" });
    const first = await statsFingerprint(db);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await statsFingerprint(db)).toBe(first);
  });

  it("changes when an event is added or a round amount changes", async () => {
    const { db } = testDb;
    const company = await insertCompany(db, { name: "Moving Ltd" });
    const empty = await statsFingerprint(db);

    const [event] = await db
      .insert(events)
      .values({
        type: "funding_round",
        companyId: company.id,
        announcedOn: "2026-03-02",
      })
      .returning();
    if (!event) throw new Error("no event");
    await db.insert(fundingRounds).values({ eventId: event.id });
    const withEvent = await statsFingerprint(db);
    expect(withEvent).not.toBe(empty);

    // An FX backfill sets the GBP amount without touching a timestamp.
    await db
      .update(fundingRounds)
      .set({ amountMinor: 100, currency: "GBP", amountGbpMinor: 100 })
      .where(eq(fundingRounds.eventId, event.id));
    expect(await statsFingerprint(db)).not.toBe(withEvent);
  });

  it("depends on the logic version", async () => {
    const { db } = testDb;
    const inputs = [{ table: events }];
    expect(await computeFingerprint(db, "a", inputs)).not.toBe(
      await computeFingerprint(db, "b", inputs),
    );
  });
});

describe("shouldRebuild", () => {
  it("is true until the same fingerprint is recorded", async () => {
    const { db } = testDb;
    expect(await shouldRebuild(db, "stats", "abc")).toBe(true);
    await recordRebuild(db, "stats", "abc", new Date("2026-11-11T10:00:00Z"));
    expect(await shouldRebuild(db, "stats", "abc")).toBe(false);
    expect(await shouldRebuild(db, "stats", "def")).toBe(true);
    expect(await shouldRebuild(db, "locations", "abc")).toBe(true);

    await recordRebuild(db, "stats", "def", new Date("2026-11-11T11:00:00Z"));
    expect(await shouldRebuild(db, "stats", "abc")).toBe(true);
    expect(await shouldRebuild(db, "stats", "def")).toBe(false);
  });
});
