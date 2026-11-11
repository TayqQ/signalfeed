import { parseArgs } from "node:util";
import { SECTORS } from "@/core/sectors";
import { createPipelineDb } from "@/db/client";
import {
  ThemeAdminError,
  listThemes,
  mergeThemes,
  moveTag,
  renameTheme,
  setThemeSector,
  suggestMerges,
} from "@/pipeline/themes/theme-admin";
import { loadDotEnv } from "./env";

const USAGE = `Usage: pnpm themes <command>

  list [--unreviewed]               Active themes with companies, tags, name source and sector
  rename <slug> "<name>"            Set a theme's name. The naming step never changes it again
  sector <slug> <sector-slug>       Set a theme's sector
  merge <from-slug> <into-slug>     Move every tag of one theme into another
  move <tag-slug> <theme-slug|none> Put a tag in a theme, or in none. Assignment never changes it
  suggest-merges                    List pairs of themes that look alike. Changes nothing

Run it from a maintainer's machine with DATABASE_URL set. It never calls an LLM.`;

function required(value: string | undefined, what: string): string {
  if (!value) throw new ThemeAdminError(`Missing ${what}\n\n${USAGE}`);
  return value;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      unreviewed: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, first, second] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const known = ["list", "rename", "sector", "merge", "move", "suggest-merges"];
  if (!known.includes(command)) {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, close } = createPipelineDb(url);
  try {
    switch (command) {
      case "list": {
        const themes = await listThemes(db, { unreviewed: values.unreviewed });
        for (const theme of themes) {
          console.log(
            [
              theme.slug,
              JSON.stringify(theme.name),
              `name:${theme.nameSource}`,
              `sector:${theme.sector ?? "none"}`,
              `companies:${theme.companies}`,
              `reviewed:${theme.reviewedAt ? "yes" : "no"}`,
              `tags:${theme.tags.join(",")}`,
            ].join("  "),
          );
        }
        console.error(`${themes.length} themes`);
        return 0;
      }
      case "rename": {
        const theme = await renameTheme({
          db,
          slug: required(first, "theme slug"),
          name: required(second, "new name"),
        });
        console.log(JSON.stringify({ renamed: theme.slug, name: theme.name }));
        return 0;
      }
      case "sector": {
        const sector = required(second, "sector slug");
        if (!(SECTORS as readonly string[]).includes(sector)) {
          throw new ThemeAdminError(
            `Unknown sector "${sector}". Use one of: ${SECTORS.join(", ")}`,
          );
        }
        const theme = await setThemeSector({
          db,
          slug: required(first, "theme slug"),
          sector,
        });
        console.log(JSON.stringify({ theme: theme.slug, sector }));
        return 0;
      }
      case "merge": {
        const result = await mergeThemes({
          db,
          fromSlug: required(first, "slug of the theme to merge"),
          intoSlug: required(second, "slug of the theme to keep"),
        });
        console.log(
          JSON.stringify({
            merged: result.from.slug,
            into: result.into.slug,
            tagsMoved: result.tagsMoved,
          }),
        );
        return 0;
      }
      case "move": {
        const target = required(second, 'theme slug or "none"');
        const result = await moveTag({
          db,
          tagSlug: required(first, "tag slug"),
          themeSlug: target === "none" ? null : target,
        });
        console.log(
          JSON.stringify({
            tag: first,
            theme: result.toTheme?.slug ?? null,
          }),
        );
        return 0;
      }
      default: {
        const pairs = await suggestMerges(db);
        for (const pair of pairs) {
          console.log(
            `${pair.similarity.toFixed(3)}  ${pair.a.slug} (${pair.a.name})  ${pair.b.slug} (${pair.b.name})`,
          );
        }
        console.error(`${pairs.length} candidate pairs`);
        return 0;
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
