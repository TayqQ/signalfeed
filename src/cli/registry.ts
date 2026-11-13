import { parseArgs } from "node:util";
import { REGISTRY_KINDS, type RegistryKind } from "@/core/enums";
import { createPipelineDb } from "@/db/client";
import {
  approveLinks,
  link,
  listCandidates,
  reject,
  rejectCandidates,
  showCompany,
  unlinkCompany,
  type ReviewCandidate,
  type ReviewEvent,
  type ReviewResult,
} from "@/pipeline/registry/review";
import { loadDotEnv } from "./env";

const USAGE = `Usage: pnpm registry <command>

  list [--registry ch|sec] [--limit 20]   Open candidates: evidence for and against, headline count, registry URL
  show <company-slug>                     Every registry row for a company, in any status
  approve <id> [<id> ...]                 Link candidates by id (from list). Manual, so final
  reject <id> [<id> ...]                  Reject candidates by id. Never proposed again
  reject <company-slug> <number> --registry ch|sec
                                          Reject a number that is not in the list
  link <company-slug> <number> --registry ch|sec [--name "..."]
                                          Link a number you looked up yourself
  unlink <company-slug> --registry ch|sec Remove the link. The number is then rejected

Run it from a maintainer's machine with DATABASE_URL set. It never calls an API.
Check each candidate at the URL that list prints before you approve it.`;

function registryKind(value: string | undefined): RegistryKind | undefined {
  if (value === undefined) return undefined;
  const kind = { ch: "companies_house", sec: "sec_edgar" }[value] ?? value;
  if (!(REGISTRY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown registry "${value}". Use ch or sec`);
  }
  return kind as RegistryKind;
}

function requireRegistry(value: string | undefined): RegistryKind {
  const kind = registryKind(value);
  if (!kind) throw new Error("This command needs --registry ch|sec");
  return kind;
}

function parseIds(values: string[]): number[] {
  if (values.length === 0) throw new Error("Give at least one id");
  return values.map((value) => {
    const id = Number.parseInt(value, 10);
    if (!/^\d+$/.test(value) || id < 1) throw new Error(`Not an id: ${value}`);
    return id;
  });
}

function money(event: ReviewEvent): string {
  if (event.amountMinor === null || event.currency === null) return "";
  return ` ${event.currency} ${(event.amountMinor / 100).toLocaleString("en-GB")}`;
}

function describeEvent(event: ReviewEvent | null): string {
  if (!event) return "none";
  const kind = event.roundType ? `${event.roundType} round` : event.type;
  return `${event.announcedOn} ${kind}${money(event)}`;
}

export function formatCandidate(row: ReviewCandidate): string {
  const place = [row.company.town, row.company.country]
    .filter(Boolean)
    .join(", ");
  const registry = row.registry === "companies_house" ? "CH" : "SEC";
  const facts = [
    row.registryFacts.status,
    row.registryFacts.date,
    row.registryFacts.outcode,
  ].filter(Boolean);
  const lines = [
    `#${row.id}  ${row.company.name} (${row.company.slug})${place ? `  ${place}` : ""}`,
    `    ${registry} ${row.registryId}  ${row.registryName}  [${row.status}]${facts.length ? `  ${facts.join(", ")}` : ""}`,
    `    first: ${describeEvent(row.company.earliest)}`,
    `    last:  ${describeEvent(row.company.latest)}`,
    `    headlines: ${row.company.headlines}`,
    `    for:     ${row.evidenceFor.join("; ") || "nothing"}`,
    `    against: ${row.evidenceAgainst.join("; ") || "nothing"}`,
    `    rule:    ${row.reason}`,
    `    check:   ${row.url}`,
  ];
  return lines.join("\n");
}

function printResults(results: ReviewResult[]): number {
  for (const result of results) {
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.id}: ${result.message}`,
    );
  }
  return results.every((result) => result.ok) ? 0 : 1;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      limit: { type: "string", default: "20" },
      name: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const known = ["list", "show", "approve", "reject", "link", "unlink"];
  if (!known.includes(command)) {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, close } = createPipelineDb(url);
  const now = new Date();
  try {
    switch (command) {
      case "list": {
        const limit = Number.parseInt(values.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("--limit needs a positive number");
        }
        const rows = await listCandidates(db, {
          registry: registryKind(values.registry),
          limit,
        });
        console.log(rows.map(formatCandidate).join("\n\n"));
        console.error(
          `${rows.length} open candidates${rows.length === limit ? " (limit reached; use --limit for more)" : ""}`,
        );
        return 0;
      }
      case "show": {
        const slug = rest[0];
        if (!slug) throw new Error("show needs a company slug");
        const shown = await showCompany(db, slug);
        console.log(`${shown.name} (${shown.slug})`);
        for (const row of shown.links) {
          console.log(
            `  #${row.id}  ${row.registry === "companies_house" ? "CH" : "SEC"} ${row.registryId}  ${row.registryName}  [${row.status}]  ${row.decidedBy}${row.method ? `, ${row.method}` : ""}\n      ${row.reason}\n      ${row.url}`,
          );
        }
        if (shown.links.length === 0) console.log("  no registry rows");
        return 0;
      }
      case "approve":
        return printResults(await approveLinks(db, parseIds(rest), now));
      case "reject": {
        if (rest.length === 2 && !/^\d+$/.test(rest[0] ?? "")) {
          return printResults([
            await reject(db, {
              slug: rest[0] as string,
              registry: requireRegistry(values.registry),
              registryId: rest[1] as string,
              registryName: values.name,
              now,
            }),
          ]);
        }
        return printResults(await rejectCandidates(db, parseIds(rest), now));
      }
      case "link": {
        const [slug, number] = rest;
        if (!slug || !number) throw new Error("link needs a slug and a number");
        return printResults([
          await link(db, {
            slug,
            registry: requireRegistry(values.registry),
            registryId: number,
            registryName: values.name,
            now,
          }),
        ]);
      }
      default: {
        const slug = rest[0];
        if (!slug) throw new Error("unlink needs a company slug");
        return printResults([
          await unlinkCompany(db, {
            slug,
            registry: requireRegistry(values.registry),
            now,
          }),
        ]);
      }
    }
  } finally {
    await close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
