// The registry link eval (docs/spec-phase3.md section 12, Task 053). Replays
// labelled cases through the pure link rules, with no network and no database,
// and scores the automatic links.

import { readFileSync } from "node:fs";
import { z } from "zod";
import { DATE_PRECISIONS, EVENT_TYPES, ROUND_TYPES } from "@/core/enums";
import type {
  CapitalFiling,
  FormDFacts,
  RegistryCompanyFacts,
} from "@/core/registry";
import { parseUkPostcode } from "@/lib/geo/postcode";
import type { ConfirmableEvent } from "@/pipeline/registry/confirm-rules";
import {
  decideChLink,
  decideFormDLink,
  type ChLinkCandidate,
  type ChLinkCompany,
  type ChLinkResult,
  type FormDLinkCompany,
} from "@/pipeline/registry/link-rules";

export const LINK_CASES_PATH = "fixtures/registry/link-cases.json";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const eventSchema = z.object({
  id: z.number().int().optional(),
  type: z.enum(EVENT_TYPES).default("funding_round"),
  roundType: z.enum(ROUND_TYPES).nullable(),
  announcedOn: date,
  datePrecision: z.enum(DATE_PRECISIONS).default("day"),
  amountUsdMinor: z.number().int().nullable().default(null),
});

function toEvents(
  events: ReadonlyArray<z.infer<typeof eventSchema>>,
): ConfirmableEvent[] {
  return events.map((event, index) => ({
    ...event,
    id: event.id ?? index + 1,
  }));
}

const profileSchema = z.object({
  companyNumber: z.string(),
  name: z.string(),
  previousNames: z.array(z.string()).default([]),
  status: z.string().default("active"),
  companyType: z.string().default("ltd"),
  incorporatedOn: date,
  ceasedOn: date.nullable().default(null),
  sicCodes: z.array(z.string()).default([]),
  officePostcode: z.string().nullable().default(null),
  officeOutcode: z.string().nullable().default(null),
  accountsType: z.string().nullable().default(null),
  accountsMadeUpTo: date.nullable().default(null),
});

const filingSchema = z.object({
  transactionId: z.string().optional(),
  type: z.string().default("SH01"),
  actionDate: date.nullable(),
  filedOn: date.optional(),
  capital: z
    .array(z.object({ currency: z.string(), figure: z.string() }))
    .nullable()
    .default(null),
});

const chCaseSchema = z.object({
  id: z.string(),
  kind: z.literal("companies_house"),
  tags: z.array(z.string()),
  note: z.string(),
  company: z.object({
    names: z.array(z.string()).min(1),
    countryCode: z.string().nullable().default("GB"),
    foundedYear: z.number().int().nullable().default(null),
    events: z.array(eventSchema).default([]),
    location: z
      .object({
        label: z.string(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        outcode: z.string().optional(),
      })
      .nullable()
      .default(null),
    grantPostcodes: z.array(z.string()).default([]),
    grantCompanyNumber: z.string().nullable().default(null),
    rejectedNumbers: z.array(z.string()).default([]),
  }),
  candidates: z.array(
    z.object({
      profile: profileSchema,
      filings: z.array(filingSchema),
      officePostcodeShared: z.boolean().default(false),
    }),
  ),
  linkedToOthers: z.array(z.string()).default([]),
  expected: z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("linked"), registryId: z.string() }),
    z.object({ outcome: z.literal("candidates") }),
    z.object({
      outcome: z.literal("none"),
      mergeCandidate: z.string().optional(),
    }),
  ]),
});

