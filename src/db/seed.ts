import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { parseWebEnv } from "@/core/env";
import type { ExtractionV1 } from "@/core/extraction-schema";
import { computeRoundMomentum } from "@/lib/company-momentum";
import { normaliseCompanyName, normaliseInvestorName } from "@/lib/normalise";
import { createPipelineDb, type Db } from "./client";
import {
  EMBEDDING_DIMENSIONS,
  acquisitions,
  chCompanies,
  chFilings,
  companies,
  companyAliases,
  companyLocations,
  companyTags,
  companyThemes,
  eventConfirmations,
  eventInvestors,
  eventSources,
  events,
  extractions,
  formDFilings,
  fundingRoundMomentum,
  fundingRounds,
  ingestRuns,
  investors,
  launches,
  llmUsage,
  registryLinks,
  sourceItems,
  sources,
  tagThemes,
  tags,
  themes,
  themeWeeklyStats,
  weeklyTotals,
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
): Promise<Map<string, number>> {
  if (data.tags.length === 0) return new Map();
  const inserted = await db
    .insert(tags)
    .values(data.tags.map((tag) => ({ slug: tag.slug, label: tag.label })))
    .returning({ id: tags.id, slug: tags.slug });
  const tagIds = new Map(inserted.map((tag) => [tag.slug, tag.id]));
  if (data.companyTags.length === 0) return tagIds;
  await db.insert(companyTags).values(
    data.companyTags.map((link) => ({
      companyId: requireId(companyIds, "company", link.companySlug),
      tagId: requireId(tagIds, "tag", link.tagSlug),
      source: "extraction",
      mentionCount: 1,
    })),
  );
  return tagIds;
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
): Promise<number[]> {
  const eventIds: number[] = [];
  if (eventsToInsert.length === 0) return eventIds;
  const articles = eventsToInsert.flatMap((event) => event.articles);
  const insertedItems =
    articles.length === 0
      ? []
      : await db
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
          .returning({
            id: sourceItems.id,
            externalId: sourceItems.externalId,
          });
  const itemIdByExternal = new Map(
    insertedItems.map((item) => [item.externalId, item.id]),
  );

  const insertedExtractions =
    insertedItems.length === 0
      ? []
      : await db
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
          .returning({
            id: extractions.id,
            sourceItemId: extractions.sourceItemId,
          });
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
        evidence: event.evidence ?? "reported",
        sourceCount: event.articles.length,
      })
      .returning({ id: events.id });
    if (!inserted) throw new Error("Event insert failed");
    const eventId = inserted.id;
    eventIds.push(eventId);

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

    if (event.articles.length === 0) continue;
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
  return eventIds;
}

/** A unit vector with a single 1, so seeded theme centroids are obviously synthetic. */
function fixtureCentroid(position: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[position % EMBEDDING_DIMENSIONS] = 1;
  return vector;
}

async function insertThemes(
  db: Db,
  data: SeedDataset,
  tagIds: Map<string, number>,
  companyIds: Map<string, number>,
  now: Date,
): Promise<void> {
  if (data.themes.length === 0) return;
  const ids = new Map<string, number>();
  const surviving = data.themes.filter((theme) => !theme.mergedIntoSlug);
  const merged = data.themes.filter((theme) => theme.mergedIntoSlug);
  const row = (theme: SeedDataset["themes"][number], position: number) => ({
    slug: theme.slug,
    name: theme.name,
    nameSource: theme.nameSource,
    sector: theme.sector,
    status: theme.mergedIntoSlug ? ("merged" as const) : ("active" as const),
    seedTagId: requireId(tagIds, "tag", theme.seedTagSlug),
    centroid: fixtureCentroid(position),
    embeddingModel: "seed-fixture",
    namedAt: theme.nameSource === "tag" ? null : now,
    reviewedAt: theme.reviewed ? now : null,
  });
  const first = await db
    .insert(themes)
    .values(surviving.map((theme, index) => row(theme, index)))
    .returning({ id: themes.id, slug: themes.slug });
  for (const inserted of first) ids.set(inserted.slug, inserted.id);
  if (merged.length > 0) {
    const second = await db
      .insert(themes)
      .values(
        merged.map((theme, index) => ({
          ...row(theme, surviving.length + index),
          mergedIntoId: requireId(ids, "theme", theme.mergedIntoSlug ?? ""),
        })),
      )
      .returning({ id: themes.id, slug: themes.slug });
    for (const inserted of second) ids.set(inserted.slug, inserted.id);
  }

  await db.insert(tagThemes).values(
    data.tagThemes.map((link) => ({
      tagId: requireId(tagIds, "tag", link.tagSlug),
      themeId: requireId(ids, "theme", link.themeSlug),
      similarity: link.similarity,
      assignedBy: link.assignedBy,
      embeddingModel: "seed-fixture",
    })),
  );
  await db.insert(companyThemes).values(
    data.companyThemes.map((link) => ({
      companyId: requireId(companyIds, "company", link.companySlug),
      themeId: requireId(ids, "theme", link.themeSlug),
      tagCount: link.tagCount,
    })),
  );
  if (data.themeWeeklyStats.length > 0) {
    await db.insert(themeWeeklyStats).values(
      data.themeWeeklyStats.map(({ themeSlug, ...week }) => ({
        ...week,
        themeId: requireId(ids, "theme", themeSlug),
      })),
    );
  }
}

async function insertWeeklyTotals(db: Db, data: SeedDataset): Promise<void> {
  if (data.weeklyTotals.length === 0) return;
  await db.insert(weeklyTotals).values(data.weeklyTotals);
}

async function insertLocations(
  db: Db,
  data: SeedDataset,
  companyIds: Map<string, number>,
): Promise<void> {
  if (data.locations.length === 0) return;
  await db.insert(companyLocations).values(
    data.locations.map(({ companySlug, ...location }) => ({
      ...location,
      companyId: requireId(companyIds, "company", companySlug),
    })),
  );
}

