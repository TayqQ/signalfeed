import { parseArgs } from "node:util";
import { INGEST_TRIGGERS, type IngestTrigger } from "@/core/enums";
import { withIngestLock } from "@/pipeline/lock";
import {
  collectStep,
  derivedStatsStep,
  embedStep,
  extractStep,
  fxStep,
  locationsStep,
  prefilterStep,
  reextractStep,
  resolveStep,
  runAll,
  runGrants,
  themesStep,
} from "@/pipeline/run";
import { SOURCES } from "@/pipeline/sources";
import { upsertSources } from "@/pipeline/store/sources";
import { createPipelineDeps } from "@/pipeline/wiring";
import { loadDotEnv } from "./env";

const USAGE = `Usage: pnpm ingest <command> [options]

Commands:
  run        Collect, prefilter, extract, resolve and convert, then tag and
             resolve grants, embed tags, assign and name themes, and rebuild
             locations and stats, under a lock
  collect    Fetch feeds and store new items. Needs no LLM key
  extract    Prefilter pending items, then extract them
  resolve    Turn stored extractions into companies and events
  fx         Fetch missing rates and fill USD and GBP
  reextract  Re-run extraction for the current prompt version
  grants     Fetch new Innovate UK projects and organisations from Gateway to
             Research. Needs no LLM key. Recorded as a run
  embed      Embed tags that have no embedding from the current model
  themes     Assign embedded tags to themes, then name new themes
  stats      Rebuild company locations and the derived stats tables

Options:
  --trigger schedule|manual   run, grants: recorded on the run (default manual)
  --prompt-version <v>        reextract: must match this build's prompt
  --limit <n>                 reextract: most items to process (default 100)
  --dry-run                   reextract: print the estimate, call nothing
  --yes                       reextract: confirm the spend
  --since YYYY-MM-DD          grants: skip projects that start before this date
  --max-pages <n>             grants: most project pages to fetch (default 30)
  --max-orgs <n>              grants: most organisations to fetch (default 1500)
  --force                     stats: rebuild even when nothing has changed
  -h, --help                  Show this help

Without OPENAI_API_KEY, run still collects, resolves grants and rebuilds
stats. Extraction, grant tagging, embedding and theme naming wait for a key.`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !DATE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${flag} needs a date as YYYY-MM-DD`);
  }
  return value;
}

function positiveInt(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${flag} needs a whole number above 0`);
  }
  return n;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value));
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      trigger: { type: "string", default: "manual" },
      "prompt-version": { type: "string" },
      limit: { type: "string", default: "100" },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      since: { type: "string" },
      "max-pages": { type: "string" },
      "max-orgs": { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (!(INGEST_TRIGGERS as readonly string[]).includes(values.trigger)) {
    console.error(`Unknown trigger: ${values.trigger}`);
    return 1;
  }

  const grantOptions = {
    since: isoDate(values.since, "--since"),
    maxPages: positiveInt(values["max-pages"], "--max-pages"),
    maxOrgFetches: positiveInt(values["max-orgs"], "--max-orgs"),
  };

  loadDotEnv();
  const { deps, lock, close } = createPipelineDeps(process.env);
  try {
    if (command === "run") {
      const summary = await runAll(deps, lock, values.trigger as IngestTrigger);
      print(summary);
      return summary.status === "failed" ? 1 : 0;
    }

    if (command === "grants") {
      const summary = await runGrants(
        deps,
        lock,
        values.trigger as IngestTrigger,
        grantOptions,
      );
      print(summary);
      return summary.status === "failed" ? 1 : 0;
    }

    if (command === "reextract") {
      if (!values["prompt-version"]) {
        console.error("reextract needs --prompt-version");
        return 1;
      }
      print(
        await reextractStep(deps, {
          promptVersion: values["prompt-version"],
          limit: Number.parseInt(values.limit, 10),
          dryRun: values["dry-run"],
          yes: values.yes,
        }),
      );
      return 0;
    }

    // Each returns what to print and any step failures.
    type StepRun = () => Promise<{ output: unknown; errors?: string[] }>;
    const steps: Record<string, StepRun> = {
      collect: async () => {
        await upsertSources(deps.db, SOURCES);
        return { output: { collect: await collectStep(deps) } };
      },
      extract: async () => ({
        output: {
          prefilter: await prefilterStep(deps),
          extract: await extractStep(deps),
        },
      }),
      resolve: async () => ({ output: { resolve: await resolveStep(deps) } }),
      fx: async () => ({ output: { fx: await fxStep(deps) } }),
      embed: async () => {
        const { stats, errors } = await embedStep(deps, { paidAllowed: true });
        return { output: { embed: stats, errors }, errors };
      },
      themes: async () => {
        const { stats, errors } = await themesStep(deps, { paidAllowed: true });
        return { output: { themes: stats, errors }, errors };
      },
      stats: async () => {
        const locations = await locationsStep(deps, { force: values.force });
        const stats = await derivedStatsStep(deps, { force: values.force });
        const errors = [...locations.errors, ...stats.errors];
        return {
          output: { locations: locations.stats, stats: stats.stats, errors },
          errors,
        };
      },
    };
    const step = steps[command];
    if (!step) {
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
    }
    const locked = await withIngestLock(lock, step);
    if (!locked.ran) {
      print({ ran: false });
      return 0;
    }
    print(locked.result.output);
    for (const message of locked.result.errors ?? []) {
      console.error(`Step failed: ${message}`);
    }
    return locked.result.errors?.length ? 1 : 0;
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