const formDCaseSchema = z.object({
  id: z.string(),
  kind: z.literal("sec_form_d"),
  tags: z.array(z.string()),
  note: z.string(),
  filing: z.object({
    accessionNumber: z.string(),
    cik: z.string(),
    issuerName: z.string(),
    entityType: z.string().nullable().default(null),
    issuerState: z.string().nullable().default(null),
    issuerCity: z.string().nullable().default(null),
    yearOfInc: z.number().int().nullable().default(null),
    industryGroup: z.string().nullable().default(null),
    isAmendment: z.boolean().default(false),
    dateOfFirstSale: date.nullable(),
    totalOfferingUsdMinor: z.number().int().nullable().default(null),
    totalSoldUsdMinor: z.number().int().nullable().default(null),
    filedOn: date,
  }),
  companies: z.array(
    z.object({
      companyId: z.number().int(),
      names: z.array(z.string()).min(1),
      countryCode: z.string().nullable().default(null),
      secCik: z.string().nullable().default(null),
      foundedYear: z.number().int().nullable().default(null),
      events: z.array(eventSchema).default([]),
      rejectedCiks: z.array(z.string()).default([]),
    }),
  ),
  expected: z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("linked"), companyId: z.number().int() }),
    z.object({ outcome: z.literal("owned"), companyId: z.number().int() }),
    z.object({ outcome: z.literal("candidate") }),
    z.object({ outcome: z.literal("none") }),
  ]),
});

const caseSchema = z.discriminatedUnion("kind", [
  chCaseSchema,
  formDCaseSchema,
]);
const fileSchema = z.object({
  version: z.literal(1),
  cases: z.array(caseSchema),
});

export type LinkCase = z.infer<typeof caseSchema>;
type ChCase = z.infer<typeof chCaseSchema>;
type FormDCase = z.infer<typeof formDCaseSchema>;

