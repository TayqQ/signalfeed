import type { HttpFetcher } from "@/core/ports";

/**
 * robots.txt for publisher fetches (D68), following RFC 9309. Pure parsing and
 * matching, plus a per-host checker that fetches, caches and spaces requests.
 * Phase 3.5 company-website fetching reuses this module.
 */

/**
 * Our product tokens. The user agent is `Raisory/...`; `SignalFeed` (the old
 * name) still matches, so a rule a site wrote for it keeps applying.
 */
export const ROBOTS_USER_AGENT_TOKENS: readonly string[] = [
  "Raisory",
  "SignalFeed",
];

/** RFC 9309 asks parsers to read at least 500 KiB. */
const MAX_ROBOTS_BYTES = 500 * 1024;
const ROBOTS_TIMEOUT_MS = 10_000;
export const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;
/** A longer `Crawl-delay` is capped, so one host cannot stall a run. */
export const MAX_CRAWL_DELAY_MS = 60_000;

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export interface RobotsRules {
  rules: Rule[];
  /** Seconds from `Crawl-delay` in the matched group, or null. */
  crawlDelaySeconds: number | null;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

/** Upper-cases percent escapes so `%2f` and `%2F` compare equal. */
function normalisePath(value: string): string {
  return value.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase());
}

function patternToRegex(pattern: string): RegExp {
  let source = "";
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  for (const char of body) {
    source += char === "*" ? ".*" : char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}${anchored ? "$" : ""}`, "s");
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  /** True while the last line was a `user-agent` line: more agents join the group. */
  let collectingAgents = false;

  const clipped = text.slice(0, MAX_ROBOTS_BYTES).replace(/^﻿/, "");
  for (const rawLine of clipped.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      collectingAgents = false;
      // A rule before any user-agent line belongs to no group.
      if (!current || value === "") continue;
      const pattern = normalisePath(value);
      current.rules.push({
        allow: key === "allow",
        pattern,
        regex: patternToRegex(pattern),
      });
      continue;
    }
    if (key === "crawl-delay") {
      collectingAgents = false;
      const seconds = Number(value);
      if (
        current &&
        current.crawlDelay === null &&
        value !== "" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      ) {
        current.crawlDelay = seconds;
      }
    }
    // `sitemap` and unknown lines neither start nor end a group.
  }
  return groups;
}

/**
 * Rules for our product tokens (case-insensitive). If any group names one of
 * them, only those groups apply (merged); otherwise the `*` groups; otherwise
 * there are no rules.
 */
export function parseRobots(
  text: string,
  tokens: readonly string[] = ROBOTS_USER_AGENT_TOKENS,
): RobotsRules {
  const groups = parseGroups(text);
  const wanted = new Set(tokens.map((t) => t.toLowerCase()));
  let matched = groups.filter((g) => g.agents.some((a) => wanted.has(a)));
  if (matched.length === 0) {
    matched = groups.filter((g) => g.agents.includes("*"));
  }
  const delays = matched
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== null);
  return {
    rules: matched.flatMap((g) => g.rules),
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : null,
  };
}

/** Longest matching pattern wins; `Allow` wins a tie; no match means allowed. */
export function isPathAllowed(
  robots: RobotsRules,
  pathAndQuery: string,
): boolean {
  const path = normalisePath(pathAndQuery || "/");
  let best: Rule | null = null;
  for (const rule of robots.rules) {
    if (!rule.regex.test(path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export type RobotsDecision =
  | { allowed: true; crawlDelayMs: number | null }
  | { allowed: false; reason: "disallowed" | "unavailable" };

/** Thrown by a collector when robots.txt stops a fetch. Not a feed failure. */
export class RobotsSkipError extends Error {
  readonly reason: "disallowed" | "unavailable";
  constructor(url: string, reason: "disallowed" | "unavailable") {
    super(
      reason === "disallowed"
        ? `disallowed by robots.txt: ${url}`
        : `robots.txt unavailable, host skipped this run: ${url}`,
    );
    this.name = "RobotsSkipError";
    this.reason = reason;
  }
}

export interface RobotsChecker {
  /** Decision for a URL, from the cached robots.txt of its host. */
  check(url: string): Promise<RobotsDecision>;
  /**
   * `check`, then (when allowed) waits so requests to one host are at least
   * `Crawl-delay` apart. Call it right before each publisher request.
   */
  beforeFetch(url: string): Promise<RobotsDecision>;
}

export interface CreateRobotsCheckerOptions {
  fetcher: HttpFetcher;
  tokens?: readonly string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cacheMs?: number;
}

type HostEntry =
  | { kind: "rules"; robots: RobotsRules; fetchedAt: number }
  | { kind: "open"; fetchedAt: number }
  | { kind: "unavailable"; fetchedAt: number };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** robots.txt answers that mean "not for you": treated as disallow-all. */
const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

/**
 * Status rules: 2xx parses the file. 404, 410 and other 4xx mean no rules
 * (allowed), as RFC 9309 says. 401, 403 and 429 are stricter than the RFC: a
 * host that refuses us its robots.txt is treated as disallowing everything
 * for this run, because we can't see rules it may have (Tech.eu blocks
 * GitHub's IPs and its robots.txt disallows /feed/). 5xx, any other status, a
 * network error or a timeout also disallows the whole host for this run. Every outcome is cached per host for 24 hours, in memory.
 */
export function createRobotsChecker(
  options: CreateRobotsCheckerOptions,
): RobotsChecker {
  const tokens = options.tokens ?? ROBOTS_USER_AGENT_TOKENS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const cacheMs = options.cacheMs ?? ROBOTS_CACHE_MS;
  const cache = new Map<string, Promise<HostEntry>>();
  const lastRequestAt = new Map<string, number>();

  async function load(origin: string): Promise<HostEntry> {
    const fetchedAt = now();
    try {
      const response = await options.fetcher.get(`${origin}/robots.txt`, {
        timeoutMs: ROBOTS_TIMEOUT_MS,
      });
      if (response.status >= 200 && response.status < 300) {
        return {
          kind: "rules",
          robots: parseRobots(response.body, tokens),
          fetchedAt,
        };
      }
      if (REFUSED_STATUSES.has(response.status)) {
        return { kind: "unavailable", fetchedAt };
      }
      if (response.status >= 400 && response.status < 500) {
        return { kind: "open", fetchedAt };
      }
      return { kind: "unavailable", fetchedAt };
    } catch {
      return { kind: "unavailable", fetchedAt };
    }
  }

  function entryFor(origin: string): Promise<HostEntry> {
    const cached = cache.get(origin);
    if (cached) {
      return cached.then((entry) => {
        if (now() - entry.fetchedAt < cacheMs) return entry;
        const fresh = load(origin);
        cache.set(origin, fresh);
        return fresh;
      });
    }
    const loading = load(origin);
    cache.set(origin, loading);
    return loading;
  }

  async function check(url: string): Promise<RobotsDecision> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { allowed: false, reason: "disallowed" };
    }
    const entry = await entryFor(parsed.origin);
    if (entry.kind === "unavailable") {
      return { allowed: false, reason: "unavailable" };
    }
    if (entry.kind === "open") return { allowed: true, crawlDelayMs: null };
    if (!isPathAllowed(entry.robots, parsed.pathname + parsed.search)) {
      return { allowed: false, reason: "disallowed" };
    }
    const seconds = entry.robots.crawlDelaySeconds;
    return {
      allowed: true,
      crawlDelayMs:
        seconds === null ? null : Math.min(seconds * 1000, MAX_CRAWL_DELAY_MS),
    };
  }

  return {
    check,
    async beforeFetch(url) {
      const decision = await check(url);
      if (!decision.allowed) return decision;
      const host = new URL(url).origin;
      const last = lastRequestAt.get(host);
      if (decision.crawlDelayMs !== null && last !== undefined) {
        const wait = decision.crawlDelayMs - (now() - last);
        if (wait > 0) await sleep(wait);
      }
      lastRequestAt.set(host, now());
      return decision;
    },
  };
}
