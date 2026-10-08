const LEGAL_SUFFIXES = new Set([
  "ab",
  "bv",
  "co",
  "corp",
  "gmbh",
  "inc",
  "limited",
  "llc",
  "ltd",
  "oy",
  "plc",
  "sas",
]);

/** Trailing words removed from company names and kept for investors. */
const INVESTOR_WORDS = new Set(["capital", "venture", "ventures"]);

const LETTERS: Readonly<Record<string, string>> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
  ŋ: "n",
  ħ: "h",
};

/**
 * Multi-part public suffixes used to find a registrable host.
 * Single-label suffixes fall back to the final label.
 */
const MULTI_PART_SUFFIXES = new Set([
  "ac.uk",
  "co.id",
  "co.il",
  "co.in",
  "co.jp",
  "co.ke",
  "co.kr",
  "co.nz",
  "co.th",
  "co.uk",
  "co.za",
  "com.ar",
  "com.au",
  "com.br",
  "com.cn",
  "com.hk",
  "com.mx",
  "com.my",
  "com.ng",
  "com.ph",
  "com.pk",
  "com.sg",
  "com.tr",
  "com.tw",
  "com.ua",
  "com.vn",
  "gov.uk",
  "net.au",
  "org.uk",
]);

/** Generic TLDs longer than two letters. Two-letter labels are treated as ccTLDs. */
const GENERIC_TLDS = new Set([
  "agency",
  "app",
  "biz",
  "capital",
  "cloud",
  "club",
  "com",
  "consulting",
  "design",
  "dev",
  "digital",
  "finance",
  "fund",
  "gmbh",
  "group",
  "health",
  "inc",
  "info",
  "labs",
  "llc",
  "ltd",
  "media",
  "money",
  "net",
  "network",
  "news",
  "online",
  "org",
  "plc",
  "pro",
  "shop",
  "site",
  "software",
  "solutions",
  "store",
  "studio",
  "systems",
  "tech",
  "venture",
  "ventures",
  "world",
  "xyz",
]);

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "ref"]);
const MAX_SLUG_LENGTH = 60;
const MAX_TAG_LENGTH = 40;

function stripDiacritics(value: string): string {
  const replaced = Array.from(value, (char) => LETTERS[char] ?? char).join("");
  return replaced.normalize("NFD").replace(/\p{M}+/gu, "");
}

function suffixKey(token: string): string {
  return token.replace(/[^a-z0-9]/g, "");
}

function stripLegalSuffixes(value: string): string {
  const tokens = value.split(/\s+/).filter((token) => token.length > 0);
  const kept = tokens.filter((token) => {
    const key = suffixKey(token);
    return key.length > 0 && !LEGAL_SUFFIXES.has(key);
  });
  return (kept.length > 0 ? kept : tokens).join(" ");
}

function stripTrailingWords(value: string, words: ReadonlySet<string>): string {
  const tokens = value.split(/\s+/).filter((token) => token.length > 0);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (!last || !words.has(suffixKey(last))) break;
    tokens.pop();
  }
  return tokens.join(" ");
}

function publicSuffixLength(labels: readonly string[]): number {
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length >= 2 && MULTI_PART_SUFFIXES.has(lastTwo)) return 2;
  return 1;
}

function isKnownPublicSuffix(
  labels: readonly string[],
  suffixLength: number,
): boolean {
  if (suffixLength >= 2) return true;
  const tld = labels[labels.length - 1] ?? "";
  return tld.length === 2 || GENERIC_TLDS.has(tld);
}

/** Brand label of a domain-style token, or null when the token is not a domain. */
function domainStyleBase(value: string): string | null {
  if (/\s/.test(value)) return null;
  const token = value.replace(/^www\./, "").replace(/\.+$/g, "");
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,24}$/.test(token)) return null;
  const labels = token.split(".");
  const suffixLength = publicSuffixLength(labels);
  if (!isKnownPublicSuffix(labels, suffixLength)) return null;
  return labels[labels.length - suffixLength - 1] ?? null;
}

function stripPunctuation(value: string): string {
  return value
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseName(name: string, stripInvestorWords: boolean): string {
  const prepared = stripDiacritics(name.toLowerCase()).replace(/[,;]+/g, " ");
  const withoutLegal = stripLegalSuffixes(prepared);
  const withoutWords = stripInvestorWords
    ? stripTrailingWords(withoutLegal, INVESTOR_WORDS)
    : withoutLegal;
  return stripPunctuation(domainStyleBase(withoutWords) ?? withoutWords);
}

/** Spec section 7. Also drops a trailing "capital" or "ventures". */
export function normaliseCompanyName(name: string): string {
  return normaliseName(name, true);
}

/** Company rules, but words such as "capital" and "ventures" are kept. */
export function normaliseInvestorName(name: string): string {
  return normaliseName(name, false);
}

/** ASCII kebab-case, at most 60 characters, with no leading or trailing hyphen. */
export function slugify(name: string): string {
  const slug = stripDiacritics(name.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Lowercases the host, drops tracking parameters and the fragment, sorts the
 * remaining query, and removes any trailing slash.
 */
export function canonicaliseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  const kept: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const normalisedKey = key.toLowerCase();
    if (
      normalisedKey.startsWith("utm_") ||
      TRACKING_PARAMS.has(normalisedKey)
    ) {
      continue;
    }
    kept.push([key, value]);
  }
  kept.sort((left, right) => {
    const byKey = compareCodePoints(left[0], right[0]);
    return byKey === 0 ? compareCodePoints(left[1], right[1]) : byKey;
  });
  parsed.search = "";
  for (const [key, value] of kept) {
    parsed.searchParams.append(key, value);
  }
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
  }
  if (parsed.pathname === "/") {
    return parsed.toString().replace(/\/(?=\?|$)/, "");
  }
  return parsed.toString();
}

function hostnameOf(urlOrDomain: string): string | null {
  const trimmed = urlOrDomain.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const hostname = new URL(withScheme).hostname
      .toLowerCase()
      .replace(/\.$/g, "");
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/** Registrable host (eTLD+1) with a leading `www.` removed by that rule. */
export function extractDomain(urlOrDomain: string): string {
  const hostname = hostnameOf(urlOrDomain);
  if (!hostname) return "";
  if (isIpAddress(hostname)) return hostname;
  const labels = hostname.split(".").filter((label) => label.length > 0);
  if (labels.length <= 1) return labels[0] ?? "";
  const suffixLength = publicSuffixLength(labels);
  const start = Math.max(labels.length - suffixLength - 1, 0);
  return labels.slice(start).join(".");
}

/** Lowercase, trimmed, collapsed whitespace, `&` to `and`, at most 40 characters. */
export function normaliseTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `domain` appears in any text as a host, including a trailing
 * sentence dot, and not as part of a longer host such as `notacme.com`.
 */
export function domainAppearsIn(
  domain: string,
  texts: readonly string[],
): boolean {
  const needle = domain.trim().toLowerCase();
  if (!needle) return false;
  const pattern = new RegExp(
    `(?:^|[^a-z0-9-])${escapeRegExp(needle)}(?:$|[^a-z0-9.]|\\.(?=$|[^a-z0-9]))`,
    "i",
  );
  return texts.some((text) => pattern.test(text));
}
