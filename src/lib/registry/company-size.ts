import type { CompanySizeBand } from "@/core/registry";

// Company size from the last accounts type (D59, spec-phase3 section 7.3).
// One table, so a change to the accounts regime is a one-file edit.
// `full_accounts` means "size not stated": small companies may choose full
// accounts, so it does not mean large.

const BAND_BY_ACCOUNTS_TYPE: Readonly<Record<string, CompanySizeBand>> = {
  "micro-entity": "micro",

  small: "small",
  "total-exemption-full": "small",
  "total-exemption-small": "small",
  "audited-abridged": "small",
  "unaudited-abridged": "small",
  "partial-exemption": "small",
  "audit-exemption-subsidiary": "small",
  "filing-exemption-subsidiary": "small",

  medium: "medium",

  full: "full_accounts",
  group: "full_accounts",

  dormant: "dormant",

  initial: "no_accounts_yet",
  interim: "no_accounts_yet",
  null: "no_accounts_yet",
  "no-accounts-type-available": "no_accounts_yet",
};

export const BAND_LABELS: Readonly<Record<CompanySizeBand, string>> = {
  micro: "Micro",
  small: "Small",
  medium: "Medium",
  full_accounts: "Full accounts (size not stated)",
  dormant: "Dormant",
  no_accounts_yet: "No accounts filed yet",
};

function normalise(accountsType: string | null | undefined): string {
  return (accountsType ?? "").trim().toLowerCase();
}

/**
 * Null or empty input means no accounts yet. An unknown type is treated as
 * `full_accounts`; check `isKnownAccountsType` to log it.
 */
export function sizeBandForAccounts(
  accountsType: string | null | undefined,
): CompanySizeBand {
  const key = normalise(accountsType);
  if (key === "") return "no_accounts_yet";
  return Object.hasOwn(BAND_BY_ACCOUNTS_TYPE, key)
    ? (BAND_BY_ACCOUNTS_TYPE[key] ?? "full_accounts")
    : "full_accounts";
}

/**
 * False for a type that is not in the table, so the registry step can log it:
 * a new Companies House type must be noticed, not hidden. Null and empty are
 * known (no accounts yet).
 */
export function isKnownAccountsType(
  accountsType: string | null | undefined,
): boolean {
  const key = normalise(accountsType);
  return key === "" || Object.hasOwn(BAND_BY_ACCOUNTS_TYPE, key);
}

export function sizeBandLabel(band: CompanySizeBand): string {
  return BAND_LABELS[band];
}

/** The accounts types in the table, for tests. */
export function knownAccountsTypes(): string[] {
  return Object.keys(BAND_BY_ACCOUNTS_TYPE);
}
