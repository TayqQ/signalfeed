// Registry contracts for Phase 3 (docs/spec-phase3.md sections 5, 7 and 8).
// Pure: no I/O. The Companies House and EDGAR clients produce these types, and
// the link and confirmation rules read them.

import type { RegistryLinkMethod } from "./enums";

/**
 * A Companies House number: upper case, no spaces, 8 characters. All-digit
 * numbers (England and Wales) are left-padded with zeros, so "9876543" gives
 * "09876543". Prefixed numbers keep their prefix: two letters ("SC123456",
 * "NI123456", "OC123456") or the old Northern Ireland "R0". Null for anything
 * else, including all zeros.
 */
export function normaliseCompanyNumber(
  text: string | null | undefined,
): string | null {
  if (text == null) return null;
  const compact = text.replace(/\s+/g, "").toUpperCase();
  if (/^\d{1,8}$/.test(compact)) {
    return /^0+$/.test(compact) ? null : compact.padStart(8, "0");
  }
  if (/^(?:[A-Z]{2}|R0)\d{6}$/.test(compact) && !/^\D*0+$/.test(compact)) {
    return compact;
  }
  return null;
}

/** An SEC CIK: digits only, without leading zeros. Null otherwise. */
export function normaliseCik(text: string | null | undefined): string | null {
  if (text == null) return null;
  const compact = text.trim();
  if (!/^\d{1,10}$/.test(compact)) return null;
  const stripped = compact.replace(/^0+/, "");
  return stripped === "" ? null : stripped;
}

/**
 * Company size from the last accounts type (D59, spec-phase3 section 7.3).
 * Saved searches store these values, so the list is append-only.
 * `full_accounts` means "size not stated", not "large".
 */
export const COMPANY_SIZE_BANDS = [
  "micro",
  "small",
  "medium",
  "full_accounts",
  "dormant",
  "no_accounts_yet",
] as const;
export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number];

/** The `cosize` URL value of each band (spec-phase3 section 11). */
export const COMPANY_SIZE_BAND_SLUGS: Readonly<
  Record<CompanySizeBand, string>
> = {
  micro: "micro",
  small: "small",
  medium: "medium",
  full_accounts: "full-accounts",
  dormant: "dormant",
  no_accounts_yet: "no-accounts-yet",
};

const BAND_BY_SLUG: ReadonlyMap<string, CompanySizeBand> = new Map(
  COMPANY_SIZE_BANDS.map((band) => [COMPANY_SIZE_BAND_SLUGS[band], band]),
);

export function companySizeBandSlug(band: CompanySizeBand): string {
  return COMPANY_SIZE_BAND_SLUGS[band];
}

/** The band for a `cosize` URL value, or null when it is not one. */
export function companySizeBandFromSlug(slug: string): CompanySizeBand | null {
  return BAND_BY_SLUG.get(slug) ?? null;
}

export function isCompanySizeBand(value: unknown): value is CompanySizeBand {
  return (
    typeof value === "string" &&
    (COMPANY_SIZE_BANDS as readonly string[]).includes(value)
  );
}

// Normalised inputs for the link and confirmation rules (spec-phase3 section
// 7.2). Dates are YYYY-MM-DD strings.

/** A Companies House company profile, organisation fields only (D58). */
export interface RegistryCompanyFacts {
  /** Normalised by `normaliseCompanyNumber`. */
  companyNumber: string;
  name: string;
  /** Earlier names of the company. Organisation names only. */
  previousNames: string[];
  /** Companies House's own status value, such as "active" or "dissolved". */
  status: string;
  /** Companies House's own type value, such as "ltd". */
  companyType: string;
  incorporatedOn: string;
  ceasedOn: string | null;
  sicCodes: string[];
  /** Full registered office postcode. Used for checks, never displayed. */
  officePostcode: string | null;
  /** Postcode district, such as "LS1". */
  officeOutcode: string | null;
  /** `accounts.last_accounts.type`. Null when no accounts are filed. */
  accountsType: string | null;
  accountsMadeUpTo: string | null;
  // Stored in `ch_companies`, not read by the link rules.
  statusDetail?: string | null;
  officeLocality?: string | null;
  hasInsolvencyHistory?: boolean;
  etag?: string | null;
}

/** One amount in a statement of capital, as Companies House gives it. */
export interface CapitalAmount {
  currency: string;
  /** As given, for example "1,250.00". Not parsed, because it is not used as a sum. */
  figure: string;
}

/** A capital-category filing, such as an SH01 (return of allotment). */
export interface CapitalFiling {
  transactionId: string;
  /** Filing type, such as "SH01". */
  type: string;
  filedOn: string;
  /** For an SH01, the allotment date. */
  actionDate: string | null;
  /** Statement of capital after the allotment. */
  capital: CapitalAmount[] | null;
  /** Stored for the deferred SH01 reader (Task 067). Not read by the rules. */
  documentId?: string | null;
}

/** A Form D or D/A filing, issuer and offering fields only (D58). */
export interface FormDFacts {
  accessionNumber: string;
  /** Normalised by `normaliseCik`. */
  cik: string;
  issuerName: string;
  entityType: string | null;
  /** State of the principal place of business. */
  issuerState: string | null;
  issuerCity: string | null;
  /** Given only when the issuer was incorporated within five years. */
  yearOfInc: number | null;
  industryGroup: string | null;
  isAmendment: boolean;
  dateOfFirstSale: string | null;
  /** Null when the offering is "Indefinite". */
  totalOfferingUsdMinor: number | null;
  totalSoldUsdMinor: number | null;
  filedOn: string;
  // Stored in `form_d_filings`, not read by the link or confirmation rules.
  /** State or country of incorporation. */
  jurisdiction?: string | null;
  incOverFiveYears?: boolean;
  previousAccessionNumber?: string | null;
  firstSaleYetToOccur?: boolean;
  investorCount?: number | null;
  /** For example `equity`, `debt`, `option`. */
  securities?: string[];
  /** For example `06b`. */
  exemptions?: string[];
}

/** What the rules decided for one registry candidate. Manual links are never decided here. */
export type LinkCandidateDecision =
  | {
      outcome: "linked";
      registryId: string;
      method: Exclude<RegistryLinkMethod, "manual">;
      /** Which rule and signals, for the review queue and logs. */
      reason: string;
    }
  | { outcome: "candidate"; registryId: string; reason: string }
  | { outcome: "none"; registryId: string; reason: string };

const COMPANIES_HOUSE_BASE =
  "https://find-and-update.company-information.service.gov.uk/company/";
const EDGAR_BROWSE_BASE = "https://www.sec.gov/edgar/browse/?CIK=";

/** The public Companies House page of a company. Throws on an invalid number. */
export function companiesHouseUrl(companyNumber: string): string {
  const number = normaliseCompanyNumber(companyNumber);
  if (number === null) throw new Error("Invalid Companies House number");
  return COMPANIES_HOUSE_BASE + number;
}

/** The public EDGAR page of a filer. Throws on an invalid CIK. */
export function edgarCompanyUrl(cik: string): string {
  const normalised = normaliseCik(cik);
  if (normalised === null) throw new Error("Invalid CIK");
  return EDGAR_BROWSE_BASE + normalised;
}
