import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { parseWebEnv } from "@/core/env";
import type { ExtractionV1 } from "@/core/extraction-schema";
import { normaliseCompanyName, normaliseInvestorName } from "@/lib/normalise";
import { createPipelineDb, type Db } from "./client";
import {
  acquisitions,
  companies,
  companyAliases,
  companyTags,
  eventInvestors,
  eventSources,
  events,
  extractions,
  fundingRounds,
  ingestRuns,
  investors,
  launches,
  llmUsage,
  sourceItems,
  sources,
  tags,
} from "./schema";
import {
  buildSeedDataset,
  SEED_REFERENCE,
  type SeedDataset,
  type SeedEvent,
} from "./seed-data";

const EXTRACTION_RESULT: ExtractionV1 = { isRelevant: true, events: [] };

/** True when seeding a localhost database, or when `--force` is passed. */
export function isLocalSeedTarget(
  databaseUrl: string,
  force: boolean,
): boolean {
  return force || databaseUrl.includes("localhost");
}

async function alreadySeeded(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, SEED_REFERENCE.liveCompanySlug))
    .limit(1);
  return row != null;
}

function requireId(
  ids: Map<string, number>,
  label: string,
  slug: string,
): number {
  const id = ids.get(slug);
  if (id == null) throw new Error(`Missing seed ${label} ${slug}`);
  return id;
}

async function insertCompanies(
  db: Db,
  data: SeedDataset,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const live = data.companies.filter((company) => !company.mergedIntoSlug);
  const merged = data.companies.filter((company) => company.mergedIntoSlug);

  const inserted = await db
    .insert(companies)
    .values(
      live.map((company) => ({
        slug: company.slug,
        name: company.name,
        normalisedName: normaliseCompanyName(company.name),
        websiteDomain: company.websiteDomain,
        description: company.description,
        countryCode: company.countryCode,
        city: company.city,
        foundedYear: company.foundedYear,
        foundedYearSource: company.foundedYearSource,
        status: company.status,
        ukCompanyNumber: company.ukCompanyNumber,
        ycBatch: company.ycBatch,
        githubOrg: company.githubOrg,
      })),
    )
    .returning({ id: companies.id, slug: companies.slug });
  for (const row of inserted) ids.set(row.slug, row.id);

  if (merged.length > 0) {
    const mergedRows = await db
      .insert(companies)
      .values(
        merged.map((company) => ({
          slug: company.slug,
          name: company.name,
          normalisedName: normaliseCompanyName(company.name),
          websiteDomain: company.websiteDomain,
          description: company.description,
          countryCode: company.countryCode,
          city: company.city,
          foundedYear: company.foundedYear,
          foundedYearSource: company.foundedYearSource,
          status: company.status,
          mergedIntoId: requireId(ids, "company", company.mergedIntoSlug ?? ""),
        })),
      )
      .returning({ id: companies.id, slug: companies.slug });
    for (const row of mergedRows) ids.set(row.slug, row.id);
  }

  return ids;
}

async function insertInvestors(
  db: Db,
  data: SeedDataset,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const live = data.investors.filter((investor) => !investor.mergedIntoSlug);
  const merged = data.investors.filter((investor) => investor.mergedIntoSlug);

  const inserted = await db
    .insert(investors)
    .values(
      live.map((investor) => ({
        slug: investor.slug,
        name: investor.name,
        normalisedName: normaliseInvestorName(investor.name),
        kind: investor.kind,
        countryCode: investor.countryCode,
        websiteDomain: investor.websiteDomain,
      })),
    )
    .returning({ id: investors.id, slug: investors.slug });
  for (const row of inserted) ids.set(row.slug, row.id);

  if (merged.length > 0) {
    const mergedRows = await db
      .insert(investors)
      .values(
        merged.map((investor) => ({
          slug: investor.slug,
          name: investor.name,
          normalisedName: normaliseInvestorName(investor.name),
          kind: investor.kind,
          countryCode: investor.countryCode,
          websiteDomain: investor.websiteDomain,
          mergedIntoId: requireId(
            ids,
            "investor",
            investor.mergedIntoSlug ?? "",
          ),
        })),
      )
      .returning({ id: investors.id, slug: investors.slug });
    for (const row of mergedRows) ids.set(row.slug, row.id);
  }

  return ids;
}