export function loadLinkCases(path = LINK_CASES_PATH): LinkCase[] {
  const parsed = fileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  for (const item of parsed.cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate link case ${item.id}`);
    ids.add(item.id);
  }
  return parsed.cases;
}

// ---------------------------------------------------------------------------
// Replay

/** What the rules did with one case, reduced to what is scored. */
export interface CaseResult {
  id: string;
  kind: LinkCase["kind"];
  tags: string[];
  note: string;
  /** The registry id (CH number) or company id (Form D) linked automatically. */
  expectedLink: string | null;
  predictedLink: string | null;
  expectedOutcome: string;
  predictedOutcome: string;
  /** The correct link was among the review candidates. */
  sentToReview: boolean;
  reason: string;
  /** Capital filing histories the decision asked for (Companies House only). */
  filingFetches: number;
  /** The decision with filings fetched on demand differs from the one with every filing known. */
  fetchMismatch: boolean;
}

function profileOf(
  profile: z.infer<typeof profileSchema>,
): RegistryCompanyFacts {
  const outcode =
    profile.officeOutcode ??
    (profile.officePostcode
      ? (parseUkPostcode(profile.officePostcode)?.outcode ?? null)
      : null);
  return { ...profile, officeOutcode: outcode };
}

function filingsOf(
  number: string,
  filings: ReadonlyArray<z.infer<typeof filingSchema>>,
): CapitalFiling[] {
  return filings.map((filing, index) => ({
    transactionId: filing.transactionId ?? `${number}-${index + 1}`,
    type: filing.type,
    filedOn: filing.filedOn ?? filing.actionDate ?? "1970-01-01",
    actionDate: filing.actionDate,
    capital: filing.capital,
  }));
}

function chCompanyOf(item: ChCase): ChLinkCompany {
  return { ...item.company, events: toEvents(item.company.events) };
}

function decideWith(
  item: ChCase,
  fetched: (number: string) => boolean,
): ChLinkResult {
  const candidates: ChLinkCandidate[] = item.candidates.map((candidate) => ({
    profile: profileOf(candidate.profile),
    filings: fetched(candidate.profile.companyNumber)
      ? filingsOf(candidate.profile.companyNumber, candidate.filings)
      : null,
    officePostcodeShared: candidate.officePostcodeShared,
  }));
  return decideChLink({
    company: chCompanyOf(item),
    candidates,
    linkedToOthers: item.linkedToOthers,
  });
}

function sameDecision(a: ChLinkResult, b: ChLinkResult): boolean {
  const key = (r: ChLinkResult) =>
    JSON.stringify([
      r.outcome,
      r.decisions.map((d) => [
        d.registryId,
        d.outcome,
        d.outcome === "linked" ? d.method : null,
      ]),
    ]);
  return key(a) === key(b);
}

/** The most telling reason: the link, the review candidates, or why each match was dropped. */
function reasonOf(result: ChLinkResult): string {
  const linked = result.decisions.find((d) => d.outcome === "linked");
  if (linked) return linked.reason;
  const shown = result.decisions.filter((d) =>
    result.outcome === "candidates" ? d.outcome === "candidate" : true,
  );
  if (shown.length === 0) return result.reason;
  const parts = shown.map((d) => `${d.registryId}: ${d.reason}`);
  if (result.mergeCandidates.length > 0) parts.push(result.reason);
  return parts.join(" / ");
}

/**
 * Replays a Companies House case as Task 056 would run it: decide without
 * filings, fetch only the filings the decision asks for, and decide again.
 */
function runChCase(item: ChCase): CaseResult {
  const fetchedNumbers = new Set<string>();
  let result = decideWith(item, () => false);
  for (let round = 0; round < 3 && result.needsFilings.length > 0; round += 1) {
    for (const number of result.needsFilings) fetchedNumbers.add(number);
    result = decideWith(item, (number) => fetchedNumbers.has(number));
  }
  const full = decideWith(item, () => true);
  const linked = result.decisions.find((d) => d.outcome === "linked");
  const expectedLink =
    item.expected.outcome === "linked" ? item.expected.registryId : null;
  const expectedOutcome =
    item.expected.outcome === "none" && item.expected.mergeCandidate
      ? `none, merge ${item.expected.mergeCandidate}`
      : item.expected.outcome === "linked"
        ? `linked ${item.expected.registryId}`
        : item.expected.outcome;
  const merge = result.mergeCandidates.map((m) => m.registryId).join(", ");
  const predictedOutcome =
    result.outcome === "linked" && linked
      ? `linked ${linked.registryId}`
      : result.outcome === "none" && merge
        ? `none, merge ${merge}`
        : result.outcome === "skipped"
          ? "none"
          : result.outcome;
  return {
    id: item.id,
    kind: item.kind,
    tags: item.tags,
    note: item.note,
    expectedLink,
    predictedLink: linked?.registryId ?? null,
    expectedOutcome,
    predictedOutcome,
    sentToReview:
      expectedLink !== null &&
      result.decisions.some(
        (d) => d.outcome === "candidate" && d.registryId === expectedLink,
      ),
    reason: reasonOf(result),
    filingFetches: fetchedNumbers.size,
    fetchMismatch: !sameDecision(result, full),
  };
}

function formDOf(item: FormDCase): FormDFacts {
  return { ...item.filing };
}

function runFormDCase(item: FormDCase): CaseResult {
  const companies: FormDLinkCompany[] = item.companies.map((company) => ({
    ...company,
    events: toEvents(company.events),
  }));
  const result = decideFormDLink(formDOf(item), companies);
  const expectedLink =
    item.expected.outcome === "linked" ? String(item.expected.companyId) : null;
  const predictedLink =
    result.outcome === "linked" ? String(result.companyId) : null;
  const expectedOutcome =
    item.expected.outcome === "linked" || item.expected.outcome === "owned"
      ? `${item.expected.outcome} ${item.expected.companyId}`
      : item.expected.outcome;
  const predictedOutcome =
    result.outcome === "linked" || result.outcome === "owned"
      ? `${result.outcome} ${result.companyId}`
      : result.outcome;
  return {
    id: item.id,
    kind: item.kind,
    tags: item.tags,
    note: item.note,
    expectedLink,
    predictedLink,
    expectedOutcome,
    predictedOutcome,
    sentToReview:
      expectedLink !== null &&
      result.outcome === "candidate" &&
      String(result.companyId) === expectedLink,
    reason: result.reason,
    filingFetches: 0,
    fetchMismatch: false,
  };
}

export function runLinkCase(item: LinkCase): CaseResult {
  return item.kind === "companies_house" ? runChCase(item) : runFormDCase(item);
}

// ---------------------------------------------------------------------------
// Scores

export interface LinkScore {
  cases: number;
  expectedLinks: number;
  autoLinks: number;
  correctLinks: number;
  wrongLinks: number;
  /** Correct links that went to review instead. They count against recall, not precision. */
  sentToReview: number;
  /** Correct links that were neither linked nor sent to review. */
  missed: number;
  precision: number;
  recall: number;
}

export interface LinkEvalResult {
  total: LinkScore;
  companiesHouse: LinkScore;
  formD: LinkScore;
  results: CaseResult[];
  wrong: CaseResult[];
  toReview: CaseResult[];
  missed: CaseResult[];
  /** Cases where a non-link outcome (candidates or none) differs from the label. */
  outcomeDifferences: CaseResult[];
  fetchMismatches: CaseResult[];
  filingFetches: number;
  filingHistories: number;
}

function score(results: readonly CaseResult[]): LinkScore {
  let expectedLinks = 0;
  let autoLinks = 0;
  let correctLinks = 0;
  let wrongLinks = 0;
  let sentToReview = 0;
  let missed = 0;
  for (const r of results) {
    if (r.expectedLink !== null) expectedLinks += 1;
    if (r.predictedLink !== null) {
      autoLinks += 1;
      if (r.predictedLink === r.expectedLink) correctLinks += 1;
      else wrongLinks += 1;
    }
    if (r.expectedLink !== null && r.predictedLink !== r.expectedLink) {
      if (r.sentToReview) sentToReview += 1;
      else missed += 1;
    }
  }
  return {
    cases: results.length,
    expectedLinks,
    autoLinks,
    correctLinks,
    wrongLinks,
    sentToReview,
    missed,
    precision: autoLinks === 0 ? 1 : correctLinks / autoLinks,
    recall: expectedLinks === 0 ? 1 : correctLinks / expectedLinks,
  };
}

/** Runs every labelled case. Pure: no network, no database. */
export function runLinkEval(path = LINK_CASES_PATH): LinkEvalResult {
  const cases = loadLinkCases(path);
  const results = cases.map(runLinkCase);
  const ch = results.filter((r) => r.kind === "companies_house");
  return {
    total: score(results),
    companiesHouse: score(ch),
    formD: score(results.filter((r) => r.kind === "sec_form_d")),
    results,
    wrong: results.filter(
      (r) => r.predictedLink !== null && r.predictedLink !== r.expectedLink,
    ),
    toReview: results.filter(
      (r) =>
        r.expectedLink !== null &&
        r.predictedLink !== r.expectedLink &&
        r.sentToReview,
    ),
    missed: results.filter(
      (r) =>
        r.expectedLink !== null &&
        r.predictedLink !== r.expectedLink &&
        !r.sentToReview,
    ),
    outcomeDifferences: results.filter(
      (r) =>
        r.expectedLink === null &&
        r.predictedLink === null &&
        r.expectedOutcome !== r.predictedOutcome,
    ),
    fetchMismatches: results.filter((r) => r.fetchMismatch),
    filingFetches: ch.reduce((sum, r) => sum + r.filingFetches, 0),
    filingHistories: cases
      .filter((c) => c.kind === "companies_house")
      .reduce((sum, c) => sum + c.candidates.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Report

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function scoreRow(label: string, s: LinkScore): string {
  return `| ${label} | ${s.cases} | ${s.expectedLinks} | ${s.autoLinks} | ${s.correctLinks} | ${s.wrongLinks} | ${s.sentToReview} | ${s.missed} | ${pct(s.precision)} | ${pct(s.recall)} |`;
}

function caseList(
  results: readonly CaseResult[],
  line: (r: CaseResult) => string,
): string {
  return results.length === 0 ? "None." : results.map(line).join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function renderLinkReport(result: LinkEvalResult): string {
  const rows = result.results
    .map(
      (r) =>
        `| ${r.id} | ${r.tags.join(", ")} | ${r.expectedOutcome} | ${r.predictedOutcome} | ${escapeCell(r.reason)} |`,
    )
    .join("\n");
  return `# Link eval results

Generated by \`pnpm eval --links\` from \`fixtures/registry/link-cases.json\`: ${result.total.cases} hand-labelled cases with invented names (${result.companiesHouse.cases} Companies House, ${result.formD.cases} Form D). They over-represent hard cases, so this tests known failure patterns and does not estimate accuracy on real data. A case is labelled linked only when a careful person with the same facts would be sure (\`fixtures/registry/README.md\`).

Targets (spec-phase3 section 12): no wrong automatic link, and recall of at least 50%. A correct link sent to review counts against recall, not precision.

| Set | Cases | Labelled links | Auto-links | Correct | Wrong | Sent to review | Missed | Precision | Recall |
|---|---|---|---|---|---|---|---|---|---|
${scoreRow("All", result.total)}
${scoreRow("Companies House", result.companiesHouse)}
${scoreRow("Form D", result.formD)}

Capital filing histories fetched: ${result.filingFetches} of ${result.filingHistories} (the rules ask only for those a decision depends on). Decisions that changed when every filing was known: ${result.fetchMismatches.length}.

## Wrong automatic links

${caseList(result.wrong, (r) => `- ${r.id}: linked ${r.predictedLink}, labelled ${r.expectedOutcome}. ${r.reason}`)}

## Correct links sent to review

${caseList(result.toReview, (r) => `- ${r.id}: ${r.note}`)}

## Correct links missed

${caseList(result.missed, (r) => `- ${r.id}: ${r.predictedOutcome}. ${r.note}`)}

## Other outcome differences

Cases labelled as not linked where the rules chose review instead of nothing, or the reverse. Neither affects precision.

${caseList(result.outcomeDifferences, (r) => `- ${r.id}: labelled ${r.expectedOutcome}, got ${r.predictedOutcome}`)}

## Rule changes made for this set

All of them make fewer automatic links than the spec tables (section 7.2 and 8.3). Each has a case.

- **Prefix matches never link** (D61). Trading-name prefix matches go to review even with both location and filing (ch-05, ch-11, ch-12, ch-41, ch-53). This costs recall on ch-05 and ch-12.
- **Location alone does not link a single-word name.** A short brand name often belongs to an unrelated company in the same city (ch-30). Two-word names still link on location (ch-27, ch-45).
- **A shared office postcode** is ignored for location (ch-19), and for the grant postcode unless the full postcode matches (ch-43).
- **A company with a known country other than GB** goes to review: the UK company is usually a subsidiary (ch-39).
- **A grant number links only with no conflict**, and while a grant names a number, no other number links automatically (ch-35).
- **Event dates are read generously** for the date conflicts: a month-precision event counts until the end of its month for "too young" (ch-16).
- **Form D:** a single-word issuer name links only when amounts were compared (fd-06, fd-07), and a year of incorporation more than 2 years from the news founded year conflicts (fd-11).

## Search hints (D62)

Hints (a GBP round, a UK-only source, a UK town or region) decide only which companies with no stated country are searched. The rules above decide them unchanged: a filing still links an exact name (ch-57), and a prefix match or an exact name with no signal still goes to review (ch-58, ch-59).

## Every case

| Case | Tags | Labelled | Result | Reason |
|---|---|---|---|---|
${rows}
`;
}
