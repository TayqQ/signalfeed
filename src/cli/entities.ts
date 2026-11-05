import { parseArgs } from "node:util";
import { MERGE_ENTITIES, type MergeEntity } from "@/core/enums";
import { createPipelineDb } from "@/db/client";
import {
  addAlias,
  dismissCandidate,
  listCandidates,
  mergeCompanies,
  mergeInvestors,
  previewCompanyMerge,
  previewInvestorMerge,
} from "@/pipeline/resolve/merge-entities";
import { loadDotEnv } from "./env";

const USAGE = `Usage: pnpm entities <command>

  candidates [--type company|investor]              List open merge candidates
  merge --type <t> --keep <id> --merge <id> [--note "..."] [--yes]
                                                    Without --yes, shows what would change
  dismiss <candidate id>                            Close a candidate without merging
  alias --type <t> --id <id> --alias "..."          Add an alias`;

function entityType(value: string | undefined): MergeEntity | undefined {
  if (value === undefined) return undefined;
  if (!(MERGE_ENTITIES as readonly string[]).includes(value)) {
    throw new Error(`Unknown type: ${value}`);
  }
  return value as MergeEntity;
}

function requireId(value: string | undefined, label: string): number {
  const id = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(id) || id < 1) throw new Error(`${label} needs an id`);
  return id;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      type: { type: "string" },
      keep: { type: "string" },
      merge: { type: "string" },
      id: { type: "string" },
      alias: { type: "string" },
      note: { type: "string" },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, close } = createPipelineDb(url);
  try {
    const type = entityType(values.type);
    switch (command) {
      case "candidates":
        for (const row of await listCandidates(db, { entityType: type })) {
          console.log(JSON.stringify(row));
        }
        return 0;
      case "merge": {
        if (!type) throw new Error("merge needs --type");
        const keep = requireId(values.keep, "--keep");
        const merge = requireId(values.merge, "--merge");
        if (!values.yes) {
          const preview =
            type === "company"
              ? await previewCompanyMerge(db, merge)
              : await previewInvestorMerge(db, merge);
          console.log(
            JSON.stringify({ wouldMove: preview, keep, merge, applied: false }),
          );
          return 0;
        }
        const run = type === "company" ? mergeCompanies : mergeInvestors;
        const result = await run(db, keep, merge, { note: values.note });
        console.log(JSON.stringify({ ...result, applied: true }));
        if (result.possibleDuplicateEvents.length > 0) {
          console.error(
            "Warning: these events now look like duplicates and were left alone.",
          );
        }
        return 0;
      }
      case "dismiss":
        await dismissCandidate(db, requireId(positionals[1], "dismiss"));
        return 0;
      case "alias":
        if (!type || !values.alias) {
          throw new Error("alias needs --type, --id and --alias");
        }
        await addAlias(db, type, requireId(values.id, "--id"), values.alias);
        return 0;
      default:
        console.error(USAGE);
        return 1;
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