async function insertTags(
  db: Db,
  data: SeedDataset,
  companyIds: Map<string, number>,
): Promise<void> {
  if (data.tags.length === 0) return;
  const inserted = await db
    .insert(tags)
    .values(data.tags.map((tag) => ({ slug: tag.slug, label: tag.label })))
    .returning({ id: tags.id, slug: tags.slug });
  const tagIds = new Map(inserted.map((tag) => [tag.slug, tag.id]));
  if (data.companyTags.length === 0) return;
  await db.insert(companyTags).values(
    data.companyTags.map((link) => ({
      companyId: requireId(companyIds, "company", link.companySlug),
      tagId: requireId(tagIds, "tag", link.tagSlug),
      source: "extraction",
      mentionCount: 1,
    })),
  );
}

async function insertAliases(
  db: Db,
  data: SeedDataset,
  companyIds: Map<string, number>,
): Promise<void> {
  if (data.aliases.length === 0) return;
  await db.insert(companyAliases).values(
    data.aliases.map((alias) => ({
      companyId: requireId(companyIds, "company", alias.companySlug),
      alias: alias.alias,
      normalisedAlias: normaliseCompanyName(alias.alias),
      source: alias.source,
    })),
  );
}

async function insertRuns(db: Db, data: SeedDataset): Promise<number[]> {
  const ids: number[] = [];
  for (const run of data.runs) {
    const [inserted] = await db
      .insert(ingestRuns)
      .values({
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        trigger: run.trigger,
        status: run.status,
        stats: run.stats,
        error: run.error,
      })
      .returning({ id: ingestRuns.id });
    if (!inserted) throw new Error("Ingest run insert failed");
    ids.push(inserted.id);
  }
  return ids;
}

async function insertUsage(
  db: Db,
  data: SeedDataset,
  runIds: number[],
): Promise<void> {
  if (data.usage.length === 0) return;
  await db.insert(llmUsage).values(
    data.usage.map((row) => {
      const ingestRunId =
        row.runIndex == null ? null : (runIds[row.runIndex] ?? null);
      if (row.runIndex != null && ingestRunId == null) {
        throw new Error(`Missing ingest run ${row.runIndex}`);
      }
      return {
        occurredAt: row.occurredAt,
        purpose: row.purpose,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsdMicros: row.costUsdMicros,
        ingestRunId,
      };
    }),
  );
}

async function insertSource(db: Db, data: SeedDataset): Promise<number> {
  const [source] = await db
    .insert(sources)
    .values({
      slug: data.source.slug,
      name: data.source.name,
      kind: data.source.kind,
      url: data.source.url,
      priority: data.source.priority,
    })
    .returning({ id: sources.id });
  if (!source) throw new Error("Source insert failed");

  if (data.looseItems.length > 0) {
    await db.insert(sourceItems).values(
      data.looseItems.map((item) => ({
        sourceId: source.id,
        externalId: item.externalId,
        url: item.url,
        canonicalUrl: item.url,
        title: item.title,
        publishedAt: new Date(item.publishedAt),
        status: item.status,
      })),
    );
  }

  return source.id;
}

