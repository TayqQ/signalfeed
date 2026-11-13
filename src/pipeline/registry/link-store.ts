// The only code that writes `registry_links`, and the company columns and
// aliases a link fills (spec-phase3 sections 5.2, 7.2 and 8.3, D53).
//
// Invariants:
// - one `linked` row per company and registry, and one per number;
// - manual decisions are final: automatic calls never change them;
// - a number already held by another company becomes a candidate and a merge
//   candidate, never a second link;
// - every function acts on the survivor of a merged company.

import { and, eq, isNull, ne } from "drizzle-orm";
import type {
  LinkDecidedBy,
  RegistryKind,
  RegistryLinkMethod,
  RegistryLinkStatus,
  RegistrySearchOutcome,
} from "@/core/enums";
import { normaliseCik, normaliseCompanyNumber } from "@/core/registry";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  registryLinks,
  registrySearches,
} from "@/db/schema";
import { normaliseCompanyName } from "@/lib/normalise";
import { addMergeCandidate } from "@/pipeline/resolve/merge-candidates";

/** A company is searched again after this many days, even with the same inputs. */
export const SEARCH_INTERVAL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MERGE_DEPTH = 32;

/** Merge candidate reasons when two companies want the same number. */
export const TAKEN_MERGE_REASONS: Readonly<Record<RegistryKind, string>> = {
  companies_house: "same Companies House number",
  sec_edgar: "same SEC CIK",
};

/** A shared number is strong evidence of a duplicate, but a person still decides. */
const TAKEN_MERGE_SCORE = 1;

type LinkRow = typeof registryLinks.$inferSelect;

export interface LinkInput {
  companyId: number;
  registry: RegistryKind;
  /** A Companies House number or a CIK; normalised here. */
  registryId: string;
  /** The organisation name the registry gives. */
  registryName: string;
  method: RegistryLinkMethod;
  /** Which rule and signals decided the link. */
  reason: string;
  decidedBy: LinkDecidedBy;
  now: Date;
}

export type RecordLinkResult =
  /** `changed` is false when the same link already stood. */
  | { outcome: "linked"; companyId: number; changed: boolean }
  /** An automatic call met a manual decision, which stands. */
  | { outcome: "blocked"; companyId: number }
  /** Another company holds the number. Automatic calls record a candidate and a merge candidate. */
  | { outcome: "taken"; companyId: number; holderCompanyId: number }
  /** The company is already linked to another number in this registry. */
  | { outcome: "already_linked"; companyId: number; linkedRegistryId: string };

export interface CandidateInput {
  companyId: number;
  registry: RegistryKind;
  registryId: string;
  registryName: string;
  reason: string;
  now: Date;
}

export interface RejectInput {
  companyId: number;
  registry: RegistryKind;
  registryId: string;
  /** Needed only when no row exists yet for this number. */
  registryName?: string;
  reason: string;
  now: Date;
}

export interface UnlinkInput {
  companyId: number;
  registry: RegistryKind;
  reason: string;
  now: Date;
}

export type DemoteResult =
  | { outcome: "demoted"; companyId: number; registryId: string }
  | { outcome: "not_linked"; companyId: number }
  /** Manual links are never demoted automatically. */
  | { outcome: "manual"; companyId: number };

export interface SearchInput {
  companyId: number;
  registry: RegistryKind;
  outcome: RegistrySearchOutcome;
  inputFingerprint: string;
  now: Date;
}

/** The registry's number in stored form. Throws on a value that is not a number. */
export function normaliseRegistryId(
  registry: RegistryKind,
  registryId: string,
): string {
  const normalised =
    registry === "companies_house"
      ? normaliseCompanyNumber(registryId)
      : normaliseCik(registryId);
  if (normalised === null) {
    throw new Error(`Invalid ${registry} number: ${registryId}`);
  }
  return normalised;
}