/** Equity-round momentum for every company, by the rules in spec section 8.3. */
async function insertMomentum(
  db: Db,
  data: SeedDataset,
  companyIds: Map<string, number>,
  eventIds: number[],
): Promise<void> {
  const byCompany = new Map<
    string,
    Parameters<typeof computeRoundMomentum>[0][number][]
  >();
  data.events.forEach((event, index) => {
    if (event.type !== "funding_round") return;
    const list = byCompany.get(event.companySlug) ?? [];
    const eventId = eventIds[index];
    if (eventId == null) throw new Error(`Missing seed event ${index}`);
    list.push({
      eventId,
      announcedOn: event.announcedOn,
      datePrecision: "day",
      roundType: event.roundType,
      amountGbpMinor: event.amountGbpMinor,
    });
    byCompany.set(event.companySlug, list);
  });
  const rows = [...byCompany].flatMap(([companySlug, rounds]) =>
    computeRoundMomentum(rounds).map((result) => ({
      eventId: result.eventId,
      companyId: requireId(companyIds, "company", companySlug),
      equityRoundNumber: result.equityRoundNumber,
      previousEventId: result.previousEventId,
      monthsSincePrevious: result.monthsSincePrevious,
      stepUpBasisEventId: result.stepUpBasisEventId,
      stepUpRatio: result.stepUpRatio,
      roundsIn24mToDate: result.roundsIn24mToDate,
    })),
  );
  if (rows.length === 0) return;
  await db.insert(fundingRoundMomentum).values(rows);
}

/**
 * Phase 3 registry rows: a linked UK company with an SH01 confirmation, a
 * dormant one, and a US company with a Form D confirmation. All invented.
 */
async function insertRegistry(
  db: Db,
  data: SeedDataset,
  companyIds: Map<string, number>,
  eventIds: number[],
): Promise<void> {
  const registry = data.registry;
  if (registry.chCompanies.length > 0) {
    await db.insert(chCompanies).values(registry.chCompanies);
  }

  await db.insert(registryLinks).values(
    registry.links.map((link) => ({
      companyId: requireId(companyIds, "company", link.companySlug),
      registry: link.registry,
      registryId: link.registryId,
      registryName: link.registryName,
      status: "linked" as const,
      method: link.method,
      reason: link.reason,
      decidedBy: "auto" as const,
    })),
  );

  const filingIds = new Map<string, number>();
  if (registry.chFilings.length > 0) {
    const rows = await db
      .insert(chFilings)
      .values(registry.chFilings)
      .returning({ id: chFilings.id, key: chFilings.transactionId });
    for (const row of rows) filingIds.set(row.key, row.id);
  }

  if (registry.formDFilings.length > 0) {
    const [edgar] = await db
      .insert(sources)
      .values({
        slug: registry.edgarSource.slug,
        name: registry.edgarSource.name,
        kind: registry.edgarSource.kind,
        url: registry.edgarSource.url,
        priority: registry.edgarSource.priority,
      })
      .returning({ id: sources.id });
    if (!edgar) throw new Error("EDGAR source insert failed");
    const rows = await db
      .insert(formDFilings)
      .values(
        registry.formDFilings.map(({ companySlug, ...filing }) => ({
          ...filing,
          sourceId: edgar.id,
          isAmendment: false,
          securities: ["equity"],
          exemptions: ["06b"],
          companyId: requireId(companyIds, "company", companySlug),
          linkedAt: new Date(),
        })),
      )
      .returning({
        id: formDFilings.id,
        key: formDFilings.accessionNumber,
      });
    for (const row of rows) filingIds.set(row.key, row.id);
  }

  if (registry.confirmations.length > 0) {
    await db.insert(eventConfirmations).values(
      registry.confirmations.map((confirmation) => {
        const eventId = eventIds[confirmation.eventIndex];
        const recordId = filingIds.get(confirmation.recordKey);
        if (eventId == null || recordId == null) {
          throw new Error(`Missing seed record ${confirmation.recordKey}`);
        }
        return {
          eventId,
          recordKind: confirmation.recordKind,
          recordId,
          rule: confirmation.rule,
          recordDate: confirmation.recordDate,
          confirmsAmount: confirmation.confirmsAmount,
        };
      }),
    );
  }
}

async function insertAll(db: Db, data: SeedDataset, now: Date): Promise<void> {
  const companyIds = await insertCompanies(db, data);
  await insertAliases(db, data, companyIds);
  const tagIds = await insertTags(db, data, companyIds);
  const investorIds = await insertInvestors(db, data);
  const runIds = await insertRuns(db, data);
  await insertUsage(db, data, runIds);
  const sourceId = await insertSource(db, data);
  const eventIds = await insertEvents(
    db,
    data.events,
    companyIds,
    investorIds,
    sourceId,
  );
  // Derived rows are written directly from the seed, by the same rules as the
  // stats and location rebuilds. Task 043 can later switch the seed to the real
  // rebuild. This file does not import the pipeline, so it can run on its own.
  await insertThemes(db, data, tagIds, companyIds, now);
  await insertWeeklyTotals(db, data);
  await insertLocations(db, data, companyIds);
  await insertMomentum(db, data, companyIds, eventIds);
  await insertRegistry(db, data, companyIds, eventIds);
}

/** Inserts fictional local data. Returns false when the seed company is already present. */
export async function seedDatabase(
  db: Db,
  now: Date = new Date(),
): Promise<boolean> {
  if (await alreadySeeded(db)) return false;
  const data = buildSeedDataset(now);
  await db.transaction(async (tx) => {
    await insertAll(tx, data, now);
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