async function insertEvents(
  db: Db,
  eventsToInsert: SeedEvent[],
  companyIds: Map<string, number>,
  investorIds: Map<string, number>,
  sourceId: number,
): Promise<void> {
  if (eventsToInsert.length === 0) return;
  const articles = eventsToInsert.flatMap((event) => event.articles);
  const insertedItems = await db
    .insert(sourceItems)
    .values(
      articles.map((item) => ({
        sourceId,
        externalId: item.externalId,
        url: item.url,
        canonicalUrl: item.url,
        title: item.title,
        publishedAt: new Date(item.publishedAt),
        status: "extracted" as const,
      })),
    )
    .returning({ id: sourceItems.id, externalId: sourceItems.externalId });
  const itemIdByExternal = new Map(
    insertedItems.map((item) => [item.externalId, item.id]),
  );

  const insertedExtractions = await db
    .insert(extractions)
    .values(
      insertedItems.map((item) => ({
        sourceItemId: item.id,
        promptVersion: "v1",
        model: "gpt-4.1-nano",
        result: EXTRACTION_RESULT,
        isRelevant: true,
        isCurrent: true,
        inputTokens: 400,
        outputTokens: 120,
        costUsdMicros: 90,
      })),
    )
    .returning({ id: extractions.id, sourceItemId: extractions.sourceItemId });
  const extractionIdByItem = new Map(
    insertedExtractions.map((row) => [row.sourceItemId, row.id]),
  );

  for (const event of eventsToInsert) {
    const [inserted] = await db
      .insert(events)
      .values({
        type: event.type,
        companyId: requireId(companyIds, "company", event.companySlug),
        announcedOn: event.announcedOn,
        datePrecision: "day",
        evidence: "reported",
        sourceCount: event.articles.length,
      })
      .returning({ id: events.id });
    if (!inserted) throw new Error("Event insert failed");
    const eventId = inserted.id;

    if (event.type === "funding_round") {
      await db.insert(fundingRounds).values({
        eventId,
        roundType: event.roundType,
        roundLabel: event.roundLabel,
        amountMinor: event.amountMinor,
        currency: event.currency,
        amountUsdMinor: event.amountUsdMinor,
        amountGbpMinor: event.amountGbpMinor,
        fxRateDate: event.fxRateDate,
        includesIndividualAngels: event.includesIndividualAngels,
      });
      if (event.investors.length > 0) {
        await db.insert(eventInvestors).values(
          event.investors.map((investor) => ({
            eventId,
            investorId: requireId(investorIds, "investor", investor.slug),
            role: investor.role,
          })),
        );
      }
    } else if (event.type === "acquisition") {
      await db.insert(acquisitions).values({
        eventId,
        acquirerCompanyId: event.acquirerSlug
          ? requireId(companyIds, "company", event.acquirerSlug)
          : null,
        acquirerName: event.acquirerName,
        priceMinor: event.priceMinor,
        currency: event.currency,
        priceUsdMinor: event.priceUsdMinor,
        priceGbpMinor: event.priceGbpMinor,
        fxRateDate: event.fxRateDate,
      });
    } else {
      await db.insert(launches).values({
        eventId,
        kind: event.kind,
        productName: event.productName,
        url: event.url,
        externalRef: event.externalRef,
      });
    }

    await db.insert(eventSources).values(
      event.articles.map((item, index) => {
        const sourceItemId = itemIdByExternal.get(item.externalId);
        if (sourceItemId == null) {
          throw new Error(`Missing source item ${item.externalId}`);
        }
        const extractionId = extractionIdByItem.get(sourceItemId);
        if (extractionId == null) {
          throw new Error(`Missing extraction for ${item.externalId}`);
        }
        return { eventId, extractionId, sourceItemId, eventIndex: index };
      }),
    );
  }
}

async function insertAll(db: Db, data: SeedDataset): Promise<void> {
  const companyIds = await insertCompanies(db, data);
  await insertAliases(db, data, companyIds);
  await insertTags(db, data, companyIds);
  const investorIds = await insertInvestors(db, data);
  const runIds = await insertRuns(db, data);
  await insertUsage(db, data, runIds);
  const sourceId = await insertSource(db, data);
  await insertEvents(db, data.events, companyIds, investorIds, sourceId);
}

/** Inserts fictional local data. Returns false when the seed company is already present. */
export async function seedDatabase(db: Db): Promise<boolean> {
  if (await alreadySeeded(db)) return false;
  const data = buildSeedDataset();
  await db.transaction(async (tx) => {
    await insertAll(tx, data);
  });
  return true;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === resolve(entry);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the environment.
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  const force = process.argv.includes("--force");
  if (!isLocalSeedTarget(databaseUrl, force)) {
    console.error(
      "Refusing to seed because DATABASE_URL does not contain localhost. Pass --force to seed anyway.",
    );
    process.exit(1);
  }

  const { DATABASE_URL } = parseWebEnv(process.env);
  const pipeline = createPipelineDb(DATABASE_URL);
  try {
    const inserted = await seedDatabase(pipeline.db);
    console.log(inserted ? "Seed data inserted" : "Seed data already present");
  } finally {
    await pipeline.close();
  }
}

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
}