/** The company itself, or the company it was merged into, followed to the end of the chain. */
async function survivorId(db: Db, companyId: number): Promise<number> {
  let id = companyId;
  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
    const [row] = await db
      .select({ mergedIntoId: companies.mergedIntoId })
      .from(companies)
      .where(eq(companies.id, id));
    if (!row) throw new Error(`Company ${id} does not exist`);
    if (row.mergedIntoId === null) return id;
    id = row.mergedIntoId;
  }
  throw new Error(
    `Merge chain from company ${companyId} is cyclic or too deep`,
  );
}

function numberColumn(registry: RegistryKind) {
  return registry === "companies_house"
    ? companies.ukCompanyNumber
    : companies.secCik;
}

function numberValue(registry: RegistryKind, value: string | null) {
  return registry === "companies_house"
    ? { ukCompanyNumber: value }
    : { secCik: value };
}

async function rowsFor(
  db: Db,
  companyId: number,
  registry: RegistryKind,
): Promise<LinkRow[]> {
  return db
    .select()
    .from(registryLinks)
    .where(
      and(
        eq(registryLinks.companyId, companyId),
        eq(registryLinks.registry, registry),
      ),
    );
}

/**
 * The surviving company that holds this number, other than `companyId`: through
 * a `linked` row, or the company number column. Null when nobody else holds it.
 */
async function holderOf(
  db: Db,
  companyId: number,
  registry: RegistryKind,
  registryId: string,
): Promise<number | null> {
  const [linked] = await db
    .select({ companyId: registryLinks.companyId })
    .from(registryLinks)
    .where(
      and(
        eq(registryLinks.registry, registry),
        eq(registryLinks.registryId, registryId),
        eq(registryLinks.status, "linked"),
      ),
    );
  // A row left on a merged company still blocks a new link, so it counts as
  // taken even when its survivor is this company.
  if (linked) return survivorId(db, linked.companyId);

  const column = numberColumn(registry);
  const [held] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(column, registryId), ne(companies.id, companyId)));
  return held ? survivorId(db, held.id) : null;
}

/** Fills the company number column when it is empty, and adds the registry name as an alias. */
async function applyLinkFacts(
  db: Db,
  companyId: number,
  registry: RegistryKind,
  registryId: string,
  registryName: string,
): Promise<void> {
  await db
    .update(companies)
    .set(numberValue(registry, registryId))
    .where(and(eq(companies.id, companyId), isNull(numberColumn(registry))));

  const alias = registryName.trim();
  const normalisedAlias = normaliseCompanyName(alias);
  if (!alias || !normalisedAlias) return;
  await db
    .insert(companyAliases)
    .values({ companyId, alias, normalisedAlias, source: "registry" })
    .onConflictDoNothing({
      target: [companyAliases.companyId, companyAliases.normalisedAlias],
    });
}

/** Clears the company number column, but only when it holds this number. */
async function clearNumber(
  db: Db,
  companyId: number,
  registry: RegistryKind,
  registryId: string,
): Promise<void> {
  await db
    .update(companies)
    .set(numberValue(registry, null))
    .where(
      and(eq(companies.id, companyId), eq(numberColumn(registry), registryId)),
    );
}

async function insertCandidate(
  db: Db,
  input: Omit<CandidateInput, "companyId" | "registryId">,
  companyId: number,
  registryId: string,
): Promise<boolean> {
  const inserted = await db
    .insert(registryLinks)
    .values({
      companyId,
      registry: input.registry,
      registryId,
      registryName: input.registryName,
      status: "candidate",
      method: null,
      reason: input.reason,
      decidedBy: "auto",
      createdAt: input.now,
      decidedAt: input.now,
    })
    .onConflictDoNothing({
      target: [
        registryLinks.companyId,
        registryLinks.registry,
        registryLinks.registryId,
      ],
    })
    .returning({ id: registryLinks.id });
  return inserted.length > 0;
}

/**
 * Links a company to a registry number, keeping the invariants above.
 *
 * An automatic call changes nothing when the company has a manual link in this
 * registry or a rejection of this number. A manual call over an existing link to
 * another number refuses (`already_linked`): unlink first. A manual call for a
 * number another company holds refuses (`taken`) and writes nothing.
 */
