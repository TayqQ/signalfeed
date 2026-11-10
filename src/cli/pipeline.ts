import { parseArgs } from "node:util";
import { INGEST_TRIGGERS, type IngestTrigger } from "@/core/enums";
import { withIngestLock } from "@/pipeline/lock";
import {
  collectStep,
  extractStep,
  fxStep,
  prefilterStep,
  reextractStep,
  resolveStep,
  runAll,
} from "@/pipeline/run";
import { SOURCES } from "@/pipeline/sources";
import { upsertSources } from "@/pipeline/store/sources";
import { createPipelineDeps } from "@/pipeline/wiring";
import { loadDotEnv } from "./env";

const USAGE = `Usage: pnpm ingest <command> [options]

Commands:
  run        Collect, prefilter, extract, resolve and convert, under a lock
  collect    Fetch feeds and store new items. Needs no LLM key
  extract    Prefilter pending items, then extract them
  resolve    Turn stored extractions into companies and events
  fx         Fetch missing rates and fill USD and GBP
  reextract  Re-run extraction for the current prompt version

Options:
  --trigger schedule|manual   Recorded on the run (default manual)
  --prompt-version <v>        reextract: must match this build's prompt
  --limit <n>                 reextract: most items to process (default 100)
  --dry-run                   reextract: print the estimate, call nothing
  --yes                       reextract: confirm the spend
  -h, --help                  Show this help

Without OPENAI_API_KEY, run still collects and stores items for extraction later.`;

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

  loadDotEnv();
  const { deps, lock, close } = createPipelineDeps(process.env);
  try {
    if (command === "run") {
      const summary = await runAll(deps, lock, values.trigger as IngestTrigger);
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

    const steps: Record<string, () => Promise<unknown>> = {
      collect: async () => {
        await upsertSources(deps.db, SOURCES);
        return { collect: await collectStep(deps) };
      },
      extract: async () => ({
        prefilter: await prefilterStep(deps),
        extract: await extractStep(deps),
      }),
      resolve: async () => ({ resolve: await resolveStep(deps) }),
      fx: async () => ({ fx: await fxStep(deps) }),
    };
    const step = steps[command];
    if (!step) {
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
    }
    const locked = await withIngestLock(lock, step);
    print(locked.ran ? locked.result : { ran: false });
    return 0;
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
