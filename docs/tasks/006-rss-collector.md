# 006 RSS collector

- **Tier:** 2 (a collector against a fixed port). **Suggested model:** Grok 4.7 or Claude Sonnet.
- **Depends on:** 001, 003. **Wave:** 3.

## Goal
Build the configured source list and an RSS/Atom collector that turns a feed into `CollectedItem[]` using the `HttpFetcher` port.

## Why it matters
This is the only way data enters Phase 1. Robust parsing and conditional requests keep the system polite to publishers and cheap to run.

## Read first
- `AGENTS.md`
- `docs/sources.md` (the final table)
- `docs/spec.md` (section 7, step 2)
- `src/core/domain.ts`, `src/core/ports.ts`, `src/core/enums.ts`

## Files you may create or change
- `src/pipeline/sources.ts`
- `src/pipeline/collect/parse-feed.ts`, `src/pipeline/collect/parse-feed.test.ts`
- `src/pipeline/collect/rss.ts`, `src/pipeline/collect/rss.test.ts`
- `fixtures/feeds/*.xml` (synthetic feeds written by you; never copy real publisher text)

## Requirements
- **`sources.ts`:** `export const SOURCES: SourceConfig[]`, taken from the `docs/sources.md` table (slug, name, kind `'rss'`, url, priority, enabled).
- **`parse-feed.ts`:** `parseFeed(xml: string, sourceSlug: string): CollectedItem[]`, using `fast-xml-parser`. It must:
  - support RSS 2.0 and Atom;
  - set `externalId` from `guid`, then `id`, then the link;
  - turn the description into plain text (strip HTML, decode entities, collapse whitespace, at most 1,000 characters);
  - parse `publishedAt` from `pubDate`, `published` or `updated`, giving `null` if invalid;
  - skip items without a title or link;
  - never throw on one bad item.
- **`rss.ts`:** `createRssCollector(fetcher: HttpFetcher): Collector`. It passes ETag/Last-Modified through, returns `notModified: true` with no items on 304, and throws a descriptive error on other non-2xx responses. URLs are returned raw; canonicalisation happens in the store (Task 010).
- **Fixtures:** at least `rss2-basic.xml`, `rss2-html-description.xml`, `atom-basic.xml`, `malformed-item.xml`. Use invented headlines such as "Example Robotics raises £4M seed".

## Acceptance criteria
- `pnpm check` passes.
- Tests prove: RSS and Atom parsing, HTML stripping, a missing guid falling back to the link, an invalid date becoming `null`, a malformed item being skipped while the others are kept, 304 handling, and conditional headers being sent (using a fake `HttpFetcher`).
- Every `SOURCES` entry has a unique slug and a valid URL (tested).

## Out of scope
- Writing to the database (010), prefiltering (007), HN/GitHub/YC collectors (Phase 2).