export async function recordLink(
  db: Db,
  input: LinkInput,
): Promise<RecordLinkResult> {
  return db.transaction(async (tx) => {
    const companyId = await survivorId(tx, input.companyId);
    const registryId = normaliseRegistryId(input.registry, input.registryId);
    const auto = input.decidedBy === "auto";

    const rows = await rowsFor(tx, companyId, input.registry);
    const current = rows.find((row) => row.status === "linked");
    const same = rows.find((row) => row.registryId === registryId);

    if (auto) {
      if (current?.decidedBy === "manual")
        return { outcome: "blocked", companyId };
      if (same?.status === "rejected") return { outcome: "blocked", companyId };
    }
    if (current && current.registryId === registryId) {
      if (auto || current.decidedBy === "manual") {
        return { outcome: "linked", companyId, changed: false };
      }
      // A person confirms an automatic link: it becomes final.
      await tx
        .update(registryLinks)
        .set({
          method: input.method,
          reason: input.reason,
          decidedBy: "manual",
          decidedAt: input.now,
        })
        .where(eq(registryLinks.id, current.id));
      await applyLinkFacts(
        tx,
        companyId,
        input.registry,
        registryId,
        input.registryName,
      );
      return { outcome: "linked", companyId, changed: true };
    }
    if (current) {
      if (auto) {
        await insertCandidate(
          tx,
          {
            ...input,
            reason: `${input.reason}; already linked to ${current.registryId}`,
          },
          companyId,
          registryId,
        );
      }
      return {
        outcome: "already_linked",
        companyId,
        linkedRegistryId: current.registryId,
      };
    }

    const holder = await holderOf(tx, companyId, input.registry, registryId);
    if (holder !== null) {
      if (auto) {
        await insertCandidate(
          tx,
          {
            ...input,
            reason: `${input.reason}; number held by company ${holder}`,
          },
          companyId,
          registryId,
        );
        await addMergeCandidate(tx, {
          entityType: "company",
          leftId: companyId,
          rightId: holder,
          score: TAKEN_MERGE_SCORE,
          reason: TAKEN_MERGE_REASONS[input.registry],
        });
      }
      return { outcome: "taken", companyId, holderCompanyId: holder };
    }

    const decided = {
      registryName: input.registryName,
      status: "linked" as const,
      method: input.method,
      reason: input.reason,
      decidedBy: input.decidedBy,
      decidedAt: input.now,
    };
    await tx
      .insert(registryLinks)
      .values({
        ...decided,
        companyId,
        registry: input.registry,
        registryId,
        createdAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          registryLinks.companyId,
          registryLinks.registry,
          registryLinks.registryId,
        ],
        set: decided,
      });
    await applyLinkFacts(
      tx,
      companyId,
      input.registry,
      registryId,
      input.registryName,
    );
    return { outcome: "linked", companyId, changed: true };
  });
}

/**
 * Records a number for review. Does nothing when any row, in any status, exists
 * for this company, registry and number. Returns true when a row was inserted.
 */
export async function recordCandidate(
  db: Db,
  input: CandidateInput,
): Promise<boolean> {
  const companyId = await survivorId(db, input.companyId);
  const registryId = normaliseRegistryId(input.registry, input.registryId);
  return insertCandidate(db, input, companyId, registryId);
}

/**
 * A manual rejection: the number is never linked or proposed automatically for
 * this company again. Rejecting a linked number also clears the column it filled.
 * Returns the row's status before the rejection, or null when there was no row.
 */
