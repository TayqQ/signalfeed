import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { normaliseCik, type FormDFacts } from "@/core/registry";

/**
 * Elements that hold personal data (D58). They are deleted from the parsed
 * tree, at any depth, before anything is validated or mapped.
 */
const PERSONAL_DATA_KEYS = new Set([
  "relatedPersonsList",
  "relatedPersonInfo",
  "salesCompensationList",
  "recipient",
  "signatureBlock",
]);

/**
 * `typesOfSecuritiesOffered` flags in the SEC Form D schema (X0708). Flags
 * that are not listed here are ignored.
 */
const SECURITY_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["isEquityType", "equity"],
  ["isDebtType", "debt"],
  ["isOptionToAcquireType", "option"],
  ["isSecurityToBeAcquiredType", "acquired_security"],
  ["isPooledInvestmentFundType", "pooled_fund"],
  ["isTenantInCommonType", "tenant_in_common"],
  ["isMineralPropertyType", "mineral_property"],
  ["isOtherType", "other"],
];

const POOLED_FUND_GROUP = "Pooled Investment Fund";

export interface ParseFormDOptions {
  /** From the index file name. It is not in the XML. */
  accessionNumber: string;
  /** `yyyy-mm-dd`, from the index. */
  filedOn: string;
}

export interface ParsedFormD {
  facts: FormDFacts;
  /** Industry group is exactly "Pooled Investment Fund". Not stored as a company. */
  isFund: boolean;
  /** The filing this one amends (D/A only). */
  previousAccessionNumber: string | null;
}

export class FormDParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormDParseError";
  }
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

// Empty elements arrive as "" and text as strings. Nested elements arrive as
// objects, and repeats as arrays.
const text = z.string().optional();
const flag = z.union([z.string(), z.boolean()]).optional();

const schema = z.object({
  edgarSubmission: z.object({
    submissionType: text,
    primaryIssuer: z.object({
      cik: z.string(),
      entityName: z.string().min(1),
      entityType: text,
      jurisdictionOfInc: text,
      issuerAddress: z
        .object({ city: text, stateOrCountry: text })
        .optional()
        .catch(undefined),
      yearOfInc: z
        .union([
          z.string(),
          z.object({
            value: text,
            withinFiveYears: flag,
            overFiveYears: flag,
          }),
        ])
        .optional()
        .catch(undefined),
    }),
    offeringData: z.object({
      industryGroup: z
        .object({ industryGroupType: text })
        .optional()
        .catch(undefined),
      federalExemptionsExclusions: z
        .object({ item: z.unknown().optional() })
        .optional()
        .catch(undefined),
      typeOfFiling: z
        .object({
          newOrAmendment: z
            .object({ isAmendment: flag, previousAccessionNumber: text })
            .optional()
            .catch(undefined),
          dateOfFirstSale: z
            .object({ value: text, yetToOccur: flag })
            .optional()
            .catch(undefined),
        })
        .optional()
        .catch(undefined),
      typesOfSecuritiesOffered: z
        .record(z.string(), z.unknown())
        .optional()
        .catch(undefined),
      offeringSalesAmounts: z
        .object({ totalOfferingAmount: text, totalAmountSold: text })
        .optional()
        .catch(undefined),
      investors: z
        .object({ totalNumberAlreadyInvested: text })
        .optional()
        .catch(undefined),
    }),
  }),
});

function stripPersonalData(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripPersonalData(item);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PERSONAL_DATA_KEYS.has(key)) delete record[key];
    else stripPersonalData(record[key]);
  }
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Whole dollars to cents. "Indefinite", blanks and anything odd are null. */
function dollarsToMinor(value: string | undefined): number | null {
  const cleaned = value?.replace(/[$,\s]/g, "") ?? "";
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const minor = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function parseYear(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d{4}$/.test(trimmed)) return null;
  const year = Number(trimmed);
  return year >= 1800 && year <= 2200 ? year : null;
}

function toIsoDate(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function toStrings(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function securitiesFrom(types: Record<string, unknown> | undefined): string[] {
  if (!types) return [];
  return SECURITY_FLAGS.filter(([name]) => isTrue(types[name])).map(
    ([, label]) => label,
  );
}

/**
 * Parses a Form D `primary_doc.xml` into issuer and offering facts only.
 * Personal-data elements are removed from the parsed tree before validation,
 * and only the fields named in the schema above are ever read (D58).
 */
export function parseFormD(
  xml: string,
  options: ParseFormDOptions,
): ParsedFormD {
  let tree: unknown;
  try {
    tree = parser.parse(xml);
  } catch {
    throw new FormDParseError("Form D XML could not be parsed");
  }
  stripPersonalData(tree);
  const result = schema.safeParse(tree);
  if (!result.success) {
    throw new FormDParseError(
      `Form D XML has an unexpected shape: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  const {
    primaryIssuer: issuer,
    offeringData: offering,
    submissionType,
  } = result.data.edgarSubmission;
  const cik = normaliseCik(issuer.cik);
  if (!cik) throw new FormDParseError("Form D XML has an invalid CIK");

  const year = issuer.yearOfInc;
  const yearObject = typeof year === "object" ? year : undefined;
  const yearOfInc =
    typeof year === "string" ? parseYear(year) : parseYear(year?.value);
  const amendment = offering.typeOfFiling?.newOrAmendment;
  const firstSale = offering.typeOfFiling?.dateOfFirstSale;
  const industryGroup = blankToNull(offering.industryGroup?.industryGroupType);
  const previous = blankToNull(amendment?.previousAccessionNumber);
  const investors = offering.investors?.totalNumberAlreadyInvested?.trim();

  const facts: FormDFacts = {
    accessionNumber: options.accessionNumber,
    cik,
    issuerName: issuer.entityName,
    entityType: blankToNull(issuer.entityType),
    issuerState: blankToNull(issuer.issuerAddress?.stateOrCountry),
    issuerCity: blankToNull(issuer.issuerAddress?.city),
    yearOfInc,
    industryGroup,
    isAmendment: isTrue(amendment?.isAmendment) || submissionType === "D/A",
    dateOfFirstSale: toIsoDate(firstSale?.value),
    totalOfferingUsdMinor: dollarsToMinor(
      offering.offeringSalesAmounts?.totalOfferingAmount,
    ),
    totalSoldUsdMinor: dollarsToMinor(
      offering.offeringSalesAmounts?.totalAmountSold,
    ),
    filedOn: options.filedOn,
    jurisdiction: blankToNull(issuer.jurisdictionOfInc),
    incOverFiveYears: isTrue(yearObject?.overFiveYears),
    previousAccessionNumber: previous,
    firstSaleYetToOccur: isTrue(firstSale?.yetToOccur),
    investorCount:
      investors && /^\d+$/.test(investors) ? Number(investors) : null,
    securities: securitiesFrom(offering.typesOfSecuritiesOffered),
    exemptions: toStrings(offering.federalExemptionsExclusions?.item),
  };
  return {
    facts,
    isFund: industryGroup === POOLED_FUND_GROUP,
    previousAccessionNumber: previous,
  };
}
