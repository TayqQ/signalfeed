/**
 * Builds src/lib/registry/sic-codes.json from the Companies House condensed
 * SIC 2007 list (a two-column CSV: "SIC Code,Description"). Run it by hand;
 * tests never call it and nothing here uses the network.
 *
 *   pnpm exec tsx scripts/registry/build-sic-codes.ts <csv-file> [out-file]
 *
 * Keep the CSV outside the repository. See scripts/registry/README.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format } from "prettier";

/** Splits one CSV line with optional double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Tidies spacing and capitalises the first letter. Wording is otherwise kept. */
export function cleanDescription(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.charAt(0).toUpperCase() + compact.slice(1);
}

export function parseSicCsv(csv: string): Record<string, string> {
  const lines = csv
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const result: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const [code, description] = splitCsvLine(line);
    const trimmed = (code ?? "").trim();
    if (!/^\d{5}$/.test(trimmed)) {
      throw new Error(`Unexpected SIC code: ${JSON.stringify(code)}`);
    }
    if (!description || description.trim() === "") {
      throw new Error(`No description for ${trimmed}`);
    }
    if (result[trimmed] !== undefined) {
      throw new Error(`Duplicate SIC code: ${trimmed}`);
    }
    result[trimmed] = cleanDescription(description);
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function main(): Promise<void> {
  const [csvPath, outArg] = process.argv.slice(2);
  if (!csvPath) {
    throw new Error("Usage: build-sic-codes.ts <csv-file> [out-file]");
  }
  const outPath =
    outArg ??
    path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "src/lib/registry/sic-codes.json",
    );
  const codes = parseSicCsv(readFileSync(csvPath, "utf8"));
  const text = await format(JSON.stringify(codes), { parser: "json" });
  writeFileSync(outPath, text);
  console.log(`Wrote ${Object.keys(codes).length} codes to ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
