import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ROUND_TYPES } from "@/core/enums";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import { events, eventSources, sources } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { resolveExtraction } from "@/pipeline/resolve/resolve-extraction";
import { insertExtraction } from "@/pipeline/store/extractions";
import { insertCollectedItems } from "@/pipeline/store/source-items";

const CASES_PATH = "fixtures/resolution/cases.json";
const BASE_DATE = Date.UTC(2026, 0, 5, 12);

const reportSchema = z.object({
  id: z.string(),
  companyKey: z.string(),
  eventKey: z.string(),
  name: z.string(),
  day: z.number().int(),
  type: z.enum(["funding_round", "acquisition"]),
  roundType: z.enum(ROUND_TYPES).nullable(),
  amountText: z.string().nullable(),
  countryCode: z.string().nullable(),
  source: z.number().int().min(1).max(3),
  investors: z.array(z.tuple([z.string(), z.boolean()])),
  domain: z.string().nullable(),
  acquirer: z.string().nullable(),
  note: z.string().nullable(),
});
export type ResolutionReport = z.infer<typeof reportSchema>;

export interface PairScore {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface PairMistake {
  kind: "wrongly merged" | "wrongly split";
  left: string;
  right: string;
}

export interface ResolutionResult {
  reports: number;
  company: PairScore;
  event: PairScore;
  companyMistakes: PairMistake[];
  eventMistakes: PairMistake[];
}

function extractionOf(report: ResolutionReport): ExtractionV1 {
  const event: ExtractedEventV1 = {
    type: report.type,
    company: {
      name: report.name,
      websiteDomain: report.domain,
      description: null,
      countryCode: report.countryCode,
      city: null,
      foundedYear: null,
      tags: [],
    },
    announcedOn: null,
    funding:
      report.type === "funding_round"
        ? {
            roundType: report.roundType ?? "unknown",
            roundLabel: null,
            amountText: report.amountText,
            currencyHint: null,
            investors: report.investors.map(([name, isLead]) => ({
              name,
              isLead,
              kind: "vc",
            })),
            includesIndividualAngels: false,
          }
        : null,
    acquisition:
      report.type === "acquisition"
        ? {
            acquirerName: report.acquirer ?? "",
            acquirerDomain: null,
            acquirerCountryCode: null,
            priceText: report.amountText,
            currencyHint: null,
          }
        : null,
    launch: null,
  };
  return { isRelevant: true, events: [event] };
}

function scorePairs(
  reports: readonly ResolutionReport[],
  gold: (report: ResolutionReport) => string,
  predicted: ReadonlyMap<string, number>,
): { score: PairScore; mistakes: PairMistake[] } {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const mistakes: PairMistake[] = [];
  reports.forEach((left, index) => {
    for (const right of reports.slice(index + 1)) {
      const sameGold = gold(left) === gold(right);
      const leftPrediction = predicted.get(left.id);
      const samePrediction =
        leftPrediction !== undefined &&
        leftPrediction === predicted.get(right.id);
      if (sameGold && samePrediction) truePositives += 1;
      else if (samePrediction) {
        falsePositives += 1;
        mistakes.push({
          kind: "wrongly merged",
          left: `${left.id} ${left.name}`,
          right: `${right.id} ${right.name}`,
        });
      } else if (sameGold) {
        falseNegatives += 1;
        mistakes.push({
          kind: "wrongly split",
          left: `${left.id} ${left.name}`,
          right: `${right.id} ${right.name}`,
        });
      }
    }
  });
  const precision =
    truePositives + falsePositives === 0
      ? 1
      : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0
      ? 1
      : truePositives / (truePositives + falseNegatives);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    score: {
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1,
    },
    mistakes,
  };
}

/** Runs every report through the real resolver on a throwaway database. */
export async function runResolutionEval(
  path = CASES_PATH,
): Promise<ResolutionResult> {
  const reports = z
    .array(reportSchema)
    .parse(JSON.parse(readFileSync(path, "utf8")));
  const test = await createTestDb();
  try {
    const { db } = test;
    await db.insert(sources).values(
      [1, 2, 3].map((n) => ({
        slug: `source-${n}`,
        name: `Source ${n}`,
        kind: "rss" as const,
        url: `https://source-${n}.test/feed`,
        priority: 10 - n,
      })),
    );

    const itemOf = new Map<number, string>();
    let nextItem = 0;
    for (const report of reports) {
      nextItem += 1;
      const url = `https://news.test/${report.id}`;
      await insertCollectedItems(db, report.source, [
        {
          sourceSlug: `source-${report.source}`,
          externalId: url,
          url,
          title: `${report.name} report`,
          summary: report.domain,
          publishedAt: new Date(BASE_DATE + report.day * 86_400_000),
        },
      ]);
      const result = extractionOf(report);
      const stored = await insertExtraction(db, {
        sourceItemId: nextItem,
        promptVersion: "resolution-eval",
        model: "none",
        result,
        isRelevant: true,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
      });
      itemOf.set(nextItem, report.id);
      await resolveExtraction(db, stored.id);
    }

    const links = await db
      .select({
        sourceItemId: eventSources.sourceItemId,
        eventId: events.id,
        companyId: events.companyId,
      })
      .from(eventSources)
      .innerJoin(events, eq(events.id, eventSources.eventId))
      .orderBy(asc(eventSources.sourceItemId));

    const companyOf = new Map<string, number>();
    const eventOf = new Map<string, number>();
    for (const link of links) {
      const id = itemOf.get(link.sourceItemId);
      if (!id) continue;
      companyOf.set(id, link.companyId);
      eventOf.set(id, link.eventId);
    }

    const company = scorePairs(reports, (r) => r.companyKey, companyOf);
    const event = scorePairs(reports, (r) => r.eventKey, eventOf);
    return {
      reports: reports.length,
      company: company.score,
      event: event.score,
      companyMistakes: company.mistakes,
      eventMistakes: event.mistakes,
    };
  } finally {
    await test.close();
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mistakeList(mistakes: readonly PairMistake[]): string {
  if (mistakes.length === 0) return "None.";
  return mistakes
    .map((m) => `- ${m.kind}: ${m.left} and ${m.right}`)
    .join("\n");
}

export function renderResolutionReport(result: ResolutionResult): string {
  return `# Resolution eval results

Generated by \`pnpm eval --resolution\` from \`fixtures/resolution/cases.json\`: ${result.reports} hand-written reports with invented names. They deliberately over-represent hard cases, so this tests known failure patterns and does not estimate accuracy on real news.

Scored over every pair of reports: did two reports of the same company or event end up together, and did two different ones stay apart?

| Pairs | Precision | Recall | F1 | Wrongly merged | Wrongly split |
|---|---|---|---|---|---|
| Company | ${pct(result.company.precision)} | ${pct(result.company.recall)} | ${pct(result.company.f1)} | ${result.company.falsePositives} | ${result.company.falseNegatives} |
| Event | ${pct(result.event.precision)} | ${pct(result.event.recall)} | ${pct(result.event.f1)} | ${result.event.falsePositives} | ${result.event.falseNegatives} |

## Company mistakes

${mistakeList(result.companyMistakes)}

## Event mistakes

${mistakeList(result.eventMistakes)}
`;
}