export async function rejectLink(
  db: Db,
  input: RejectInput,
): Promise<RegistryLinkStatus | null> {
  return db.transaction(async (tx) => {
    const companyId = await survivorId(tx, input.companyId);
    const registryId = normaliseRegistryId(input.registry, input.registryId);
    const rows = await rowsFor(tx, companyId, input.registry);
    const existing = rows.find((row) => row.registryId === registryId);
    const decided = {
      status: "rejected" as const,
      method: null,
      reason: input.reason,
      decidedBy: "manual" as const,
      decidedAt: input.now,
    };

    if (!existing) {
      if (!input.registryName) {
        throw new Error("A registry name is needed to reject a new number");
      }
      await tx.insert(registryLinks).values({
        ...decided,
        companyId,
        registry: input.registry,
        registryId,
        registryName: input.registryName,
        createdAt: input.now,
      });
      return null;
    }

    await tx
      .update(registryLinks)
      .set(decided)
      .where(eq(registryLinks.id, existing.id));
    if (existing.status === "linked") {
      await clearNumber(tx, companyId, input.registry, registryId);
    }
    return existing.status;
  });
}

/**
 * A manual unlink: the company's linked row in this registry becomes `rejected`,
 * so automatic linking never restores it, and the company number column is
 * cleared if it holds that number. Returns the unlinked number, or null when the
 * company had no link.
 */
export async function unlink(
  db: Db,
  input: UnlinkInput,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const companyId = await survivorId(tx, input.companyId);
    const rows = await rowsFor(tx, companyId, input.registry);
    const current = rows.find((row) => row.status === "linked");
    if (!current) return null;

    await tx
      .update(registryLinks)
      .set({
        status: "rejected",
        method: null,
        reason: input.reason,
        decidedBy: "manual",
        decidedAt: input.now,
      })
      .where(eq(registryLinks.id, current.id));
    await clearNumber(tx, companyId, input.registry, current.registryId);
    return current.registryId;
  });
}

/**
 * The only automatic unlink (spec-phase3 section 7.2): when a refreshed profile
 * shows a conflict, an automatic link becomes a `candidate` again and the
 * company number column is cleared. Manual links are refused.
 */
export async function demoteAutoLink(
  db: Db,
  input: UnlinkInput,
): Promise<DemoteResult> {
  return db.transaction(async (tx) => {
    const companyId = await survivorId(tx, input.companyId);
    const rows = await rowsFor(tx, companyId, input.registry);
    const current = rows.find((row) => row.status === "linked");
    if (!current) return { outcome: "not_linked", companyId };
    if (current.decidedBy === "manual") return { outcome: "manual", companyId };

    await tx
      .update(registryLinks)
      .set({
        status: "candidate",
        method: null,
        reason: input.reason,
        decidedAt: input.now,
      })
      .where(eq(registryLinks.id, current.id));
    await clearNumber(tx, companyId, input.registry, current.registryId);
    return { outcome: "demoted", companyId, registryId: current.registryId };
  });
}

/** Records that a company was searched in a registry, replacing any earlier search. */
export async function recordSearch(db: Db, input: SearchInput): Promise<void> {
  const companyId = await survivorId(db, input.companyId);
  const values = {
    searchedAt: input.now,
    outcome: input.outcome,
    inputFingerprint: input.inputFingerprint,
  };
  await db
    .insert(registrySearches)
    .values({ ...values, companyId, registry: input.registry })
    .onConflictDoUpdate({
      target: [registrySearches.companyId, registrySearches.registry],
      set: values,
    });
}

/**
 * True when the company has never been searched in this registry, its inputs
 * changed since, or the last search is at least 90 days old.
 */
export async function searchIsDue(
  db: Db,
  companyId: number,
  registry: RegistryKind,
  fingerprint: string,
  now: Date,
): Promise<boolean> {
  const survivor = await survivorId(db, companyId);
  const [last] = await db
    .select()
    .from(registrySearches)
    .where(
      and(
        eq(registrySearches.companyId, survivor),
        eq(registrySearches.registry, registry),
      ),
    );
  if (!last) return true;
  if (last.inputFingerprint !== fingerprint) return true;
  return (
    now.getTime() - last.searchedAt.getTime() >= SEARCH_INTERVAL_DAYS * DAY_MS
  );
}
