import { XMLParser, type X2jOptions } from "fast-xml-parser";
import type { CollectedItem } from "@/core/domain";

const SUMMARY_MAX_CHARS = 1000;

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
} satisfies X2jOptions;

const parser = new XMLParser(parserOptions);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  pound: "£",
  euro: "€",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
};

/**
 * Parse an RSS 2.0 or Atom document into collected items.
 * A single bad item is skipped. If the XML parser itself throws, this throws.
 */
export function parseFeed(xml: string, sourceSlug: string): CollectedItem[] {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to parse feed "${sourceSlug}": ${detail}`);
  }

  const items: CollectedItem[] = [];
  for (const raw of extractRawItems(parsed)) {
    try {
      const item = toCollectedItem(raw, sourceSlug);
      if (item) items.push(item);
    } catch {
      // Skip this item. One malformed entry must not discard the feed.
    }
  }
  return items;
}

function extractRawItems(parsed: unknown): unknown[] {
  const root = asRecord(parsed);
  if (!root) return [];

  const rss = asRecord(root.rss);
  if (rss) {
    const channels = asList(rss.channel);
    return channels.flatMap((channel) => asList(asRecord(channel)?.item));
  }

  if (root.feed !== undefined) {
    return asList(root.feed).flatMap((feed) => asList(asRecord(feed)?.entry));
  }

  return [];
}

function toCollectedItem(
  raw: unknown,
  sourceSlug: string,
): CollectedItem | null {
  const item = asRecord(raw);
  if (!item) return null;

  const title = toPlainText(fieldText(item.title) ?? "");
  const url = linkOf(item.link);
  if (title === null || url === null) return null;

  const summarySource =
    fieldText(item.description) ??
    fieldText(item.summary) ??
    fieldText(item.content);

  return {
    sourceSlug,
    externalId: scalarText(item.guid) ?? scalarText(item.id) ?? url,
    url,
    title,
    summary:
      summarySource === null
        ? null
        : toPlainText(summarySource, SUMMARY_MAX_CHARS),
    publishedAt: parsePublishedAt(
      firstPresent(item, ["pubDate", "published", "updated"]),
    ),
  };
}

function firstPresent(
  item: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    if (!Object.hasOwn(item, key)) continue;
    const text = scalarText(item[key]);
    if (text !== null) return text;
  }
  return null;
}

function parsePublishedAt(raw: string | null): Date | null {
  if (raw === null) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function linkOf(value: unknown): string | null {
  if (!isUnknownArray(value)) return linkFromNode(value);

  const candidates = value.filter((entry) => linkFromNode(entry) !== null);
  const alternates = candidates.filter((entry) => {
    const rel = attribute(entry, "@_rel");
    return rel === null || rel === "alternate";
  });
  const pool = alternates.length > 0 ? alternates : candidates;
  const html = pool.find((entry) => {
    const type = attribute(entry, "@_type");
    return type === null || type === "text/html";
  });
  const chosen = html ?? pool[0];
  return chosen === undefined ? null : linkFromNode(chosen);
}

function linkFromNode(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const href = record["@_href"];
  if (typeof href === "string" && href.trim().length > 0) return href.trim();
  return scalarText(record["#text"]);
}

function attribute(value: unknown, name: string): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const attr = record[name];
  return typeof attr === "string" && attr.length > 0 ? attr : null;
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const record = asRecord(value);
  if (!record) return null;
  return scalarText(record["#text"]);
}

function fieldText(value: unknown, depth = 0): string | null {
  if (depth > 12) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (isUnknownArray(value)) {
    const parts = value
      .map((entry) => fieldText(entry, depth + 1))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  const record = asRecord(value);
  if (!record) return null;

  const parts: string[] = [];
  const text = record["#text"];
  if (typeof text === "string" && text.length > 0) parts.push(text);
  for (const [key, child] of Object.entries(record)) {
    if (key === "#text" || key.startsWith("@_")) continue;
    const childText = fieldText(child, depth + 1);
    if (childText !== null) parts.push(childText);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function toPlainText(input: string, maxChars?: number): string | null {
  const stripped = stripHtml(input);
  const decoded = decodeEntities(stripped);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (maxChars === undefined) return collapsed;
  const chars = Array.from(collapsed);
  if (chars.length <= maxChars) return collapsed;
  return chars.slice(0, maxChars).join("");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (match, raw: string) => {
      const body = raw.toLowerCase();
      if (body.startsWith("#x")) {
        return codePointOr(match, Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return codePointOr(match, Number.parseInt(body.slice(1), 10));
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

function codePointOr(fallback: string, code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  return String.fromCodePoint(code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return isUnknownArray(value) ? value : [value];
}
